import {
    concatHex,
    encodeAbiParameters,
    encodeFunctionData,
    encodePacked,
    hashTypedData,
    keccak256,
    pad,
    toHex,
    type Address,
    type Hex,
} from "viem";
import {ROOT_AUTHORITY} from "./constants.js";

/** Mirror of `src/utils/Types.sol` - field order is load-bearing for ABI encoding. */
export interface Caveat {
    enforcer: Address;
    terms: Hex;
    args: Hex;
}

export interface Delegation {
    delegate: Address;
    delegator: Address;
    authority: Hex;
    caveats: Caveat[];
    salt: bigint;
    signature: Hex;
}

/* -------------------------------------------------------------------------- */
/*                                EIP-712 typing                               */
/* -------------------------------------------------------------------------- */

/** EIP-712 types for signing. `signature` and `Caveat.args` are deliberately absent - the
 *  typehashes omit them so a signature can be attached after the payload is fixed, and args can
 *  be supplied by the redeemer. This mirrors DELEGATION_TYPEHASH / CAVEAT_TYPEHASH exactly;
 *  sdk/test/encoding.test.ts proves the resulting digest byte-identical to Solidity's. */
export const DELEGATION_TYPES = {
    Delegation: [
        {name: "delegate", type: "address"},
        {name: "delegator", type: "address"},
        {name: "authority", type: "bytes32"},
        {name: "caveats", type: "Caveat[]"},
        {name: "salt", type: "uint256"},
    ],
    Caveat: [
        {name: "enforcer", type: "address"},
        {name: "terms", type: "bytes"},
    ],
} as const;

export function delegationDomain(chainId: number, manager: Address) {
    return {name: "Mapae", version: "1", chainId, verifyingContract: manager} as const;
}

/** The digest the delegator signs. For a MapaeAccount delegator the OWNER signs this digest and
 *  the manager validates through the account's ERC-1271. */
export function delegationDigest(chainId: number, manager: Address, d: Delegation): Hex {
    return hashTypedData({
        domain: delegationDomain(chainId, manager),
        types: DELEGATION_TYPES,
        primaryType: "Delegation",
        message: {
            delegate: d.delegate,
            delegator: d.delegator,
            authority: d.authority,
            caveats: d.caveats.map((c) => ({enforcer: c.enforcer, terms: c.terms})),
            salt: d.salt,
        },
    });
}

/* -------------------------------------------------------------------------- */
/*                              Context encoding                               */
/* -------------------------------------------------------------------------- */

const DELEGATION_ABI_COMPONENTS = [
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

/** `abi.encode(Delegation[])` - the permission context redeemed on-chain, leaf first, root last.
 *  Byte-parity with Solidity is proven by the fixture test, not assumed. */
export function encodePermissionContext(chain: Delegation[]): Hex {
    return encodeAbiParameters(DELEGATION_ABI_COMPONENTS, [chain]);
}

/** ERC-7579 single execution: target(20) ‖ value(32) ‖ callData, tightly packed. */
export function encodeExecutionSingle(target: Address, value: bigint, callData: Hex): Hex {
    return encodePacked(["address", "uint256", "bytes"], [target, value, callData]);
}

export function encodeErc20Transfer(to: Address, amount: bigint): Hex {
    return encodeFunctionData({
        abi: [
            {
                type: "function",
                name: "transfer",
                inputs: [
                    {name: "to", type: "address"},
                    {name: "amount", type: "uint256"},
                ],
                outputs: [{type: "bool"}],
                stateMutability: "nonpayable",
            },
        ],
        functionName: "transfer",
        args: [to, amount],
    });
}

/* -------------------------------------------------------------------------- */
/*                                Terms builders                               */
/* -------------------------------------------------------------------------- */

/** DojangVerifiedEnforcer: attesterId(32) ‖ principal(20). The issuer is signed by the
 *  delegator - choosing it is a per-delegation decision, not a deployment constant. */
export function dojangTerms(attesterId: Hex, principal: Address): Hex {
    return encodePacked(["bytes32", "address"], [attesterId, principal]);
}

/** ERC20PeriodTransferEnforcer: token(20) ‖ periodAmount(32) ‖ periodDuration(32) ‖ startDate(32). */
export function periodTerms(token: Address, periodAmount: bigint, periodDuration: bigint, startDate: bigint): Hex {
    return encodePacked(
        ["address", "uint256", "uint256", "uint256"],
        [token, periodAmount, periodDuration, startDate],
    );
}

/** AllowedPayeeEnforcer: N x 20-byte addresses, N >= 1 (empty terms revert - deny by default). */
export function payeeTerms(payees: Address[]): Hex {
    if (payees.length === 0) throw new Error("payeeTerms: empty payee list is refused on-chain");
    return concatHex(payees);
}

/** TimestampEnforcer: uint128 afterThreshold ‖ uint128 beforeThreshold (0 = unset). */
export function timestampTerms(afterThreshold: bigint, beforeThreshold: bigint): Hex {
    return concatHex([
        pad(toHex(afterThreshold), {size: 16}),
        pad(toHex(beforeThreshold), {size: 16}),
    ]);
}

/* -------------------------------------------------------------------------- */
/*                             Convenience builders                            */
/* -------------------------------------------------------------------------- */

export function rootDelegation(
    params: Omit<Delegation, "authority" | "signature"> & {signature?: Hex},
): Delegation {
    return {...params, authority: ROOT_AUTHORITY, signature: params.signature ?? "0x"};
}

/** Reference TS implementation of EncoderLib._getDelegationHash, used by trace tooling. */
export function delegationHash(d: Delegation): Hex {
    const CAVEAT_TYPEHASH = keccak256(toHex("Caveat(address enforcer,bytes terms)"));
    const DELEGATION_TYPEHASH = keccak256(
        toHex(
            "Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)",
        ),
    );
    const caveatHashes = d.caveats.map((c) =>
        keccak256(
            encodeAbiParameters(
                [{type: "bytes32"}, {type: "address"}, {type: "bytes32"}],
                [CAVEAT_TYPEHASH, c.enforcer, keccak256(c.terms)],
            ),
        ),
    );
    const caveatArrayHash = keccak256(concatHex(caveatHashes));
    return keccak256(
        encodeAbiParameters(
            [
                {type: "bytes32"},
                {type: "address"},
                {type: "address"},
                {type: "bytes32"},
                {type: "bytes32"},
                {type: "uint256"},
            ],
            [DELEGATION_TYPEHASH, d.delegate, d.delegator, d.authority, caveatArrayHash, d.salt],
        ),
    );
}
