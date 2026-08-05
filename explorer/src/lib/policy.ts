import type {Address, Hex} from "viem";
import type {Caveat, Delegation} from "@mapae/sdk";
import {
    decodeCondition as decodeConditionRaw,
    decodeConditions as decodeConditionsRaw,
    encodeCondition as encodeConditionRaw,
    encodeConditions as encodeConditionsRaw,
    roundTrips as roundTripsRaw,
    type Condition,
    type ConditionKind,
    type EnforcerBook,
} from "@mapae/policy";
import {addresses, ISSUERS, TOKENS} from "./config";

/**
 * What a Mapae MEANS, in the reader's language.
 *
 * The codec itself lives in the SDK, where it is tested as a pair of inverses
 * (sdk/test/policy.test.ts) and where a facilitator or a third party can reach it. This module
 * binds that codec to this deployment's addresses and adds the one thing a browser needs and a
 * library should not have: sentences.
 *
 * The sentence is generated from the same structure the bytes are, so what a person reads before
 * signing cannot drift from the terms they sign. That is the property the SDK test defends.
 */

export type {Caveat, Delegation, Condition, ConditionKind};

/** This deployment's enforcers, read from deployments/91342.json. */
const BOOK: EnforcerBook = {
    dojangEnforcer: addresses.dojangEnforcer,
    periodEnforcer: addresses.periodEnforcer,
    payeeEnforcer: addresses.payeeEnforcer,
    timestampEnforcer: addresses.timestampEnforcer,
    perPaymentEnforcer: addresses.perPaymentEnforcer,
    verifiedCodeEnforcer: addresses.verifiedCodeEnforcer,
};

export const encodeCondition = (c: Condition): Caveat => encodeConditionRaw(c, BOOK);
export const encodeConditions = (cs: Condition[]): Caveat[] => encodeConditionsRaw(cs, BOOK);
export const decodeCondition = (enforcer: Address, terms: Hex): Condition =>
    decodeConditionRaw(enforcer, terms, BOOK);
export const decodeConditions = (caveats: readonly Caveat[]): Condition[] =>
    decodeConditionsRaw(caveats, BOOK);
export const roundTrips = (c: Condition): boolean => roundTripsRaw(c, BOOK);

/* ----------------------------- presentation -------------------------------- */

export type Lang = "en" | "ko";

export function issuerName(attesterId: Hex, lang: Lang): string {
    const known = ISSUERS[attesterId.toLowerCase()] ?? ISSUERS[attesterId];
    if (!known) return `${attesterId.slice(0, 10)}…`;
    return lang === "ko" ? known.nameKo : known.name;
}

/** Whether the issuer is a real-world KYC attester or the self-service testnet faucet. Shown so
 *  a demo attestation is never mistaken for an exchange's. */
export function issuerIsReal(attesterId: Hex): boolean {
    return (ISSUERS[attesterId.toLowerCase()] ?? ISSUERS[attesterId])?.real ?? false;
}

/**
 * Amounts, with the ticker where it matters.
 *
 * mKRW is declared with `decimals() == 0`, so an on-chain balance of 20000 is literally twenty
 * thousand - no scaling, and any explorer reads it correctly. That makes "₩20,000" an honest
 * rendering of the number.
 *
 * It is not an honest rendering of the ASSET, though: mKRW is a mock, and Mapae is deliberately
 * asset-agnostic. A bare ₩ next to a large figure reads as Korean won, which would be claiming
 * something we have not built. So anywhere the amount is the headline, the ticker comes with it;
 * dense tables keep the short form, where the column header already says what the asset is.
 */
export function fmtToken(token: Address, raw: bigint, withTicker = false): string {
    const t = TOKENS[token.toLowerCase()];
    if (t?.won) {
        const won = `₩${raw.toLocaleString("ko-KR")}`;
        return withTicker ? `${won} ${t.symbol}` : won;
    }
    if (t) return `${raw.toLocaleString()} ${t.symbol}`;
    return `${raw.toString()} (${token.slice(0, 8)}…)`;
}

export function tokenSymbol(token: Address): string {
    return TOKENS[token.toLowerCase()]?.symbol ?? "";
}

export function fmtDuration(seconds: bigint, lang: Lang): string {
    const s = Number(seconds);
    if (s === 86_400) return lang === "ko" ? "하루" : "day";
    if (s === 604_800) return lang === "ko" ? "한 주" : "week";
    if (s % 86_400 === 0) {
        const d = s / 86_400;
        return lang === "ko" ? `${d}일` : `${d} days`;
    }
    if (s % 3_600 === 0) {
        const h = s / 3_600;
        return lang === "ko" ? `${h}시간` : `${h} hours`;
    }
    return lang === "ko" ? `${s}초` : `${s}s`;
}

export function fmtDate(unix: bigint, lang: Lang): string {
    if (unix === 0n) return lang === "ko" ? "제한 없음" : "no limit";
    return new Date(Number(unix) * 1000).toLocaleString(lang === "ko" ? "ko-KR" : "en-GB", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export interface Rendered {
    kind: ConditionKind;
    title: string;
    /** The binding statement first, then any clarifying note. */
    lines: string[];
}

type Translate = (
    section: "policy" | "common",
    key: string,
    vars?: Record<string, string | number>,
) => string;

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`;

export function renderCondition(
    c: Condition,
    t: Translate,
    lang: Lang,
    names?: Record<string, string>,
): Rendered {
    const label = (a: Address) => names?.[a.toLowerCase()] ?? short(a);
    switch (c.kind) {
        case "identity":
            return {
                kind: c.kind,
                title: t("policy", "identity"),
                lines: [
                    t("policy", "identityLine", {issuer: issuerName(c.attesterId, lang)}),
                    t("policy", "identityLine2"),
                ],
            };
        case "period":
            return {
                kind: c.kind,
                title: t("policy", "period"),
                lines: [
                    t("policy", "periodLine", {
                        amount: fmtToken(c.token, c.amount),
                        period: fmtDuration(c.duration, lang),
                    }),
                    t("policy", "periodLine2"),
                ],
            };
        case "payee":
            return {
                kind: c.kind,
                title: t("policy", "payee"),
                lines: [
                    t("policy", "payeeLine", {payee: c.payees.map(label).join(", ")}),
                    t("policy", "payeeLine2"),
                ],
            };
        case "perPayment":
            return {
                kind: c.kind,
                title: t("policy", "perPayment"),
                lines: [
                    // The terms carry only the number - the token is whichever the payment
                    // moves, in practice the period condition's. Formatted as the deployment's
                    // payment token, which is what every issued policy uses.
                    t("policy", "perPaymentLine", {max: fmtToken(addresses.mockKRW, c.max)}),
                    t("policy", "perPaymentLine2"),
                ],
            };
        case "window": {
            const lines: string[] = [];
            if (c.from > 0n) lines.push(t("policy", "windowLineFrom", {from: fmtDate(c.from, lang)}));
            if (c.until > 0n)
                lines.push(t("policy", "windowLineUntil", {until: fmtDate(c.until, lang)}));
            if (lines.length === 0) lines.push(t("common", "never"));
            return {kind: c.kind, title: t("policy", "window"), lines};
        }
        case "humanloop":
            return {
                kind: c.kind,
                title: t("policy", "humanloop"),
                lines: [
                    t("policy", "humanloopLine", {
                        issuer: issuerName(c.attesterId, lang),
                        domain: c.domain,
                    }),
                ],
            };
        case "unknown":
            return {
                kind: c.kind,
                title: t("policy", "unknown"),
                lines: [`${short(c.enforcer)} · ${c.terms.slice(0, 26)}…`],
            };
    }
}
