/**
 * Cross-language byte-parity test.
 *
 * Solidity (script/GenFixtures.s.sol) is the reference; this file proves the SDK's re-implementation
 * produces IDENTICAL bytes for every encoding the live demo depends on:
 *   - abi.encode(Delegation[])   -> the permission context redeemed on-chain
 *   - EIP-712 delegation digest  -> what the principal actually signs
 *   - packed single execution    -> what every spending enforcer indexes into
 *
 * A mismatch in any of these either fails signature validation (best case) or redeems a different
 * delegation than the one the principal signed (worst case). Run before ANY live transaction:
 *   pnpm fixtures
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {hashTypedData} from "viem";
import {
    delegationHash,
    encodeExecutionSingle,
    encodePermissionContext,
    encodeErc20Transfer,
    DELEGATION_TYPES,
    type Delegation,
} from "../src/delegation.js";
import {ROOT_AUTHORITY} from "../src/constants.js";

const fixtures = JSON.parse(readFileSync(new URL("../../test/fixtures/encoding.json", import.meta.url), "utf8"));

// The exact struct GenFixtures.s.sol builds. Do not "clean up" these values.
const delegation: Delegation = {
    delegate: "0x3333333333333333333333333333333333333333",
    delegator: "0x4444444444444444444444444444444444444444",
    authority: ROOT_AUTHORITY,
    caveats: [
        {enforcer: "0x1111111111111111111111111111111111111111", terms: "0xaabbcc", args: "0x"},
        {
            enforcer: "0x2222222222222222222222222222222222222222",
            terms: "0x00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff0011223344556677",
            args: "0xdeadbeef",
        },
    ],
    salt: 42n,
    signature: "0x1234",
};

// 1. abi.encode(Delegation[]) - nested dynamic structs, the classic drift point.
assert.equal(
    encodePermissionContext([delegation]),
    fixtures.permissionContext,
    "permission context bytes differ from Solidity",
);

// 2. The delegation struct hash (EncoderLib._getDelegationHash).
assert.equal(delegationHash(delegation), fixtures.delegationHash, "delegation hash differs from Solidity");

// 3. The full EIP-712 digest via viem's hashTypedData - proves our DELEGATION_TYPES (which omit
//    signature and args) reproduce toTypedDataHash(domainSeparator, delegationHash) exactly.
assert.equal(
    hashTypedData({
        domain: {
            name: "Mapae",
            version: "1",
            chainId: 91_342,
            verifyingContract: "0x5555555555555555555555555555555555555555",
        },
        types: DELEGATION_TYPES,
        primaryType: "Delegation",
        message: {
            delegate: delegation.delegate,
            delegator: delegation.delegator,
            authority: delegation.authority,
            caveats: delegation.caveats.map((c) => ({enforcer: c.enforcer, terms: c.terms})),
            salt: delegation.salt,
        },
    }),
    fixtures.typedDataDigest,
    "EIP-712 digest differs from Solidity",
);

// 4. Packed single execution: target(20) ‖ value(32) ‖ transfer calldata.
assert.equal(
    encodeExecutionSingle(
        "0x6666666666666666666666666666666666666666",
        123n,
        encodeErc20Transfer("0x7777777777777777777777777777777777777777", 50_000n),
    ),
    fixtures.executionSingle,
    "packed execution bytes differ from Solidity",
);

console.log("byte-parity: 4/4 encodings identical to Solidity reference");
