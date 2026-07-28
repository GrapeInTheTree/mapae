// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title IDojangScroll
/// @notice Read interface for GIWA's Dojang attestation service.
/// @dev Dojang is built on EAS (the OP Stack predeploy at 0x42..21); DojangScroll is its
///      convenience reader. Dojang declares `DojangAttesterId` as a user-defined value type over
///      `bytes32`; UDVTs are ABI-transparent, so `bytes32` here yields byte-identical selectors.
///      Verified live against 0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9 on GIWA Sepolia.
///
///      Liveness is evaluated on every read. `AttestationVerifier._isVerified` returns false when
///      `expirationTime` has passed or `revocationTime != 0`, and Dojang's own
///      `AddressIndexingResolver.onRevoke` deliberately does NOT de-index, documenting that
///      attestations must be verified at the point of use. Mapae's enforcers rely on exactly that:
///      the identity gate is evaluated at redemption, never cached at issuance.
interface IDojangScroll {
    /// @notice Declared by Dojang's interface for the `get*Uid` family.
    /// @dev Selector 0xab9797df. NOTE: the deployed implementation does not actually throw this -
    ///      the reverts that surface come from `AttestationVerifier` (see {IDojangVerifierErrors}).
    ///      Declared here for interface fidelity only; do not match on it.
    error NotVerifiedAddress(address addr);

    /// @notice Whether `addr` holds a live, unrevoked, unexpired Verified Address attestation
    ///         issued by the attester registered under `attesterId`.
    /// @dev Never reverts for a missing/expired/revoked attestation - returns false. This is the
    ///      only form safe to gate on.
    function isVerified(address addr, bytes32 attesterId) external view returns (bool);

    /// @notice The EAS uid of `addr`'s Verified Address attestation from `attesterId`.
    /// @dev REVERTS when the attestation is missing, expired, or revoked. Always call
    ///      {isVerified} first.
    function getVerifiedAddressAttestationUid(address addr, bytes32 attesterId)
        external
        view
        returns (bytes32);

    /// @notice Whether a live Verified Code attestation exists for `codeHash` under `domain`.
    /// @dev Reserved for the roadmap `VerifiedCodeEnforcer` ("only an audited agent build may spend").
    function isVerifiedCode(bytes32 codeHash, string calldata domain, bytes32 attesterId)
        external
        view
        returns (bool);
}

/// @title IDojangVerifierErrors
/// @notice The errors Dojang's `AttestationVerifier` library actually raises on the reverting read
///         paths, mirrored here so consumers can decode them.
/// @dev Source: giwa-io/dojang `src/libraries/AttestationVerifier.sol`. Selectors confirmed live.
///      The three cases are distinguishable, which is precisely why Mapae gates on the
///      non-reverting {IDojangScroll.isVerified}: a payer should receive one actionable Mapae
///      error, not three different Dojang internals.
interface IDojangVerifierErrors {
    /// @notice No attestation is indexed for the subject. Selector 0x6e7910da.
    error ZeroUid();
    /// @notice The attestation exists but its expiry has passed.
    error ExpiredAttestation(bytes32 attestationUid, uint256 expirationTime);
    /// @notice The attestation exists but was revoked.
    error RevokedAttestation(bytes32 attestationUid, uint256 revocationTime);
    /// @notice The attestation's recipient is not the queried subject.
    error MisMatchRecipient(address actual, address expect);
    /// @notice The attestation's schema is not the expected one.
    error MisMatchSchema(bytes32 actual, bytes32 expect);
}

/// @title IDojangAttesterBook
/// @notice Resolves a Dojang attester id to the address that issues under it.
interface IDojangAttesterBook {
    function getAttester(bytes32 attesterId) external view returns (address);
}

/// @title IGiwaFaucetExtension
/// @notice GIWA Sepolia's permissionless self-service Dojang attester.
/// @dev Any address can obtain, and later revoke, its own testnet Verified Address attestation.
///      This is what makes Mapae's revocation demo a sequence of real transactions rather than a
///      simulation. Testnet only - there is no mainnet, and no self-service issuer would exist on
///      one.
interface IGiwaFaucetExtension {
    /// @notice Issues a Verified Address attestation to `msg.sender`. Requires `msg.value >= fee()`.
    function payAndIssueEAS() external payable returns (bytes32 uid);

    /// @notice Revokes the caller's own attestation.
    function revokeEAS() external;

    /// @notice Issuance fee in wei. Owner-mutable - always read at runtime, never hardcode.
    function fee() external view returns (uint256);

    /// @notice The Dojang attester id this extension issues under.
    function attesterId() external view returns (bytes32);
}
