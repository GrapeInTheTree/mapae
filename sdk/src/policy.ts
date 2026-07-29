import type {Address, Hex} from "viem";
import {
    dojangTerms,
    payeeTerms,
    periodTerms,
    timestampTerms,
    type Caveat,
} from "./delegation.js";

/**
 * What a caveat MEANS, recovered from the bytes it was signed as.
 *
 * The terms builders in `delegation.ts` go one way; anything that has to explain a delegation
 * after the fact - an explorer, a wallet's permission screen, a facilitator writing a receipt -
 * needs to come back the other way. Both directions live here so they can be tested as inverses
 * rather than drifting apart in two codebases.
 *
 * Enforcer addresses are passed in rather than imported, so this module stays deployment-agnostic
 * and usable from a browser that has its own address book.
 */

export type Condition =
    | {kind: "identity"; attesterId: Hex; principal: Address}
    | {kind: "period"; token: Address; amount: bigint; duration: bigint; start: bigint}
    | {kind: "payee"; payees: Address[]}
    | {kind: "window"; from: bigint; until: bigint}
    | {kind: "humanloop"; attesterId: Hex; domain: string}
    | {kind: "unknown"; enforcer: Address; terms: Hex};

export type ConditionKind = Condition["kind"];

/** The enforcer each condition is enforced by, for one deployment. */
export interface EnforcerBook {
    dojangEnforcer: Address;
    periodEnforcer: Address;
    payeeEnforcer: Address;
    timestampEnforcer: Address;
    verifiedCodeEnforcer?: Address;
}

/** Terms lengths the deployed enforcers require. Encoding the wrong length produces a delegation
 *  that signs cleanly and reverts on its first use, hours later. */
export const TERMS_BYTES: Partial<Record<ConditionKind, number>> = {
    identity: 52,
    period: 116,
    window: 32,
};

const utf8ToHex = (s: string): Hex =>
    `0x${[...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

const hexToUtf8 = (h: string): string =>
    new TextDecoder().decode(Uint8Array.from((h.match(/../g) ?? []).map((b) => parseInt(b, 16))));

export function encodeCondition(c: Condition, book: EnforcerBook): Caveat {
    switch (c.kind) {
        case "identity":
            return {
                enforcer: book.dojangEnforcer,
                terms: dojangTerms(c.attesterId, c.principal),
                args: "0x",
            };
        case "period":
            return {
                enforcer: book.periodEnforcer,
                terms: periodTerms(c.token, c.amount, c.duration, c.start),
                args: "0x",
            };
        case "payee":
            return {enforcer: book.payeeEnforcer, terms: payeeTerms(c.payees), args: "0x"};
        case "window":
            return {
                enforcer: book.timestampEnforcer,
                terms: timestampTerms(c.from, c.until),
                args: "0x",
            };
        case "humanloop": {
            if (!book.verifiedCodeEnforcer) throw new Error("verifiedCodeEnforcer is not deployed");
            return {
                enforcer: book.verifiedCodeEnforcer,
                terms: `${c.attesterId}${utf8ToHex(c.domain).slice(2)}` as Hex,
                args: "0x",
            };
        }
        case "unknown":
            return {enforcer: c.enforcer, terms: c.terms, args: "0x"};
    }
}

export function encodeConditions(cs: Condition[], book: EnforcerBook): Caveat[] {
    return cs.map((c) => {
        const caveat = encodeCondition(c, book);
        const got = (caveat.terms.length - 2) / 2;
        const want = TERMS_BYTES[c.kind];
        if (want !== undefined && got !== want) {
            throw new Error(`${c.kind}: encoded ${got} bytes of terms, enforcer requires ${want}`);
        }
        if (c.kind === "payee" && (got === 0 || got % 20 !== 0)) {
            throw new Error(`payee: terms must be a non-zero multiple of 20 bytes, got ${got}`);
        }
        return caveat;
    });
}

const eq = (a: string, b?: string) => Boolean(b) && a.toLowerCase() === b!.toLowerCase();
const at = (body: string, from: number, to: number) => `0x${body.slice(from * 2, to * 2)}`;

export function decodeCondition(enforcer: Address, terms: Hex, book: EnforcerBook): Condition {
    const body = terms.slice(2);
    const n = body.length / 2;
    try {
        if (eq(enforcer, book.dojangEnforcer) && n === 52) {
            return {
                kind: "identity",
                attesterId: at(body, 0, 32) as Hex,
                principal: at(body, 32, 52) as Address,
            };
        }
        if (eq(enforcer, book.periodEnforcer) && n === 116) {
            return {
                kind: "period",
                token: at(body, 0, 20) as Address,
                amount: BigInt(at(body, 20, 52)),
                duration: BigInt(at(body, 52, 84)),
                start: BigInt(at(body, 84, 116)),
            };
        }
        if (eq(enforcer, book.payeeEnforcer) && n > 0 && n % 20 === 0) {
            const payees: Address[] = [];
            for (let i = 0; i < n; i += 20) payees.push(at(body, i, i + 20) as Address);
            return {kind: "payee", payees};
        }
        if (eq(enforcer, book.timestampEnforcer) && n === 32) {
            return {kind: "window", from: BigInt(at(body, 0, 16)), until: BigInt(at(body, 16, 32))};
        }
        if (book.verifiedCodeEnforcer && eq(enforcer, book.verifiedCodeEnforcer) && n > 32) {
            return {
                kind: "humanloop",
                attesterId: at(body, 0, 32) as Hex,
                domain: hexToUtf8(body.slice(64)),
            };
        }
    } catch {
        // An undecodable caveat is reported as unknown rather than thrown. A surface that exists
        // to explain a rejection must not itself fail because one condition was unrecognised.
    }
    return {kind: "unknown", enforcer, terms};
}

export function decodeConditions(caveats: readonly Caveat[], book: EnforcerBook): Condition[] {
    return caveats.map((c) => decodeCondition(c.enforcer, c.terms, book));
}

/** Encode then decode must return the original. Called before signing, so a malformed policy is
 *  caught while it is still a form rather than after it is a signature. */
export function roundTrips(c: Condition, book: EnforcerBook): boolean {
    const caveat = encodeCondition(c, book);
    return same(decodeCondition(caveat.enforcer, caveat.terms, book), c);
}

function same(a: Condition, b: Condition): boolean {
    return JSON.stringify(a, norm) === JSON.stringify(b, norm);
}

function norm(_k: string, v: unknown) {
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "string") return v.toLowerCase();
    return v;
}
