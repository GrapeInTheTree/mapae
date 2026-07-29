// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity ^0.8.29;

// Vendored from MetaMask/delegation-framework src/enforcers/ERC20PeriodTransferEnforcer.sol
// (MIT AND Apache-2.0). Modifications: pragma widened from 0.8.23, import paths adapted. Contract
// name, storage layout, terms layout, revert strings, events and logic are unchanged (one
// comment-only slither annotation added) - this is
// their audited spend-tracking enforcer running unmodified on the Mapae manager, which is possible
// precisely because its state is keyed by (msg.sender, delegationHash) and therefore
// manager-agnostic. Do not "improve" this file; byte-faithful vendoring IS the point.

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {CaveatEnforcer} from "./CaveatEnforcer.sol";
import {ModeCode} from "../utils/Types.sol";
import {ExecutionLib} from "../libraries/ExecutionLib.sol";

/**
 * @title ERC20PeriodTransferEnforcer
 * @notice Enforces periodic transfer limits for ERC20 token transfers.
 * @dev This contract implements a mechanism by which a user may transfer up to a fixed amount of
 * tokens (the period amount) during a given time period. The transferable amount resets at the
 * beginning of each period, and any unused tokens are forfeited once the period ends. Partial
 * transfers within a period are allowed, but the total transfer in any period cannot exceed the
 * specified limit.
 * @dev This enforcer operates only in single execution call type and with default execution mode.
 */
contract ERC20PeriodTransferEnforcer is CaveatEnforcer {
    using ExecutionLib for bytes;

    ////////////////////////////// State //////////////////////////////

    struct PeriodicAllowance {
        uint256 periodAmount; // Maximum transferable tokens per period.
        uint256 periodDuration; // Duration of each period in seconds.
        uint256 startDate; // Timestamp when the first period begins.
        uint256 lastTransferPeriod; // The period index in which the last transfer was made.
        uint256 transferredInCurrentPeriod; // Cumulative amount transferred in the current period.
    }

    /**
     * @dev Mapping from a delegation manager address and delegation hash to a PeriodicAllowance.
     */
    mapping(address delegationManager => mapping(bytes32 delegationHash => PeriodicAllowance)) public
        periodicAllowances;

    ////////////////////////////// Events //////////////////////////////

    event TransferredInPeriod(
        address indexed sender,
        address indexed redeemer,
        bytes32 indexed delegationHash,
        address token,
        uint256 periodAmount,
        uint256 periodDuration,
        uint256 startDate,
        uint256 transferredInCurrentPeriod,
        uint256 transferTimestamp
    );

    ////////////////////////////// Public Methods //////////////////////////////

    /**
     * @notice Retrieves the current transferable amount along with period status for a given
     * delegation.
     */
    function getAvailableAmount(bytes32 _delegationHash, address _delegationManager, bytes calldata _terms)
        external
        view
        returns (uint256 availableAmount_, bool isNewPeriod_, uint256 currentPeriod_)
    {
        PeriodicAllowance memory storedAllowance_ = periodicAllowances[_delegationManager][_delegationHash];
        if (storedAllowance_.startDate != 0) {
            return _getAvailableAmount(storedAllowance_);
        }

        // Not yet initialized: simulate using provided terms.
        (, uint256 periodAmount_, uint256 periodDuration_, uint256 startDate_) = getTermsInfo(_terms);

        PeriodicAllowance memory allowance_ = PeriodicAllowance({
            periodAmount: periodAmount_,
            periodDuration: periodDuration_,
            startDate: startDate_,
            lastTransferPeriod: 0,
            transferredInCurrentPeriod: 0
        });
        return _getAvailableAmount(allowance_);
    }

    /**
     * @notice Hook called before an ERC20 transfer to enforce the periodic transfer limit.
     * @param _terms 116 packed bytes:
     *  - 20 bytes: ERC20 token address.
     *  - 32 bytes: periodAmount.
     *  - 32 bytes: periodDuration (in seconds).
     *  - 32 bytes: startDate for the first period.
     * @param _mode The execution mode. (Must be Single callType, Default execType)
     */
    function beforeHook(
        bytes calldata _terms,
        bytes calldata,
        ModeCode _mode,
        bytes calldata _executionCallData,
        bytes32 _delegationHash,
        address,
        address _redeemer
    ) public override onlySingleCallTypeMode(_mode) onlyDefaultExecutionMode(_mode) {
        _validateAndConsumeTransfer(_terms, _executionCallData, _delegationHash, _redeemer);
    }

    /**
     * @notice Decodes the transfer terms.
     */
    function getTermsInfo(bytes calldata _terms)
        public
        pure
        returns (address token_, uint256 periodAmount_, uint256 periodDuration_, uint256 startDate_)
    {
        require(_terms.length == 116, "ERC20PeriodTransferEnforcer:invalid-terms-length");

        token_ = address(bytes20(_terms[0:20]));
        periodAmount_ = uint256(bytes32(_terms[20:52]));
        periodDuration_ = uint256(bytes32(_terms[52:84]));
        startDate_ = uint256(bytes32(_terms[84:116]));
    }

    ////////////////////////////// Internal Methods //////////////////////////////

    function _validateAndConsumeTransfer(
        bytes calldata _terms,
        bytes calldata _executionCallData,
        bytes32 _delegationHash,
        address _redeemer
    ) private {
        // partial destructure, upstream-faithful:
        // value is unused because an ERC20 transfer carries no native value.
        // slither-disable-next-line unused-return
        (address target_,, bytes calldata callData_) = _executionCallData.decodeSingle();

        require(callData_.length == 68, "ERC20PeriodTransferEnforcer:invalid-execution-length");

        (address token_, uint256 periodAmount_, uint256 periodDuration_, uint256 startDate_) =
            getTermsInfo(_terms);

        require(token_ == target_, "ERC20PeriodTransferEnforcer:invalid-contract");
        require(
            bytes4(callData_[0:4]) == IERC20.transfer.selector, "ERC20PeriodTransferEnforcer:invalid-method"
        );

        PeriodicAllowance storage allowance_ = periodicAllowances[msg.sender][_delegationHash];

        // Initialize the allowance on first use.
        if (allowance_.startDate == 0) {
            require(startDate_ > 0, "ERC20PeriodTransferEnforcer:invalid-zero-start-date");
            require(periodAmount_ > 0, "ERC20PeriodTransferEnforcer:invalid-zero-period-amount");
            require(periodDuration_ > 0, "ERC20PeriodTransferEnforcer:invalid-zero-period-duration");

            // Ensure the transfer period has started.
            require(block.timestamp >= startDate_, "ERC20PeriodTransferEnforcer:transfer-not-started");

            allowance_.periodAmount = periodAmount_;
            allowance_.periodDuration = periodDuration_;
            allowance_.startDate = startDate_;
        }

        // Calculate available tokens using the current allowance state.
        (uint256 available_, bool isNewPeriod_, uint256 currentPeriod_) = _getAvailableAmount(allowance_);

        uint256 transferAmount_ = uint256(bytes32(callData_[36:68]));
        require(transferAmount_ <= available_, "ERC20PeriodTransferEnforcer:transfer-amount-exceeded");

        // If a new period has started, reset transferred amount before continuing.
        if (isNewPeriod_) {
            allowance_.lastTransferPeriod = currentPeriod_;
            allowance_.transferredInCurrentPeriod = 0;
        }

        allowance_.transferredInCurrentPeriod += transferAmount_;

        emit TransferredInPeriod(
            msg.sender,
            _redeemer,
            _delegationHash,
            token_,
            periodAmount_,
            periodDuration_,
            startDate_,
            allowance_.transferredInCurrentPeriod,
            block.timestamp
        );
    }

    /**
     * @notice Computes the available tokens that can be transferred in the current period.
     * @dev The first period starts at index 1. If the current time is before the start date,
     * availableAmount_ is 0.
     */
    function _getAvailableAmount(PeriodicAllowance memory _allowance)
        internal
        view
        returns (uint256 availableAmount_, bool isNewPeriod_, uint256 currentPeriod_)
    {
        if (block.timestamp < _allowance.startDate) {
            return (0, false, 0);
        }

        currentPeriod_ = (block.timestamp - _allowance.startDate) / _allowance.periodDuration + 1;

        isNewPeriod_ = (_allowance.lastTransferPeriod != currentPeriod_);

        uint256 alreadyTransferred = isNewPeriod_ ? 0 : _allowance.transferredInCurrentPeriod;

        availableAmount_ =
            _allowance.periodAmount > alreadyTransferred ? _allowance.periodAmount - alreadyTransferred : 0;
    }
}
