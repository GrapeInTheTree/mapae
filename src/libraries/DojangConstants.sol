// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title DojangConstants
/// @notice GIWA Sepolia (chain 91342) Dojang and EAS deployment constants.
/// @dev Every value below was read from the live chain on 2026-07-29, not copied from docs.
///      The GIWA docs render three resolver addresses one character short; the canonical source is
///      https://github.com/giwa-io/dojang/blob/main/deployments/91342-deploy.json
library DojangConstants {
    /* -------------------------------------------------------------------------- */
    /*                                  Contracts                                  */
    /* -------------------------------------------------------------------------- */

    /// @notice EAS, an OP Stack predeploy.
    address internal constant EAS = 0x4200000000000000000000000000000000000021;

    /// @notice EAS SchemaRegistry, an OP Stack predeploy.
    address internal constant SCHEMA_REGISTRY = 0x4200000000000000000000000000000000000020;

    /// @notice DojangScroll v0.5.1 - the convenience read surface over Dojang attestations.
    address internal constant DOJANG_SCROLL = 0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9;

    /// @notice Maps a Dojang attester id to the issuing address.
    address internal constant DOJANG_ATTESTER_BOOK = 0xDA282E89244424E297Ce8e78089B54D043FB28B6;

    /// @notice Permissionless self-service attester (testnet only).
    address internal constant GIWA_FAUCET_EXTENSION = 0x63CCe2b569A7bC35895ee24306c1512fefc06121;

    /* -------------------------------------------------------------------------- */
    /*                                 Attester ids                                */
    /* -------------------------------------------------------------------------- */

    /// @notice keccak256("dojang.dojangattesterids.upbitkorea") - verified on-chain.
    /// @dev Issued by 0x09B170CA2A006081042992bCE7379B85a02149C6. Real KYC; unobtainable by us,
    ///      which is precisely why it is used as the negative case in the live demo and as the
    ///      positive case in a pinned fork test.
    bytes32 internal constant UPBIT_KOREA =
        0xd99b42e778498aa3c9c1f6a012359130252780511687a35982e8e52735453034;

    /// @notice keccak256("dojang.dojangattesterids.testnetfaucet") - verified on-chain.
    bytes32 internal constant TESTNET_FAUCET =
        0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678;

    /* -------------------------------------------------------------------------- */
    /*                                   Schemas                                   */
    /* -------------------------------------------------------------------------- */

    /// @notice Verified Address schema uid. Body: `bool isVerified`. Revocable.
    bytes32 internal constant SCHEMA_VERIFIED_ADDRESS =
        0x072d75e18b2be4f89a13a7147240477481c4b526d5795802acba59046b426e08;

    /// @notice Verified Code schema uid. Body: `bytes32 codeHash, string domain`. Revocable.
    bytes32 internal constant SCHEMA_VERIFIED_CODE =
        0x55ac1369dac97522d062b89ffdc4e752b48fbeba86915fdb956c7c2d0501d280;
}
