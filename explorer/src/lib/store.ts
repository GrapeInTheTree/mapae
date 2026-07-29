import {delegationHash, type Delegation} from "@mapae/sdk";
import type {Address, Hex} from "viem";
import {giwaSepolia, addresses} from "./config";

/**
 * Where signed Mapae live before they are used.
 *
 * A grant is off-chain by design: signing costs no gas and leaves no trace, which is what makes
 * ERC-7715's model work and what lets a principal issue an authority that is never exercised.
 * The consequence is that an indexer cannot find a delegation that has not been redeemed yet, so
 * something has to remember it.
 *
 * That something is this browser, deliberately. A server would be a second place to look for the
 * truth, and the moment it is down - or slow, or wrong - a user cannot tell whether their
 * authority exists. The contract is the only authority on whether a Mapae can be spent; this is
 * a convenience index over things the user themselves signed, and it says so in the UI. Export
 * exists because the honest version of "stored locally" includes "and you can take it with you".
 */

const KEY = "mapae.issued.v1";

export interface StoredMapae {
    /** Delegation hash - the identity of this authority everywhere else in the system. */
    hash: Hex;
    chainId: number;
    manager: Address;
    /** Exactly what was signed. Conditions are always re-derived from these caveats, never
     *  stored alongside them, so a display can never disagree with the signature. */
    delegation: Delegation;
    /** Labels the user typed. Presentation only - never part of the signed payload. */
    agentName: string;
    merchantName?: string;
    presetId?: string;
    createdAt: number;
}

/* bigint does not survive JSON. Salt is the only one, but a lost salt is a different delegation. */
function replacer(_k: string, v: unknown) {
    return typeof v === "bigint" ? {__big: v.toString()} : v;
}

function reviver(_k: string, v: unknown) {
    if (v && typeof v === "object" && "__big" in (v as Record<string, unknown>)) {
        return BigInt((v as {__big: string}).__big);
    }
    return v;
}

function readAll(): StoredMapae[] {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw, reviver) as StoredMapae[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        // Corrupt storage must not brick the page; the chain still knows everything that matters.
        return [];
    }
}

function writeAll(items: StoredMapae[]) {
    localStorage.setItem(KEY, JSON.stringify(items, replacer));
}

/** Everything this browser has issued, newest first. */
export function list(owner?: Address): StoredMapae[] {
    const all = readAll().sort((a, b) => b.createdAt - a.createdAt);
    if (!owner) return all;
    // A delegation is "mine" if my account is the one that pays.
    const o = owner.toLowerCase();
    return all.filter((m) => m.delegation.delegator.toLowerCase() === o);
}

export function get(hash: Hex): StoredMapae | undefined {
    return readAll().find((m) => m.hash.toLowerCase() === hash.toLowerCase());
}

/** Idempotent by delegation hash: re-saving the same authority updates rather than duplicates. */
export function save(entry: Omit<StoredMapae, "hash" | "chainId" | "manager" | "createdAt">): StoredMapae {
    const hash = delegationHash(entry.delegation);
    const record: StoredMapae = {
        ...entry,
        hash,
        chainId: giwaSepolia.id,
        manager: addresses.manager,
        createdAt: Date.now(),
    };
    const rest = readAll().filter((m) => m.hash.toLowerCase() !== hash.toLowerCase());
    writeAll([record, ...rest]);
    return record;
}

export function remove(hash: Hex) {
    writeAll(readAll().filter((m) => m.hash.toLowerCase() !== hash.toLowerCase()));
}

/** The whole index, as a file. "Stored in your browser" is only honest with a way out. */
export function exportAll(): string {
    return JSON.stringify(readAll(), replacer, 2);
}

export function download(filename: string, contents: string) {
    const url = URL.createObjectURL(new Blob([contents], {type: "application/json"}));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
