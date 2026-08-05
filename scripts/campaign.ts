/**
 * The campaign: a week of real usage, compressed into one run.
 *
 *   pnpm tsx scripts/campaign.ts
 *
 * The ledger had one demo run, one fleet, and a handful of hand-driven sessions - enough to prove
 * every path once, not enough to look lived-in. This issues six more authorities with distinct
 * shapes and spends against each the way its persona would, collecting along the way a refusal of
 * EVERY deployed kind on fresh delegations:
 *
 *   period cap        - a subscription that tries to renew twice in one window
 *   per-payment cap   - a metered API that tries one oversized call
 *   payee allowlist   - a grocery budget probed by an unlisted address
 *   expired window    - a short authority used after its own end (the run waits it out)
 *   disabled          - a kill-switch drill: pay, disable, refused, enable, pay again
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
    type Caveat,
    type Delegation,
} from "../sdk/src/delegation.js";
import {accountAbi, dojangScrollAbi, enforcerErrorsAbi, erc20Abi, managerAbi} from "../sdk/src/abi.js";

const rpc = process.env.GIWA_SEPOLIA_RPC_URL ?? "https://sepolia-rpc.giwa.io";
const principal = privateKeyToAccount(process.env.PRINCIPAL_PRIVATE_KEY as Hex);
const agent = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as Hex);

const ACCOUNT = "0xc46BCCe39E0fA77BBC7F748987cCb24ee6d773D4" as Address;
const merchant = (seed: string): Address =>
    privateKeyToAccount(keccak256(toHex(`mapae-campaign-${seed}`))).address;

const DAY = 86_400n;
const WEEK = 7n * DAY;

const pub = createPublicClient({chain: giwaSepolia, transport: http(rpc)});
const wallets = {
    principal: createWalletClient({account: principal, chain: giwaSepolia, transport: http(rpc)}),
    agent: createWalletClient({account: agent, chain: giwaSepolia, transport: http(rpc)}),
} as const;
const accounts = {principal, agent} as const;
const nonces: Record<"principal" | "agent", number> = {principal: -1, agent: -1};

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

async function send(
    label: string,
    expected: "success" | "revert",
    from: "principal" | "agent",
    to: Address,
    data: Hex,
): Promise<void> {
    let decoded: string | undefined;
    const deadline = Date.now() + 20_000;
    for (;;) {
        try {
            await pub.call({account: accounts[from].address, to, data});
            decoded = undefined;
            if (expected === "success") break;
        } catch (err) {
            decoded = decodeRevert(extractRevertData(err));
            if (expected === "revert") break;
        }
        if (Date.now() > deadline) break;
        await sleep(1_000);
    }

    const hash = await wallets[from].sendTransaction({to, data, gas: 1_500_000n, nonce: nonces[from]++});
    const receipt = await pub.waitForTransactionReceipt({hash, timeout: 90_000});
    const ok = receipt.status === "success";
    if ((expected === "success") !== ok) {
        throw new Error(`${label}: expected ${expected}, receipt says ${receipt.status} (${hash})`);
    }
    console.log(`  [${ok ? "OK " : "REV"}] ${label}${decoded ? ` -> ${decoded}` : ""}`);
}

/** Sign a root delegation from the campaign account with the given caveats. */
async function issue(caveats: Caveat[], salt: bigint): Promise<Delegation> {
    const unsigned = rootDelegation({delegate: agent.address, delegator: ACCOUNT, caveats, salt});
    return {
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
}

const redeem = (d: Delegation, to: Address, amount: bigint): Hex =>
    encodeFunctionData({
        abi: managerAbi,
        functionName: "redeemDelegations",
        args: [
            [encodePermissionContext([d])],
            [MODE_SIMPLE_SINGLE],
            [encodeExecutionSingle(addresses.mockKRW, 0n, encodeErc20Transfer(to, amount))],
        ],
    });

/** The kill switch is the delegator's: the call must come FROM the account. */
const switchData = (d: Delegation, disable: boolean): Hex =>
    encodeFunctionData({
        abi: accountAbi,
        functionName: "execute",
        args: [
            MODE_SIMPLE_SINGLE as Hex,
            encodeExecutionSingle(
                addresses.manager,
                0n,
                encodeFunctionData({
                    abi: managerAbi,
                    functionName: disable ? "disableDelegation" : "enableDelegation",
                    args: [d],
                }),
            ),
        ],
    });

const identity: Caveat = {
    enforcer: addresses.dojangEnforcer,
    terms: dojangTerms(TESTNET_FAUCET_ID, principal.address),
    args: "0x",
};

async function main() {
    const live = await pub.readContract({
        address: addresses.dojangScroll,
        abi: dojangScrollAbi,
        functionName: "isVerified",
        args: [principal.address, TESTNET_FAUCET_ID],
    });
    if (!live) throw new Error("principal's Dojang is not live");
    const balance = (await pub.readContract({
        address: addresses.mockKRW,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [ACCOUNT],
    })) as bigint;
    if (balance < 300_000n) throw new Error(`campaign account underfunded: ${balance}`);

    nonces.principal = await pub.getTransactionCount({address: principal.address, blockTag: "pending"});
    nonces.agent = await pub.getTransactionCount({address: agent.address, blockTag: "pending"});

    const now = () => BigInt(Math.floor(Date.now() / 1000));
    const base = BigInt(Date.now());

    /* ------------------------- 1 · lunch allowance ------------------------- */
    console.log("\nLunch allowance — 12,000/day, at most 6,000 per payment");
    const lunchSpot = merchant("lunch");
    const lunch = await issue(
        [
            identity,
            {enforcer: addresses.periodEnforcer, terms: periodTerms(addresses.mockKRW, 12_000n, DAY, now() - 60n), args: "0x"},
            {enforcer: addresses.perPaymentEnforcer, terms: perPaymentTerms(6_000n), args: "0x"},
            {enforcer: addresses.payeeEnforcer, terms: payeeTerms([lunchSpot]), args: "0x"},
            {enforcer: addresses.timestampEnforcer, terms: timestampTerms(0n, now() + 30n * DAY), args: "0x"},
        ],
        base + 1n,
    );
    await send("lunch: 5,500", "success", "agent", addresses.manager, redeem(lunch, lunchSpot, 5_500n));
    await send("lunch: 6,000 - at the ceiling", "success", "agent", addresses.manager, redeem(lunch, lunchSpot, 6_000n));
    await send("lunch: 6,500 refused - over the ceiling", "revert", "agent", addresses.manager, redeem(lunch, lunchSpot, 6_500n));
    await send("lunch: unlisted diner refused", "revert", "agent", addresses.manager, redeem(lunch, merchant("stranger"), 500n));

    /* ------------------------- 2 · news subscription ------------------------ */
    console.log("\nNews subscription — 4,900 per 30 days: renewing twice is the bug it exists to stop");
    const newsDesk = merchant("news");
    const news = await issue(
        [
            identity,
            {enforcer: addresses.periodEnforcer, terms: periodTerms(addresses.mockKRW, 4_900n, 30n * DAY, now() - 60n), args: "0x"},
            {enforcer: addresses.payeeEnforcer, terms: payeeTerms([newsDesk]), args: "0x"},
            {enforcer: addresses.timestampEnforcer, terms: timestampTerms(0n, now() + 365n * DAY), args: "0x"},
        ],
        base + 2n,
    );
    await send("news: 4,900 renews", "success", "agent", addresses.manager, redeem(news, newsDesk, 4_900n));
    await send("news: second renewal in the same window refused", "revert", "agent", addresses.manager, redeem(news, newsDesk, 4_900n));

    /* --------------------------- 3 · metered API --------------------------- */
    console.log("\nData API — 3,000/day in 500-won calls");
    const apiDesk = merchant("api");
    const api = await issue(
        [
            identity,
            {enforcer: addresses.periodEnforcer, terms: periodTerms(addresses.mockKRW, 3_000n, DAY, now() - 60n), args: "0x"},
            {enforcer: addresses.perPaymentEnforcer, terms: perPaymentTerms(500n), args: "0x"},
            {enforcer: addresses.payeeEnforcer, terms: payeeTerms([apiDesk]), args: "0x"},
            {enforcer: addresses.timestampEnforcer, terms: timestampTerms(0n, now() + 7n * DAY), args: "0x"},
        ],
        base + 3n,
    );
    for (let i = 1; i <= 3; i++) {
        await send(`api: call ${i} - 500`, "success", "agent", addresses.manager, redeem(api, apiDesk, 500n));
    }
    await send("api: 800 refused - calls are metered at 500", "revert", "agent", addresses.manager, redeem(api, apiDesk, 800n));

    /* ------------------------ 4 · grocery run, 3 shops ----------------------- */
    console.log("\nGroceries — 90,000/week across three named shops");
    const shops = [merchant("shop-a"), merchant("shop-b"), merchant("shop-c")];
    const grocery = await issue(
        [
            identity,
            {enforcer: addresses.periodEnforcer, terms: periodTerms(addresses.mockKRW, 90_000n, WEEK, now() - 60n), args: "0x"},
            {enforcer: addresses.payeeEnforcer, terms: payeeTerms(shops), args: "0x"},
            {enforcer: addresses.timestampEnforcer, terms: timestampTerms(0n, now() + 30n * DAY), args: "0x"},
        ],
        base + 4n,
    );
    await send("grocery: shop A - 24,500", "success", "agent", addresses.manager, redeem(grocery, shops[0], 24_500n));
    await send("grocery: shop B - 17,800", "success", "agent", addresses.manager, redeem(grocery, shops[1], 17_800n));
    await send("grocery: shop C - 9,300", "success", "agent", addresses.manager, redeem(grocery, shops[2], 9_300n));
    await send("grocery: fourth shop refused - not on the list", "revert", "agent", addresses.manager, redeem(grocery, merchant("shop-x"), 1_000n));

    /* -------------------------- 5 · the short window ------------------------- */
    console.log("\nShort window — an authority that outlives its errand by design");
    const courier = merchant("courier");
    const windowEnd = now() + 50n;
    const shortLived = await issue(
        [
            identity,
            {enforcer: addresses.periodEnforcer, terms: periodTerms(addresses.mockKRW, 20_000n, DAY, now() - 60n), args: "0x"},
            {enforcer: addresses.payeeEnforcer, terms: payeeTerms([courier]), args: "0x"},
            {enforcer: addresses.timestampEnforcer, terms: timestampTerms(0n, windowEnd), args: "0x"},
        ],
        base + 5n,
    );
    await send("courier: 10,000 inside the window", "success", "agent", addresses.manager, redeem(shortLived, courier, 10_000n));
    const waitMs = Number(windowEnd - now()) * 1000 + 25_000;
    console.log(`  … waiting ${Math.ceil(waitMs / 1000)}s for the window to close`);
    await sleep(waitMs);
    await send("courier: 5,000 after expiry refused", "revert", "agent", addresses.manager, redeem(shortLived, courier, 5_000n));

    /* ------------------------- 6 · kill-switch drill ------------------------- */
    console.log("\nKill-switch drill — pay, disable, refused, enable, resume");
    const vendor = merchant("vendor");
    const drilled = await issue(
        [
            identity,
            {enforcer: addresses.periodEnforcer, terms: periodTerms(addresses.mockKRW, 15_000n, DAY, now() - 60n), args: "0x"},
            {enforcer: addresses.payeeEnforcer, terms: payeeTerms([vendor]), args: "0x"},
            {enforcer: addresses.timestampEnforcer, terms: timestampTerms(0n, now() + 30n * DAY), args: "0x"},
        ],
        base + 6n,
    );
    await send("drill: 3,000 while live", "success", "agent", addresses.manager, redeem(drilled, vendor, 3_000n));
    await send("drill: delegator throws the switch", "success", "principal", ACCOUNT, switchData(drilled, true));
    await send("drill: 2,000 refused while off", "revert", "agent", addresses.manager, redeem(drilled, vendor, 2_000n));
    await send("drill: switch back on", "success", "principal", ACCOUNT, switchData(drilled, false));
    await send("drill: 2,000 resumes against the same budget", "success", "agent", addresses.manager, redeem(drilled, vendor, 2_000n));

    console.log(`\ncampaign complete - six authorities issued, hashes:`);
    for (const [name, d] of [
        ["lunch", lunch],
        ["news", news],
        ["api", api],
        ["grocery", grocery],
        ["courier", shortLived],
        ["drill", drilled],
    ] as const) {
        console.log(`  ${name.padEnd(8)} ${delegationHash(d)}`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
