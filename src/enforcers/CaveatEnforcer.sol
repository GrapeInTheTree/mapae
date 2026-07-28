// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity ^0.8.29;

// Vendored from MetaMask/delegation-framework src/enforcers/CaveatEnforcer.sol (MIT AND
// Apache-2.0). Modifications: pragma widened from 0.8.23, import paths adapted to this repo's
// layout. Hook signatures, modifier semantics and revert strings are unchanged - enforcers built
// on this base remain drop-in compatible with MetaMask's DelegationManager and vice versa.

import {ICaveatEnforcer} from "../interfaces/ICaveatEnforcer.sol";
import {ModeCode, ExecType, CallType} from "../utils/Types.sol";
import {
    ModeLib,
    CALLTYPE_SINGLE,
    CALLTYPE_BATCH,
    EXECTYPE_DEFAULT,
    EXECTYPE_TRY
} from "../libraries/ModeLib.sol";

/// @title CaveatEnforcer
/// @dev Abstract base: every hook is a no-op unless overridden, so an enforcer implements only the
///      hooks its condition needs and the manager can safely call all four.
abstract contract CaveatEnforcer is ICaveatEnforcer {
    using ModeLib for ModeCode;

    /// @inheritdoc ICaveatEnforcer
    function beforeAllHook(
        bytes calldata,
        bytes calldata,
        ModeCode,
        bytes calldata,
        bytes32,
        address,
        address
    ) public virtual {}

    /// @inheritdoc ICaveatEnforcer
    function beforeHook(bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address)
        public
        virtual {}

    /// @inheritdoc ICaveatEnforcer
    function afterHook(bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address)
        public
        virtual {}

    /// @inheritdoc ICaveatEnforcer
    function afterAllHook(bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address)
        public
        virtual {}

    /// @dev Require the execution to be a single call.
    modifier onlySingleCallTypeMode(ModeCode _mode) {
        {
            require(
                CallType.unwrap(_mode.getCallType()) == CallType.unwrap(CALLTYPE_SINGLE),
                "CaveatEnforcer:invalid-call-type"
            );
        }
        _;
    }

    /// @dev Require the execution to be a batch call.
    modifier onlyBatchCallTypeMode(ModeCode _mode) {
        {
            require(
                CallType.unwrap(_mode.getCallType()) == CallType.unwrap(CALLTYPE_BATCH),
                "CaveatEnforcer:invalid-call-type"
            );
        }
        _;
    }

    /// @dev Require revert-on-failure execution semantics.
    modifier onlyDefaultExecutionMode(ModeCode _mode) {
        {
            require(
                ExecType.unwrap(_mode.getExecType()) == ExecType.unwrap(EXECTYPE_DEFAULT),
                "CaveatEnforcer:invalid-execution-type"
            );
        }
        _;
    }

    /// @dev Require try execution semantics.
    modifier onlyTryExecutionMode(ModeCode _mode) {
        {
            require(
                ExecType.unwrap(_mode.getExecType()) == ExecType.unwrap(EXECTYPE_TRY),
                "CaveatEnforcer:invalid-execution-type"
            );
        }
        _;
    }
}
