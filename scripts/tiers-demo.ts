/**
 * Graduated autonomy, mined.
 *
 * The question an agent budget never answers is the only one anyone actually asks: *how much may
 * it decide alone?* This script answers it on-chain, with ONE authority and three rungs:
 *
 *   root    identity, ₩50,000 a day, one merchant, seven days   → the person signs this once
 *     rung 1  ≤ ₩10,000 per payment, unattended                 → the agent just pays
 *     rung 2  ≤ ₩30,000 per payment, unattended                 → the same payment, one rung up
 *     rung 3  ≤ ₩200,000 per payment, human confirmation        → the agent cannot pay alone
 *
 * One authority rather than three, and that is the whole point of the shape. An earlier version of
 * this script signed the rungs as SIBLINGS, and `ERC20PeriodTransferEnforcer` keys its ledger on
 * the delegation hash - so two rungs meant two ledgers, and a person who signed "₩50,000 a day"
 * twice had granted ₩100,000. Nothing reverted; the chain did exactly what was signed. Hanging the
 * rungs off one root fixes it, because the manager hands each delegation's caveats that
 * delegation's own hash and the cap therefore lives in one ledger.
 *
 * The root delegates to the PERSON, not to the agent, and the person signs each rung. Conditions
 * can only be added going down a chain, never removed - so a human gate on a rung the AGENT signed
 * would bind nobody: it would sign a second rung without the gate and redeem through that. Moving
 * the gate up to the root binds everyone and makes a ₩1,000 payment need a human, which is a
 * ladder with no rungs. Both arrangements are pinned in test/integration/TierBudget.t.sol.
 *
 * The ceiling above rung 3 is the root's own: ₩200,000 per payment and ₩50,000 a day. A larger
 * payment is refused by the authority that was signed, not by the absence of a rung.
 *
 * The historical mapae worked the same way: the number of horses on the plate scaled with the
 * weight of the errand, and the plate said which one you held.
 *
 * On rung 3, note what is being proven. Verified Code attestations are issued by exchanges through
 * their own channels - we cannot mint one, so the confirmation cannot be staged. What settles that
 * scene is the REFUSAL: a payment inside every limit, from a live identity, on an enabled
 * delegation, to an allowed payee, refused solely because no live human confirmation stands behind
 * it. That is the gate working, and it is the only half of it we can honestly show. It is also why
 * there are three rungs and not two: a gated rung can never settle, so the rungs that exhaust the
 * shared budget have to be the ungated ones.
 *
 *   pnpm tsx scripts/tiers-demo.ts <mapaeAccountAddress>
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
assert(ACCOUNT?.startsWith("0x"), "usage: pnpm tsx scripts/tiers-demo.ts <mapaeAccountAddress>");

const principal = privateKeyToAccount(process.env.PRINCIPAL_PRIVATE_KEY as Hex);
const agent = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as Hex);
const pub = createPublicClient({chain: giwaSepolia, transport: http()});
const wallet = createWalletClient({account: agent, chain: giwaSepolia, transport: http()});

const merchant = privateKeyToAccount(keccak256(toHex("mapae-tiers-merchant"))).address;
const unlisted = privateKeyToAccount(keccak256(toHex("mapae-tiers-unlisted"))).address;

const won = (n: bigint) => `₩${n.toLocaleString("en-US")}`;
const EXPLORER = "https://sepolia-explorer.giwa.io/tx/";

/** The confirmation domain a Verified Code would be issued under. Nothing issues one to us. */
const CONFIRM_DOMAIN = "mapae.tiers.demo";

const now = () => BigInt(Math.floor(Date.now() / 1000));

/* --------------------------------- authorities -------------------------------- */

/// The root: the account authorises the PERSON, carrying every condition the tiers inherit.
///
/// The person is the delegate here rather than the agent, and that placement is the difference
/// between a ladder and a suggestion. Caveats can only be added going down a chain, never removed,
/// so a tier the AGENT signs binds nobody - it would simply sign a second tier without the human
/// gate and redeem through that. Delegating the root to the person means the agent cannot mint a
/// tier at all, because it is not the person. Proven both ways in test/integration/TierBudget.t.sol.
function signRoot(caveats: Caveat[], salt: bigint): Promise<Delegation> {
    const unsigned = rootDelegation({delegate: principal.address, delegator: ACCOUNT, caveats, salt});
    return principal
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

/** Conditions both tiers share: the identity that makes the spend traceable, one day of budget,
 *  one allowed merchant, a week to live. */
function common(): Caveat[] {
    return [
        {enforcer: addresses.dojangEnforcer, terms: dojangTerms(TESTNET_FAUCET_ID, principal.address), args: "0x"},
        {
            enforcer: addresses.periodEnforcer,
            terms: periodTerms(addresses.mockKRW, 50_000n, 86_400n, now() - 60n),
            args: "0x",
        },
        {enforcer: addresses.payeeEnforcer, terms: payeeTerms([merchant]), args: "0x"},
        {enforcer: addresses.timestampEnforcer, terms: timestampTerms(0n, now() + 7n * 86_400n), args: "0x"},
    ];
}

/// A rung: narrows the per-payment ceiling, and optionally demands a live human confirmation.
/// Signed by the person, hung off the root, so every rung spends the same day budget.
function signTier(ceiling: bigint, gated: boolean, salt: bigint, root: Delegation): Promise<Delegation> {
    const caveats: Caveat[] = [
        {enforcer: addresses.perPaymentEnforcer, terms: perPaymentTerms(ceiling), args: "0x"},
    ];
    if (gated) {
        caveats.push({
            enforcer: addresses.verifiedCodeEnforcer,
            terms: `0x${TESTNET_FAUCET_ID.slice(2)}${Buffer.from(CONFIRM_DOMAIN).toString("hex")}` as Hex,
            args: "0x",
        });
    }
    const unsigned: Delegation = {
        delegate: agent.address,
        delegator: principal.address,
        authority: delegationHash(root),
        caveats,
        salt,
        signature: "0x",
    };
    return principal
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
 * Attempt a payment and record what the chain said.
 *
 * A refusal is broadcast deliberately rather than simulated away: the point of this ledger is that
 * anyone can open the transaction and read the enforcer's own error. A refusal nobody can click on
 * is a claim, not evidence.
 */
async function attempt(
    scene: string, chain: Delegation[], to: Address, amount: bigint, caveatArgs?: Hex,
) {
    // Caveat args are supplied at redemption, never signed - so presenting one here changes what
    // the enforcers see without touching the delegation hash the principal put their name to.
    const presented: Delegation[] = caveatArgs
        ? chain.map((d) => ({...d, caveats: d.caveats.map((c) =>
            c.enforcer.toLowerCase() === addresses.verifiedCodeEnforcer.toLowerCase()
                ? {...c, args: caveatArgs} : c)}))
        : chain;
    const args = [
        [encodePermissionContext(presented)],
        [MODE_SIMPLE_SINGLE as Hex],
        [encodeExecutionSingle(addresses.mockKRW, 0n, encodeErc20Transfer(to, amount))],
    ] as const;

    const base = (await pub.getBlock()).baseFeePerGas ?? 1_000_000n;
    const tx = await wallet.writeContract({
        address: addresses.manager,
        abi: managerAbi,
        functionName: "redeemDelegations",
        args,
        gas: 1_500_000n,
        maxFeePerGas: base * 3n,
        maxPriorityFeePerGas: base,
    });
    const receipt = await pub.waitForTransactionReceipt({hash: tx, timeout: 120_000});
    const settled = receipt.status === "success";

    let reason: string | undefined;
    if (!settled) {
        // Replaying against the state the block executed on is the honest answer, but GIWA's
        // public RPC frequently returns a historical eth_call with no revert data at all, and
        // "reverted" names nothing. Falling back to current state recovers the enforcer's own
        // error, which for these scenes is the same refusal - the conditions did not change.
        for (const at of [receipt.blockNumber - 1n, undefined]) {
            try {
                await pub.simulateContract({
                    address: addresses.manager,
                    abi: managerAbi,
                    functionName: "redeemDelegations",
                    args,
                    account: agent.address,
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

/* ------------------------------------- run ------------------------------------ */

/// Put the principal's identity back on chain if it is not live.
///
/// Scene 5 revokes a real attestation, so a run that dies between the revoke and the re-issue
/// leaves the chain in a state where scene 1 cannot pass - the demo would have broken its own
/// precondition and every later run would fail at the first line for a reason that has nothing
/// to do with what it is demonstrating. Called before the first scene and again on the way out,
/// success or not.
async function ensureVerified(): Promise<Hex | null> {
    const live = (await pub.readContract({
        address: addresses.dojangScroll,
        abi: [{type: "function", name: "isVerified", inputs: [{type: "address"}, {type: "bytes32"}],
               outputs: [{type: "bool"}], stateMutability: "view"}] as const,
        functionName: "isVerified",
        args: [principal.address, TESTNET_FAUCET_ID],
    })) as boolean;
    if (live) return null;

    const fee = (await pub.readContract({
        address: addresses.giwaFaucetExtension,
        abi: [{type: "function", name: "fee", inputs: [], outputs: [{type: "uint256"}], stateMutability: "view"}] as const,
        functionName: "fee",
    })) as bigint;
    const tx = await createWalletClient({account: principal, chain: giwaSepolia, transport: http()})
        .writeContract({
            address: addresses.giwaFaucetExtension,
            abi: [{type: "function", name: "payAndIssueEAS", inputs: [], outputs: [{type: "bytes32"}], stateMutability: "payable"}] as const,
            functionName: "payAndIssueEAS",
            value: fee,
        });
    const r = await pub.waitForTransactionReceipt({hash: tx, timeout: 120_000});
    if (r.status !== "success") throw new Error(`re-issuing the identity reverted: ${tx}`);
    return tx;
}

/// Revoke the principal's attestation. One transaction, to an attestation registry, naming no
/// delegation and touching no Mapae contract.
async function revokeIdentity(): Promise<Hex> {
    const tx = await createWalletClient({account: principal, chain: giwaSepolia, transport: http()})
        .writeContract({
            address: addresses.giwaFaucetExtension,
            abi: [{type: "function", name: "revokeEAS", inputs: [], outputs: [], stateMutability: "nonpayable"}] as const,
            functionName: "revokeEAS",
        });
    const r = await pub.waitForTransactionReceipt({hash: tx, timeout: 120_000});
    if (r.status !== "success") throw new Error(`revoking the identity reverted: ${tx}`);
    return tx;
}

/// GIWA's public RPC load-balances across backends at different heights, so a read taken right
/// after a receipt can still answer from before it. Poll for the state we just wrote.
async function waitForIdentity(live: boolean): Promise<void> {
    for (let i = 0; i < 12; i++) {
        const now_ = (await pub.readContract({
            address: addresses.dojangScroll,
            abi: [{type: "function", name: "isVerified", inputs: [{type: "address"}, {type: "bytes32"}],
                   outputs: [{type: "bool"}], stateMutability: "view"}] as const,
            functionName: "isVerified",
            args: [principal.address, TESTNET_FAUCET_ID],
        })) as boolean;
        if (now_ === live) return;
        await new Promise((r) => setTimeout(r, 3_000));
    }
    throw new Error(`the chain never reported identityLive=${live}`);
}

async function main() {
    console.log(`account ${ACCOUNT}\nmerchant ${merchant}\nunlisted ${unlisted}\n`);
    await ensureVerified();

    const salt = BigInt(Date.now());
    const root = await signRoot(common(), salt);
    const tier1 = await signTier(10_000n, false, salt + 1n, root);
    const tier2 = await signTier(30_000n, false, salt + 2n, root);
    const tier3 = await signTier(200_000n, true, salt + 3n, root);
    const t1 = [tier1, root], t2 = [tier2, root], t3 = [tier3, root];

    // The confirmation code is `args`, not `terms`: it is what the REDEEMER presents at payment
    // time, which is the whole shape of a human-in-the-loop gate. A code nobody issued is what an
    // agent holds when nobody confirmed - so this is the honest stand-in, and the chain refuses it
    // with the enforcer's own CodeNotVerified rather than a malformed-caveat error.
    const unconfirmedCode = keccak256(toHex("nobody-confirmed-this-payment"));

    console.log(`root    ${delegationHash(root)}  — ${won(50_000n)} a day, one merchant, seven days`);
    console.log(`  rung 1  ≤ ${won(10_000n)} per payment, unattended`);
    console.log(`  rung 2  ≤ ${won(30_000n)} per payment, unattended`);
    console.log(`  rung 3  ≤ ${won(200_000n)} per payment, human confirmation required\n`);

    console.log(`1. ${won(10_000n)} on rung 1 — inside what the agent may decide alone`);
    const a = await attempt("₩10,000 on rung 1", t1, merchant, 10_000n);
    assert(a.settled, "rung 1 payment should settle");

    console.log(`\n2. ${won(30_000n)} on rung 1 — above that rung's ceiling`);
    const b = await attempt("₩30,000 on rung 1, above its ₩10,000 ceiling", t1, merchant, 30_000n);
    assert(!b.settled && b.reason?.includes("PerPaymentCapExceeded"), `expected the ceiling to refuse, got ${b.reason}`);

    console.log(`\n3. ${won(5_000n)} to a merchant nobody allowed`);
    const c = await attempt("₩5,000 to an unlisted payee", t1, unlisted, 5_000n);
    assert(!c.settled && c.reason?.includes("PayeeNotAllowed"), `expected the payee list to refuse, got ${c.reason}`);

    console.log(`\n4. ${won(150_000n)} on rung 3 — allowed by amount, but needs a person`);
    const d = await attempt(
        "₩150,000 on rung 3, presenting a code nobody confirmed", t3, merchant, 150_000n, unconfirmedCode,
    );
    assert(
        !d.settled && d.reason?.includes("CodeNotVerified"),
        `the human rung must refuse for want of a confirmation, got ${d.reason}`,
    );

    console.log(`\n5. the principal revokes their identity, then ${won(5_000n)} on rung 1`);
    const revokeTx = await revokeIdentity();
    console.log(`  revoked  ${EXPLORER}${revokeTx}`);
    await waitForIdentity(false);
    const e = await attempt("₩5,000 after the identity was revoked", t1, merchant, 5_000n);
    assert(!e.settled && e.reason?.includes("NotDojangVerified"), `expected identity to refuse, got ${e.reason}`);

    console.log(`\n6. the principal re-issues it — the rungs resume`);
    const reissueTx = await ensureVerified();
    console.log(`  re-issued  ${EXPLORER}${reissueTx}`);
    await waitForIdentity(true);
    const g = await attempt("₩5,000 after the identity was restored", t1, merchant, 5_000n);
    assert(g.settled, "the rungs should resume once the identity is live again");

    console.log(`\n7. ${won(30_000n)} on rung 2 — the payment rung 1 refused, one rung up`);
    const h = await attempt("₩30,000 on rung 2", t2, merchant, 30_000n);
    assert(h.settled, "rung 2 should allow what rung 1 refused");

    // ₩45,000 of the day is gone, so ₩5,000 remains. Rung 2 still allows ₩30,000 per payment and
    // ₩20,000 is well inside that - what refuses is the budget underneath it.
    console.log(`\n8. ${won(20_000n)} on rung 2 — inside its ceiling, past what the day has left`);
    const i = await attempt("₩20,000 on rung 2, inside its ceiling but past the shared budget", t2, merchant, 20_000n);
    assert(!i.settled && i.reason?.includes("transfer-amount-exceeded"),
        `expected the shared budget to refuse, got ${i.reason}`);

    console.log(`\n9. ${won(5_000n)} on rung 2 — exactly what is left`);
    const j = await attempt("₩5,000 on rung 2, exactly the remaining budget", t2, merchant, 5_000n);
    assert(j.settled, "the last of the day's budget should settle");

    // Rung 1 has spent ₩15,000 all day, inside its own ₩10,000-per-payment ceiling every time. It
    // is refused anyway, because the day belongs to the root and rung 2 spent it. This is the row
    // that separates a ladder from two separate grants: a rung cannot be read on its own.
    console.log(`\n10. ${won(5_000n)} on rung 1 — a rung that never overspent, stopped by another`);
    const k = await attempt("₩5,000 on rung 1, after rung 2 spent the day", t1, merchant, 5_000n);
    assert(!k.settled && k.reason?.includes("transfer-amount-exceeded"),
        `the budget is shared across rungs, got ${k.reason}`);

    const settlements = ledger.filter((l) => l.settled);
    const total = settlements.reduce((sum, l) => sum + l.amount, 0n);
    console.log(`\nmerchant received ${won(total)} across ${settlements.length} settlements`);

    /* ------------------------------- the ledger ------------------------------- */

    const header = "| What the agent tried | Outcome on chain | Transaction |\n|---|---|---|";
    const rows = ledger
        .map((l) => `| ${l.scene} | ${l.settled ? "**settled**" : `**refused** \`${l.reason}\``} | [${l.tx!.slice(0, 10)}…](${EXPLORER}${l.tx}) |`)
        .join("\n");

    appendFileSync(
        "docs/DEMO.md",
        `\n## Graduated autonomy - how much may the agent decide alone?\n\n` +
            `One authority, three rungs. The person signs a root that carries the identity condition,\n` +
            `a ${won(50_000n)} day budget, one merchant and a seven-day window, then signs each rung off\n` +
            `it. Every rung inherits all of that and narrows one thing further.\n\n` +
            `| Rung | Per payment | Human in the loop |\n|---|---|---|\n` +
            `| 1 | ${won(10_000n)} | no |\n| 2 | ${won(30_000n)} | no |\n| 3 | ${won(200_000n)} | yes |\n\n` +
            `**Who signs a rung decides whether its gate means anything.** The root delegates to the\n` +
            `*person*, not to the agent, and the person signs each rung. Conditions can only be added\n` +
            `going down a chain, never removed - so a rung the agent signed would bind nobody, because\n` +
            `the agent could sign a second rung without the gate and redeem through that instead. Both\n` +
            `arrangements are pinned in \`test/integration/TierBudget.t.sol\`.\n\n` +
            `${header}\n${rows}\n\n` +
            `The last three rows are the reason this is one authority rather than three. Rung 2 spends\n` +
            `the day down to nothing; rung 1 is then refused even though it never once exceeded its own\n` +
            `${won(10_000n)} ceiling. **A rung cannot be read on its own** - the budget belongs to the root\n` +
            `they hang from, and \`ERC20PeriodTransferEnforcer\` keys its ledger on the delegation hash it\n` +
            `is attached to.\n\n` +
            `Signed as siblings instead - two roots, each saying ${won(50_000n)} a day - the same ladder\n` +
            `would spend ${won(100_000n)}, because two delegation hashes mean two ledgers. Nothing reverts;\n` +
            `the chain does exactly what was signed. The gap is between what was signed and what the\n` +
            `person believes they signed, which is why it is a test and not a footnote.\n\n` +
            `Row 4 is the other one worth reading twice. That payment is inside every limit, from a live\n` +
            `identity, on an enabled delegation, to an allowed merchant. It is refused because no live\n` +
            `human confirmation stands behind it. Verified Codes are issued by exchanges through their\n` +
            `own channels, so the confirming half cannot be staged here - the refusal is the half that\n` +
            `can be proven, and it is the half that matters.\n\n` +
            `Reproduce with \`pnpm tsx scripts/tiers-demo.ts <account>\`.\n`,
    );
    console.log("appended the tier ledger to docs/DEMO.md");
    console.log("\ntiers demo: all assertions held");
}

// The identity is left live whether or not the run succeeded: an aborted demo must not be the
// reason the next one cannot start.
main()
    .catch(async (e) => {
        console.error(e);
        await ensureVerified().catch(() => {});
        process.exit(1);
    });
