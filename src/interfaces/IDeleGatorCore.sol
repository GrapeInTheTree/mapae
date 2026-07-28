// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ModeCode} from "../utils/Types.sol";

/// @title IDeleGatorCore
/// @notice The account-side hook a delegation manager calls to perform an authorised execution.
/// @dev Signature-identical to MetaMask's delegation-framework, so an account implementing this is
///      drivable by either manager.
interface IDeleGatorCore {
    /// @notice Executes on behalf of the account. MUST be callable only by the delegation manager.
    function executeFromExecutor(ModeCode _mode, bytes calldata _executionCalldata)
        external
        payable
        returns (bytes[] memory returnData);
}

/// @title IMapaeAccount
/// @notice The Mapae account surface an identity enforcer needs.
/// @dev Mapae deliberately separates the two things a delegation binds together:
///        - the ACCOUNT holds the funds and carries the delegation state
///        - the OWNER is the human, and is the address a Dojang attestation is issued to
///      They must not be conflated. Upbit attests a KYC'd person's wallet; it will never attest a
///      freshly deployed contract. Gating on the account address would mean the gate could only
///      ever be satisfied by a self-issued attestation, which would make the whole design
///      circular.
interface IMapaeAccount {
    /// @notice The human principal this account acts for. Immutable after construction.
    function owner() external view returns (address);
}
