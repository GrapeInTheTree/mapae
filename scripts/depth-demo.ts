/**
 * The authority you forgot you granted, mined.
 *
 * A person grants spending authority to one agent. That agent hires a second. The second hires a
 * third. By the time money moves, the payment is three hops from the signature that permitted it,
 * and **the person has never seen the address that spends it** - they signed nothing about B and
 * nothing about C, and no transaction was sent when B and C were brought in.
 *
 * This is not a hypothetical shape. It is what happens the moment agents can call agents, and it
 * is the shape in which authority quietly outlives the intent behind it.
 *
 * One precise claim, and it is worth stating narrowly because the loose version is false:
 *
 *   FALSE - "only Mapae can kill a delegation tree." Disabling the root severs the chain in any
 *           ERC-7710 framework. That is the standard working, not a feature of ours.
 *
 *   TRUE  - the person revokes an attestation, in a transaction that touches no Mapae contract
 *           and names no delegation, and **every tree they ever rooted** stops - including the
 *           branches they never signed and cannot enumerate.
 *
 * That difference matters because revoking what you remember is easy. The authority that hurts you
 * is the one you cannot list.
 *
 *   pnpm tsx scripts/depth-demo.ts <mapaeAccountAddress>
 */
import "./env.js";
import assert from "node:assert";
import {appendFileSync} from "node:fs";
import {
    createPublicClient,
    createWalletClient,
    decodeErrorResult,
    http,
    keccak256,
    toHex,
    type Account,
    type Address,
    type Hex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";

import {addresses, giwaSepolia, TESTNET_FAUCET_ID} from "../sdk/src/constants.js";
import {enforcerErrorsAbi, managerAbi} from "../sdk/src/abi.js";
import {
    DELEGATION_TYPES,
    delegationDomain,
    delegationHash,
    dojangTerms,
    encodeErc20Transfer,
    encodeExecutionSingle,
    encodePermissionContext,
    payeeTerms,
    periodTerms,
    perPaymentTerms,
    rootDelegation,
    timestampTerms,
    type Caveat,
    type Delegation,
} from "../sdk/src/delegation.js";
import {MODE_SIMPLE_SINGLE} from "../sdk/src/protocol.js";

const ACCOUNT = process.argv[2] as Address;
assert(ACCOUNT?.startsWith("0x"), "usage: pnpm tsx scripts/depth-demo.ts <mapaeAccountAddress>");

const principal = privateKeyToAccount(process.env.PRINCIPAL_PRIVATE_KEY as Hex);

/** The agent the person actually granted to. The only one they ever saw. */
const agentA = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as Hex);

/** Hired by A, and then by B. The person signed nothing about either, and neither hire is a
 *  transaction - a delegation is a signature, so a sub-agent appears without touching the chain. */
const agentB = privateKeyToAccount(keccak256(toHex("mapae-depth-subagent-b")));
const agentC = privateKeyToAccount(keccak256(toHex("mapae-depth-subagent-c")));

const merchant = privateKeyToAccount(keccak256(toHex("mapae-depth-merchant"))).address;

const pub = createPublicClient({chain: giwaSepolia, transport: http()});
const won = (n: bigint) => `₩${n.toLocaleString("en-US")}`;
const EXPLORER = "https://sepolia-explorer.giwa.io/tx/";
const now = () => BigInt(Math.floor(Date.now() / 1000));

/* --------------------------------- authorities -------------------------------- */

function signAs(signer: Account, unsigned: Delegation): Promise<Delegation> {
    return (signer as ReturnType<typeof privateKeyToAccount>)
        .signTypedData({
            domain: delegationDomain(giwaSepolia.id, addresses.manager),
            types: DELEGATION_TYPES,
            primaryType: "Delegation",
            message: {
                delegate: unsigned.delegate,
                delegator: unsigned.delegator,
                authority: unsigned.authority,
                caveats: unsigned.caveats.map((c) => ({enforcer: c.enforcer, terms: c.terms})),
                salt: unsigned.salt,
            },
        })
        .then((signature) => ({...unsigned, signature}));
}

/** What the person signs: the identity that makes every hop traceable, a day of budget, one
 *  merchant, a week, and ₩10,000 per payment. Everything below inherits all of it. */
function rootCaveats(): Caveat[] {
    return [
        {enforcer: addresses.dojangEnforcer, terms: dojangTerms(TESTNET_FAUCET_ID, principal.address), args: "0x"},
        {enforcer: addresses.periodEnforcer, terms: periodTerms(addresses.mockKRW, 100_000n, 86_400n, now() - 60n), args: "0x"},
        {enforcer: addresses.payeeEnforcer, terms: payeeTerms([merchant]), args: "0x"},
        {enforcer: addresses.timestampEnforcer, terms: timestampTerms(0n, now() + 7n * 86_400n), args: "0x"},
        {enforcer: addresses.perPaymentEnforcer, terms: perPaymentTerms(10_000n), args: "0x"},
    ];
}

/** A hop. `caveats` narrow further; the parent's conditions still run on every redemption. */
function hop(signer: Account, to: Address, parent: Delegation, caveats: Caveat[]): Promise<Delegation> {
    return signAs(signer, {
        delegate: to,
        delegator: signer.address,
        authority: delegationHash(parent),
        caveats,
        salt: BigInt(Date.now()) + BigInt(Math.floor(Math.random() * 1000)),
        signature: "0x",
    });
}

/* ----------------------------------- attempts ---------------------------------- */

interface Attempt {
    scene: string;
    amount: bigint;
    settled: boolean;
    reason?: string;
    tx?: Hex;
}
const ledger: Attempt[] = [];

function decode(err: unknown): string {
    let e = err as {data?: Hex; cause?: unknown} | undefined;
    while (e) {
        const data = (e as {data?: Hex}).data;
        if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
            try {
                const d = decodeErrorResult({abi: [...managerAbi, ...enforcerErrorsAbi], data});
                return `${d.errorName}${d.args?.length ? `(${d.args.join(", ")})` : "()"}`;
            } catch {
                /* not one of ours */
            }
        }
        const short = (e as {shortMessage?: string}).shortMessage;
        if (short && !e.cause) return short;
        e = e.cause as typeof e;
    }
    return "reverted";
}

/**
 * Redeem a chain and record what the chain said.
 *
 * Refusals are broadcast rather than simulated away: a refusal nobody can open in an explorer is
 * a claim, not evidence. `chain` is leaf-first, the order the manager walks.
 */
async function attempt(scene: string, redeemer: Account, chain: Delegation[], amount: bigint) {
    const args = [
        [encodePermissionContext(chain)],
        [MODE_SIMPLE_SINGLE as Hex],
        [encodeExecutionSingle(addresses.mockKRW, 0n, encodeErc20Transfer(merchant, amount))],
    ] as const;

    const wallet = createWalletClient({account: redeemer, chain: giwaSepolia, transport: http()});
    const base = (await pub.getBlock()).baseFeePerGas ?? 1_000_000n;
    const tx = await wallet.writeContract({
        address: addresses.manager,
        abi: managerAbi,
        functionName: "redeemDelegations",
        args,
        gas: 2_000_000n,
        maxFeePerGas: base * 3n,
        maxPriorityFeePerGas: base,
    });
    const receipt = await pub.waitForTransactionReceipt({hash: tx, timeout: 120_000});
    const settled = receipt.status === "success";

    let reason: string | undefined;
    if (!settled) {
        // GIWA's public RPC often serves a historical eth_call with no revert data, and "reverted"
        // names nothing. Falling back to current state recovers the enforcer's own error; for
        // these scenes the conditions did not change in between.
        for (const at of [receipt.blockNumber - 1n, undefined]) {
            try {
                await pub.simulateContract({
                    address: addresses.manager,
                    abi: managerAbi,
                    functionName: "redeemDelegations",
                    args,
                    account: redeemer.address,
                    ...(at === undefined ? {} : {blockNumber: at}),
                });
            } catch (e) {
                const decoded = decode(e);
                if (decoded !== "reverted") {
                    reason = decoded;
                    break;
                }
            }
        }
        reason ??= "reverted";
    }

    ledger.push({scene, amount, settled, reason, tx});
    console.log(`  ${settled ? "settled" : `refused  ${reason ?? ""}`}\n    ${EXPLORER}${tx}`);
    return {settled, reason};
}

/* --------------------------------- identity ---------------------------------- */

const faucetAbi = [
    {type: "function", name: "fee", inputs: [], outputs: [{type: "uint256"}], stateMutability: "view"},
    {type: "function", name: "payAndIssueEAS", inputs: [], outputs: [{type: "bytes32"}], stateMutability: "payable"},
    {type: "function", name: "revokeEAS", inputs: [], outputs: [], stateMutability: "nonpayable"},
] as const;

async function identityIsLive(): Promise<boolean> {
    return (await pub.readContract({
        address: addresses.dojangScroll,
        abi: [{type: "function", name: "isVerified", inputs: [{type: "address"}, {type: "bytes32"}],
               outputs: [{type: "bool"}], stateMutability: "view"}] as const,
        functionName: "isVerified",
        args: [principal.address, TESTNET_FAUCET_ID],
    })) as boolean;
}

/** Issue if it is not live. Scene 3 revokes a real attestation, so a run that dies before scene 4
 *  would otherwise leave the chain unable to start the next one. */
async function ensureVerified(): Promise<Hex | null> {
    if (await identityIsLive()) return null;
    const wallet = createWalletClient({account: principal, chain: giwaSepolia, transport: http()});
    const fee = (await pub.readContract({address: addresses.giwaFaucetExtension, abi: faucetAbi, functionName: "fee"})) as bigint;
    const tx = await wallet.writeContract({
        address: addresses.giwaFaucetExtension, abi: faucetAbi, functionName: "payAndIssueEAS", value: fee,
    });
    const r = await pub.waitForTransactionReceipt({hash: tx, timeout: 120_000});
    if (r.status !== "success") throw new Error(`re-issuing the identity reverted: ${tx}`);
    return tx;
}

async function revokeIdentity(): Promise<Hex> {
    const wallet = createWalletClient({account: principal, chain: giwaSepolia, transport: http()});
    const tx = await wallet.writeContract({address: addresses.giwaFaucetExtension, abi: faucetAbi, functionName: "revokeEAS"});
    const r = await pub.waitForTransactionReceipt({hash: tx, timeout: 120_000});
    if (r.status !== "success") throw new Error(`revoking the identity reverted: ${tx}`);
    return tx;
}

/** GIWA's public RPC load-balances across backends at different heights, so a read taken right
 *  after a receipt can still answer from before it. Poll for the state we just wrote. */
async function waitForIdentity(live: boolean): Promise<void> {
    for (let i = 0; i < 12; i++) {
        if ((await identityIsLive()) === live) return;
        await new Promise((r) => setTimeout(r, 3_000));
    }
    throw new Error(`the chain never reported identityLive=${live}`);
}

/* ----------------------------------- gas ------------------------------------- */

/** A sub-agent needs gas like any account: `redeemDelegations` is sent by the delegate, so C
 *  broadcasts its own payments. Nothing about this is delegation - it is an EOA needing a balance,
 *  and the person funds it here only because this is a testnet demo with invented sub-agents. */
async function fund(who: Address, label: string): Promise<void> {
    const have = await pub.getBalance({address: who});
    const floor = 20_000_000_000_000n; // ~60 transactions at the measured rate
    if (have >= floor) return;
    const wallet = createWalletClient({account: principal, chain: giwaSepolia, transport: http()});
    const tx = await wallet.sendTransaction({to: who, value: floor});
    await pub.waitForTransactionReceipt({hash: tx, timeout: 120_000});
    console.log(`  funded ${label} for gas  ${EXPLORER}${tx}`);
}

/* ------------------------------------- run ------------------------------------ */

async function main() {
    console.log(`account   ${ACCOUNT}\nmerchant  ${merchant}\n`);
    const restored = await ensureVerified();
    if (restored) console.log(`  identity restored  ${EXPLORER}${restored}`);
    await fund(agentC.address, "C");
    console.log("");

    // The person signs once. Everything below happens without them.
    const root = await signAs(principal, rootDelegation({
        delegate: agentA.address, delegator: ACCOUNT, caveats: rootCaveats(), salt: BigInt(Date.now()),
    }));

    // A hires B, tightening to ₩5,000. B hires C and writes ₩50,000 - five times what the root
    // allows. Nothing stops B from signing that; what stops it is redemption.
    const toB = await hop(agentA, agentB.address, root, [
        {enforcer: addresses.perPaymentEnforcer, terms: perPaymentTerms(5_000n), args: "0x"},
    ]);
    const toC = await hop(agentB, agentC.address, toB, [
        {enforcer: addresses.perPaymentEnforcer, terms: perPaymentTerms(50_000n), args: "0x"},
    ]);
    const chain = [toC, toB, root];

    console.log(`the person signed one delegation, to A`);
    console.log(`  A ${agentA.address}  ≤ ${won(10_000n)} per payment`);
    console.log(`  B ${agentB.address}  ≤ ${won(5_000n)}   — hired by A, no transaction, no human signature`);
    console.log(`  C ${agentC.address}  ≤ ${won(50_000n)}  — hired by B, and B wrote a ceiling above the root's`);

    // The claim that the person cannot enumerate this tree is checked, not asserted: neither
    // sub-agent appears anywhere in what they signed.
    // Exactly the fields the EIP-712 message covers - delegate, delegator, authority, every
    // caveat's enforcer and terms - concatenated and searched. Not a serialisation of the object.
    const signedBytes = [
        root.delegate, root.delegator, root.authority,
        ...root.caveats.flatMap((c) => [c.enforcer, c.terms]),
    ].join("").toLowerCase();
    for (const [who, a] of [["B", agentB.address], ["C", agentC.address]] as const) {
        assert(!signedBytes.includes(a.slice(2).toLowerCase()), `${who} appears in what the person signed`);
    }
    console.log(`\n  neither B nor C appears anywhere in the delegation the person put their name to`);

    console.log(`\n1. C pays ${won(3_000n)} — three hops from the signature that permits it`);
    const a = await attempt("₩3,000 by a sub-sub-agent the person never saw", agentC, chain, 3_000n);
    assert(a.settled, "a payment inside every hop's limits should settle");

    console.log(`\n2. C pays ${won(8_000n)} — inside its own grant, past the hop above it`);
    const b = await attempt("₩8,000 — within C's own ceiling, above B's", agentC, chain, 8_000n);
    assert(!b.settled && b.reason?.includes("PerPaymentCapExceeded"),
        `a child must not widen its parent, got ${b.reason}`);

    console.log(`\n3. the person revokes their identity — one transaction, no Mapae contract in it`);
    const revoke = await revokeIdentity();
    console.log(`  revoked  ${EXPLORER}${revoke}`);
    await waitForIdentity(false);

    const c = await attempt("₩3,000 by C, after the identity was revoked", agentC, chain, 3_000n);
    assert(!c.settled && c.reason?.includes("NotDojangVerified"), `the deepest hop should stop, got ${c.reason}`);

    // The leaf is the interesting one, but the branch the person DOES remember has to stop too,
    // or "every tree they rooted" would be a claim about one path.
    console.log(`\n4. and the branch they do remember — A, one hop, same revocation`);
    const d = await attempt("₩3,000 by A, the agent they actually granted to", agentA, [root], 3_000n);
    assert(!d.settled && d.reason?.includes("NotDojangVerified"), `the root hop should stop too, got ${d.reason}`);

    console.log(`\n5. the person re-issues it — the whole tree resumes, including the part they cannot name`);
    const reissue = await ensureVerified();
    console.log(`  re-issued  ${EXPLORER}${reissue}`);
    await waitForIdentity(true);
    const e = await attempt("₩3,000 by C, after the identity was restored", agentC, chain, 3_000n);
    assert(e.settled, "the tree should resume once the identity is live again");

    const settlements = ledger.filter((l) => l.settled);
    console.log(`\nmerchant received ${won(settlements.reduce((s, l) => s + l.amount, 0n))} across ${settlements.length} settlements`);

    /* ------------------------------- the ledger ------------------------------- */

    const header = "| What was attempted | Outcome on chain | Transaction |\n|---|---|---|";
    const rows = ledger
        .map((l) => `| ${l.scene} | ${l.settled ? "**settled**" : `**refused** \`${l.reason}\``} | [${l.tx!.slice(0, 10)}…](${EXPLORER}${l.tx}) |`)
        .join("\n");

    appendFileSync(
        "docs/DEMO.md",
        `\n## Depth - the authority nobody remembers granting\n\n` +
            `One person signed one delegation, to agent A. A hired B; B hired C. Neither hire was a\n` +
            `transaction and neither carries the person's signature, so **the tree that spends their money\n` +
            `is not a tree they can enumerate.** This run checks that rather than assuming it: neither\n` +
            `sub-agent's address appears anywhere in what the person signed.\n\n` +
            `| Hop | Signed by | Per-payment ceiling |\n|---|---|---|\n` +
            `| A | the person | ${won(10_000n)} |\n` +
            `| B | A | ${won(5_000n)} |\n` +
            `| C | B | ${won(50_000n)} — five times the root's |\n\n` +
            `${header}\n${rows}\n\n` +
            `The second row is redelegation's load-bearing property. B was free to *write* C a ceiling\n` +
            `above the root's; nothing prevents signing it. What it cannot do is survive redemption -\n` +
            `every hop's conditions run, so the tightest one binds and a child can only narrow.\n\n` +
            `Rows three and four are the point of the whole script. The revocation is one transaction\n` +
            `sent to an attestation registry: it names no delegation, touches no Mapae contract, and the\n` +
            `person could not have named C if they had wanted to. The leaf stops, and so does the branch\n` +
            `they do remember. Restoring the identity brings back all of it.\n\n` +
            `The narrow claim is worth keeping narrow. **Disabling a root delegation severs a chain in\n` +
            `any ERC-7710 framework** - that is the standard working, not something Mapae adds. What is\n` +
            `ours is the other direction: the person acts on *their own identity*, and every tree they\n` +
            `ever rooted stops at once, including the branches they never signed. Revoking what you\n` +
            `remember is easy. The authority that hurts you is the one you cannot list.\n\n` +
            `Reproduce with \`pnpm tsx scripts/depth-demo.ts <account>\`.\n`,
    );
    console.log("appended the depth ledger to docs/DEMO.md");
    console.log("\ndepth demo: all assertions held");
}

// Leave the identity live whether or not the run succeeded: an aborted demo must not be the
// reason the next one cannot start.
main().catch(async (e) => {
    console.error(e);
    await ensureVerified().catch(() => {});
    process.exit(1);
});
