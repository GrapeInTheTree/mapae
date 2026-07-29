/**
 * Spend a Mapae that the browser issued.
 *
 *   pnpm redeem <permissionContext> [amount]
 *
 * Paste the context from the Composer's "Copy permission context" button. This is the half of the
 * round trip the UI cannot do: the Composer proves a person can GRANT authority, and this proves
 * an agent can USE what they granted - same bytes, no re-encoding, no second source of truth.
 *
 * If these two halves disagree the delegation was never real, and the disagreement would surface
 * here as a revert rather than as a wrong number on a page.
 *
 * The payee and the amount come from the signed policy itself, not from arguments, so it is
 * impossible to demonstrate a payment the delegation did not actually authorise.
 *
 * Requires .env: AGENT_PRIVATE_KEY, matching the Agent address you typed into the Composer.
 */
import "./env.js";
import {
    createPublicClient,
    createWalletClient,
    decodeAbiParameters,
    decodeErrorResult,
    http,
    type Address,
    type Hex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {addresses, giwaSepolia, MODE_SIMPLE_SINGLE} from "../sdk/src/constants.js";
import {enforcerErrorsAbi, managerAbi} from "../sdk/src/abi.js";
import {
    delegationHash,
    encodeErc20Transfer,
    encodeExecutionSingle,
    type Delegation,
} from "../sdk/src/delegation.js";
import {decodeConditions} from "../sdk/src/policy.js";

const rpc = process.env.GIWA_SEPOLIA_RPC_URL ?? "https://sepolia-rpc.giwa.io";
const key = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
const context = process.argv[2] as Hex | undefined;
const amountArg = process.argv[3];

if (!context?.startsWith("0x")) {
    console.error('usage: pnpm redeem <permissionContext> [amount]\n  (copy it from the Composer)');
    process.exit(1);
}
if (!key) {
    console.error("AGENT_PRIVATE_KEY missing from .env");
    process.exit(1);
}

const agent = privateKeyToAccount(key);
const pub = createPublicClient({chain: giwaSepolia, transport: http(rpc)});
const wallet = createWalletClient({account: agent, chain: giwaSepolia, transport: http(rpc)});

/* --------------------------- read what was signed -------------------------- */

const DELEGATION_TUPLE = [
    {
        type: "tuple[]",
        components: [
            {name: "delegate", type: "address"},
            {name: "delegator", type: "address"},
            {name: "authority", type: "bytes32"},
            {
                name: "caveats",
                type: "tuple[]",
                components: [
                    {name: "enforcer", type: "address"},
                    {name: "terms", type: "bytes"},
                    {name: "args", type: "bytes"},
                ],
            },
            {name: "salt", type: "uint256"},
            {name: "signature", type: "bytes"},
        ],
    },
] as const;

const [chain] = decodeAbiParameters(DELEGATION_TUPLE, context) as unknown as [Delegation[]];
const leaf = chain[0];
const root = chain[chain.length - 1];

const book = {
    dojangEnforcer: addresses.dojangEnforcer,
    periodEnforcer: addresses.periodEnforcer,
    payeeEnforcer: addresses.payeeEnforcer,
    timestampEnforcer: addresses.timestampEnforcer,
};
const conditions = decodeConditions(root.caveats, book);
const payeeCond = conditions.find((c) => c.kind === "payee");
const periodCond = conditions.find((c) => c.kind === "period");

if (payeeCond?.kind !== "payee" || periodCond?.kind !== "period") {
    console.error("this context has no payee/period condition — nothing to spend against");
    process.exit(1);
}

// Straight from the signed terms. Passing these as arguments would let the demo show a payment
// the delegation never authorised, which is the one thing this script must not be able to do.
const payee = payeeCond.payees[0];
const amount = amountArg ? BigInt(amountArg.replace(/[^0-9]/g, "")) : periodCond.amount / 4n;

console.log(`\n  permission context  ${chain.length} link${chain.length > 1 ? "s" : ""}`);
console.log(`  delegation hash     ${delegationHash(root)}`);
console.log(`  paying account      ${root.delegator}`);
console.log(`  delegate (agent)    ${leaf.delegate}`);
console.log(`  signing as          ${agent.address}`);

if (leaf.delegate.toLowerCase() !== agent.address.toLowerCase()) {
    console.error(
        `\n  ✗ AGENT_PRIVATE_KEY is not the delegate.\n` +
            `    Put ${agent.address} in the Composer's "Agent address" and issue again,\n` +
            `    or set AGENT_PRIVATE_KEY to the key for ${leaf.delegate}.\n`,
    );
    process.exit(1);
}

console.log(`\n  spending            ${amount.toLocaleString()} mKRW → ${payee}\n`);

/* --------------------------------- redeem ---------------------------------- */

const execution = encodeExecutionSingle(
    periodCond.token,
    0n,
    encodeErc20Transfer(payee, amount),
);
const args = [[context], [MODE_SIMPLE_SINGLE as Hex], [execution]] as const;

// Simulation is advisory on GIWA's load-balanced endpoint, but a revert here is still the
// cheapest place to read the reason.
try {
    await pub.simulateContract({
        address: addresses.manager,
        abi: managerAbi,
        functionName: "redeemDelegations",
        args,
        account: agent,
    });
    console.log("  simulation          passes");
} catch (e) {
    console.log(`  simulation          ${reasonOf(e)}`);
    console.log("  (broadcasting anyway — a refusal on-chain is the point of this system)\n");
}

const hash = await wallet.writeContract({
    address: addresses.manager,
    abi: managerAbi,
    functionName: "redeemDelegations",
    args,
    gas: 1_500_000n,
});
const receipt = await pub.waitForTransactionReceipt({hash, timeout: 90_000});

console.log(`\n  ${receipt.status === "success" ? "\x1b[32mPAID\x1b[0m" : "\x1b[31mREFUSED\x1b[0m"}`);
console.log(`  tx        https://sepolia-explorer.giwa.io/tx/${hash}`);
console.log(`  trace     http://localhost:5173/tx/${hash}\n`);

/** Pull a decoded custom error out of viem's nested error chain. */
function reasonOf(err: unknown): string {
    let e = err as {data?: unknown; cause?: unknown} | undefined;
    while (e) {
        const data = (e as {data?: Hex}).data;
        if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
            try {
                const d = decodeErrorResult({abi: [...managerAbi, ...enforcerErrorsAbi], data});
                return `${d.errorName}${d.args?.length ? `(${d.args.join(", ")})` : ""}`;
            } catch {
                /* not one of ours; fall through to the string form */
            }
        }
        const short = (e as {shortMessage?: string}).shortMessage;
        if (short && !e.cause) return short;
        e = e.cause as typeof e;
    }
    return "reverted";
}
