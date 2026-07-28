// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/* -------------------------------------------------------------------------- */
/*                          ERC-7579 execution mode types                      */
/* -------------------------------------------------------------------------- */

/// @dev Packed execution mode. Layout, from the most significant byte:
///      callType(1) | execType(1) | unused(4) | modeSelector(4) | modePayload(22)
///      A plain single call with default (revert-on-failure) semantics is bytes32(0).
type ModeCode is bytes32;

type CallType is bytes1;

type ExecType is bytes1;

type ModeSelector is bytes4;

type ModePayload is bytes22;

/* -------------------------------------------------------------------------- */
/*                              Delegation types                               */
/* -------------------------------------------------------------------------- */

/// @title Delegation
/// @notice A grant of scoped authority from `delegator` to `delegate`.
/// @dev Field order and semantics are byte-identical to MetaMask's delegation-framework, so a
///      Mapae delegation is redeemable by their DelegationManager and theirs by ours.
///      `signature` is excluded from the delegation hash, which is what allows it to be attached
///      after the payload is fixed.
/// @param delegate The party authorised to redeem. `ANY_DELEGATE` makes the delegation bearer.
/// @param delegator The party whose account executes. For Mapae this is a MapaeAccount, and its
///        owner is the identity the Dojang gate is evaluated against.
/// @param authority Hash of the parent delegation, or `ROOT_AUTHORITY` for a root delegation.
/// @param caveats Conditions, evaluated as a conjunction - every one must pass.
/// @param salt Disambiguates otherwise identical delegations.
/// @param signature EIP-712 signature by `delegator` (ECDSA for an EOA, ERC-1271 for a contract).
struct Delegation {
    address delegate;
    address delegator;
    bytes32 authority;
    Caveat[] caveats;
    uint256 salt;
    bytes signature;
}

/// @title Caveat
/// @notice One condition attached to a delegation, enforced by an external contract.
/// @dev `args` is excluded from the caveat hash, so the redeemer may supply it at redemption time
///      without invalidating the delegator's signature.
/// @param enforcer The `ICaveatEnforcer` that evaluates this condition.
/// @param terms Signed by the delegator. Tightly packed, layout defined by the enforcer.
/// @param args Supplied by the redeemer. Unsigned.
struct Caveat {
    address enforcer;
    bytes terms;
    bytes args;
}
