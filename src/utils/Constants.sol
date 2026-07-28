// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @dev EIP-712 domain typehash.
bytes32 constant EIP712_DOMAIN_TYPEHASH =
    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

/// @dev Delegation typehash. NOTE: `signature` is deliberately omitted, so a signature can be
///      attached after the payload is fixed. Byte-identical to MetaMask's delegation-framework.
bytes32 constant DELEGATION_TYPEHASH = keccak256(
    "Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)"
);

/// @dev Caveat typehash. NOTE: `args` is deliberately omitted, so the redeemer can supply it at
///      redemption time. Byte-identical to MetaMask's delegation-framework.
bytes32 constant CAVEAT_TYPEHASH = keccak256("Caveat(address enforcer,bytes terms)");

/// @dev Authority value marking a delegation as a root (not derived from a parent).
bytes32 constant ROOT_AUTHORITY = bytes32(type(uint256).max);

/// @dev Sentinel delegate making a delegation bearer - anyone may redeem it.
address constant ANY_DELEGATE = address(0xa11);
