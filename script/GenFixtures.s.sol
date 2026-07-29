// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";

import {Delegation, Caveat} from "../src/utils/Types.sol";
import {ROOT_AUTHORITY} from "../src/utils/Constants.sol";
import {EncoderLib} from "../src/libraries/EncoderLib.sol";
import {ExecutionLib} from "../src/libraries/ExecutionLib.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title GenFixtures
/// @notice Emits the canonical byte fixtures the TypeScript SDK must reproduce exactly.
/// @dev Solidity is the reference implementation; the SDK is the re-implementation under test.
///      Nested dynamic structs (`Delegation[]` containing `Caveat[]` containing `bytes`) are
///      exactly where a hand-rolled ABI encoding drifts silently, and a drifted context either
///      fails signature validation (best case) or redeems a different delegation than the one the
///      principal signed (worst case). One fixture file kills that entire failure class before a
///      single live transaction is sent.
///
///      Run: forge script script/GenFixtures.s.sol
contract GenFixtures is Script {
    function run() external {
        // Fixed, arbitrary-but-memorable values. Never change these: the TS test pins them.
        Caveat[] memory caveats = new Caveat[](2);
        caveats[0] = Caveat({
            enforcer: 0x1111111111111111111111111111111111111111,
            terms: hex"aabbcc",
            args: hex"" // args empty in the signed fixture; a second fixture varies it below
        });
        caveats[1] = Caveat({
            enforcer: 0x2222222222222222222222222222222222222222,
            terms: hex"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff0011223344556677",
            args: hex"deadbeef"
        });

        Delegation memory d = Delegation({
            delegate: 0x3333333333333333333333333333333333333333,
            delegator: 0x4444444444444444444444444444444444444444,
            authority: ROOT_AUTHORITY,
            caveats: caveats,
            salt: 42,
            signature: hex"1234"
        });

        Delegation[] memory chain = new Delegation[](1);
        chain[0] = d;

        // The EIP-712 domain the live manager uses, reproduced with fixed inputs so the fixture
        // is chain-independent: name "Mapae", version "1", chainId 91342, a fixed address.
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("Mapae")),
                keccak256(bytes("1")),
                uint256(91_342),
                0x5555555555555555555555555555555555555555
            )
        );

        bytes32 delegationHash = EncoderLib._getDelegationHash(d);

        string memory json = "fixtures";
        vm.serializeBytes(json, "permissionContext", abi.encode(chain));
        vm.serializeBytes32(json, "delegationHash", delegationHash);
        vm.serializeBytes32(json, "domainSeparator", domainSeparator);
        vm.serializeBytes32(
            json, "typedDataDigest", MessageHashUtils.toTypedDataHash(domainSeparator, delegationHash)
        );
        string memory out = vm.serializeBytes(
            json,
            "executionSingle",
            ExecutionLib.encodeSingle(
                0x6666666666666666666666666666666666666666,
                123,
                abi.encodeWithSignature(
                    "transfer(address,uint256)", 0x7777777777777777777777777777777777777777, 50_000
                )
            )
        );
        vm.writeJson(out, "./test/fixtures/encoding.json");
    }
}
