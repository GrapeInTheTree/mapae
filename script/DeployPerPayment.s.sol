// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {PerPaymentLimitEnforcer} from "../src/enforcers/PerPaymentLimitEnforcer.sol";

/// @title DeployPerPayment
/// @notice Deploys ONLY the per-payment ceiling enforcer. The rest of the stack is live and
///         source-verified; a caveat enforcer is stateless and keyed by nothing, so adding one is
///         a single deployment, never a redeployment of anything that already carries state.
/// @dev Usage:
///        source .env && forge script script/DeployPerPayment.s.sol \
///          --rpc-url $GIWA_SEPOLIA_RPC_URL --private-key $PRINCIPAL_PRIVATE_KEY --broadcast
///      Then verify, and add the address to deployments/91342.json by hand - the curated record
///      is edited deliberately, not overwritten by whichever script ran last.
contract DeployPerPayment is Script {
    function run() external {
        require(block.chainid == 91_342, "wrong chain - GIWA Sepolia only");

        vm.startBroadcast();
        PerPaymentLimitEnforcer enforcer = new PerPaymentLimitEnforcer();
        vm.stopBroadcast();

        console2.log("PerPaymentLimitEnforcer:", address(enforcer));
    }
}
