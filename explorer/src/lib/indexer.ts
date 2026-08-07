import type {Address, Hex} from "viem";

/**
 * The indexer, used as an accelerator - never as a dependency.
 *
 * Every fact this returns is also derivable in the browser from the chain, which is the whole
 * reason the explorer needs no backend. So the index is asked first because it is faster, and
 * anything it cannot answer within a heartbeat falls through to the path that was always there.
 * Turning the index off - or losing the machine it runs on - costs speed and nothing else.
 *
 * A dead host is the easy case: the connection is refused at once. The dangerous one is a host
 * that accepts and then holds, so every call carries its own deadline, and a failure is
 * remembered briefly - long enough that a browsing session does not pay the timeout on every
 * navigation, short enough that recovery needs no reload.
 */

const BASE = (import.meta.env.VITE_INDEXER_URL ?? "").replace(/\/$/, "");
const DEADLINE_MS = 2_000;
const SULK_MS = 30_000;

let unreachableUntil = 0;

export const indexerConfigured = () => BASE.length > 0;

/** True when the index is configured and not currently sulking after a failure. */
export const indexerLikely = () => indexerConfigured() && Date.now() >= unreachableUntil;

async function ask<T>(path: string): Promise<T | null> {
    if (!indexerLikely()) return null;
    try {
        const res = await fetch(`${BASE}${path}`, {signal: AbortSignal.timeout(DEADLINE_MS)});
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as T;
    } catch {
        unreachableUntil = Date.now() + SULK_MS;
        return null;
    }
}

/* ------------------------------- shapes ------------------------------- */

export interface IndexedStats {
    delegations: number;
    redemptions: number;
    principals: number;
    accounts: number;
    attempts: number;
    rejections: number;
    /** Share of attempts the index owns outright; the rest is bridged while it backfills. */
    selfIndexed: number;
    historyComplete: boolean;
    /** False while the index is still backfilling. Attempts and rejections are exact either
     *  way - the bridge covers them - but the other counts are a fraction until this is true. */
    ready: boolean;
}

export interface IndexedAttempt {
    txHash: Hex;
    blockNumber: string;
    timestamp: string;
    from: Address;
    ok: boolean;
    batch: number;
    rootHash: Hex | null;
    leafHash: Hex | null;
    rootDelegator: Address | null;
    redeemer: Address | null;
    token: Address | null;
    payee: Address | null;
    amount: string | null;
}

/** Aggregates for the home page. Null means: compute them the way we always did. */
export const indexedStats = () => ask<IndexedStats>("/api/stats");

/** Every redemption attempt, refusals included, newest first. */
export const indexedActivity = (limit = 100) =>
    ask<{items: IndexedAttempt[]; historyComplete: boolean}>(`/api/activity?limit=${limit}`);

/** Whether a hash names a Mapae the chain has seen.
 *
 *  Three answers, and the third one matters: true, false, and null for "the index could not say".
 *  A caller that flattened null to false would tell a person their Mapae does not exist because a
 *  machine of ours was briefly unreachable. The index only ever sees a Mapae from its first use -
 *  issuing one is a signature and leaves no trace - so false here means the same thing the
 *  delegation page means by it. */
export async function indexedDelegationExists(hash: Hex): Promise<boolean | null> {
    if (!indexerLikely()) return null;
    try {
        const res = await fetch(`${BASE}/api/delegation/${hash}`, {
            signal: AbortSignal.timeout(DEADLINE_MS),
        });
        if (res.status === 404) return false;
        if (!res.ok) throw new Error(String(res.status));
        return true;
    } catch {
        unreachableUntil = Date.now() + SULK_MS;
        return null;
    }
}
