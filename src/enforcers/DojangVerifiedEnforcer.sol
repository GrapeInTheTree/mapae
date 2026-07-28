// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {CaveatEnforcer} from "./CaveatEnforcer.sol";
import {ModeCode} from "../utils/Types.sol";
import {IDojangScroll} from "../interfaces/IDojangScroll.sol";
import {IMapaeAccount} from "../interfaces/IDeleGatorCore.sol";

/// @dev The one factory view this enforcer needs; kept minimal so the enforcer compiles against
///      the interface rather than the implementation.
interface IMapaeAccountRegistry {
    function isMapaeAccount(address account) external view returns (bool);
}

/// @title DojangVerifiedEnforcer
/// @notice Gates a delegation on the delegator's principal holding a LIVE Dojang Verified Address
///         attestation from a named issuer, evaluated at redemption time.
/// @dev This is Mapae's contribution. Caveat enforcers exist for amounts, periods, streams,
///      targets, methods, calldata, timestamps and call counts - and none, in any deployed
///      framework, for identity. This one closes that gap on the only chain where the identity in
///      question is issued by a licensed exchange.
///
///      Design decisions, each load-bearing:
///
///      1. GATES THE DELEGATOR'S PRINCIPAL, NOT THE REDEEMER. The question a payer, an auditor or
///         an insurer asks is "which verified human authorised this spend", not "is the agent
///         verified". (A redeemer-gating sibling for attested agent code is roadmap.)
///
///      2. THE ISSUER IS PART OF THE SIGNED TERMS. Which attester counts - Upbit Korea, the
///         testnet faucet, a future bank issuer - is a decision the delegator signs, per
///         delegation, not a deployment constant of this contract. A delegation scoped to Upbit
///         cannot be satisfied by a self-issued attestation; the fork suite proves the live
///         DojangScroll discriminates exactly this way.
///
///      3. LIVENESS IS READ AT USE, NEVER CACHED AT ISSUANCE. `isVerified` re-reads expiry and
///         revocation on every call - Dojang's own resolver documents that the indexer "is not the
///         source of truth for an attestation's liveness". Consequence, proven on the live chain:
///         revoking the attestation makes every future redemption fail immediately, with no
///         transaction on Mapae's side. Identity revocation is a kill switch the delegation
///         manager does not even see.
///
///      4. GATES ON THE BOOLEAN READ, NOT THE REVERTING ONE. Dojang's uid getter reverts with
///         three different internal errors (absent / expired / revoked); `isVerified` collapses
///         all three to false. Gating on the boolean means a payer always receives this contract's
///         one actionable error, never a Dojang internal - and the uid getter is only called
///         afterwards, when it is guaranteed not to revert, to put the attestation uid in the
///         event for traceback.
///
///      5. STATELESS. A pure gate holds no per-delegation state, so there is no accounting to
///         poison by calling the hook directly: an attacker invoking `beforeHook` outside a
///         redemption can burn their own gas emitting an event attributed to themselves as
///         `msg.sender`, and nothing else.
///
///      6. NO EXECUTION-SHAPE RESTRICTION. The gate never parses `_executionCalldata`, so it is
///         meaningful for any call type - unlike spending enforcers, which must restrict to the
///         single-call shape they know how to decode.
///
///      Terms are 52 tightly packed bytes - attesterId(32) ‖ principal(20) - following the
///      MetaMask convention of packed terms with fixed offsets.
///
///      The principal-to-delegator binding accepts exactly two shapes:
///        - principal == delegator: the principal signs and spends from its own address (the
///          EOA / EIP-7702 path);
///        - delegator is a factory-registered MapaeAccount whose immutable `owner()` is the
///          principal. The registry check is what defeats ownership forgery: without it, anyone
///          could point a contract's `owner()` at a stranger's verified address and every payment
///          would trace back to an innocent person. Only accounts whose owner signed an EIP-712
///          consent at creation are registered.
contract DojangVerifiedEnforcer is CaveatEnforcer {
    /// @notice Dojang's read surface. Immutable: the gate's truth source cannot be repointed.
    IDojangScroll public immutable DOJANG_SCROLL;

    /// @notice The account factory whose registry proves an account's `owner()` consented.
    IMapaeAccountRegistry public immutable ACCOUNT_FACTORY;

    /// @notice The traceback anchor: from a redemption's logs, resolve delegation -> principal ->
    ///         attestation uid -> (via EAS) issuer, timestamps and revocation status.
    event DojangGatePassed(
        address indexed manager,
        bytes32 indexed delegationHash,
        address indexed principal,
        address delegator,
        bytes32 attesterId,
        bytes32 attestationUid
    );

    error InvalidTermsLength(uint256 length);
    error UnknownAccount(address delegator);
    error PrincipalMismatch(address delegator, address expectedPrincipal, address actualOwner);
    error NotDojangVerified(address principal, bytes32 attesterId);
    error ZeroAddressArg();

    constructor(IDojangScroll _dojangScroll, IMapaeAccountRegistry _accountFactory) {
        if (address(_dojangScroll) == address(0) || address(_accountFactory) == address(0)) {
            revert ZeroAddressArg();
        }
        DOJANG_SCROLL = _dojangScroll;
        ACCOUNT_FACTORY = _accountFactory;
    }

    /// @inheritdoc CaveatEnforcer
    /// @dev `beforeHook` rather than `beforeAllHook`: it is the last gate to run before this
    ///      delegation's execution, so in a multi-item batch an earlier item cannot invalidate the
    ///      identity between check and spend.
    function beforeHook(
        bytes calldata _terms,
        bytes calldata,
        ModeCode,
        bytes calldata,
        bytes32 _delegationHash,
        address _delegator,
        address
    ) public override {
        (bytes32 attesterId_, address principal_) = getTermsInfo(_terms);

        if (principal_ != _delegator) {
            // Smart-account path: trust `owner()` only after the factory registry confirms this
            // account's owner proved consent at creation. Order matters - the registry check must
            // come first, because `owner()` on an unregistered contract is attacker-controlled.
            if (!ACCOUNT_FACTORY.isMapaeAccount(_delegator)) revert UnknownAccount(_delegator);
            address actualOwner_ = IMapaeAccount(_delegator).owner();
            if (actualOwner_ != principal_) {
                revert PrincipalMismatch(_delegator, principal_, actualOwner_);
            }
        }

        if (!DOJANG_SCROLL.isVerified(principal_, attesterId_)) {
            revert NotDojangVerified(principal_, attesterId_);
        }

        emit DojangGatePassed(
            msg.sender,
            _delegationHash,
            principal_,
            _delegator,
            attesterId_,
            // Safe only because isVerified passed above; on an unverified subject this call
            // reverts with Dojang's internals (see decision 4).
            DOJANG_SCROLL.getVerifiedAddressAttestationUid(principal_, attesterId_)
        );
    }

    /// @notice Decodes the 52-byte packed terms.
    /// @param _terms attesterId(32) ‖ principal(20), tightly packed.
    function getTermsInfo(bytes calldata _terms)
        public
        pure
        returns (bytes32 attesterId_, address principal_)
    {
        if (_terms.length != 52) {
            revert InvalidTermsLength(_terms.length);
        }
        attesterId_ = bytes32(_terms[0:32]);
        principal_ = address(bytes20(_terms[32:52]));
    }
}
