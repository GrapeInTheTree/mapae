/**
 * The fleet: six Mapae with six different personalities, issued and USED on GIWA Sepolia.
 *
 *   pnpm fleet
 *
 * The delegation catalogue can only show what the chain has seen, so a catalogue with four
 * near-identical entries undersells the range of what a policy can say. This issues six distinct
 * authorities from one fresh account - subscription, API metering, weekly shopping budget,
 * full-cap compute, coffee allowance, research stipend - and spends against each at least once.
 * Two of them also collect an honest refusal (over-cap, unlisted payee), because refusals are
 * half of what the ledger is for.
 *
 * Inherits demo.ts's RPC posture wholesale: fixed gas, locally tracked nonces, simulation as
 * advisory only, the receipt as the only truth.
 *
 * Requires .env: PRINCIPAL_PRIVATE_KEY (funded), AGENT_PRIVATE_KEY.
 */
import "./env.js";
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
import {
    dojangScrollAbi,
    enforcerErrorsAbi,
    erc20Abi,
    factoryAbi,
    faucetExtensionAbi,
    managerAbi,
} from "../sdk/src/abi.js";

const rpc = process.env.GIWA_SEPOLIA_RPC_URL ?? "https://sepolia-rpc.giwa.io";
const principal = privateKeyToAccount(process.env.PRINCIPAL_PRIVATE_KEY as Hex);
const agent = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as Hex);

const pub = createPublicClient({chain: giwaSepolia, transport: http(rpc)});
const wallets = {
    principal: createWalletClient({account: principal, chain: giwaSepolia, transport: http(rpc)}),
    agent: createWalletClient({account: agent, chain: giwaSepolia, transport: http(rpc)}),
} as const;
const accounts = {principal, agent} as const;
const nonces: Record<"principal" | "agent", number> = {principal: -1, agent: -1};

const errorAbi = [...managerAbi, ...enforcerErrorsAbi, ...factoryAbi];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const merchant = (seed: string): Address => privateKeyToAccount(keccak256(toHex(`mapae-fleet-${seed}`))).address;

const DAY = 86_400n;
const WEEK = 7n * DAY;

/** Six policies that read as six different jobs. Every value here becomes signed terms. */
const FLEET = [
    {name: "News subscription",  seed: "news",     cap: 9_900n,   period: 30n * DAY, validDays: 365n, pay: [9_900n]},
    {name: "Data API agent",     seed: "api",      cap: 3_000n,   period: DAY,       validDays: 7n,   pay: [1_200n], overCap: 2_000n},
    {name: "Shopping agent",     seed: "shop",     cap: 300_000n, period: WEEK,      validDays: 30n,  pay: [120_000n]},
    {name: "Cloud compute",      seed: "cloud",    cap: 25_000n,  period: DAY,       validDays: 90n,  pay: [25_000n]},
    {name: "Coffee allowance",   seed: "cafe",     cap: 6_000n,   period: DAY,       validDays: 30n,  pay: [4_500n], wrongPayee: 1_500n},
    {name: "Research stipend",   seed: "research", cap: 15_000n,  period: DAY,       validDays: 14n,  pay: [7_500n]},
] as const;

function decodeRevert(data: Hex | undefined): string {
    if (!data || data === "0x") return "(no revert data)";
    try {
        const d = decodeErrorResult({abi: errorAbi, data});
        return `${d.errorName}${d.args?.length ? `(${d.args.map(String).join(", ")})` : "()"}`;
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

async function send(
    label: string,
    expected: "success" | "revert",
    from: "principal" | "agent",
    to: Address,
    data: Hex,
    value = 0n,
): Promise<void> {
    // Advisory simulation, polled briefly toward the expected outcome; the receipt decides.
    let decoded: string | undefined;
    const deadline = Date.now() + 20_000;
    for (;;) {
        try {
            await pub.call({account: accounts[from].address, to, data, value});
            decoded = undefined;
            if (expected === "success") break;
        } catch (err) {
            decoded = decodeRevert(extractRevertData(err));
            if (expected === "revert") break;
        }
        if (Date.now() > deadline) break;
        await sleep(1_000);
    }

    const hash = await wallets[from].sendTransaction({to, data, value, gas: 1_500_000n, nonce: nonces[from]++});
    const receipt = await pub.waitForTransactionReceipt({hash, timeout: 90_000});
    const ok = receipt.status === "success";
    if ((expected === "success") !== ok) {
        throw new Error(`${label}: expected ${expected}, receipt says ${receipt.status} (${hash})`);
    }
    console.log(`  [${ok ? "OK " : "REV"}] ${label}${decoded ? ` -> ${decoded}` : ""}`);
    console.log(`        https://sepolia-explorer.giwa.io/tx/${hash}`);
}

async function main() {
    console.log(`principal ${principal.address}`);
    console.log(`agent     ${agent.address}\n`);

    const bal = await pub.getBalance({address: principal.address});
    console.log(`principal balance: ${formatEther(bal)} ETH`);
    if (bal < parseEther("0.002")) throw new Error("principal underfunded");

    nonces.principal = await pub.getTransactionCount({address: principal.address, blockTag: "pending"});
    nonces.agent = await pub.getTransactionCount({address: agent.address, blockTag: "pending"});

    /* ------------------------------ account + funds ----------------------------- */

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
        "Create MapaeAccount",
        "success",
        "principal",
        addresses.factory,
        encodeFunctionData({abi: factoryAbi, functionName: "createAccount", args: [principal.address, accountSalt, consent]}),
    );
    console.log(`  MapaeAccount ${ACCOUNT}\n`);

    await send(
        "Fund account with 1,000,000 mKRW",
        "success",
        "principal",
        addresses.mockKRW,
        encodeFunctionData({abi: erc20Abi, functionName: "mint", args: [ACCOUNT, 1_000_000n]}),
    );

    /* --------------------------------- identity -------------------------------- */

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
            "Obtain Dojang attestation",
            "success",
            "principal",
            addresses.giwaFaucetExtension,
            encodeFunctionData({abi: faucetExtensionAbi, functionName: "payAndIssueEAS"}),
            fee,
        );
    }
    await waitUntil("attestation visible", isVerified);

    /* ---------------------------------- the fleet ------------------------------- */

    const now = BigInt(Math.floor(Date.now() / 1000));
    const ATTACKER = merchant("bystander");

    for (const [i, f] of FLEET.entries()) {
        const payee = merchant(f.seed);
        const unsigned = rootDelegation({
            delegate: agent.address,
            delegator: ACCOUNT,
            caveats: [
                {enforcer: addresses.dojangEnforcer, terms: dojangTerms(TESTNET_FAUCET_ID, principal.address), args: "0x"},
                {enforcer: addresses.periodEnforcer, terms: periodTerms(addresses.mockKRW, f.cap, f.period, now - 60n), args: "0x"},
                {enforcer: addresses.payeeEnforcer, terms: payeeTerms([payee]), args: "0x"},
                {enforcer: addresses.timestampEnforcer, terms: timestampTerms(0n, now + f.validDays * DAY), args: "0x"},
            ],
            // Distinct salt per personality: same signer, same account, six separate budgets.
            salt: accountSalt + BigInt(i) + 1n,
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

        console.log(`\n${f.name} — cap ${f.cap}/${f.period === DAY ? "day" : f.period === WEEK ? "week" : "30d"}, hash ${delegationHash(signed).slice(0, 10)}…`);
        for (const amount of f.pay) {
            await send(`${f.name}: pay ${amount.toLocaleString()} mKRW`, "success", "agent", addresses.manager, redeem(payee, amount));
        }
        if ("overCap" in f && f.overCap) {
            await send(`${f.name}: over-cap ${f.overCap.toLocaleString()} refused`, "revert", "agent", addresses.manager, redeem(payee, f.overCap));
        }
        if ("wrongPayee" in f && f.wrongPayee) {
            await send(`${f.name}: unlisted payee refused`, "revert", "agent", addresses.manager, redeem(ATTACKER, f.wrongPayee));
        }
    }

    console.log("\nfleet issued and exercised - the catalogue now has range.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
