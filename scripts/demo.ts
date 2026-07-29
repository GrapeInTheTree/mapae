/**
 * The Mapae live demo: T1-T8 as REAL transactions on GIWA Sepolia.
 *
 * Every case rehearsed in test/integration/EndToEnd.t.sol runs here against the deployed,
 * source-verified contracts, and every hash - successes AND rejections - lands in docs/DEMO.md as
 * a clickable explorer link. Rejections are deliberately broadcast after simulation: a reverted
 * transaction on a public explorer with a decoded custom error is the difference between claiming
 * the scope is enforced and letting a reviewer click it.
 *
 *   pnpm demo
 *
 * Requires .env: GIWA_SEPOLIA_RPC_URL, PRINCIPAL_PRIVATE_KEY (funded), AGENT_PRIVATE_KEY.
 * Budget per run: ~0.002 ETH attestation fees (T7 revoke -> T8 re-issue) + dust for gas.
 *
 * RPC-consistency posture, learned the hard way: the public endpoint load-balances across
 * backends that lag each other by a few blocks. The sequencer always executes against canonical
 * state, so BROADCASTS are never wrong - but naive reads, simulations, gas estimations and nonce
 * fetches all race. Consequently this script:
 *   - never estimates gas (fixed 1.5M limit; per-tx cap on GIWA is 16.7M, cost is dust);
 *   - never fetches nonces mid-run (fetched once, tracked locally);
 *   - treats simulation as ADVISORY, polling it until it agrees with the expected outcome, and
 *     lets the receipt be the only truth;
 *   - polls every state transition (attest/revoke/disable/enable) until VISIBLE before any
 *     dependent step.
 */
import "./env.js";
import {mkdirSync, writeFileSync} from "node:fs";
import {
    createPublicClient,
    createWalletClient,
    decodeErrorResult,
    encodeFunctionData,
    formatEther,
    http,
    keccak256,
    parseEther,
    toHex,
    type Address,
    type Hex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {
    addresses,
    giwaSepolia,
    MODE_SIMPLE_SINGLE,
    TESTNET_FAUCET_ID,
    UPBIT_KOREA_ID,
} from "../sdk/src/constants.js";
import {
    dojangTerms,
    encodeErc20Transfer,
    encodeExecutionSingle,
    encodePermissionContext,
    payeeTerms,
    periodTerms,
    rootDelegation,
    timestampTerms,
    DELEGATION_TYPES,
    delegationDomain,
    type Delegation,
} from "../sdk/src/delegation.js";
import {
    accountAbi,
    dojangScrollAbi,
    enforcerErrorsAbi,
    erc20Abi,
    factoryAbi,
    faucetExtensionAbi,
    managerAbi,
} from "../sdk/src/abi.js";

/* ---------------------------------- setup ---------------------------------- */

const rpc = process.env.GIWA_SEPOLIA_RPC_URL ?? "https://sepolia-rpc.giwa.io";
const principal = privateKeyToAccount(process.env.PRINCIPAL_PRIVATE_KEY as Hex);
const agent = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as Hex);

// Deterministic bystanders - they never sign anything.
const MERCHANT = privateKeyToAccount(keccak256(toHex("mapae-demo-merchant"))).address;
const ATTACKER = privateKeyToAccount(keccak256(toHex("mapae-demo-attacker"))).address;

const pub = createPublicClient({chain: giwaSepolia, transport: http(rpc)});
const wallets = {
    principal: createWalletClient({account: principal, chain: giwaSepolia, transport: http(rpc)}),
    agent: createWalletClient({account: agent, chain: giwaSepolia, transport: http(rpc)}),
} as const;
const accounts = {principal, agent} as const;
const nonces: Record<"principal" | "agent", number> = {principal: -1, agent: -1};

const errorAbi = [...managerAbi, ...enforcerErrorsAbi, ...factoryAbi];
const explorer = (h: string) => `https://sepolia-explorer.giwa.io/tx/${h}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row {
    id: string;
    title: string;
    expected: string;
    hash?: string;
    status: "success" | "reverted" | "skipped";
    decoded?: string;
}
const rows: Row[] = [];

function decodeRevert(data: Hex | undefined): string {
    if (!data || data === "0x") return "(no revert data)";
    try {
        const d = decodeErrorResult({abi: errorAbi, data});
        const args = d.args?.length ? `(${d.args.map(String).join(", ")})` : "()";
        return `${d.errorName}${args}`;
    } catch {
        return `raw: ${data.slice(0, 74)}`;
    }
}

function extractRevertData(err: unknown): Hex | undefined {
    let e: any = err;
    while (e) {
        if (typeof e.data === "string" && e.data.startsWith("0x")) return e.data as Hex;
        if (typeof e.data === "object" && typeof e.data?.data === "string") return e.data.data as Hex;
        e = e.cause;
    }
    return undefined;
}

async function waitUntil(label: string, fn: () => Promise<boolean>, timeoutMs = 45_000): Promise<void> {
    const start = Date.now();
    for (;;) {
        try {
            if (await fn()) return;
        } catch {
            /* transient RPC failure - keep polling */
        }
        if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for: ${label}`);
        await sleep(1_000);
    }
}

/** Simulate (advisory, polled toward the expectation), then broadcast with fixed gas and a
 *  locally tracked nonce. The receipt is the only truth. */
async function send(
    id: string,
    title: string,
    expected: "success" | `revert: ${string}`,
    from: "principal" | "agent",
    to: Address,
    data: Hex,
    value = 0n,
): Promise<Row> {
    const expectRevert = expected.startsWith("revert");
    let decoded: string | undefined;

    const deadline = Date.now() + 30_000;
    for (;;) {
        try {
            await pub.call({account: accounts[from].address, to, data, value});
            decoded = undefined;
            if (!expectRevert) break;
        } catch (err) {
            decoded = decodeRevert(extractRevertData(err));
            if (expectRevert) break;
        }
        if (Date.now() > deadline) break; // proceed; the receipt decides
        await sleep(1_000);
    }

    const hash = await wallets[from].sendTransaction({
        to,
        data,
        value,
        gas: 1_500_000n,
        nonce: nonces[from]++,
    });
    const receipt = await pub.waitForTransactionReceipt({hash, timeout: 90_000});

    const row: Row = {id, title, expected, hash, status: receipt.status, decoded};
    rows.push(row);
    const mark = receipt.status === "success" ? "OK " : "REV";
    console.log(`  [${mark}] ${id} ${title}${decoded ? ` -> ${decoded}` : ""}`);
    console.log(`        ${explorer(hash)}`);
    return row;
}

async function main() {
    console.log(`principal ${principal.address}`);
    console.log(`agent     ${agent.address}`);
    console.log(`merchant  ${MERCHANT}`);
    console.log(`attacker  ${ATTACKER}\n`);

    const principalBal = await pub.getBalance({address: principal.address});
    console.log(`principal balance: ${formatEther(principalBal)} ETH`);
    if (principalBal < parseEther("0.0025")) throw new Error("principal underfunded; claim from faucets first");

    nonces.principal = await pub.getTransactionCount({address: principal.address, blockTag: "pending"});
    nonces.agent = await pub.getTransactionCount({address: agent.address, blockTag: "pending"});

    const merchantBefore = await pub.readContract({
        address: addresses.mockKRW,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [MERCHANT],
    });

    /* ------------------------------ 0. plumbing ------------------------------ */

    if ((await pub.getBalance({address: agent.address})) < parseEther("0.0002")) {
        await send("S0", "Fund agent for gas", "success", "principal", agent.address, "0x", parseEther("0.0005"));
    }

    /* --------------------------- 1. the Mapae account ------------------------- */

    const accountSalt = BigInt(Date.now());
    const consentDigest = await pub.readContract({
        address: addresses.factory,
        abi: factoryAbi,
        functionName: "creationDigest",
        args: [principal.address, accountSalt],
    });
    const consent = await principal.sign({hash: consentDigest});
    const ACCOUNT = (await pub.readContract({
        address: addresses.factory,
        abi: factoryAbi,
        functionName: "predict",
        args: [principal.address, accountSalt],
    })) as Address;

    await send(
        "S1",
        "Create MapaeAccount (owner EIP-712 consent)",
        "success",
        "principal",
        addresses.factory,
        encodeFunctionData({abi: factoryAbi, functionName: "createAccount", args: [principal.address, accountSalt, consent]}),
    );
    console.log(`MapaeAccount ${ACCOUNT} (salt ${accountSalt})`);

    await send(
        "S2",
        "Fund account with 1,000,000 mKRW",
        "success",
        "principal",
        addresses.mockKRW,
        encodeFunctionData({abi: erc20Abi, functionName: "mint", args: [ACCOUNT, 1_000_000n]}),
    );

    /* ----------------------- 2. the identity (Dojang) ------------------------ */

    const isVerified = () =>
        pub.readContract({
            address: addresses.dojangScroll,
            abi: dojangScrollAbi,
            functionName: "isVerified",
            args: [principal.address, TESTNET_FAUCET_ID],
        });

    if (!(await isVerified())) {
        const fee = await pub.readContract({
            address: addresses.giwaFaucetExtension,
            abi: faucetExtensionAbi,
            functionName: "fee",
        });
        await send(
            "S3",
            "Principal obtains Dojang attestation (payAndIssueEAS)",
            "success",
            "principal",
            addresses.giwaFaucetExtension,
            encodeFunctionData({abi: faucetExtensionAbi, functionName: "payAndIssueEAS"}),
            fee,
        );
    } else {
        rows.push({id: "S3", title: "Principal already holds a live Dojang attestation", expected: "-", status: "skipped"} as unknown as Row);
        console.log("principal already Dojang-verified");
    }
    await waitUntil("attestation visible on read path", isVerified);

    /* ------------------------- 3. the signed delegation ----------------------- */

    const now = BigInt(Math.floor(Date.now() / 1000));
    const buildDelegation = (attesterId: Hex): Delegation =>
        rootDelegation({
            delegate: agent.address,
            delegator: ACCOUNT,
            caveats: [
                {enforcer: addresses.dojangEnforcer, terms: dojangTerms(attesterId, principal.address), args: "0x"},
                {enforcer: addresses.periodEnforcer, terms: periodTerms(addresses.mockKRW, 50_000n, 86_400n, now - 60n), args: "0x"},
                {enforcer: addresses.payeeEnforcer, terms: payeeTerms([MERCHANT]), args: "0x"},
                {enforcer: addresses.timestampEnforcer, terms: timestampTerms(0n, now + 7n * 86_400n), args: "0x"},
            ],
            salt: accountSalt,
        });

    const signDelegation = async (d: Delegation): Promise<Delegation> => ({
        ...d,
        signature: await principal.signTypedData({
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
        }),
    });

    const delegation = await signDelegation(buildDelegation(TESTNET_FAUCET_ID));
    const wrongIssuer = await signDelegation(buildDelegation(UPBIT_KOREA_ID));

    console.log(`\ndelegation signed: agent may pay MERCHANT <=50,000 mKRW/day until +7d,`);
    console.log(`while the principal's Dojang attestation stays live\n`);

    const redeemData = (d: Delegation, to: Address, amount: bigint): Hex =>
        encodeFunctionData({
            abi: managerAbi,
            functionName: "redeemDelegations",
            args: [
                [encodePermissionContext([d])],
                [MODE_SIMPLE_SINGLE],
                [encodeExecutionSingle(addresses.mockKRW, 0n, encodeErc20Transfer(to, amount))],
            ],
        });

    const ownerCall = (fn: "disableDelegation" | "enableDelegation", d: Delegation): Hex =>
        encodeFunctionData({
            abi: accountAbi,
            functionName: "execute",
            args: [
                MODE_SIMPLE_SINGLE,
                encodeExecutionSingle(
                    addresses.manager,
                    0n,
                    encodeFunctionData({abi: managerAbi, functionName: fn, args: [d]}),
                ),
            ],
        });

    const dHash = await pub.readContract({
        address: addresses.manager,
        abi: managerAbi,
        functionName: "getDelegationHash",
        args: [delegation],
    });
    const disabledIs = (want: boolean) => async () =>
        (await pub.readContract({
            address: addresses.manager,
            abi: managerAbi,
            functionName: "disabledDelegations",
            args: [dHash],
        })) === want;
    const verifiedIs = (want: boolean) => async () => (await isVerified()) === want;

    /* --------------------------------- T1-T8 --------------------------------- */

    await send("T1", "Authorized payment: 30,000 mKRW -> merchant", "success", "agent", addresses.manager, redeemData(delegation, MERCHANT, 30_000n));
    await send("T2", "Over daily cap: +30,000 (total would be 60,000 > 50,000)", "revert: transfer-amount-exceeded", "agent", addresses.manager, redeemData(delegation, MERCHANT, 30_000n));
    await send("T3", "Unlisted payee: 10,000 -> attacker", "revert: PayeeNotAllowed", "agent", addresses.manager, redeemData(delegation, ATTACKER, 10_000n));
    await send("T4", "Issuer discrimination: delegation demands UPBIT KOREA", "revert: NotDojangVerified", "agent", addresses.manager, redeemData(wrongIssuer, MERCHANT, 10_000n));

    await send("T5a", "Principal disables the delegation", "success", "principal", ACCOUNT, ownerCall("disableDelegation", delegation));
    await waitUntil("disabled flag visible", disabledIs(true));
    await send("T5", "Payment while disabled (identity still LIVE)", "revert: CannotUseADisabledDelegation", "agent", addresses.manager, redeemData(delegation, MERCHANT, 10_000n));

    await send("T6a", "Principal re-enables the delegation", "success", "principal", ACCOUNT, ownerCall("enableDelegation", delegation));
    await waitUntil("enabled flag visible", disabledIs(false));
    await send("T6", "Payment after re-enable: 10,000 -> merchant", "success", "agent", addresses.manager, redeemData(delegation, MERCHANT, 10_000n));

    await send("T7a", "Principal revokes their Dojang attestation", "success", "principal", addresses.giwaFaucetExtension, encodeFunctionData({abi: faucetExtensionAbi, functionName: "revokeEAS"}));
    await waitUntil("revocation visible", verifiedIs(false));
    await send("T7", "Payment after identity revocation (delegation ENABLED, cap unspent, window open)", "revert: NotDojangVerified", "agent", addresses.manager, redeemData(delegation, MERCHANT, 10_000n));

    const fee2 = await pub.readContract({address: addresses.giwaFaucetExtension, abi: faucetExtensionAbi, functionName: "fee"});
    await send("T8a", "Principal re-issues their attestation", "success", "principal", addresses.giwaFaucetExtension, encodeFunctionData({abi: faucetExtensionAbi, functionName: "payAndIssueEAS"}), fee2);
    await waitUntil("re-issuance visible", verifiedIs(true));
    await send("T8", "Payment after re-issuance: 10,000 -> merchant", "success", "agent", addresses.manager, redeemData(delegation, MERCHANT, 10_000n));

    /* ------------------------------- final state ------------------------------ */

    // Poll: the last transfer must be visible before we assert balances.
    await waitUntil("final merchant balance visible", async () => {
        const b = await pub.readContract({address: addresses.mockKRW, abi: erc20Abi, functionName: "balanceOf", args: [MERCHANT]});
        return b - merchantBefore === 50_000n;
    });
    const merchantBal = await pub.readContract({address: addresses.mockKRW, abi: erc20Abi, functionName: "balanceOf", args: [MERCHANT]});
    const accountBal = await pub.readContract({address: addresses.mockKRW, abi: erc20Abi, functionName: "balanceOf", args: [ACCOUNT]});
    const attackerBal = await pub.readContract({address: addresses.mockKRW, abi: erc20Abi, functionName: "balanceOf", args: [ATTACKER]});
    console.log(`\nfinal: merchant +₩${merchantBal - merchantBefore} (total ₩${merchantBal}) | account ₩${accountBal} | attacker ₩${attackerBal}`);

    /* -------------------------------- DEMO.md --------------------------------- */

    const t1 = rows.find((r) => r.id === "T1");
    const md = `# Mapae Live Demo - GIWA Sepolia

Run at ${new Date().toISOString()} · chain 91342 · every hash below is clickable and public.

**The delegation:** the agent \`${agent.address}\` may pay the merchant up to ₩50,000/day from
the principal's MapaeAccount for 7 days - and only while the principal \`${principal.address}\`
holds a live Dojang attestation from the testnet faucet issuer.

**Cast**

| Role | Address |
|---|---|
| Principal (human; holds the Dojang attestation; signs the delegation) | \`${principal.address}\` |
| MapaeAccount (holds funds and delegation state; owner = principal) | \`${ACCOUNT}\` |
| Agent (delegate; redeems) | \`${agent.address}\` |
| Merchant (allowed payee) | \`${MERCHANT}\` |
| Attacker (unlisted payee) | \`${ATTACKER}\` |

**Transactions**

| # | What happened | Expected | On-chain result | Tx |
|---|---|---|---|---|
${rows
    .map((r) => {
        const result = r.status === "skipped" ? "skipped" : r.status === "success" ? "success" : `**reverted** \`${r.decoded ?? ""}\``;
        const link = r.hash ? `[${r.hash.slice(0, 10)}…](${explorer(r.hash)})` : "-";
        return `| ${r.id} | ${r.title} | ${r.expected} | ${result} | ${link} |`;
    })
    .join("\n")}

**Final balances (this run):** merchant +₩${merchantBal - merchantBefore} · account ₩${accountBal} · attacker ₩${attackerBal}

## Why T7 is the thesis

At T7 the delegation signature is valid, the daily cap has ₩40,000 unspent, the time window is
open, the payee is allowed, and the delegation is enabled. The payment still fails - purely
because the principal revoked their real-world identity attestation, in a transaction that never
touched a Mapae contract. Identity revocation is a kill switch the delegation layer does not even
see; it is inherited from Dojang reading liveness at the moment of use.

T5-T8 form a 2x2 matrix: each kill switch (disable-delegation / revoke-identity) blocks alone
while the other is untouched, and each is reversible. No ordering assumptions - the manager checks
disabled-state before any caveat, so the errors never bleed into each other.

## Traceback

\`pnpm trace ${t1?.hash ?? "<txHash>"}\` resolves T1's hash backwards:
payment -> delegation hash -> principal -> attestation uid -> issuer, entirely from public state.

## Reproduce

\`\`\`bash
cp .env.example .env   # two fresh keys; fund the principal from the faucets
pnpm install && pnpm fixtures && pnpm demo
\`\`\`
`;
    mkdirSync("docs", {recursive: true});
    writeFileSync("docs/DEMO.md", md);
    console.log("\nwrote docs/DEMO.md");

    // Hard assertions - the demo is a test, not a screenshot.
    const expectReverted = ["T2", "T3", "T4", "T5", "T7"];
    const expectSuccess = ["S1", "S2", "T1", "T5a", "T6a", "T6", "T7a", "T8a", "T8"];
    for (const id of expectReverted) {
        const r = rows.find((x) => x.id === id);
        if (r?.status !== "reverted") throw new Error(`${id} should have reverted, got ${r?.status}`);
    }
    for (const id of expectSuccess) {
        const r = rows.find((x) => x.id === id);
        if (r && r.status !== "success" && r.status !== "skipped") throw new Error(`${id} should have succeeded, got ${r?.status}`);
    }
    if (merchantBal - merchantBefore !== 50_000n) throw new Error(`merchant delta should be exactly 50,000, got ${merchantBal - merchantBefore}`);
    if (attackerBal !== 0n) throw new Error(`attacker should hold 0, got ${attackerBal}`);
    console.log("demo assertions: all held");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
