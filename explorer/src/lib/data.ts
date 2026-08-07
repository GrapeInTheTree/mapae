import {
    createPublicClient,
    decodeAbiParameters,
    decodeErrorResult,
    decodeFunctionData,
    http,
    parseAbi,
    parseEventLogs,
    type Address,
    type Hex,
} from "viem";
import {
    accountAbi,
    dojangEnforcerAbi,
    dojangScrollAbi,
    easAbi,
    attesterBookAbi,
    enforcerErrorsAbi,
    factoryAbi,
    managerAbi,
    periodEnforcerAbi,
} from "@mapae/abi";
import {delegationHash, type Delegation} from "@mapae/sdk";
import {addresses, giwaSepolia, BLOCKSCOUT} from "./config";
import {decodeConditions, type Condition} from "./policy";
import snapshot from "../data/snapshot.json";
import {indexedActivity, indexedStats} from "./indexer";

export const client = createPublicClient({chain: giwaSepolia, transport: http()});

const errorAbi = [...managerAbi, ...enforcerErrorsAbi, ...factoryAbi];

/** Manager events - the SDK's managerAbi carries functions and errors only. */
const managerEventsAbi = parseAbi([
    "event RedeemedDelegation(address indexed rootDelegator, address indexed redeemer, bytes32 indexed delegationHash)",
    "event DisabledDelegation(bytes32 indexed delegationHash, address indexed delegator)",
    "event EnabledDelegation(bytes32 indexed delegationHash, address indexed delegator)",
]);

/* ----------------------------- delegation decoding ----------------------------- */

const DELEGATION_PARAMS = [
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

export interface DecodedDelegation {
    delegate: Address;
    delegator: Address;
    authority: Hex;
    salt: bigint;
    /** Decoded through the SDK codec, so this page and the Composer agree by construction. */
    conditions: Condition[];
    raw: {enforcer: Address; terms: Hex; args: Hex}[];
    /** True for the deepest link - the one whose account pays and whose rules always apply. */
    isRoot: boolean;
}

/** A permission context, decoded whole. Leaf first, root last, exactly as it is redeemed.
 *
 *  Showing only the leaf would be actively misleading: a re-delegation can narrow what it
 *  received but never widen it, so the conditions that actually bound a payment are the UNION of
 *  every link's. A page that displayed only the child would omit the root's limit, which is
 *  usually the one that matters. */
export function decodeContext(context: Hex): DecodedDelegation[] {
    const [chain] = decodeAbiParameters(DELEGATION_PARAMS, context);
    return chain.map((d, i) => ({
        delegate: d.delegate,
        delegator: d.delegator,
        authority: d.authority,
        salt: d.salt,
        conditions: decodeConditions(
            d.caveats.map((c) => ({enforcer: c.enforcer, terms: c.terms, args: c.args})),
        ),
        raw: d.caveats.map((c) => ({enforcer: c.enforcer, terms: c.terms, args: c.args})),
        isRoot: i === chain.length - 1,
    }));
}

/* --------------------------------- the feed --------------------------------- */

export interface FeedItem {
    hash: Hex;
    ok: boolean;
    timestamp: string;
    from: Address;
}

/** Redemption attempts against the manager - successes AND failures. The index first, then
 *  Blockscout, which is where these came from before there was an index. */
export async function fetchFeed(): Promise<FeedItem[]> {
    const indexed = await indexedActivity(100);
    if (indexed) {
        return indexed.items.map((a) => ({
            hash: a.txHash,
            ok: a.ok,
            timestamp: new Date(Number(a.timestamp) * 1000).toISOString(),
            from: a.from,
        }));
    }
    const res = await fetch(
        `${BLOCKSCOUT}/api/v2/addresses/${addresses.manager}/transactions?filter=to`,
    );
    const data = await res.json();
    return (data.items ?? [])
        .filter((t: {raw_input?: string}) => t.raw_input?.startsWith("0xcef6d209"))
        .map((t: {hash: Hex; status: string; timestamp: string; from: {hash: Address}}) => ({
            hash: t.hash,
            ok: t.status === "ok",
            timestamp: t.timestamp,
            from: t.from.hash,
        }));
}

/* --------------------------------- statistics -------------------------------- */

export interface Stats {
    delegations: number;
    redemptions: number;
    rejections: number;
    principals: number;
    headBlock: bigint;
    /** Blocks scanned live on top of the build-time checkpoint. Zero when an index answered. */
    deltaBlocks: bigint;
    /** Which path produced these numbers, so the screen can say so rather than imply it. */
    source: "index" | "chain";
}

let statsCache: Promise<Stats> | null = null;

/**
 * Checkpoint + catch-up, which is what an indexer does - here with the checkpoint baked in at
 * build time and the catch-up run in the browser.
 *
 * GIWA mints a block per second, so scanning from the deploy block on every page load costs one
 * getLogs call today and 351 within a year. Starting from the shipped checkpoint keeps it at one
 * call for as long as deployments are reasonably fresh, and degrades gently rather than
 * catastrophically if a build goes stale.
 */
export function fetchStats(): Promise<Stats> {
    statsCache ??= (async () => {
        const head = await client.getBlockNumber();

        // The index answers in one request what the scan below spends a Blockscout round-trip
        // and a getLogs sweep on. If it does not answer, nothing is lost but the speed.
        //
        // `ready` is load-bearing, not decoration: Ponder advances one checkpoint across all its
        // sources, so while any source is backfilling these counts are a fraction of the truth.
        // A fast wrong number is worse than a slow right one, so an unready index is ignored here.
        const indexed = await indexedStats();
        if (indexed?.ready) {
            return {
                delegations: indexed.delegations,
                redemptions: indexed.redemptions,
                rejections: indexed.rejections,
                principals: indexed.principals,
                headBlock: head,
                deltaBlocks: 0n,
                source: "index" as const,
            };
        }

        const CHUNK = 90_000n;

        const delegations = new Set<string>(snapshot.delegationHashes);
        const principals = new Set<string>(snapshot.principalAddresses);
        // Counted by TRANSACTION, not by event: the manager emits one RedeemedDelegation per hop,
        // so a two-hop redelegation (as the x402 facilitator uses) would otherwise count twice.
        const paymentTxs = new Set<string>(snapshot.paymentTxHashes);

        const from0 = BigInt(snapshot.checkpointBlock) + 1n;
        for (let from = from0; from <= head; from += CHUNK) {
            const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
            // GIWA's public RPC sheds heavy queries under load, and a log sweep is the heaviest
            // thing this page asks for - so the fallback path needs the same retry the trace
            // page already learned to use. Without it a single shed request empties the counters.
            const logs = await withRetry(() =>
                client.getLogs({
                    address: [addresses.manager, addresses.dojangEnforcer],
                    fromBlock: from,
                    toBlock: to,
                }),
            );
            for (const l of parseEventLogs({abi: managerEventsAbi, logs, eventName: "RedeemedDelegation"})) {
                paymentTxs.add(l.transactionHash);
                delegations.add(l.args.delegationHash);
            }
            for (const l of parseEventLogs({
                abi: dojangEnforcerAbi,
                logs,
                eventName: "DojangGatePassed",
            })) {
                principals.add(l.args.principal.toLowerCase());
            }
        }

        const feed = await fetchFeed();
        return {
            delegations: delegations.size,
            redemptions: paymentTxs.size,
            rejections: feed.filter((f) => !f.ok).length,
            principals: principals.size,
            headBlock: head,
            deltaBlocks: head > from0 ? head - from0 : 0n,
            source: "chain" as const,
        };
    })();
    // A memoised promise remembers a rejection as faithfully as a result, which would leave the
    // page showing dashes until someone reloaded it. Forget the failure so the next mount tries.
    statsCache.catch(() => {
        statsCache = null;
    });
    return statsCache;
}

/* --------------------------------- the activity list --------------------------------- */

export interface ActivityItem {
    hash: Hex;
    ok: boolean;
    timestamp: string;
    from: Address;
    /** The transfer this attempt carried, decoded from calldata - present for refusals too. */
    payment?: {token: Address; to: Address; amount: bigint};
    delegationHash?: Hex;
    batch: number;
}

/** The feed with its meaning attached: every attempt against the manager, with the amount, the
 *  payee and the authority it invoked - all recovered from calldata, so a refused attempt is as
 *  legible as a settled one. */
export async function fetchActivity(): Promise<ActivityItem[]> {
    // The index stores each attempt with its intent already decoded, refusals included - the
    // same recovery this function performs below, done once at write time instead of per visit.
    const indexed = await indexedActivity(100);
    if (indexed) {
        return indexed.items.map((a) => ({
            hash: a.txHash,
            ok: a.ok,
            timestamp: new Date(Number(a.timestamp) * 1000).toISOString(),
            from: a.from,
            batch: a.batch,
            delegationHash: a.rootHash ?? undefined,
            payment:
                a.token && a.payee && a.amount !== null
                    ? {token: a.token, to: a.payee, amount: BigInt(a.amount)}
                    : undefined,
        }));
    }
    const res = await fetch(
        `${BLOCKSCOUT}/api/v2/addresses/${addresses.manager}/transactions?filter=to`,
    );
    const data = await res.json();
    const txs = ((data.items ?? []) as {
        hash: Hex;
        status: string;
        timestamp: string;
        from: {hash: Address};
        raw_input?: Hex;
    }[]).filter((t) => t.raw_input?.startsWith("0xcef6d209"));

    return txs.map((t) => {
        const item: ActivityItem = {
            hash: t.hash,
            ok: t.status === "ok",
            timestamp: t.timestamp,
            from: t.from.hash,
            batch: 0,
        };
        try {
            const {args} = decodeFunctionData({abi: managerAbi, data: t.raw_input!});
            const [contexts, , execs] = args as [Hex[], Hex[], Hex[]];
            item.batch = contexts.length;
            const [chain] = decodeAbiParameters(DELEGATION_PARAMS, contexts[0]);
            const root = chain[chain.length - 1];
            item.delegationHash = delegationHash({
                delegate: root.delegate,
                delegator: root.delegator,
                authority: root.authority,
                caveats: root.caveats.map((c) => ({...c})),
                salt: root.salt,
                signature: root.signature,
            });
            const exec = execs[0];
            const callData = exec.slice(2 + 40 + 64);
            if (callData.startsWith("a9059cbb")) {
                item.payment = {
                    token: `0x${exec.slice(2, 42)}` as Address,
                    to: `0x${callData.slice(8 + 24, 8 + 64)}` as Address,
                    amount: BigInt(`0x${callData.slice(8 + 64, 8 + 128)}`),
                };
            }
        } catch {
            /* undecodable input: the row still shows status, hash and time */
        }
        return item;
    });
}

/* ------------------------------- the delegation list ------------------------------- */

export interface DelegationSummary {
    hash: Hex;
    delegator: Address;
    delegate: Address;
    conditions: Condition[];
    raw: {enforcer: Address; terms: Hex; args: Hex}[];
    /**
     * The signed root, recovered whole from the calldata that redeemed it.
     *
     * Kept because the kill switch needs it: `disableDelegation` takes the delegation struct, not
     * its hash. Without this only a browser that still holds its own issuance record could throw
     * the switch - which is backwards, since the authority to disable is the delegator's and
     * belongs to them wherever they are signed in.
     */
    delegation: Delegation;
    chainLength: number;
    /** Every attempt against this authority, newest first - refusals included. */
    txs: {hash: Hex; ok: boolean; timestamp: string}[];
    settled: number;
    refused: number;
    lastUsed: string;
    /* Live state, read from the chain at load. null when the RPC shed the read. */
    disabled: boolean | null;
    identityLive: boolean | null;
    available: bigint | null;
    periodCap: bigint | null;
}

/**
 * Every Mapae the chain has ever seen, reconstructed from calldata.
 *
 * There is no registry to query and no server to ask - deliberately. A grant is an off-chain
 * signature, so an unused Mapae exists nowhere but its issuer's browser; the moment one is USED,
 * the full signed delegation rides in the redemption calldata, refusals included. Grouping those
 * transactions by delegation hash rebuilds the complete catalogue from primary evidence, which is
 * exactly the property the product claims: the chain is the only answer to "what authority
 * exists", and here is that answer, read directly.
 */
/// How many pages of manager transactions to walk when rebuilding the list from chain.
///
/// One page is not a list, it is a window on the last hour. Measured on 2026-08-07, the first page
/// held 8 distinct authorities and five pages held 73 - a day of demo traffic against one account
/// is enough to push every other Mapae out of view, while the counter above the list still says
/// 84 because that number comes from the index. A list that disagrees with the number printed
/// beside it is worse than a slow one.
const LIST_PAGES = 6;

/// `onPartial` is handed the list as it grows, one Blockscout page at a time.
///
/// Six pages is six sequential round trips - the cursor makes them sequential - and waiting for
/// all of them before drawing anything is a blank screen for several seconds. The first page is
/// the most recent activity, which is what a reader is usually looking for, so it goes up
/// immediately and the rest fill in behind it.
export async function fetchDelegationList(
    onPartial?: (rows: DelegationSummary[]) => void,
): Promise<DelegationSummary[]> {
    type Tx = {hash: Hex; status: string; timestamp: string; raw_input?: Hex};
    const txs: Tx[] = [];
    let params = "";
    for (let page = 0; page < LIST_PAGES; page++) {
        const res = await fetch(
            `${BLOCKSCOUT}/api/v2/addresses/${addresses.manager}/transactions?filter=to${params}`,
        );
        // A source that is down must not read as "there is nothing here". This list has no other
        // source - the conditions it shows live in transaction calldata, which no event carries -
        // so a failed first page has to surface as a failure, not as an empty ledger.
        if (!res.ok) {
            if (page === 0) throw new Error(`delegation list unavailable: Blockscout ${res.status}`);
            break;
        }
        const data = await res.json();
        txs.push(...((data.items ?? []) as Tx[]).filter((t) => t.raw_input?.startsWith("0xcef6d209")));
        onPartial?.(group(txs));
        const next = data.next_page_params as Record<string, string | number> | null | undefined;
        if (!next) break;
        params = `&${new URLSearchParams(Object.entries(next).map(([k, v]) => [k, String(v)]))}`;
    }

    return group(txs);
}

/// Group manager transactions into one row per root authority.
function group(txs: {hash: Hex; status: string; timestamp: string; raw_input?: Hex}[]): DelegationSummary[] {
    const map = new Map<string, DelegationSummary>();
    for (const t of txs) {
        let contexts: Hex[];
        try {
            const {args} = decodeFunctionData({abi: managerAbi, data: t.raw_input!});
            [contexts] = args as [Hex[], Hex[], Hex[]];
        } catch {
            continue;
        }
        for (const ctx of contexts) {
            try {
                const [chain] = decodeAbiParameters(DELEGATION_PARAMS, ctx);
                const root = chain[chain.length - 1];
                // The hash excludes the signature, so the same signed authority hashes
                // identically in every transaction that carries it - that is what makes
                // grouping by hash mean "the same Mapae".
                const hash = delegationHash({
                    delegate: root.delegate,
                    delegator: root.delegator,
                    authority: root.authority,
                    caveats: root.caveats.map((c) => ({...c})),
                    salt: root.salt,
                    signature: root.signature,
                });
                const entry = map.get(hash);
                if (entry) {
                    entry.txs.push({hash: t.hash, ok: t.status === "ok", timestamp: t.timestamp});
                } else {
                    map.set(hash, {
                        hash,
                        delegator: root.delegator,
                        delegate: chain[0].delegate,
                        conditions: decodeConditions(root.caveats.map((c) => ({...c}))),
                        raw: root.caveats.map((c) => ({...c})),
                        delegation: {
                            delegate: root.delegate,
                            delegator: root.delegator,
                            authority: root.authority,
                            caveats: root.caveats.map((c) => ({...c})),
                            salt: root.salt,
                            signature: root.signature,
                        },
                        chainLength: chain.length,
                        txs: [{hash: t.hash, ok: t.status === "ok", timestamp: t.timestamp}],
                        settled: 0,
                        refused: 0,
                        lastUsed: t.timestamp,
                        disabled: null,
                        identityLive: null,
                        available: null,
                        periodCap: null,
                    });
                }
            } catch {
                /* not a decodable context; skip the entry, keep the list */
            }
        }
    }

    const list = [...map.values()];
    for (const e of list) {
        e.settled = e.txs.filter((x) => x.ok).length;
        e.refused = e.txs.length - e.settled;
        // Blockscout returns newest first; keep that order and take the newest as last-used.
        e.lastUsed = e.txs[0]?.timestamp ?? e.lastUsed;
    }

    return list.sort((a, b) => Date.parse(b.lastUsed) - Date.parse(a.lastUsed));
}

/// Fill in the now-questions: disabled, identity still live, budget left.
///
/// Separated from the listing, and bounded, because it is the expensive half. Each row costs up
/// to three chain reads, so enriching a 73-row list in one go fired ~200 concurrent calls at a
/// rate-limited public endpoint - the reads that lost came back as nulls, and a null budget draws
/// as "Used —" on a delegation that has plainly been used. Slow was the visible symptom; wrong
/// was the real one. Callers enrich the rows they are about to show.
export async function enrichDelegations(rows: DelegationSummary[]): Promise<void> {
    const QUEUE = 6;
    let next = 0;
    const worker = async () => {
        for (let i = next++; i < rows.length; i = next++) {
            const e = rows[i];
            try {
                e.disabled = (await client.readContract({
                    address: addresses.manager,
                    abi: managerAbi,
                    functionName: "disabledDelegations",
                    args: [e.hash],
                })) as boolean;
            } catch {
                /* row renders with unknown state */
            }
            const identity = e.conditions.find((c) => c.kind === "identity");
            if (identity?.kind === "identity") {
                try {
                    e.identityLive = await client.readContract({
                        address: addresses.dojangScroll,
                        abi: dojangScrollAbi,
                        functionName: "isVerified",
                        args: [identity.principal, identity.attesterId],
                    });
                } catch {
                    /* unknown */
                }
            }
            const periodCaveat = e.raw.find(
                (c) => c.enforcer.toLowerCase() === addresses.periodEnforcer.toLowerCase(),
            );
            const period = e.conditions.find((c) => c.kind === "period");
            if (periodCaveat && period?.kind === "period") {
                e.periodCap = period.amount;
                try {
                    const res2 = (await client.readContract({
                        address: addresses.periodEnforcer,
                        abi: periodEnforcerAbi,
                        functionName: "getAvailableAmount",
                        args: [e.hash, addresses.manager, periodCaveat.terms],
                    })) as readonly [bigint, boolean, bigint];
                    e.available = res2[0];
                } catch {
                    /* meter simply not drawn */
                }
            }
        }
    };
    await Promise.all(Array.from({length: Math.min(QUEUE, rows.length)}, worker));
}

/* ---------------------------------- tracing ---------------------------------- */

export interface Attestation {
    uid: Hex;
    recipient: Address;
    attester: Address;
    issuedAt: number;
    expiresAt: number;
    revokedAt: number;
}

export interface Trace {
    hash: Hex;
    ok: boolean;
    blockNumber: bigint;
    /** Unix seconds, from the block header. */
    timestamp?: number;
    gasUsed?: bigint;
    redeemer: Address;
    /** Decoded reason, failures only. */
    rejection?: string;
    /** Every link of the redeemed context, leaf first. Empty if this is not a redemption. */
    chain: DecodedDelegation[];
    /** The deepest link: whose account pays, and whose conditions can never be widened. */
    delegation?: DecodedDelegation;
    /** How many permission contexts this one transaction redeemed. A batch settles atomically,
     *  so a single refusal anywhere rolls all of them back. */
    batchSize: number;
    delegationHash?: Hex;
    /** The transfer this redemption performed (or attempted). */
    payment?: {token: Address; to: Address; amount: bigint};
    /** Identity chain, resolved live. */
    identity?: {
        principal: Address;
        attesterId: Hex;
        attestationUid?: Hex;
        attestation?: Attestation;
        attesterFromBook?: Address;
        liveNow: boolean;
        accountRegistered?: boolean;
        accountOwner?: Address;
    };
    spentInPeriod?: bigint;
    periodCap?: bigint;
}

function extractRevert(err: unknown): Hex | undefined {
    let e = err as {data?: unknown; cause?: unknown} | undefined;
    while (e) {
        if (typeof e.data === "string" && e.data.startsWith("0x") && e.data.length > 2)
            return e.data as Hex;
        const inner = (e.data as {data?: string})?.data;
        if (typeof inner === "string" && inner.startsWith("0x")) return inner as Hex;
        e = e.cause as typeof e;
    }
    return undefined;
}

function decodeRejection(data: Hex | undefined): string {
    if (!data) return "사유를 복원할 수 없음";
    try {
        const d = decodeErrorResult({abi: errorAbi, data});
        return d.args?.length ? `${d.errorName}(${d.args.map(String).join(", ")})` : `${d.errorName}()`;
    } catch {
        return `raw ${data.slice(0, 20)}…`;
    }
}

const transferEventAbi = parseAbi([
    "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

/** GIWA's public RPC load-balances across backends that lag each other by a few blocks; a read
 *  that one backend answers, another 404s a second later. Retried with backoff because the
 *  alternative was worse than an error: a transient miss rendered as the confident, false claim
 *  that the transaction is not a Mapae redemption. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 5, delayMs = 900): Promise<T> {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            last = e;
            if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
        }
    }
    throw last;
}

export async function traceTx(hash: Hex): Promise<Trace> {
    const [receipt, tx] = await withRetry(() =>
        Promise.all([client.getTransactionReceipt({hash}), client.getTransaction({hash})]),
    );
    const ok = receipt.status === "success";

    const trace: Trace = {
        hash,
        ok,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        redeemer: tx.from,
        chain: [],
        batchSize: 0,
    };

    // The header timestamp is presentation, not evidence - a failure to fetch it must not take
    // the trace down with it. Awaited (not fire-and-forget) because the object is handed to React
    // once; a late mutation would never render.
    try {
        const block = await client.getBlock({blockNumber: receipt.blockNumber});
        trace.timestamp = Number(block.timestamp);
    } catch {
        /* header row simply omits the time */
    }

    // The delegation itself comes from CALLDATA, so failed payments decode just as richly as
    // successful ones - a rejection page shows exactly what was refused.
    try {
        const {args} = decodeFunctionData({abi: managerAbi, data: tx.input});
        const [contexts, , execs] = args as [Hex[], Hex[], Hex[]];
        trace.batchSize = contexts.length;
        trace.chain = decodeContext(contexts[0]);
        trace.delegation = trace.chain[trace.chain.length - 1]; // root: whose money, whose rules
        const exec = execs[0];
        const token = `0x${exec.slice(2, 42)}` as Address;
        const callData = exec.slice(2 + 40 + 64);
        if (callData.startsWith("a9059cbb")) {
            trace.payment = {
                token,
                to: `0x${callData.slice(8 + 24, 8 + 64)}` as Address,
                amount: BigInt(`0x${callData.slice(8 + 64, 8 + 128)}`),
            };
        }
    } catch {
        /* not a redemption call */
    }

    if (ok) {
        const gates = parseEventLogs({
            abi: dojangEnforcerAbi,
            logs: receipt.logs,
            eventName: "DojangGatePassed",
        });
        if (gates.length > 0) {
            const g = gates[0].args;
            trace.delegationHash = g.delegationHash;
            trace.identity = {
                principal: g.principal,
                attesterId: g.attesterId,
                attestationUid: g.attestationUid,
                liveNow: false,
            };
        }
        const spends = parseEventLogs({
            abi: periodEnforcerAbi,
            logs: receipt.logs,
            eventName: "TransferredInPeriod",
        });
        if (spends.length > 0) {
            trace.spentInPeriod = spends[0].args.transferredInCurrentPeriod;
            trace.periodCap = spends[0].args.periodAmount;
        }
        const transfers = parseEventLogs({
            abi: transferEventAbi,
            logs: receipt.logs,
            eventName: "Transfer",
        });
        if (!trace.payment && transfers.length > 0) {
            trace.payment = {
                token: transfers[0].address,
                to: transfers[0].args.to,
                amount: transfers[0].args.value,
            };
        }
    } else {
        // Replay against the state just before the block to recover WHY it was refused.
        try {
            await client.call({
                account: tx.from,
                to: tx.to ?? undefined,
                data: tx.input,
                blockNumber: receipt.blockNumber - 1n,
            });
            trace.rejection = "재실행에서는 통과 — 블록 내 상태 변화로 거부된 케이스";
        } catch (err) {
            trace.rejection = decodeRejection(extractRevert(err));
        }
    }

    // Identity: for failures, recover principal/issuer from the signed caveat terms instead.
    if (!trace.identity && trace.delegation) {
        const idCaveat = trace.delegation.raw.find(
            (c) => c.enforcer.toLowerCase() === addresses.dojangEnforcer.toLowerCase(),
        );
        if (idCaveat) {
            const body = idCaveat.terms.slice(2);
            trace.identity = {
                principal: `0x${body.slice(64, 104)}` as Address,
                attesterId: `0x${body.slice(0, 64)}` as Hex,
                liveNow: false,
            };
        }
    }

    if (trace.identity) {
        const id = trace.identity;
        const [liveNow, attesterFromBook] = await Promise.all([
            client.readContract({
                address: addresses.dojangScroll,
                abi: dojangScrollAbi,
                functionName: "isVerified",
                args: [id.principal, id.attesterId],
            }),
            client.readContract({
                address: addresses.attesterBook,
                abi: attesterBookAbi,
                functionName: "getAttester",
                args: [id.attesterId],
            }),
        ]);
        id.liveNow = liveNow;
        id.attesterFromBook = attesterFromBook;

        if (id.attestationUid) {
            const att = await client.readContract({
                address: addresses.eas,
                abi: easAbi,
                functionName: "getAttestation",
                args: [id.attestationUid],
            });
            id.attestation = {
                uid: att.uid,
                recipient: att.recipient,
                attester: att.attester,
                issuedAt: Number(att.time),
                expiresAt: Number(att.expirationTime),
                revokedAt: Number(att.revocationTime),
            };
        }

        if (trace.delegation && trace.delegation.delegator.toLowerCase() !== id.principal.toLowerCase()) {
            const [registered, owner] = await Promise.all([
                client.readContract({
                    address: addresses.factory,
                    abi: factoryAbi,
                    functionName: "isMapaeAccount",
                    args: [trace.delegation.delegator],
                }),
                client
                    .readContract({
                        address: trace.delegation.delegator,
                        abi: accountAbi,
                        functionName: "owner",
                    })
                    .catch(() => undefined),
            ]);
            id.accountRegistered = registered;
            id.accountOwner = owner;
        }
    }

    return trace;
}
