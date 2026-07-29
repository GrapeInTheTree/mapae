// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {CaveatEnforcer} from "./CaveatEnforcer.sol";
import {ModeCode} from "../utils/Types.sol";
import {ExecutionLib} from "../libraries/ExecutionLib.sol";

/// @title AllowedPayeeEnforcer
/// @notice Restricts an ERC-20 `transfer` execution to a signed allowlist of RECIPIENTS.
/// @dev The gap this closes: existing target-allowlist enforcers gate the execution TARGET, which
///      for an ERC-20 payment is the token contract, not the payee. The payee lives inside the
///      calldata, at bytes [4:36] of the `transfer(address,uint256)` payload, and no deployed
///      enforcer reads it. A delegation caveated with "allowed target = mKRW" still lets the agent
///      pay anyone; this enforcer is what makes "may pay only these merchants" expressible.
///
///      Security posture:
///        - DENY BY DEFAULT. Terms must contain at least one payee; empty terms revert rather
///          than meaning "allow all". An accidental allow-all hiding inside zero-length terms is
///          exactly the kind of silent failure a scoping primitive must not have.
///        - ONLY `transfer` IS RECOGNISED. Any other selector reverts. In particular `approve` and
///          `transferFrom` are refused: an approval to an allowed payee would delegate onwards
///          off-ledger, escaping both this check and every amount cap.
///        - THE ADDRESS WORD MUST BE CLEAN. ABI-encoded addresses are zero-padded; a word with
///          dirty upper bits is refused outright rather than truncated, so this enforcer and a
///          non-checking token can never disagree about who the recipient is.
///        - STATELESS, like every pure gate: nothing to poison by calling the hook directly.
///
///      Terms are N tightly packed 20-byte addresses, N >= 1. Linear scan: a payee list is small
///      by construction (it was enumerated in a signing UI); a Merkle root would save gas beyond
///      ~hundreds of entries at the cost of making the signed terms opaque to the person signing
///      them. For an accountability primitive, legible terms win.
contract AllowedPayeeEnforcer is CaveatEnforcer {
    using ExecutionLib for bytes;

    error InvalidTermsLength(uint256 length);
    error InvalidExecutionLength(uint256 length);
    error InvalidMethod(bytes4 selector);
    error DirtyRecipientWord(bytes32 word);
    error PayeeNotAllowed(address payee);

    /// @inheritdoc CaveatEnforcer
    function beforeHook(
        bytes calldata _terms,
        bytes calldata,
        ModeCode _mode,
        bytes calldata _executionCallData,
        bytes32,
        address,
        address
    ) public view override onlySingleCallTypeMode(_mode) onlyDefaultExecutionMode(_mode) {
        _validateTermsLength(_terms.length);
        _requireAllowed(_terms, _extractPayee(_executionCallData));
    }

    /// @dev Split from {beforeHook} to keep each frame under the stack limit with via_ir off
    ///      (deliberately off: it breaks Blockscout verification).
    function _extractPayee(bytes calldata _executionCallData) private pure returns (address payee_) {
        // partial destructure: this gate constrains
        // the RECIPIENT inside callData; target and value are other enforcers' concerns.
        // slither-disable-next-line unused-return
        (,, bytes calldata callData_) = _executionCallData.decodeSingle();

        if (callData_.length != 68) revert InvalidExecutionLength(callData_.length);
        if (bytes4(callData_[0:4]) != IERC20.transfer.selector) {
            revert InvalidMethod(bytes4(callData_[0:4]));
        }

        bytes32 recipientWord_ = bytes32(callData_[4:36]);
        if (uint256(recipientWord_) >> 160 != 0) revert DirtyRecipientWord(recipientWord_);
        payee_ = address(uint160(uint256(recipientWord_)));
    }

    function _requireAllowed(bytes calldata _terms, address _payee) private pure {
        uint256 count_ = _terms.length / 20;
        for (uint256 i; i < count_; ++i) {
            if (address(bytes20(_terms[i * 20:i * 20 + 20])) == _payee) return;
        }
        revert PayeeNotAllowed(_payee);
    }

    /// @notice Validates and decodes the packed payee list.
    /// @dev Exposed for off-chain construction and for tests; `beforeHook` performs the same
    ///      length validation inline.
    function getTermsInfo(bytes calldata _terms) public pure returns (address[] memory payees_) {
        _validateTermsLength(_terms.length);
        uint256 count_ = _terms.length / 20;
        payees_ = new address[](count_);
        for (uint256 i; i < count_; ++i) {
            payees_[i] = address(bytes20(_terms[i * 20:i * 20 + 20]));
        }
    }

    function _validateTermsLength(uint256 _length) private pure {
        if (_length == 0 || _length % 20 != 0) revert InvalidTermsLength(_length);
    }
}
