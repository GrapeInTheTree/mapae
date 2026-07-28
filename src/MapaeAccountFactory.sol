// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

import {MapaeAccount} from "./MapaeAccount.sol";

/// @title MapaeAccountFactory
/// @notice Deploys Mapae accounts at deterministic addresses, and is the registry an identity
///         enforcer consults before trusting an account's claim about who its owner is.
/// @dev The registry exists to close a forgery, not for convenience.
///
///      `DojangVerifiedEnforcer` evaluates the Dojang attestation of `account.owner()`. Nothing
///      stops an attacker deploying their own contract whose `owner()` returns some real
///      Upbit-verified address. They could not steal funds - the delegation only ever spends the
///      delegator's own balance - but every payment they made would trace back to an innocent
///      verified person. The accountability chain, which is the entire product, would be forged.
///
///      Two things together make the binding sound:
///        1. `MapaeAccount.owner` is immutable, so it cannot be repointed after the fact;
///        2. deployment requires an EIP-712 signature FROM that owner, so an address can only be
///           named as principal by someone holding its key (or, via ERC-1271, its own approval).
///      The enforcer then checks {isMapaeAccount} before reading `owner()`, so only accounts that
///      passed (2) are ever trusted.
contract MapaeAccountFactory is EIP712 {
    /// @dev keccak256("MapaeAccountCreation(address owner,uint256 salt)")
    bytes32 public constant CREATION_TYPEHASH = keccak256("MapaeAccountCreation(address owner,uint256 salt)");

    /// @notice The delegation manager every account produced here is bound to.
    address public immutable DELEGATION_MANAGER;

    /// @notice Accounts deployed by this factory, and therefore accounts whose `owner()` was
    ///         proven to consent. An identity enforcer MUST consult this before trusting `owner()`.
    mapping(address account => bool) public isMapaeAccount;

    event MapaeAccountCreated(address indexed account, address indexed owner, uint256 salt);

    error InvalidOwnerSignature();
    error ZeroOwner();

    constructor(address _delegationManager) EIP712("MapaeAccountFactory", "1") {
        DELEGATION_MANAGER = _delegationManager;
    }

    /// @notice Deploys the account for `_owner` at the address {predict} returns.
    /// @param _owner The human principal. Must sign `_ownerSignature`.
    /// @param _salt Lets one owner hold several accounts.
    /// @param _ownerSignature EIP-712 signature by `_owner` over `MapaeAccountCreation`.
    ///        ERC-1271 owners are supported, so a principal may itself be a smart account.
    /// @dev Deliberately callable by anyone: a relayer may pay the gas. The signature, not the
    ///      caller, is what authorises the binding.
    function createAccount(address _owner, uint256 _salt, bytes calldata _ownerSignature)
        external
        returns (MapaeAccount account)
    {
        if (_owner == address(0)) revert ZeroOwner();

        bytes32 digest_ = _hashTypedDataV4(keccak256(abi.encode(CREATION_TYPEHASH, _owner, _salt)));
        if (!SignatureChecker.isValidSignatureNow(_owner, digest_, _ownerSignature)) {
            revert InvalidOwnerSignature();
        }

        account = new MapaeAccount{salt: _toSalt(_owner, _salt)}(DELEGATION_MANAGER, _owner);
        isMapaeAccount[address(account)] = true;

        emit MapaeAccountCreated(address(account), _owner, _salt);
    }

    /// @notice The address {createAccount} will deploy to, computable before deployment.
    function predict(address _owner, uint256 _salt) external view returns (address) {
        return Create2.computeAddress(_toSalt(_owner, _salt), keccak256(_creationCode(_owner)));
    }

    /// @notice The EIP-712 digest `_owner` must sign to be bound as principal.
    function creationDigest(address _owner, uint256 _salt) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CREATION_TYPEHASH, _owner, _salt)));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /* -------------------------------------------------------------------------- */
    /*                                   Internal                                  */
    /* -------------------------------------------------------------------------- */

    /// @dev The owner is mixed into the CREATE2 salt as well as the constructor args, so one
    ///      owner's `_salt` space cannot collide with another's.
    function _toSalt(address _owner, uint256 _salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(_owner, _salt));
    }

    function _creationCode(address _owner) internal view returns (bytes memory) {
        return abi.encodePacked(type(MapaeAccount).creationCode, abi.encode(DELEGATION_MANAGER, _owner));
    }
}
