/**
 * The x402 erc7710 flow, live: an HTTP facilitator settles Mapae-delegated payments on GIWA
 * Sepolia without holding any policy - or any funds.
 *
 *   pnpm tsx scripts/facilitator-demo.ts <accountAddress>
 *
 * Three parties, three keys:
 *   principal   signs the ROOT delegation (4 caveats: identity, cap, payee, window)
 *   agent       signs a LEAF re-delegation to the facilitator's settlement address
 *   facilitator broadcasts redemptions and pays gas; funds move account -> merchant directly
 *
 * What this proves that scripts/demo.ts cannot:
 *   - the client needs ZERO gas: it signs two typed-data payloads and speaks HTTP;
 *   - one signed payload settles MULTIPLE times - erc7710 is the only x402 exact/EVM
 *     assetTransferMethod with that property (an EIP-3009 authorization dies with its nonce);
 *   - the facilitator rejects an over-cap settlement with a decoded on-chain reason, having
 *     evaluated no policy itself - verification IS simulation of the delegation manager.
 */
import "./env.js";
import assert from "node:assert/strict";
import {appendFileSync} from "node:fs";
import {createPublicClient, http, keccak256, toHex, type Address, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {addresses, giwaSepolia, TESTNET_FAUCET_ID, ROOT_AUTHORITY} from "../sdk/src/constants.js";
import {
    delegationDomain,
    delegationHash,
    dojangTerms,
    encodePermissionContext,
    payeeTerms,
    periodTerms,
    rootDelegation,
    timestampTerms,
    DELEGATION_TYPES,
    type Delegation,
} from "../sdk/src/delegation.js";
import {erc20Abi, accountAbi} from "../sdk/src/abi.js";

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://127.0.0.1:8402";
const principal = privateKeyToAccount(process.env.PRINCIPAL_PRIVATE_KEY as Hex);
const agent = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as Hex);
const MERCHANT = privateKeyToAccount(keccak256(toHex("mapae-demo-merchant"))).address;

const ACCOUNT = process.argv[2] as Address;
assert(ACCOUNT?.startsWith("0x"), "usage: pnpm tsx scripts/facilitator-demo.ts <mapaeAccountAddress>");

const pub = createPublicClient({
    chain: giwaSepolia,
    transport: http(process.env.GIWA_SEPOLIA_RPC_URL ?? "https://sepolia-rpc.giwa.io"),
});

const post = async (path: string, body: unknown) => {
    const res = await fetch(`${FACILITATOR_URL}${path}`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(body),
    });
    return res.json();
};

/* ------------------------- 1. discover the facilitator ------------------------- */

const supported = await (await fetch(`${FACILITATOR_URL}/supported`)).json();
const kind = supported.kinds[0];
const facilitatorSigner = supported.signers["eip155:*"][0] as Address;
console.log(`facilitator serves ${kind.network} ${kind.scheme}/${kind.extra.assetTransferMethods}`);
console.log(`  settlement signer ${facilitatorSigner}`);
console.log(`  pinned manager    ${kind.extra.delegationManager}`);
assert.equal(kind.extra.delegationManager, addresses.manager, "facilitator pins a different manager");

const owner = await pub.readContract({address: ACCOUNT, abi: accountAbi, functionName: "owner"});
assert.equal(owner.toLowerCase(), principal.address.toLowerCase(), "account not owned by principal");

/* ------------------- 2. root delegation: principal -> agent -------------------- */

const now = BigInt(Math.floor(Date.now() / 1000));
const salt = BigInt(Date.now());

const sign = (signer: typeof principal, d: Delegation) =>
    signer.signTypedData({
        domain: delegationDomain(giwaSepolia.id, addresses.manager),
        types: DELEGATION_TYPES,
        primaryType: "Delegation",
        message: {
            delegate: d.delegate,
            delegator: d.delegator,
            authority: d.authority,
            caveats: d.caveats.map((c) => ({enforcer: c.enforcer, terms: c.terms})),
            salt: d.salt,
        },
    });

const root = rootDelegation({
    delegate: agent.address,
    delegator: ACCOUNT,
    caveats: [
        {enforcer: addresses.dojangEnforcer, terms: dojangTerms(TESTNET_FAUCET_ID, principal.address), args: "0x"},
        {enforcer: addresses.periodEnforcer, terms: periodTerms(addresses.mockKRW, 50_000n, 86_400n, now - 60n), args: "0x"},
        {enforcer: addresses.payeeEnforcer, terms: payeeTerms([MERCHANT]), args: "0x"},
        {enforcer: addresses.timestampEnforcer, terms: timestampTerms(0n, now + 7n * 86_400n), args: "0x"},
    ],
    salt,
});
root.signature = await sign(principal, root);

/* ------------- 3. leaf delegation: agent -> facilitator's signer --------------- */
// The agent re-delegates redemption authority to the settlement address advertised in
// /supported. No caveats needed: scope is fully carried by the root, and a leaf cannot widen it
// (pinned by test_Redelegation_ChildCannotWidenParentCap).

const leaf: Delegation = {
    delegate: facilitatorSigner,
    delegator: agent.address,
    authority: delegationHash(root),
    caveats: [],
    salt,
    signature: "0x",
};
leaf.signature = await sign(agent, leaf);

const permissionContext = encodePermissionContext([leaf, root]);
console.log(`\ndelegation chain signed: principal -> agent -> facilitator (${(permissionContext.length - 2) / 2} bytes)`);

/* ------------------------------ 4. the x402 dance ------------------------------ */

const requirements = (amount: string) => ({
    scheme: "exact",
    network: "eip155:91342",
    asset: addresses.mockKRW,
    amount,
    payTo: MERCHANT,
    maxTimeoutSeconds: 60,
    extra: {assetTransferMethod: "erc7710"},
});
const payload = {
    x402Version: 2,
    payload: {permissionContext, delegationManager: addresses.manager},
    accepted: requirements("20000"),
};

const merchantBefore = await pub.readContract({address: addresses.mockKRW, abi: erc20Abi, functionName: "balanceOf", args: [MERCHANT]});
const results: string[] = [];
const record = (label: string, detail: string, tx?: string) => {
    const line = `| ${label} | ${detail} | ${tx ? `[${tx.slice(0, 10)}…](https://sepolia-explorer.giwa.io/tx/${tx})` : "-"} |`;
    results.push(line);
    console.log(`  ${label}: ${detail}${tx ? `\n    https://sepolia-explorer.giwa.io/tx/${tx}` : ""}`);
};

console.log("\nF1. /verify - a valid 20,000 payment");
const v1 = await post("/verify", {paymentPayload: payload, paymentRequirements: requirements("20000")});
assert.equal(v1.isValid, true, JSON.stringify(v1));
assert.equal(v1.payer?.toLowerCase(), ACCOUNT.toLowerCase(), "payer should be the root delegator");
record("F1 /verify 20,000", `isValid=true, payer=${v1.payer} (the account, not the agent)`);

console.log("\nF2. /verify - 60,000, over the daily cap");
const v2 = await post("/verify", {paymentPayload: {...payload, accepted: requirements("60000")}, paymentRequirements: requirements("60000")});
assert.equal(v2.isValid, false);
assert.equal(v2.invalidReason, "delegation_cap_exceeded", JSON.stringify(v2));
record("F2 /verify 60,000", `isValid=false, reason=${v2.invalidReason} - the facilitator evaluated NO policy; the chain did`);

console.log("\nF3. /settle - 20,000, first settlement");
const s1 = await post("/settle", {paymentPayload: payload, paymentRequirements: requirements("20000")});
assert.equal(s1.success, true, JSON.stringify(s1));
await pub.waitForTransactionReceipt({hash: s1.transaction, timeout: 90_000});
record("F3 /settle 20,000", `success, gas paid by facilitator, funds account->merchant`, s1.transaction);

console.log("\nF4. /settle - 20,000 AGAIN from the SAME signed payload (multi-use)");
const s2 = await post("/settle", {paymentPayload: payload, paymentRequirements: requirements("20000")});
assert.equal(s2.success, true, JSON.stringify(s2));
await pub.waitForTransactionReceipt({hash: s2.transaction, timeout: 90_000});
record("F4 /settle 20,000 again", `success - one payload, second settlement. An EIP-3009 authorization cannot do this`, s2.transaction);

console.log("\nF5. /settle - 20,000 a third time: 60,000 total would breach the cap");
const s3 = await post("/settle", {paymentPayload: payload, paymentRequirements: requirements("20000")});
assert.equal(s3.success, false);
assert.equal(s3.errorReason, "delegation_cap_exceeded", JSON.stringify(s3));
record("F5 /settle third 20,000", `rejected before broadcast: reason=${s3.errorReason} - fee payer wasted zero gas`);

// The two settlements must be visible before we assert the delta.
let merchantAfter = merchantBefore;
for (let i = 0; i < 45; i++) {
    merchantAfter = await pub.readContract({address: addresses.mockKRW, abi: erc20Abi, functionName: "balanceOf", args: [MERCHANT]});
    if (merchantAfter - merchantBefore === 40_000n) break;
    await new Promise((r) => setTimeout(r, 1000));
}
assert.equal(merchantAfter - merchantBefore, 40_000n, "merchant should have received exactly 40,000");
console.log(`\nmerchant delta: +₩${merchantAfter - merchantBefore} across two facilitator settlements`);

appendFileSync(
    "docs/DEMO.md",
    `
## x402 facilitator - the erc7710 path, live

An HTTP facilitator ([gosuda/x402-facilitator](https://github.com/gosuda/x402-facilitator),
\`feat/giwa-erc7710\`) settling Mapae delegations. The client signed two typed-data payloads and
spoke HTTP - it broadcast nothing and needed no gas. The facilitator held no policy and no funds:
verification is simulation of the delegation manager, and every cap, payee, window and identity
check ran on-chain.

Chain: principal -> agent (4 caveats) -> facilitator settlement signer \`${facilitatorSigner}\`.

| Step | Result | Tx |
|---|---|---|
${results.join("\n")}

Merchant received exactly ₩40,000 across two settlements of ONE signed payload - multi-use is the
property that distinguishes erc7710 from eip3009/permit2 in the x402 exact/EVM spec.
`,
);
console.log("appended facilitator section to docs/DEMO.md");
console.log("\nfacilitator demo: all assertions held");
