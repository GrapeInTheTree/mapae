/**
 * Graduated autonomy, mined.
 *
 * The question an agent budget never answers is the only one anyone actually asks: *how much may
 * it decide alone?* This script answers it on-chain, with two authorities the same person signs:
 *
 *   tier 1  ₩10,000 per payment, no human in the loop      → the agent just pays
 *   tier 2  ₩100,000 per payment, human confirmation gate  → the agent cannot pay alone
 *
 * Nothing above tier 2 exists, so a payment past it has no authority to redeem at all - refusal
 * by absence rather than by rule, which is the honest shape of "this is not yours to decide".
 *
 * The historical mapae worked the same way: the number of horses on the plate scaled with the
 * weight of the errand, and the plate said which one you held.
 *
 * On the human tier, note what is being proven. Verified Code attestations are issued by exchanges
 * through their own channels - we cannot mint one, so the confirmation cannot be staged. What
 * settles that scene is the REFUSAL: a payment inside every limit, from a live identity, on an
 * enabled delegation, to an allowed payee, refused solely because no live human confirmation
 * stands behind it. That is the gate working, and it is the only half of it we can honestly show.
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

function sign(caveats: Caveat[], salt: bigint): Promise<Delegation> {
    const unsigned = rootDelegation({delegate: agent.address, delegator: ACCOUNT, caveats, salt});
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
            terms: periodTerms(addresses.mockKRW, 200_000n, 86_400n, now() - 60n),
            args: "0x",
        },
        {enforcer: addresses.payeeEnforcer, terms: payeeTerms([merchant]), args: "0x"},
        {enforcer: addresses.timestampEnforcer, terms: timestampTerms(0n, now() + 7n * 86_400n), args: "0x"},
    ];
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
    scene: string, d: Delegation, to: Address, amount: bigint, caveatArgs?: Hex,
) {
    // Caveat args are supplied at redemption, never signed - so presenting one here changes what
    // the enforcers see without touching the delegation hash the principal put their name to.
    const presented: Delegation = caveatArgs
        ? {...d, caveats: d.caveats.map((c) =>
            c.enforcer.toLowerCase() === addresses.verifiedCodeEnforcer.toLowerCase()
                ? {...c, args: caveatArgs} : c)}
        : d;
    const args = [
        [encodePermissionContext([presented])],
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
async function ensureVerified(): Promise<void> {
    const live = (await pub.readContract({
        address: addresses.dojangScroll,
        abi: [{type: "function", name: "isVerified", inputs: [{type: "address"}, {type: "bytes32"}],
               outputs: [{type: "bool"}], stateMutability: "view"}] as const,
        functionName: "isVerified",
        args: [principal.address, TESTNET_FAUCET_ID],
    })) as boolean;
    if (live) return;

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
    await pub.waitForTransactionReceipt({hash: tx, timeout: 120_000});
    console.log(`  identity restored  ${EXPLORER}${tx}`);
}

async function main() {
    console.log(`account ${ACCOUNT}\nmerchant ${merchant}\nunlisted ${unlisted}\n`);
    await ensureVerified();

    const salt = BigInt(Date.now());
    const tier1 = await sign([...common(), {
        enforcer: addresses.perPaymentEnforcer, terms: perPaymentTerms(10_000n), args: "0x",
    }], salt);
    const tier2 = await sign([...common(),
        {enforcer: addresses.perPaymentEnforcer, terms: perPaymentTerms(100_000n), args: "0x"},
        {
            enforcer: addresses.verifiedCodeEnforcer,
            terms: `0x${TESTNET_FAUCET_ID.slice(2)}${Buffer.from(CONFIRM_DOMAIN).toString("hex")}` as Hex,
            args: "0x",
        },
    ], salt + 1n);
    // The confirmation code is `args`, not `terms`: it is what the REDEEMER presents at payment
    // time, which is the whole shape of a human-in-the-loop gate. A code nobody issued is what an
    // agent holds when nobody confirmed - so this is the honest stand-in, and the chain refuses it
    // with the enforcer's own CodeNotVerified rather than a malformed-caveat error.
    const unconfirmedCode = keccak256(toHex("nobody-confirmed-this-payment"));

    console.log(`tier 1  ${delegationHash(tier1)}  — up to ${won(10_000n)} per payment, unattended`);
    console.log(`tier 2  ${delegationHash(tier2)}  — up to ${won(100_000n)} per payment, human confirmation required\n`);

    console.log(`1. ${won(10_000n)} on tier 1 — inside what the agent may decide alone`);
    const a = await attempt("₩10,000 within the unattended tier", tier1, merchant, 10_000n);
    assert(a.settled, "tier 1 payment should settle");

    console.log(`\n2. ${won(30_000n)} on tier 1 — above what it may decide alone`);
    const b = await attempt("₩30,000 above the unattended tier", tier1, merchant, 30_000n);
    assert(!b.settled && b.reason?.includes("PerPaymentCapExceeded"), `expected the ceiling to refuse, got ${b.reason}`);

    console.log(`\n3. ${won(30_000n)} on tier 2 — allowed by amount, but needs a person`);
    const c = await attempt(
        "₩30,000 on the human-confirmation tier, presenting a code nobody confirmed", tier2, merchant, 30_000n, unconfirmedCode,
    );
    assert(
        !c.settled && c.reason?.includes("CodeNotVerified"),
        `the human tier must refuse for want of a confirmation, got ${c.reason}`,
    );

    console.log(`\n4. ${won(5_000n)} to a merchant nobody allowed`);
    const d = await attempt("₩5,000 to an unlisted payee", tier1, unlisted, 5_000n);
    assert(!d.settled && d.reason?.includes("PayeeNotAllowed"), `expected the payee list to refuse, got ${d.reason}`);

    console.log(`\n5. the principal revokes their identity, then ${won(5_000n)} on tier 1 again`);
    const revoke = await createWalletClient({
        account: principal, chain: giwaSepolia, transport: http(),
    }).writeContract({
        address: addresses.giwaFaucetExtension,
        abi: [{type: "function", name: "revokeEAS", inputs: [], outputs: [], stateMutability: "nonpayable"}] as const,
        functionName: "revokeEAS",
    });
    await pub.waitForTransactionReceipt({hash: revoke, timeout: 120_000});
    console.log(`  revoked  ${EXPLORER}${revoke}`);

    const e = await attempt("₩5,000 after the identity was revoked", tier1, merchant, 5_000n);
    assert(!e.settled && e.reason?.includes("NotDojangVerified"), `expected identity to refuse, got ${e.reason}`);

    console.log(`\n6. the principal re-issues it — tiers resume`);
    const fee = (await pub.readContract({
        address: addresses.giwaFaucetExtension,
        abi: [{type: "function", name: "fee", inputs: [], outputs: [{type: "uint256"}], stateMutability: "view"}] as const,
        functionName: "fee",
    })) as bigint;
    const reissue = await createWalletClient({
        account: principal, chain: giwaSepolia, transport: http(),
    }).writeContract({
        address: addresses.giwaFaucetExtension,
        abi: [{type: "function", name: "payAndIssueEAS", inputs: [], outputs: [{type: "bytes32"}], stateMutability: "payable"}] as const,
        functionName: "payAndIssueEAS",
        value: fee,
    });
    await pub.waitForTransactionReceipt({hash: reissue, timeout: 120_000});
    console.log(`  re-issued  ${EXPLORER}${reissue}`);

    const f = await attempt("₩5,000 after the identity was restored", tier1, merchant, 5_000n);
    assert(f.settled, "the tier should resume once the identity is live again");

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
            `Two authorities the same person signed, differing only in what they let the agent do without\n` +
            `asking. Both carry the same identity, the same ${won(200_000n)} day budget, the same single\n` +
            `merchant and the same seven-day window.\n\n` +
            `| | Per payment | Human in the loop |\n|---|---|---|\n` +
            `| Tier 1 | ${won(10_000n)} | no |\n| Tier 2 | ${won(100_000n)} | yes |\n\n` +
            `Nothing above tier 2 exists, so a larger payment is refused by having no authority to\n` +
            `redeem rather than by a rule - which is the honest shape of *this is not yours to decide*.\n\n` +
            `${header}\n${rows}\n\n` +
            `The third row is the one worth reading twice. That payment is inside every limit, from a live\n` +
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
