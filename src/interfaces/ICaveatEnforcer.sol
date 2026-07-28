// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ModeCode} from "../utils/Types.sol";

/// @title ICaveatEnforcer
/// @notice A condition attached to a delegation, evaluated by the delegation manager around
///         execution. Reverting in any hook reverts the entire redemption.
/// @dev Signature-identical to MetaMask's delegation-framework `ICaveatEnforcer`, which is what
///      makes their 38 audited enforcers usable on the Mapae manager, and Mapae's identity
///      enforcer usable on theirs.
///
///      Enforcers are stateless with respect to the manager: any state they keep must be keyed by
///      `(msg.sender, delegationHash)` so the same enforcer can serve several managers without
///      their accounting bleeding together.
///
///      Hook order for a single redemption, as implemented by the manager:
///        beforeAllHook (leaf -> root, all batches)
///        beforeHook    (leaf -> root)
///        execute
///        afterHook     (root -> leaf)
///        afterAllHook  (root -> leaf, all batches)
///      A condition whose truth depends on the call having happened must be checked in an
///      after-hook; nothing guarantees execution occurred when a before-hook runs.
interface ICaveatEnforcer {
    /// @notice Runs before any execution in the batch.
    function beforeAllHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) external;

    /// @notice Runs immediately before this delegation's execution.
    function beforeHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) external;

    /// @notice Runs immediately after this delegation's execution.
    function afterHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) external;

    /// @notice Runs after every execution in the batch.
    function afterAllHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) external;
}
