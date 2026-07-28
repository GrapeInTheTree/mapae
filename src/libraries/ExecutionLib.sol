// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title ExecutionLib
/// @notice Encodes and decodes ERC-7579 execution calldata.
/// @dev Single-call layout is tightly packed: target(20) | value(32) | callData(...).
///      Matches erc7579/erc7579-implementation exactly; verified against that source.
///      Enforcers that inspect the payment recipient or amount index into `callData` from here, so
///      any drift in this layout silently breaks every spending limit. It is pinned by tests.
library ExecutionLib {
    error InvalidSingleExecutionLength(uint256 length);

    function encodeSingle(address target, uint256 value, bytes memory callData)
        internal
        pure
        returns (bytes memory executionCalldata)
    {
        executionCalldata = abi.encodePacked(target, value, callData);
    }

    function decodeSingle(bytes calldata executionCalldata)
        internal
        pure
        returns (address target, uint256 value, bytes calldata callData)
    {
        if (executionCalldata.length < 52) {
            revert InvalidSingleExecutionLength(executionCalldata.length);
        }
        target = address(bytes20(executionCalldata[0:20]));
        value = uint256(bytes32(executionCalldata[20:52]));
        callData = executionCalldata[52:];
    }
}
