// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IDojangScroll, IDojangVerifierErrors} from "../interfaces/IDojangScroll.sol";

/// @title MockDojangScroll
/// @notice Test double mirroring the DEPLOYED DojangScroll's observed behaviour, not an idealised
///         one.
/// @dev Faithfulness matters here because the enforcer's correctness argument leans on two
///      behaviours proven against the live contract in the fork suite:
///        - `isVerified` collapses absent / expired / revoked to `false`, never reverting;
///        - the uid getter keeps the uid indexed after revocation and reverts
///          `RevokedAttestation(uid, time)` - revocation does NOT de-index.
///      Unit tests exercise the enforcer against this mock; the fork suite proves the mock's
///      behaviour matches reality.
contract MockDojangScroll is IDojangScroll, IDojangVerifierErrors {
    struct Record {
        bytes32 uid;
        uint64 expirationTime; // 0 = never expires
        uint64 revocationTime; // 0 = not revoked
    }

    mapping(address subject => mapping(bytes32 attesterId => Record)) internal records;

    /* ------------------------------- test knobs ------------------------------- */

    function issue(address subject, bytes32 attesterId, bytes32 uid, uint64 expirationTime) external {
        records[subject][attesterId] = Record({uid: uid, expirationTime: expirationTime, revocationTime: 0});
    }

    function revoke(address subject, bytes32 attesterId) external {
        // Mirrors live Dojang: the record survives, only revocationTime is set.
        records[subject][attesterId].revocationTime = uint64(block.timestamp);
    }

    /* ------------------------------ IDojangScroll ------------------------------ */

    function isVerified(address subject, bytes32 attesterId) external view returns (bool) {
        Record memory r = records[subject][attesterId];
        if (r.uid == 0) return false;
        if (r.expirationTime != 0 && r.expirationTime <= uint64(block.timestamp)) return false;
        if (r.revocationTime != 0) return false;
        return true;
    }

    function getVerifiedAddressAttestationUid(address subject, bytes32 attesterId)
        external
        view
        returns (bytes32)
    {
        Record memory r = records[subject][attesterId];
        if (r.uid == 0) revert ZeroUid();
        if (r.expirationTime != 0 && r.expirationTime <= uint64(block.timestamp)) {
            revert ExpiredAttestation(r.uid, r.expirationTime);
        }
        if (r.revocationTime != 0) revert RevokedAttestation(r.uid, r.revocationTime);
        return r.uid;
    }

    function isVerifiedCode(bytes32, string calldata, bytes32) external pure returns (bool) {
        return false;
    }
}
