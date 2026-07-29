// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {CaveatEnforcer} from "./CaveatEnforcer.sol";
import {ModeCode} from "../utils/Types.sol";
import {IDojangScroll} from "../interfaces/IDojangScroll.sol";

/// @title VerifiedCodeEnforcer
/// @notice Gates redemption on a LIVE Dojang Verified Code attestation: a human confirmed an
///         off-chain verification code, and that confirmation is still valid.
/// @dev This is the human-in-the-loop tier. Dojang's Verified Code attests the hash of an
///      OFF-CHAIN verification code under a service domain - the on-chain trace of a person
///      completing an OTP-style confirmation. Attaching this caveat to a delegation therefore
///      means: the agent may spend only while a recent human confirmation stands. Autonomy is
///      graduated, not binary - small delegations run unattended, large ones require a person
///      in the loop per confirmation window, and the delegator chooses which by choosing
///      caveats. (This mirrors the historical mapae tiers: the number of horses on the plate
///      scaled with the weight of the mission.)
///
///      Division of labour between the signed and unsigned parts, and why it is sound:
///        - TERMS (signed by the delegator): the ISSUER and the DOMAIN. The delegator decides
///          whose confirmations count and for which service. Variable length: the domain is a
///          string and occupies the tail.
///        - ARGS (supplied by the redeemer): the 32-byte code hash naming which confirmation
///          satisfies the gate. Args are unsigned by design - but the redeemer cannot conjure a
///          confirmation, only point at one: the gate passes only if a LIVE attestation for that
///          hash exists under the signed issuer and domain, and liveness (expiry, revocation) is
///          read from Dojang at redemption, exactly like the identity gate. A stale pointer is a
///          revert, not a bypass.
///
///      Freshness comes from the attestation's own expiry: issuers attest confirmations with
///      short lifetimes, so "a person confirmed recently" is enforced by Dojang's clock, not by
///      trust in the agent.
///
///      Honestly stated: on GIWA Sepolia today only Upbit issues Verified Code attestations,
///      through its own off-chain flow, and there is no self-service test issuer (the faucet
///      extension issues Verified Address only). This enforcer is therefore verified against the
///      mock - whose Verified Address behaviour the fork suite proves faithful to the deployed
///      DojangScroll - and deployed ready for the first issuer integration, rather than
///      demonstrated with live issuance.
contract VerifiedCodeEnforcer is CaveatEnforcer {
    /// @notice Dojang's read surface. Immutable: the gate's truth source cannot be repointed.
    IDojangScroll public immutable DOJANG_SCROLL;

    /// @notice Audit anchor: which human confirmation authorised this redemption.
    event VerifiedCodeGatePassed(
        address indexed manager,
        bytes32 indexed delegationHash,
        bytes32 indexed codeHash,
        address redeemer,
        bytes32 attesterId,
        string domain
    );

    error InvalidTermsLength(uint256 length);
    error InvalidArgsLength(uint256 length);
    error CodeNotVerified(bytes32 codeHash, string domain, bytes32 attesterId);
    error ZeroAddressArg();

    constructor(IDojangScroll _dojangScroll) {
        if (address(_dojangScroll) == address(0)) revert ZeroAddressArg();
        DOJANG_SCROLL = _dojangScroll;
    }

    /// @inheritdoc CaveatEnforcer
    /// @dev `beforeHook`, like the identity gate: the last check before this delegation's
    ///      execution, so nothing can invalidate the confirmation between check and spend.
    function beforeHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode,
        bytes calldata,
        bytes32 _delegationHash,
        address,
        address _redeemer
    ) public override {
        (bytes32 attesterId_, string memory domain_) = getTermsInfo(_terms);

        if (_args.length != 32) revert InvalidArgsLength(_args.length);
        bytes32 codeHash_ = bytes32(_args);

        if (!DOJANG_SCROLL.isVerifiedCode(codeHash_, domain_, attesterId_)) {
            revert CodeNotVerified(codeHash_, domain_, attesterId_);
        }

        emit VerifiedCodeGatePassed(msg.sender, _delegationHash, codeHash_, _redeemer, attesterId_, domain_);
    }

    /// @notice Decodes the packed terms: attesterId(32) ‖ domain(rest, non-empty string).
    function getTermsInfo(bytes calldata _terms)
        public
        pure
        returns (bytes32 attesterId_, string memory domain_)
    {
        // 33+ bytes: a 32-byte issuer id and at least one byte of domain. An empty domain would
        // scope the gate to nothing in particular - refused, deny by default.
        if (_terms.length < 33) revert InvalidTermsLength(_terms.length);
        attesterId_ = bytes32(_terms[0:32]);
        domain_ = string(_terms[32:]);
    }
}
