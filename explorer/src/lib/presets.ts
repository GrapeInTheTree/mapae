import type {Address, Hex} from "viem";
import {addresses} from "./config";
import type {Condition} from "./policy";
import {TESTNET_FAUCET_ID} from "@mapae/protocol";

/**
 * Presets exist so that the first thing a person does is not "compose a policy from primitives".
 * They are opinions about what a sensible authority looks like for one job.
 *
 * Every preset here is built ONLY from enforcers that are deployed and source-verified on GIWA
 * Sepolia. A preset that showed a condition we have not shipped would be a demo pretending to be
 * a product - the user would sign something the chain cannot enforce. Conditions that are still
 * ahead of us are listed separately and marked as such.
 */

export type PresetId = "micro" | "burst" | "subscription" | "custom";

/**
 * One entry in the payee allowlist.
 *
 * The name is local only - it never reaches the signed terms, which carry addresses. It exists
 * because an allowlist of raw addresses is unreadable, and a person cannot meaningfully consent
 * to a list they cannot check.
 */
export interface Payee {
    address: Address | "";
    name: string;
}

export interface PresetForm {
    agentName: string;
    agent: Address | "";
    /**
     * The payee allowlist, in the order it was entered. The enforcer accepts N >= 1 packed
     * addresses and scans them linearly, so this is a list rather than a single address - a
     * benefit card or an expense policy names several merchants, not one. Always holds at least
     * one row so the form has something to render; empty rows are dropped before encoding.
     */
    payees: Payee[];
    token: Address;
    /** Token base units. mKRW has zero decimals by design, so this is won. */
    amount: bigint;
    /** Seconds. The window the limit applies to, after which it resets. */
    period: bigint;
    /** How long the authority lives, in days. */
    validDays: number;
    issuer: Hex;
    /**
     * Which optional conditions this authority carries. Identity and the spending limit are not
     * flags: identity is what makes the authority traceable to a person (the product's thesis),
     * and a delegation with no cap is a wallet, not a permission. The payee allowlist and the
     * expiry are genuinely optional, and turning one off is a decision the composer must show
     * the consequences of - not a checkbox that silently widens the grant.
     */
    usePayee: boolean;
    useWindow: boolean;
}

export interface Preset {
    id: PresetId;
    /** Which form controls this preset shows, in order. */
    fields: (keyof PresetForm)[];
    /** Only the custom preset exposes the condition toggles; the named presets ARE the opinion. */
    composable: boolean;
    defaults: Omit<PresetForm, "agentName" | "agent" | "payees">;
}

const DAY = 86_400n;

export const PRESETS: Preset[] = [
    {
        id: "micro",
        fields: ["agentName", "agent", "token", "payees", "amount", "period", "validDays"],
        composable: false,
        defaults: {
            token: addresses.mockKRW,
            amount: 5_000n,
            period: DAY,
            validDays: 30,
            issuer: TESTNET_FAUCET_ID,
            usePayee: true,
            useWindow: true,
        },
    },
    {
        id: "burst",
        fields: ["agentName", "agent", "token", "payees", "amount", "period", "validDays"],
        composable: false,
        defaults: {
            token: addresses.mockKRW,
            amount: 500_000n,
            period: DAY,
            validDays: 3,
            issuer: TESTNET_FAUCET_ID,
            usePayee: true,
            useWindow: true,
        },
    },
    {
        id: "subscription",
        fields: ["agentName", "agent", "token", "payees", "amount", "period", "validDays"],
        composable: false,
        defaults: {
            token: addresses.mockKRW,
            amount: 30_000n,
            period: DAY * 30n,
            validDays: 365,
            issuer: TESTNET_FAUCET_ID,
            usePayee: true,
            useWindow: true,
        },
    },
    {
        id: "custom",
        fields: ["agentName", "agent", "token", "payees", "amount", "period", "validDays"],
        composable: true,
        defaults: {
            token: addresses.mockKRW,
            amount: 50_000n,
            period: DAY,
            validDays: 30,
            issuer: TESTNET_FAUCET_ID,
            usePayee: true,
            useWindow: true,
        },
    },
];

export function preset(id: PresetId): Preset {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) throw new Error(`unknown preset ${id}`);
    return p;
}

/**
 * Conditions that need an enforcer we have not deployed. Shown in the Composer so the roadmap is
 * visible without being clickable - a person deciding whether to build on this should be able to
 * see what is coming, and should never be able to sign it by accident.
 */
export const COMING_NEXT = [
    {id: "perTx", en: "Per-payment ceiling", ko: "회당 한도"},
    {id: "total", en: "Lifetime total", ko: "총액 한도"},
    {id: "count", en: "Call count", ko: "호출 횟수"},
    {id: "selector", en: "Allowed function", ko: "허용 함수"},
    {id: "order", en: "Approved order", ko: "승인된 주문"},
] as const;

/**
 * The signed policy.
 *
 * Order is presentation, not semantics - every caveat is an AND and the manager evaluates all of
 * them - but identity comes first because it is the reason the rest exist. A limit protects you
 * from your agent; the identity gate is what makes the whole authority traceable to a person.
 */
export function buildConditions(form: PresetForm, principal: Address, now: number): Condition[] {
    if (!form.agent) throw new Error("agent address is required");
    const payees = form.payees.map((p) => p.address).filter(Boolean) as Address[];
    if (form.usePayee && payees.length === 0) throw new Error("at least one payee is required");

    const start = BigInt(Math.floor(now / 1000));
    const conditions: Condition[] = [
        {kind: "identity", attesterId: form.issuer, principal},
        {
            kind: "period",
            token: form.token,
            amount: form.amount,
            duration: form.period,
            start,
        },
    ];
    if (form.usePayee) conditions.push({kind: "payee", payees});
    if (form.useWindow)
        conditions.push({
            kind: "window",
            from: 0n,
            until: start + BigInt(form.validDays) * DAY,
        });
    return conditions;
}

/** Salt keeps two otherwise identical authorities apart, so re-issuing the same policy gets its
 *  own spend budget rather than inheriting the old one's. */
export function freshSalt(): bigint {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    return BigInt(`0x${[...buf].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
}
