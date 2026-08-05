import assert from "node:assert/strict";
import type {Address, Hex} from "viem";
import {
    decodeCondition,
    encodeCondition,
    encodeConditions,
    roundTrips,
    TERMS_BYTES,
    type Condition,
    type EnforcerBook,
} from "../src/policy.js";
import {TESTNET_FAUCET_ID, UPBIT_KOREA_ID} from "../src/protocol.js";

/**
 * The encoder and the decoder must be inverses.
 *
 * This is not a nicety. The Composer generates the sentence a person reads from the SAME
 * structure it generates the bytes from, and the Explorer regenerates that sentence by decoding
 * the bytes back. If the two directions disagree anywhere, a user is shown a description of a
 * permission that is not the permission they signed - which is the one failure this product
 * cannot survive, because the entire claim is that authority is legible.
 *
 * Run: pnpm fixtures (or tsx sdk/test/policy.test.ts)
 */

const BOOK: EnforcerBook = {
    dojangEnforcer: "0x1111111111111111111111111111111111111111",
    periodEnforcer: "0x2222222222222222222222222222222222222222",
    payeeEnforcer: "0x3333333333333333333333333333333333333333",
    timestampEnforcer: "0x4444444444444444444444444444444444444444",
    verifiedCodeEnforcer: "0x5555555555555555555555555555555555555555",
    perPaymentEnforcer: "0x6666666666666666666666666666666666666666",
};

const A = (n: string): Address => `0x${n.repeat(40).slice(0, 40)}`;

const CASES: Condition[] = [
    {kind: "identity", attesterId: UPBIT_KOREA_ID, principal: A("a")},
    {kind: "identity", attesterId: TESTNET_FAUCET_ID, principal: A("0")},
    {
        kind: "period",
        token: A("b"),
        amount: 50_000n,
        duration: 86_400n,
        start: 1_753_770_000n,
    },
    // Boundaries: a zero amount is refused on-chain but must still survive the codec, and a
    // 32-byte-max value proves nothing is being truncated into a smaller word.
    {kind: "period", token: A("c"), amount: 0n, duration: 1n, start: 0n},
    {
        kind: "period",
        token: A("d"),
        amount: (1n << 256n) - 1n,
        duration: (1n << 256n) - 1n,
        start: (1n << 256n) - 1n,
    },
    {kind: "payee", payees: [A("e")]},
    {kind: "payee", payees: [A("1"), A("2"), A("3")]},
    {kind: "perPayment", max: 1n},
    {kind: "perPayment", max: 10_000n},
    {kind: "perPayment", max: (1n << 256n) - 1n},
    {kind: "window", from: 0n, until: 1_760_000_000n},
    {kind: "window", from: 1n, until: 0n},
    // uint128 max on both halves: the two fields must not bleed into each other.
    {kind: "window", from: (1n << 128n) - 1n, until: (1n << 128n) - 1n},
    {kind: "humanloop", attesterId: UPBIT_KOREA_ID, domain: "api.example.com"},
    {kind: "humanloop", attesterId: TESTNET_FAUCET_ID, domain: "결제.한국"},
];

let checks = 0;
function ok(label: string, cond: boolean) {
    assert.ok(cond, label);
    checks++;
}

/* ---------------------------- inverse property ---------------------------- */

for (const c of CASES) {
    ok(`round-trip: ${c.kind} ${JSON.stringify(c, (_k, v) => (typeof v === "bigint" ? String(v) : v))}`,
        roundTrips(c, BOOK));
}

/* ------------------------------ terms lengths ----------------------------- */

for (const c of CASES) {
    const want = TERMS_BYTES[c.kind];
    if (want === undefined) continue;
    const got = (encodeCondition(c, BOOK).terms.length - 2) / 2;
    ok(`${c.kind} terms are ${want} bytes`, got === want);
}

// Payee terms are exactly 20 bytes per entry, which is what makes the enforcer's stride correct.
for (const n of [1, 2, 5]) {
    const payees = Array.from({length: n}, (_, i) => A(String(i)));
    const got = (encodeCondition({kind: "payee", payees}, BOOK).terms.length - 2) / 2;
    ok(`${n} payees encode to ${n * 20} bytes`, got === n * 20);
}

/* --------------------------- refusals, not silence ------------------------ */

// Deny-by-default: an empty allowlist is refused on-chain, so it must be refused before it can
// be signed. The terms builder happens to catch it first; either guard firing is correct, and
// what matters is that no code path produces a payee caveat that allows everyone.
assert.throws(
    () => encodeConditions([{kind: "payee", payees: []}], BOOK),
    /empty payee list|multiple of 20/,
    "an empty payee list must be refused before signing",
);
checks++;

/* ------------------------- unknown enforcers survive ---------------------- */

const stranger = decodeCondition("0x9999999999999999999999999999999999999999", "0xdeadbeef", BOOK);
ok("an unrecognised enforcer decodes to unknown rather than throwing", stranger.kind === "unknown");

// Right enforcer, wrong length: still unknown. Guessing at a truncated payload would be worse
// than admitting we cannot read it.
const truncated = decodeCondition(BOOK.dojangEnforcer, "0x1234" as Hex, BOOK);
ok("a malformed identity payload decodes to unknown", truncated.kind === "unknown");

/* -------------------------------- distinctness ---------------------------- */

// Two conditions that differ only in one field must not encode identically.
const a = encodeCondition({kind: "period", token: A("b"), amount: 1n, duration: 2n, start: 3n}, BOOK);
const b = encodeCondition({kind: "period", token: A("b"), amount: 1n, duration: 3n, start: 2n}, BOOK);
ok("field order is preserved (duration and start are not interchangeable)", a.terms !== b.terms);

console.log(`policy codec: ${checks}/${checks} checks passed (encode and decode are inverses)`);
