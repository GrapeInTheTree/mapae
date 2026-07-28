// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Delegation, Caveat} from "../utils/Types.sol";
import {DELEGATION_TYPEHASH, CAVEAT_TYPEHASH} from "../utils/Constants.sol";

/// @title EncoderLib
/// @notice EIP-712 struct hashing for delegations.
/// @dev Byte-identical to MetaMask's delegation-framework `EncoderLib`. This is the single most
///      load-bearing compatibility surface in Mapae: if these hashes drift, a delegation signed for
///      one manager is unredeemable on the other, and the "portable in both directions" claim is
///      false. Pinned by literal-constant tests, never by recomputation.
///
///      Two deliberate omissions, inherited from the typehashes:
///      - `Delegation.signature` is not hashed, so it can be attached after the payload is fixed.
///      - `Caveat.args` is not hashed, so the redeemer supplies it at redemption time without
///        invalidating the delegator's signature.
library EncoderLib {
    /// @notice Hashes a Delegation for EIP-712 signing.
    function _getDelegationHash(Delegation memory _input) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                DELEGATION_TYPEHASH,
                _input.delegate,
                _input.delegator,
                _input.authority,
                _getCaveatArrayPacketHash(_input.caveats),
                _input.salt
            )
        );
    }

    /// @notice Hashes a Caveat array.
    /// @dev Note `abi.encodePacked` over the element hashes, not `abi.encode`.
    function _getCaveatArrayPacketHash(Caveat[] memory _input) internal pure returns (bytes32) {
        bytes32[] memory caveatPacketHashes_ = new bytes32[](_input.length);
        for (uint256 i = 0; i < _input.length; ++i) {
            caveatPacketHashes_[i] = _getCaveatPacketHash(_input[i]);
        }
        return keccak256(abi.encodePacked(caveatPacketHashes_));
    }

    /// @notice Hashes a single Caveat. `args` is excluded.
    function _getCaveatPacketHash(Caveat memory _input) internal pure returns (bytes32) {
        return keccak256(abi.encode(CAVEAT_TYPEHASH, _input.enforcer, keccak256(_input.terms)));
    }
}
