/**
 * The per-payment ceiling, proven live.
 *
 *   pnpm tsx scripts/perpayment-proof.ts
 *
 * Issues one delegation carrying all five deployed conditions - identity, period cap, per-payment
 * ceiling, payee allowlist, expiry - against the existing demo account, then redeems twice:
 *
 *   pay 10,000  -> settles   (exactly at the ceiling; the boundary is inclusive)
 *   pay 10,001  -> refused   PerPaymentCapExceeded(10001, 10000)
 *
 * The pair is chosen so only the new condition can be the refusal: the day cap is 50,000 with
 * 10,000 spent, the payee is allowlisted, the window is open, the attestation is live. If the
 * second transaction reverts, it reverts because of the ceiling and nothing else.
 *
 * Inherits demo.ts's RPC posture: fixed gas, locally tracked nonces, simulation advisory only,
 * the receipt as the only truth. Requires .env: PRINCIPAL_PRIVATE_KEY, AGENT_PRIVATE_KEY.
 */
import "./env.js";
import {
    createPublicClient,
    createWalletClient,
    decodeErrorResult,
    encodeFunctionData,
    http,
    keccak256,
    toHex,
    type Address,
    type Hex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {addresses, giwaSepolia, MODE_SIMPLE_SINGLE, TESTNET_FAUCET_ID} from "../sdk/src/constants.js";
import {
    dojangTerms,
    encodeErc20Transfer,
    encodeExecutionSingle,
    encodePermissionContext,
    payeeTerms,
    perPaymentTerms,
    periodTerms,
    rootDelegation,
    timestampTerms,
    DELEGATION_TYPES,
    delegationDomain,
    delegationHash,
    type Delegation,
} from "../sdk/src/delegation.js";
import {dojangScrollAbi, enforcerErrorsAbi, erc20Abi, managerAbi} from "../sdk/src/abi.js";

const rpc = process.env.GIWA_SEPOLIA_RPC_URL ?? "https://sepolia-rpc.giwa.io";
const principal = privateKeyToAccount(process.env.PRINCIPAL_PRIVATE_KEY as Hex);
const agent = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as Hex);

/** The demo account (owner = principal) and the demo merchant, as every prior run used them. */
const ACCOUNT = "0xc46BCCe39E0fA77BBC7F748987cCb24ee6d773D4" as Address;
const MERCHANT = privateKeyToAccount(keccak256(toHex("mapae-demo-merchant"))).address;

const DAY = 86_400n;
const CEILING = 10_000n;

const pub = createPublicClient({chain: giwaSepolia, transport: http(rpc)});
const agentWallet = createWalletClient({account: agent, chain: giwaSepolia, transport: http(rpc)});

const errorAbi = [...managerAbi, ...enforcerErrorsAbi];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decodeRevert(data: Hex | undefined): string | undefined {
    if (!data || data === "0x") return undefined;
    try {
        const e = decodeErrorResult({abi: errorAbi, data});
        return `${e.errorName}(${(e.args ?? []).map(String).join(", ")})`;
    } catch {
        return data.slice(0, 10);
    }
}

function extractRevertData(err: unknown): Hex | undefined {
    let e = err as {data?: {data?: string} | string; cause?: unknown} | undefined;
    while (e) {
        if (typeof e.data === "string") return e.data as Hex;
        if (typeof e.data === "object" && typeof e.data?.data === "string") return e.data.data as Hex;
        e = e.cause as typeof e;
    }
    return undefined;
}

async function send(label: string, expected: "success" | "revert", data: Hex, nonce: number): Promise<void> {
    let decoded: string | undefined;
    const deadline = Date.now() + 20_000;
    for (;;) {
        try {
            await pub.call({account: agent.address, to: addresses.manager, data});
            decoded = undefined;
            if (expected === "success") break;
        } catch (err) {
            decoded = decodeRevert(extractRevertData(err));
            if (expected === "revert") break;
        }
        if (Date.now() > deadline) break;
        await sleep(1_000);
    }

    const hash = await agentWallet.sendTransaction({to: addresses.manager, data, gas: 1_500_000n, nonce});
    const receipt = await pub.waitForTransactionReceipt({hash, timeout: 90_000});
    const ok = receipt.status === "success";
    if ((expected === "success") !== ok) {
        throw new Error(`${label}: expected ${expected}, receipt says ${receipt.status} (${hash})`);
    }
    console.log(`  [${ok ? "OK " : "REV"}] ${label}${decoded ? ` -> ${decoded}` : ""}`);
    console.log(`        https://sepolia-explorer.giwa.io/tx/${hash}`);
}

async function main() {
    // Preconditions read from the chain, not assumed: the account is the principal's, funded,
    // and the identity is live. Any of these failing is a setup error, not a proof result.
    const [live, balance] = await Promise.all([
        pub.readContract({
            address: addresses.dojangScroll,
            abi: dojangScrollAbi,
            functionName: "isVerified",
            args: [principal.address, TESTNET_FAUCET_ID],
        }),
        pub.readContract({
            address: addresses.mockKRW,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [ACCOUNT],
        }),
    ]);
    if (!live) throw new Error("principal's Dojang is not live - re-issue before proving");
    if ((balance as bigint) < 30_000n) throw new Error("demo account underfunded");

    const now = BigInt(Math.floor(Date.now() / 1000));
    const unsigned = rootDelegation({
        delegate: agent.address,
        delegator: ACCOUNT,
        caveats: [
            {enforcer: addresses.dojangEnforcer, terms: dojangTerms(TESTNET_FAUCET_ID, principal.address), args: "0x"},
            {enforcer: addresses.periodEnforcer, terms: periodTerms(addresses.mockKRW, 50_000n, DAY, now - 60n), args: "0x"},
            {enforcer: addresses.perPaymentEnforcer, terms: perPaymentTerms(CEILING), args: "0x"},
            {enforcer: addresses.payeeEnforcer, terms: payeeTerms([MERCHANT]), args: "0x"},
            {enforcer: addresses.timestampEnforcer, terms: timestampTerms(0n, now + 7n * DAY), args: "0x"},
        ],
        salt: BigInt(Date.now()),
    });
    const signed: Delegation = {
        ...unsigned,
        signature: await principal.signTypedData({
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
        }),
    };

    console.log(`delegation ${delegationHash(signed)}`);
    console.log(`policy: 50,000/day · at most ${CEILING.toLocaleString()} per payment · one payee · 7 days\n`);

    const redeem = (amount: bigint): Hex =>
        encodeFunctionData({
            abi: managerAbi,
            functionName: "redeemDelegations",
            args: [
                [encodePermissionContext([signed])],
                [MODE_SIMPLE_SINGLE],
                [encodeExecutionSingle(addresses.mockKRW, 0n, encodeErc20Transfer(MERCHANT, amount))],
            ],
        });

    let nonce = await pub.getTransactionCount({address: agent.address, blockTag: "pending"});
    await send("pay 10,000 - exactly at the ceiling", "success", redeem(CEILING), nonce++);
    await send("pay 10,001 - one over the ceiling", "revert", redeem(CEILING + 1n), nonce++);

    console.log("\nthe ceiling holds: the cap itself settles, one unit past it is refused.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
