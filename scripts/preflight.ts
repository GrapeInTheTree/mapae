/**
 * Is this wallet ready to issue a Mapae in the browser?
 *
 *   pnpm preflight 0xYourWalletAddress
 *
 * The Composer needs four things to be true before a signature is worth anything, and three of
 * them are invisible from inside the browser until you have already committed to a step. This
 * checks all four against the chain and says what to do about each, so the UI walkthrough is a
 * demonstration rather than a debugging session.
 *
 * Read-only: it sends nothing and needs no key.
 */
import {createPublicClient, formatEther, http, type Address} from "viem";
import {addresses, giwaSepolia, TESTNET_FAUCET_ID} from "../sdk/src/constants.js";
import {dojangScrollAbi, erc20Abi, factoryAbi, faucetExtensionAbi} from "../sdk/src/abi.js";

const rpc = process.env.GIWA_SEPOLIA_RPC_URL ?? "https://sepolia-rpc.giwa.io";
const pub = createPublicClient({chain: giwaSepolia, transport: http(rpc)});

const owner = process.argv[2] as Address | undefined;
if (!owner || !/^0x[0-9a-fA-F]{40}$/.test(owner)) {
    console.error("usage: pnpm preflight 0xYourWalletAddress");
    process.exit(1);
}

const OK = "\x1b[32m✓\x1b[0m";
const NO = "\x1b[31m✗\x1b[0m";
const WARN = "\x1b[33m!\x1b[0m";

let blocking = 0;

function line(ok: boolean | "warn", label: string, detail: string, fix?: string) {
    console.log(`${ok === true ? OK : ok === "warn" ? WARN : NO}  ${label.padEnd(26)} ${detail}`);
    if (ok !== true && fix) {
        console.log(`   ${" ".repeat(26)} \x1b[2m→ ${fix}\x1b[0m`);
        if (ok === false) blocking++;
    }
}

console.log(`\n  Mapae preflight — ${owner}\n  ${"─".repeat(64)}`);

/* 1. Gas. Creating the account and disabling a Mapae are both transactions. */
const balance = await pub.getBalance({address: owner});
line(
    balance > 2_000_000_000_000_000n,
    "ETH for gas",
    `${formatEther(balance)} ETH`,
    "claim at https://faucet.giwa.io (0.005/24h) — need ~0.003 for the account, the attestation fee and two txs",
);

/* 2. Identity. Without a live attestation every payment is refused by design - which is a fine
      thing to demonstrate, but not what you want on the first run. */
const [verified, fee] = await Promise.all([
    pub.readContract({
        address: addresses.dojangScroll,
        abi: dojangScrollAbi,
        functionName: "isVerified",
        args: [owner, TESTNET_FAUCET_ID],
    }) as Promise<boolean>,
    pub.readContract({
        address: addresses.giwaFaucetExtension,
        abi: faucetExtensionAbi,
        functionName: "fee",
    }) as Promise<bigint>,
]);
line(
    verified,
    "Dojang attestation",
    verified ? "live (testnet faucet issuer)" : "none",
    `cast send ${addresses.giwaFaucetExtension} "payAndIssueEAS()" --value ${fee} --private-key <yours> --rpc-url ${rpc}`,
);

/* 3. The account. Deterministic, so its address is known before it exists. */
const account = (await pub.readContract({
    address: addresses.factory,
    abi: factoryAbi,
    functionName: "predict",
    args: [owner, 0n],
})) as Address;
const deployed = (await pub.readContract({
    address: addresses.factory,
    abi: factoryAbi,
    functionName: "isMapaeAccount",
    args: [account],
})) as boolean;
line(
    deployed,
    "Mapae account",
    `${account}${deployed ? "" : " (predicted, not yet deployed)"}`,
    'the Composer will offer "Create account" — this is the first signature and the first transaction',
);

/* 4. Funds in the account, not the wallet. A delegation spends the ACCOUNT's balance. */
const krw = (await pub
    .readContract({address: addresses.mockKRW, abi: erc20Abi, functionName: "balanceOf", args: [account]})
    .catch(() => 0n)) as bigint;
line(
    krw > 0n ? true : "warn",
    "mKRW in the account",
    `${krw.toLocaleString()} mKRW`,
    `mint some once the account exists: cast send ${addresses.mockKRW} "mint(address,uint256)" ${account} 1000000 --private-key <yours> --rpc-url ${rpc}`,
);

/* The agent. Not on-chain state, but the loop cannot close without a key for the delegate. */
const agentKey = process.env.AGENT_PRIVATE_KEY;
line(
    Boolean(agentKey),
    "AGENT_PRIVATE_KEY",
    agentKey ? "set (used by pnpm redeem)" : "missing",
    "set it in .env — the Composer's Agent address should be this key's address, so `pnpm redeem` can spend what you issue",
);

console.log(`  ${"─".repeat(64)}`);
if (blocking === 0) {
    console.log(`  ${OK} ready — open the Composer and issue a Mapae\n`);
} else {
    console.log(`  ${NO} ${blocking} blocking item${blocking > 1 ? "s" : ""} above\n`);
    process.exit(1);
}
