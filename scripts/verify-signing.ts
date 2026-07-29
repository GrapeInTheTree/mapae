/**
 * Does the signing path the Composer uses actually produce something the contracts accept?
 *
 *   pnpm verify-signing
 *
 * WHAT THIS PROVES, and what it does not.
 *
 * It runs the browser's exact construction headlessly: the same SDK modules the Composer imports
 * for the account-creation digest, the delegation typed data, the caveat encoding and the context
 * encoding. Only the wallet is substituted - viem signs where MetaMask would. EIP-712 signing is
 * deterministic given a domain, a type set and a message, so if the contracts accept a signature
 * over exactly the payload the Composer builds, the encoding is right.
 *
 * It does NOT prove the wallet half: that MetaMask is discovered, that it receives this payload
 * intact, or that the UI stores and displays the result. Those need a browser with an extension,
 * and they are two minutes of clicking.
 *
 * Requires .env: PRINCIPAL_PRIVATE_KEY (funded, Dojang-attested), AGENT_PRIVATE_KEY.
 * Costs: one account-creation tx if the account does not exist, one redemption, one disable,
 * one refused redemption. Dust.
 */
import {
    createPublicClient,
    createWalletClient,
    decodeErrorResult,
    encodeFunctionData,
    formatEther,
    hashTypedData,
    http,
    type Address,
    type Hex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {addresses, giwaSepolia, MODE_SIMPLE_SINGLE, TESTNET_FAUCET_ID} from "../sdk/src/constants.js";
import {
    accountAbi,
    dojangScrollAbi,
    enforcerErrorsAbi,
    erc20Abi,
    factoryAbi,
    managerAbi,
} from "../sdk/src/abi.js";
import {
    DELEGATION_TYPES,
    delegationDomain,
    delegationHash,
    encodeErc20Transfer,
    encodeExecutionSingle,
    encodePermissionContext,
    type Delegation,
} from "../sdk/src/delegation.js";
import {encodeConditions, type Condition} from "../sdk/src/policy.js";
import {ROOT_AUTHORITY} from "../sdk/src/protocol.js";

const rpc = process.env.GIWA_SEPOLIA_RPC_URL ?? "https://sepolia-rpc.giwa.io";
const pub = createPublicClient({chain: giwaSepolia, transport: http(rpc)});

const pk = process.env.PRINCIPAL_PRIVATE_KEY as Hex | undefined;
const ak = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
if (!pk || !ak) {
    console.error("PRINCIPAL_PRIVATE_KEY and AGENT_PRIVATE_KEY must be set in .env");
    process.exit(1);
}
const principal = privateKeyToAccount(pk);
const agent = privateKeyToAccount(ak);
const owner = createWalletClient({account: principal, chain: giwaSepolia, transport: http(rpc)});
const delegateWallet = createWalletClient({account: agent, chain: giwaSepolia, transport: http(rpc)});

/**
 * Broadcast, then poll.
 *
 * `waitForTransactionReceipt` alone is not enough here. GIWA's public endpoint load-balances
 * across backends, so the node that accepted a broadcast may not be the node answering the
 * receipt query, and a transaction sent at exactly the market rate can be evicted from the
 * mempool while a naive waiter sits on it - which is how the first run of this script lost an
 * account creation that had never been mined. Fees get headroom, and a missing receipt is
 * treated as "not yet" rather than as failure.
 */
async function send(
    wallet: typeof owner,
    req: Parameters<typeof owner.writeContract>[0],
): Promise<{hash: Hex; status: "success" | "reverted"}> {
    const base = await pub.getGasPrice();
    const hash = await wallet.writeContract({
        ...req,
        // 3x market. The whole run costs dust; being outbid is the expensive outcome.
        maxFeePerGas: base * 3n,
        maxPriorityFeePerGas: base * 2n,
    } as never);

    for (let i = 0; i < 60; i++) {
        const r = await pub.getTransactionReceipt({hash}).catch(() => null);
        if (r) return {hash, status: r.status};
        await new Promise((res) => setTimeout(res, 3000));
    }
    throw new Error(`no receipt for ${hash} after 3 minutes - check the explorer`);
}

const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;
let step = 0;
const say = (ok: boolean, what: string, detail = "") =>
    console.log(`  ${ok ? G("✓") : R("✗")} ${String(++step).padStart(2)}. ${what.padEnd(46)} ${D(detail)}`);
const fail = (what: string, detail: string) => {
    say(false, what, detail);
    process.exit(1);
};

console.log(`\n  Signing path — the Composer's construction, verified against the chain`);
console.log(`  ${"─".repeat(74)}`);
console.log(`  principal ${principal.address}   agent ${agent.address}\n`);

/* ------------------------- 1. preconditions --------------------------- */

const bal = await pub.getBalance({address: principal.address});
if (bal < 500_000_000_000_000n) fail("gas", `${formatEther(bal)} ETH — claim at https://faucet.giwa.io`);
say(true, "principal has gas", `${formatEther(bal)} ETH`);

const verified = (await pub.readContract({
    address: addresses.dojangScroll,
    abi: dojangScrollAbi,
    functionName: "isVerified",
    args: [principal.address, TESTNET_FAUCET_ID],
})) as boolean;
if (!verified) fail("Dojang attestation", "none — the gate would refuse every payment");
say(true, "Dojang attestation live", "testnet faucet issuer");

/* ------------- 2. account creation, the EIP-712 the UI signs ----------- */

const account = (await pub.readContract({
    address: addresses.factory,
    abi: factoryAbi,
    functionName: "predict",
    args: [principal.address, 0n],
})) as Address;

// Exactly what explorer/src/lib/account.ts builds. The client recomputes the digest and compares
// it to the contract's before asking anyone to sign - reproduced here, because getting this wrong
// produces a signature that is valid, well-formed and rejected on-chain.
const creationTyped = {
    domain: {
        name: "MapaeAccountFactory",
        version: "1",
        chainId: giwaSepolia.id,
        verifyingContract: addresses.factory,
    },
    types: {
        MapaeAccountCreation: [
            {name: "owner", type: "address"},
            {name: "salt", type: "uint256"},
        ],
    },
    primaryType: "MapaeAccountCreation" as const,
    message: {owner: principal.address, salt: 0n},
};

const onChainDigest = (await pub.readContract({
    address: addresses.factory,
    abi: factoryAbi,
    functionName: "creationDigest",
    args: [principal.address, 0n],
})) as Hex;
const localDigest = hashTypedData(creationTyped);
if (onChainDigest.toLowerCase() !== localDigest.toLowerCase()) {
    fail("account-creation digest matches the factory", `${localDigest} != ${onChainDigest}`);
}
say(true, "account-creation digest matches the factory", localDigest.slice(0, 18) + "…");

let deployed = (await pub.readContract({
    address: addresses.factory,
    abi: factoryAbi,
    functionName: "isMapaeAccount",
    args: [account],
})) as boolean;

if (!deployed) {
    const consent = await owner.signTypedData({account: principal, ...creationTyped});
    const r = await send(owner, {
        address: addresses.factory,
        abi: factoryAbi,
        functionName: "createAccount",
        args: [principal.address, 0n, consent],
        gas: 1_500_000n,
    } as never);
    if (r.status !== "success") fail("factory accepts the consent signature", r.hash);
    deployed = true;
    say(true, "factory accepted the consent signature", r.hash.slice(0, 18) + "…");
} else {
    say(true, "account already exists", account);
}

/* --------------------------- 3. fund it -------------------------------- */

let krw = (await pub.readContract({
    address: addresses.mockKRW,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
})) as bigint;
if (krw < 100_000n) {
    await send(owner, {
        address: addresses.mockKRW,
        abi: erc20Abi,
        functionName: "mint",
        args: [account, 1_000_000n],
        gas: 300_000n,
    } as never);
    krw = 1_000_000n;
}
say(true, "account funded", `${krw.toLocaleString()} mKRW`);

/* ------------- 4. the delegation, built the way the UI builds it -------- */

const merchant = "0x8acd1cb7f7bD5aE7D0b2e94a3aE05eF0Fe4Aa617" as Address;
const now = BigInt(Math.floor(Date.now() / 1000));

// Same order and shape as explorer/src/lib/presets.ts buildConditions().
const conditions: Condition[] = [
    {kind: "identity", attesterId: TESTNET_FAUCET_ID, principal: principal.address},
    {kind: "period", token: addresses.mockKRW, amount: 50_000n, duration: 86_400n, start: now},
    {kind: "payee", payees: [merchant]},
    {kind: "window", from: 0n, until: now + 7n * 86_400n},
];

const book = {
    dojangEnforcer: addresses.dojangEnforcer,
    periodEnforcer: addresses.periodEnforcer,
    payeeEnforcer: addresses.payeeEnforcer,
    timestampEnforcer: addresses.timestampEnforcer,
};

const unsigned: Delegation = {
    delegate: agent.address,
    delegator: account,
    authority: ROOT_AUTHORITY as Hex,
    caveats: encodeConditions(conditions, book),
    salt: BigInt(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString("hex")}`),
    signature: "0x",
};
say(true, "conditions encoded", `${unsigned.caveats.length} caveats via the shared codec`);

// The exact call the Composer now makes - SDK domain and types, not a copy.
const signature = await owner.signTypedData({
    account: principal,
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
});
const signed: Delegation = {...unsigned, signature};
const hash = delegationHash(signed);
say(true, "delegation signed (owner key, ERC-1271 path)", hash.slice(0, 18) + "…");

// The account must recognise the owner's signature, or the manager will refuse it.
const magic = (await pub.readContract({
    address: account,
    abi: [
        {
            type: "function",
            name: "isValidSignature",
            stateMutability: "view",
            inputs: [{type: "bytes32"}, {type: "bytes"}],
            outputs: [{type: "bytes4"}],
        },
    ],
    functionName: "isValidSignature",
    args: [
        hashTypedData({
            domain: delegationDomain(giwaSepolia.id, addresses.manager),
            types: DELEGATION_TYPES,
            primaryType: "Delegation",
            message: {
                delegate: signed.delegate,
                delegator: signed.delegator,
                authority: signed.authority,
                caveats: signed.caveats.map((c) => ({enforcer: c.enforcer, terms: c.terms})),
                salt: signed.salt,
            },
        }),
        signature,
    ],
})) as Hex;
if (magic !== "0x1626ba7e") fail("account validates the signature (ERC-1271)", magic);
say(true, "account validates the signature (ERC-1271)", "0x1626ba7e");

const context = encodePermissionContext([signed]);

/* ------------------------- 5. an agent spends it ----------------------- */

const before = (await pub.readContract({
    address: addresses.mockKRW,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [merchant],
})) as bigint;

const spend = (amount: bigint) =>
    send(delegateWallet, {
        address: addresses.manager,
        abi: managerAbi,
        functionName: "redeemDelegations",
        args: [
            [context],
            [MODE_SIMPLE_SINGLE as Hex],
            [encodeExecutionSingle(addresses.mockKRW, 0n, encodeErc20Transfer(merchant, amount))],
        ],
        gas: 1_500_000n,
    } as never);

const paid = await spend(20_000n);
if (paid.status !== "success") fail("agent redeems what the owner signed", paid.hash);
const after = (await pub.readContract({
    address: addresses.mockKRW,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [merchant],
})) as bigint;
if (after - before !== 20_000n) fail("funds moved", `delta ${after - before}`);
say(true, "agent redeemed it, funds moved", `+20,000 mKRW · ${paid.hash.slice(0, 18)}…`);

/* --------------------- 6. the kill switch refuses ---------------------- */

const off = await owner.writeContract({
    address: account,
    abi: accountAbi,
    functionName: "execute",
    args: [
        MODE_SIMPLE_SINGLE as Hex,
        encodeExecutionSingle(
            addresses.manager,
            0n,
            encodeFunctionData({abi: managerAbi, functionName: "disableDelegation", args: [signed]}),
        ),
    ],
    gas: 500_000n,
});
await pub.waitForTransactionReceipt({hash: off, timeout: 90_000});
say(true, "owner disabled it through the account", off.slice(0, 18) + "…");

const refused = await spend(1_000n);
if (refused.status === "success") fail("disabled delegation still spent", refused.hash);
let reason = "reverted";
try {
    await pub.call({
        account: agent,
        to: addresses.manager,
        data: encodeFunctionData({
            abi: managerAbi,
            functionName: "redeemDelegations",
            args: [[context], [MODE_SIMPLE_SINGLE as Hex], [encodeExecutionSingle(addresses.mockKRW, 0n, encodeErc20Transfer(merchant, 1_000n))]],
        }),
        blockNumber: (await pub.getTransactionReceipt({hash: refused.hash})).blockNumber - 1n,
    });
} catch (e) {
    let cur = e as {data?: Hex; cause?: unknown} | undefined;
    while (cur) {
        if (typeof cur.data === "string" && cur.data.length >= 10) {
            try {
                reason = decodeErrorResult({abi: [...managerAbi, ...enforcerErrorsAbi], data: cur.data}).errorName;
                break;
            } catch {
                /* keep walking */
            }
        }
        cur = cur.cause as typeof cur;
    }
}
say(true, "the same payment is now refused", `${reason} · ${refused.hash.slice(0, 18)}…`);

console.log(`  ${"─".repeat(74)}`);
console.log(`  ${G("The Composer's construction is accepted by the deployed contracts.")}`);
console.log(D(`  Not covered: MetaMask discovery, the extension signing, and the UI wiring.`));
console.log(D(`  Trace it:    http://localhost:5173/tx/${paid.hash}`));
console.log(D(`  Refusal:     http://localhost:5173/tx/${refused.hash}\n`));
