// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {CaveatEnforcer} from "./CaveatEnforcer.sol";
import {ModeCode} from "../utils/Types.sol";
import {ExecutionLib} from "../libraries/ExecutionLib.sol";

/// @title PerPaymentLimitEnforcer
/// @notice Caps the amount of a SINGLE ERC-20 `transfer` execution.
/// @dev The gap this closes: a period cap bounds what an agent spends over a window, but says
///      nothing about how that budget is shaped. "₩50,000 per day" alone permits one ₩50,000
///      payment; paired with this enforcer, "₩50,000 per day, at most ₩10,000 per payment" forces
///      the spend into small pieces - which is what an expense policy, a benefit card, or a
///      cautious first delegation actually means. The existing per-amount enforcers cap the
///      RUNNING TOTAL; none deployed caps the individual payment.
///
///      Security posture, identical to {AllowedPayeeEnforcer}:
///        - DENY BY DEFAULT. A zero cap is refused at use: a policy that permits nothing is a
///          mistake (an unset form field), not a policy - refusing it loudly beats silently
///          issuing a dead authority. Wrong-length terms revert rather than truncate.
///        - ONLY `transfer` IS RECOGNISED. Any other selector reverts. In particular `approve`
///          and `transferFrom` are refused: an approval within the cap would delegate onwards
///          off-ledger, where this cap no longer holds.
///        - STATELESS. The cap is read from the signed terms on every redemption; there is no
///          per-delegation accounting to poison by calling the hook directly, and the same
///          deployment serves every delegation on the manager.
///
///      Terms are exactly 32 bytes: `maxPerPayment` as a uint256, in the token's base units.
///      Composition with the period cap is a conjunction like every other caveat pair: the
///      payment must fit BOTH the remaining window allowance and this ceiling.
contract PerPaymentLimitEnforcer is CaveatEnforcer {
    using ExecutionLib for bytes;

    error InvalidTermsLength(uint256 length);
    error InvalidZeroCap();
    error InvalidExecutionLength(uint256 length);
    error InvalidMethod(bytes4 selector);
    error PerPaymentCapExceeded(uint256 amount, uint256 cap);

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
        uint256 cap_ = getTermsInfo(_terms);
        uint256 amount_ = _extractAmount(_executionCallData);
        if (amount_ > cap_) revert PerPaymentCapExceeded(amount_, cap_);
    }

    /// @dev Split from {beforeHook} to keep each frame under the stack limit with via_ir off
    ///      (deliberately off: it breaks Blockscout verification).
    function _extractAmount(bytes calldata _executionCallData) private pure returns (uint256 amount_) {
        // partial destructure: this gate constrains the AMOUNT inside callData; target and value
        // are other enforcers' concerns.
        // slither-disable-next-line unused-return
        (,, bytes calldata callData_) = _executionCallData.decodeSingle();

        if (callData_.length != 68) revert InvalidExecutionLength(callData_.length);
        if (bytes4(callData_[0:4]) != IERC20.transfer.selector) {
            revert InvalidMethod(bytes4(callData_[0:4]));
        }

        amount_ = uint256(bytes32(callData_[36:68]));
    }

    /// @notice Validates and decodes the signed cap.
    /// @dev Exposed for off-chain construction and for tests; `beforeHook` uses the same path.
    function getTermsInfo(bytes calldata _terms) public pure returns (uint256 maxPerPayment_) {
        if (_terms.length != 32) revert InvalidTermsLength(_terms.length);
        maxPerPayment_ = uint256(bytes32(_terms));
        if (maxPerPayment_ == 0) revert InvalidZeroCap();
    }
}
