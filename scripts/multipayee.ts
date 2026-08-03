/**
 * One Mapae, three payees - issued and exercised on GIWA Sepolia.
 *
 *   pnpm multipayee
 *
 * The payee enforcer has always taken N packed addresses and scanned them, and a unit test pins
 * that the LAST entry passes as readily as the first. Until now nothing on-chain showed it: every
 * delegation the ledger holds names exactly one payee, because that was all the Composer could
 * collect. This issues a three-payee authority and spends against it, so the property the test
 * asserts is also a transaction anyone can open.
 *
 * The order of the runs is the point:
 *   1. pay the FIRST listed payee      - the easy case
 *   2. pay the LAST listed payee       - the scan reaches the end of the list, not just its head
 *   3. pay an address NOT on the list  - PayeeNotAllowed; the list is an allowlist, not a hint
 *   4. exceed the daily cap            - caveats are a conjunction, the payee being right is not enough
 *
 * Inherits demo.ts's RPC posture: fixed gas, locally tracked nonces, simulation advisory only,
 * the receipt as the only truth. Requires .env: PRINCIPAL_PRIVATE_KEY (funded), AGENT_PRIVATE_KEY.
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
    periodTerms,
    rootDelegation,
    timestampTerms,
    DELEGATION_TYPES,
    delegationDomain,
    delegationHash,
    type Delegation,
} from "../sdk/src/delegation.js";
import {enforcerErrorsAbi, erc20Abi, factoryAbi, managerAbi} from "../sdk/src/abi.js";

const rpc = process.env.GIWA_SEPOLIA_RPC_URL ?? "https://sepolia-rpc.giwa.io";
const principal = privateKeyToAccount(process.env.PRINCIPAL_PRIVATE_KEY as Hex);
const agent = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as Hex);

const pub = createPublicClient({chain: giwaSepolia, transport: http(rpc)});
const wallet = createWalletClient({account: agent, chain: giwaSepolia, transport: http(rpc)});
let nonce = -1;

const errorAbi = [...managerAbi, ...enforcerErrorsAbi, ...factoryAbi];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Deterministic stand-ins. Named for the KIND of counterparty, never for a real company - a real
 * brand beside this project would imply a relationship that does not exist.
 */
const payeeFor = (seed: string): Address =>
    privateKeyToAccount(keccak256(toHex(`mapae-multipayee-${seed}`))).address;

const DAY = 86_400n;
const CAP = 30_000n;

const LIST = [
    {seed: "data-api", label: "Data API"},
    {seed: "storage", label: "Object storage"},
    {seed: "compute", label: "Cloud compute"},
] as const;

function extractRevertData(err: unknown): Hex | undefined {
    const seen = new Set<unknown>();
    const walk = (e: unknown): Hex | undefined => {
        if (!e || typeof e !== "object" || seen.has(e)) return undefined;
        seen.add(e);
        const o = e as Record<string, unknown>;
        if (typeof o.data === "string" && o.data.startsWith("0x") && o.data.length > 2) return o.data as Hex;
        for (const k of ["cause", "error", "details", "walk"]) {
            const hit = walk(o[k]);
            if (hit) return hit;
        }
        return undefined;
    };
    return walk(err);
}

function decodeRevert(data: Hex | undefined): string | undefined {
    if (!data) return undefined;
    try {
        const {errorName, args} = decodeErrorResult({abi: errorAbi, data});
        return args?.length ? `${errorName}(${args.map(String).join(", ")})` : errorName;
    } catch {
        // A vendored enforcer reverts with a plain string; show it rather than the raw bytes.
        try {
            const {errorName, args} = decodeErrorResult({
                abi: [{type: "error", name: "Error", inputs: [{type: "string"}]}] as const,
                data,
            });
            return `${errorName}: ${args?.[0]}`;
        } catch {
            return data.slice(0, 10);
        }
    }
}

async function send(label: string, expected: "success" | "revert", data: Hex): Promise<Hex> {
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

    const hash = await wallet.sendTransaction({
        to: addresses.manager,
        data,
        gas: 1_500_000n,
        nonce: nonce++,
    });
    const receipt = await pub.waitForTransactionReceipt({hash, timeout: 90_000});
    const ok = receipt.status === "success";
    if ((expected === "success") !== ok) {
        throw new Error(`${label}: expected ${expected}, receipt says ${receipt.status} (${hash})`);
    }
    console.log(`  [${ok ? "OK " : "REV"}] ${label}${decoded ? ` -> ${decoded}` : ""}`);
    console.log(`        https://sepolia-explorer.giwa.io/tx/${hash}`);
    return hash;
}

async function main() {
    nonce = await pub.getTransactionCount({address: agent.address});

    const account = (await pub.readContract({
        address: addresses.factory,
        abi: factoryAbi,
        functionName: "predict",
        args: [principal.address, 0n],
    })) as Address;

    const balance = (await pub.readContract({
        address: addresses.mockKRW,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
    })) as bigint;

    const payees = LIST.map((p) => payeeFor(p.seed));
    const outsider = payeeFor("not-listed");

    console.log(`account ${account} holds ${balance.toLocaleString()} mKRW`);
    console.log(`payees (${payees.length}):`);
    LIST.forEach((p, i) => console.log(`  ${i + 1}. ${p.label.padEnd(16)} ${payees[i]}`));
    console.log(`  x. not listed      ${outsider}`);

    if (balance < CAP) throw new Error("account is short of mKRW for this run");

    const now = BigInt(Math.floor(Date.now() / 1000));
    const unsigned = rootDelegation({
        delegate: agent.address,
        delegator: account,
        caveats: [
            {enforcer: addresses.dojangEnforcer, terms: dojangTerms(TESTNET_FAUCET_ID, principal.address), args: "0x"},
            {enforcer: addresses.periodEnforcer, terms: periodTerms(addresses.mockKRW, CAP, DAY, now - 60n), args: "0x"},
            // The one line this whole script exists to exercise.
            {enforcer: addresses.payeeEnforcer, terms: payeeTerms(payees), args: "0x"},
            {enforcer: addresses.timestampEnforcer, terms: timestampTerms(0n, now + 30n * DAY), args: "0x"},
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

    const redeem = (to: Address, amount: bigint): Hex =>
        encodeFunctionData({
            abi: managerAbi,
            functionName: "redeemDelegations",
            args: [
                [encodePermissionContext([signed])],
                [MODE_SIMPLE_SINGLE],
                [encodeExecutionSingle(addresses.mockKRW, 0n, encodeErc20Transfer(to, amount))],
            ],
        });

    console.log(`\ndelegation ${delegationHash(signed).slice(0, 12)}… - cap ${CAP.toLocaleString()}/day over ${payees.length} payees\n`);

    await send(`pay 8,000 to payee 1 of 3 (${LIST[0].label})`, "success", redeem(payees[0], 8_000n));
    await send(`pay 12,000 to payee 3 of 3 (${LIST[2].label}) - the scan reaches the last entry`, "success", redeem(payees[2], 12_000n));
    await send("pay 5,000 to an address that is not on the list", "revert", redeem(outsider, 5_000n));
    await send("pay 15,000 to payee 2 - within the list, past the daily cap", "revert", redeem(payees[1], 15_000n));

    console.log("\nthe ledger now holds a delegation whose payee list is a list.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
