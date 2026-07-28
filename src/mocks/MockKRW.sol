// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockKRW
/// @notice Testnet stand-in for a KRW stablecoin. TESTNET ONLY - carries no value and no backing.
/// @dev Two deliberate choices:
///      - `decimals() == 0`, so an on-chain balance of 50000 reads as ₩50,000 in any explorer.
///        Whole-won amounts keep the demo's numbers legible to a non-crypto reviewer.
///      - NO EIP-3009 / EIP-2612. x402's `erc7710` assetTransferMethod authorises through the
///        delegation manager, not through token-level signatures - working against a plain ERC-20
///        is part of the point. (No EIP-3009 token exists on GIWA anyway; verified 2026-07-29.)
///      Minting is permissionless but capped per call: enough for anyone to reproduce the demo,
///      not enough to be worth scripting a farm around.
contract MockKRW is ERC20 {
    /// @notice Per-call mint ceiling: ₩100,000,000.
    uint256 public constant MAX_MINT_PER_CALL = 100_000_000;

    error MintTooLarge(uint256 requested, uint256 max);

    constructor() ERC20("Mock Korean Won", "mKRW") {}

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT_PER_CALL) revert MintTooLarge(amount, MAX_MINT_PER_CALL);
        _mint(to, amount);
    }
}
