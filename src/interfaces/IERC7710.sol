// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title IERC7710
/// @notice ERC-7710 smart contract delegation. The standard is exactly this one function.
/// @dev The ERC deliberately specifies no Delegation struct, no caveat concept and no interface id:
///      the layout of `_permissionContexts[i]` is defined entirely by the manager implementation.
///      Mapae adopts MetaMask's layout - `abi.encode(Delegation[])`, leaf first, root last - so
///      that a permission context is portable between the two managers.
///
///      x402 v2's `exact` scheme on EVM names `erc7710` as an `assetTransferMethod`, verified by
///      simulating this call. That is the slot Mapae plugs into: a facilitator needs no knowledge
///      of caveats, enforcers or identity, because the entire policy lives on-chain behind this
///      function.
interface IERC7710 {
    /// @notice Redeems delegations, executing each `_executionCallDatas[i]` under `_modes[i]`.
    /// @dev MUST revert if the three arrays differ in length, and MUST be atomic across the batch.
    function redeemDelegations(
        bytes[] calldata _permissionContexts,
        bytes32[] calldata _modes,
        bytes[] calldata _executionCallDatas
    ) external;
}
