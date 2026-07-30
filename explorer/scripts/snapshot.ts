/**
 * Build-time checkpoint for the explorer's aggregate statistics.
 *
 *   pnpm snapshot        (runs before every build - the build script invokes it)
 *
 * Why this exists, with the arithmetic:
 *
 * GIWA produces one block per second - 86,400 blocks a day. The explorer's stats scan the
 * manager's whole event history, so with a 90k-block chunk size the homepage costs 1 getLogs call
 * today, 29 in a month, 87 in three months, 351 in a year. At ~400ms each that is 12s, 35s and
 * 140s of loading, and GIWA's public RPC starts answering "no backend is currently healthy" under
 * exactly that kind of load. A live scan is therefore not a design that ages.
 *
 * This is the checkpoint half of what an indexer does: scan the full history once, at build time,
 * and record the block we reached. The browser then scans only the delta from that checkpoint,
 * so the page is always current AND always fast, with no server to run and nothing to go down.
 * If a deployment goes stale the cost degrades gently (a month unshipped = 29 calls) instead of
 * catastrophically.
 *
 * The queries below are the same ones a Ponder indexer would run server-side. When continuous
 * ingest is worth its operational weight - primarily to serve a public Dojang attestation query
 * API, which GIWA lacks entirely - this logic moves, unchanged.
 */
import {writeFileSync, mkdirSync} from "node:fs";
import {createPublicClient, http, parseAbi, parseEventLogs} from "viem";
import deployments from "../../deployments/91342.json";

const RPC = process.env.GIWA_SEPOLIA_RPC_URL ?? "https://sepolia-rpc.giwa.io";
const MANAGER = deployments.MapaeDelegationManager as `0x${string}`;
const DOJANG_ENFORCER = deployments.DojangVerifiedEnforcer as `0x${string}`;
const DEPLOY_BLOCK = BigInt(deployments.deployBlock);

/** GIWA's public RPC caps getLogs at 100k blocks / 20k results. 90k leaves headroom. */
const CHUNK = 90_000n;

const client = createPublicClient({transport: http(RPC)});

const managerEvents = parseAbi([
    "event RedeemedDelegation(address indexed rootDelegator, address indexed redeemer, bytes32 indexed delegationHash)",
]);
const gateEvents = parseAbi([
    "event DojangGatePassed(address indexed manager, bytes32 indexed delegationHash, address indexed principal, address delegator, bytes32 attesterId, bytes32 attestationUid)",
]);

async function main() {
    const head = await client.getBlockNumber();
    console.log(`scanning ${DEPLOY_BLOCK} → ${head} (${head - DEPLOY_BLOCK} blocks)`);

    const delegations = new Set<string>();
    const principals = new Set<string>();
    // Payments are counted by TRANSACTION: the manager emits one RedeemedDelegation per hop, so a
    // two-hop redelegation (as the x402 facilitator uses) would otherwise count twice.
    const paymentTxs = new Set<string>();

    let calls = 0;
    for (let from = DEPLOY_BLOCK; from <= head; from += CHUNK) {
        const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
        const logs = await client.getLogs({
            address: [MANAGER, DOJANG_ENFORCER],
            fromBlock: from,
            toBlock: to,
        });
        calls++;
        for (const l of parseEventLogs({abi: managerEvents, logs, eventName: "RedeemedDelegation"})) {
            paymentTxs.add(l.transactionHash);
            delegations.add(l.args.delegationHash);
        }
        for (const l of parseEventLogs({abi: gateEvents, logs, eventName: "DojangGatePassed"})) {
            principals.add(l.args.principal.toLowerCase());
        }
    }

    const snapshot = {
        /** Everything below is counted through this block; the browser scans onward from here. */
        checkpointBlock: head.toString(),
        takenAt: new Date().toISOString(),
        delegations: delegations.size,
        payments: paymentTxs.size,
        principals: principals.size,
        /** Retained so the browser can extend the sets without double-counting. */
        delegationHashes: [...delegations],
        principalAddresses: [...principals],
        paymentTxHashes: [...paymentTxs],
    };

    mkdirSync(new URL("../src/data", import.meta.url), {recursive: true});
    writeFileSync(
        new URL("../src/data/snapshot.json", import.meta.url),
        JSON.stringify(snapshot, null, 2) + "\n",
    );

    console.log(
        `${calls} call(s) · ${snapshot.payments} payments · ${snapshot.delegations} delegations · ${snapshot.principals} principals`,
    );
    console.log(`checkpoint at block ${head}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
