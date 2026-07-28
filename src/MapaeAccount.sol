// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IDeleGatorCore, IMapaeAccount} from "./interfaces/IDeleGatorCore.sol";
import {ModeCode, CallType, ExecType} from "./utils/Types.sol";
import {ModeLib, CALLTYPE_SINGLE, EXECTYPE_DEFAULT} from "./libraries/ModeLib.sol";
import {ExecutionLib} from "./libraries/ExecutionLib.sol";

/// @title MapaeAccount
/// @notice Holds a principal's funds and executes payments a delegation has authorised.
/// @dev Mapae separates two things that a naive design conflates:
///
///        the ACCOUNT holds the funds and carries the delegation state
///        the OWNER is the human, and is who a Dojang attestation is issued to
///
///      They must not be the same address. Upbit attests a KYC'd person's wallet; it will never
///      attest a freshly deployed contract. An identity gate reading the account address could
///      therefore only ever be satisfied by a self-issued attestation, which would make the whole
///      accountability claim circular. So the account holds the money and the owner holds the
///      identity, and `DojangVerifiedEnforcer` resolves one to the other.
///
///      That resolution is only sound because `owner` is immutable and was proven to consent at
///      construction - see {MapaeAccountFactory}. Without the consent proof, anyone could deploy
///      an account naming a stranger's verified address as owner and forge an accountability
///      chain: they could not steal funds, but every payment they made would trace back to an
///      innocent Upbit-verified person. That is an attack on precisely the property this
///      primitive exists to provide.
contract MapaeAccount is IDeleGatorCore, IMapaeAccount, IERC1271 {
    using ExecutionLib for bytes;

    /// @notice The only contract permitted to drive `executeFromExecutor`.
    address public immutable DELEGATION_MANAGER;

    /// @notice The human principal. Immutable, and proven to have consented at construction.
    address public immutable override owner;

    error NotDelegationManager(address caller);
    error NotOwner(address caller);
    error UnsupportedCallType(CallType callType);
    error UnsupportedExecType(ExecType execType);
    error ExecutionFailed();

    event Executed(address indexed target, uint256 value, bytes4 selector);

    constructor(address _delegationManager, address _owner) {
        DELEGATION_MANAGER = _delegationManager;
        owner = _owner;
    }

    receive() external payable {}

    /// @inheritdoc IDeleGatorCore
    /// @dev The manager has already validated the delegation chain and run every caveat before
    ///      calling this. The account's own job is narrow: confirm the caller is the manager, and
    ///      refuse execution shapes that would let a delegate escape the scope that was checked.
    function executeFromExecutor(ModeCode _mode, bytes calldata _executionCalldata)
        external
        payable
        returns (bytes[] memory returnData)
    {
        if (msg.sender != DELEGATION_MANAGER) revert NotDelegationManager(msg.sender);
        return _execute(_mode, _executionCalldata);
    }

    /// @notice Direct execution by the principal, bypassing delegation entirely.
    /// @dev How the owner obtains and revokes their own Dojang attestation, tops up an agent, or
    ///      moves funds out. Not a delegation path: no caveats apply because no authority was
    ///      delegated.
    function execute(ModeCode _mode, bytes calldata _executionCalldata)
        external
        payable
        returns (bytes[] memory returnData)
    {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        return _execute(_mode, _executionCalldata);
    }

    /// @inheritdoc IERC1271
    /// @dev Lets the delegation manager validate this account's delegations through the ERC-1271
    ///      branch. Authority to sign for the account is exactly the owner's key, so a delegation
    ///      signed by the owner is a delegation by the account.
    function isValidSignature(bytes32 _hash, bytes calldata _signature) external view returns (bytes4) {
        if (SignatureChecker.isValidSignatureNow(owner, _hash, _signature)) {
            return IERC1271.isValidSignature.selector;
        }
        return 0xffffffff;
    }

    /* -------------------------------------------------------------------------- */
    /*                                   Internal                                  */
    /* -------------------------------------------------------------------------- */

    /// @dev Only `CALLTYPE_SINGLE` with `EXECTYPE_DEFAULT` is accepted.
    ///
    ///      Delegatecall is refused because it would let a delegate rewrite this account's
    ///      storage, including anything a future version keeps there, escaping every caveat that
    ///      was just checked.
    ///
    ///      `EXECTYPE_TRY` is refused because it swallows call failure. A caveat that passed and
    ///      then recorded spend against a transfer that silently failed would leave the on-chain
    ///      accounting claiming a payment that never happened - and the spend limit would be
    ///      consumed anyway. Batch is refused for the same reason MetaMask's spending enforcers
    ///      only handle single calls: their amount checks index a single call's calldata.
    function _execute(ModeCode _mode, bytes calldata _executionCalldata)
        internal
        returns (bytes[] memory returnData)
    {
        (CallType callType_, ExecType execType_,,) = ModeLib.decode(_mode);

        if (CallType.unwrap(callType_) != CallType.unwrap(CALLTYPE_SINGLE)) {
            revert UnsupportedCallType(callType_);
        }
        if (ExecType.unwrap(execType_) != ExecType.unwrap(EXECTYPE_DEFAULT)) {
            revert UnsupportedExecType(execType_);
        }

        (address target_, uint256 value_, bytes calldata callData_) =
            ExecutionLib.decodeSingle(_executionCalldata);

        (bool ok_, bytes memory ret_) = target_.call{value: value_}(callData_);
        if (!ok_) {
            // Bubble the callee's revert data so a failed transfer is diagnosable, rather than
            // collapsing every failure into one opaque error.
            if (ret_.length > 0) {
                assembly {
                    revert(add(ret_, 0x20), mload(ret_))
                }
            }
            revert ExecutionFailed();
        }

        emit Executed(target_, value_, callData_.length >= 4 ? bytes4(callData_[0:4]) : bytes4(0));

        returnData = new bytes[](1);
        returnData[0] = ret_;
    }
}
