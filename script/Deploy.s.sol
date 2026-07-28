// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {MapaeDelegationManager} from "../src/MapaeDelegationManager.sol";
import {MapaeAccountFactory} from "../src/MapaeAccountFactory.sol";
import {DojangVerifiedEnforcer, IMapaeAccountRegistry} from "../src/enforcers/DojangVerifiedEnforcer.sol";
import {AllowedPayeeEnforcer} from "../src/enforcers/AllowedPayeeEnforcer.sol";
import {ERC20PeriodTransferEnforcer} from "../src/enforcers/ERC20PeriodTransferEnforcer.sol";
import {TimestampEnforcer} from "../src/enforcers/TimestampEnforcer.sol";
import {MockKRW} from "../src/mocks/MockKRW.sol";
import {IDojangScroll} from "../src/interfaces/IDojangScroll.sol";
import {DojangConstants} from "../src/libraries/DojangConstants.sol";

/// @title Deploy
/// @notice Deploys the full Mapae stack to GIWA Sepolia and writes deployments/91342.json.
/// @dev The enforcer set wires against the LIVE Dojang deployment - the constants library holds
///      addresses read from the chain, not from docs (the docs render three of them truncated).
///      Usage:
///        source .env && forge script script/Deploy.s.sol \
///          --rpc-url $GIWA_SEPOLIA_RPC_URL --private-key $PRINCIPAL_PRIVATE_KEY --broadcast
contract Deploy is Script {
    function run() external {
        require(block.chainid == 91_342, "wrong chain - GIWA Sepolia only");

        vm.startBroadcast();

        MapaeDelegationManager manager = new MapaeDelegationManager();
        MapaeAccountFactory factory = new MapaeAccountFactory(address(manager));
        DojangVerifiedEnforcer dojangEnforcer = new DojangVerifiedEnforcer(
            IDojangScroll(DojangConstants.DOJANG_SCROLL), IMapaeAccountRegistry(address(factory))
        );
        AllowedPayeeEnforcer payeeEnforcer = new AllowedPayeeEnforcer();
        ERC20PeriodTransferEnforcer periodEnforcer = new ERC20PeriodTransferEnforcer();
        TimestampEnforcer timestampEnforcer = new TimestampEnforcer();
        MockKRW krw = new MockKRW();

        vm.stopBroadcast();

        console2.log("chainId:            ", block.chainid);
        console2.log("MapaeDelegationManager:", address(manager));
        console2.log("MapaeAccountFactory:   ", address(factory));
        console2.log("DojangVerifiedEnforcer:", address(dojangEnforcer));
        console2.log("AllowedPayeeEnforcer:  ", address(payeeEnforcer));
        console2.log("ERC20PeriodTransfer:   ", address(periodEnforcer));
        console2.log("TimestampEnforcer:     ", address(timestampEnforcer));
        console2.log("MockKRW:               ", address(krw));

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeUint(json, "deployBlock", block.number);
        vm.serializeAddress(json, "MapaeDelegationManager", address(manager));
        vm.serializeAddress(json, "MapaeAccountFactory", address(factory));
        vm.serializeAddress(json, "DojangVerifiedEnforcer", address(dojangEnforcer));
        vm.serializeAddress(json, "AllowedPayeeEnforcer", address(payeeEnforcer));
        vm.serializeAddress(json, "ERC20PeriodTransferEnforcer", address(periodEnforcer));
        vm.serializeAddress(json, "TimestampEnforcer", address(timestampEnforcer));
        vm.serializeAddress(json, "MockKRW", address(krw));
        vm.serializeAddress(json, "DojangScroll", DojangConstants.DOJANG_SCROLL);
        string memory out =
            vm.serializeAddress(json, "GiwaFaucetExtension", DojangConstants.GIWA_FAUCET_EXTENSION);
        vm.writeJson(out, "./deployments/91342.json");
    }
}
