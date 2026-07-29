// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";

import {VerifiedCodeEnforcer} from "../../src/enforcers/VerifiedCodeEnforcer.sol";
import {MockDojangScroll} from "../../src/mocks/MockDojangScroll.sol";
import {IDojangScroll} from "../../src/interfaces/IDojangScroll.sol";
import {ModeCode} from "../../src/utils/Types.sol";
import {ModeLib} from "../../src/libraries/ModeLib.sol";

/// @title VerifiedCodeEnforcerTest
/// @notice The human-in-the-loop gate: a delegation redeems only while a live off-chain
///         confirmation, attested by the signed issuer under the signed domain, stands.
contract VerifiedCodeEnforcerTest is Test {
    bytes32 internal constant UPBIT_ID = keccak256("dojang.dojangattesterids.upbitkorea");
    bytes32 internal constant OTHER_ID = keccak256("dojang.dojangattesterids.testnetfaucet");
    bytes32 internal constant DELEGATION_HASH = keccak256("delegation-hash");
    bytes32 internal constant CODE_HASH = keccak256("otp-123456");
    string internal constant DOMAIN = "pay.mapae.example";

    MockDojangScroll internal scroll;
    VerifiedCodeEnforcer internal enforcer;
    address internal agent = address(0xA6E27);
    ModeCode internal mode;

    function setUp() public {
        vm.warp(1_753_770_000);
        scroll = new MockDojangScroll();
        enforcer = new VerifiedCodeEnforcer(IDojangScroll(address(scroll)));
        mode = ModeLib.encodeSimpleSingle();
    }

    function test_LiveConfirmation_Passes() public {
        scroll.issueCode(CODE_HASH, DOMAIN, UPBIT_ID, uint64(block.timestamp + 10 minutes));

        vm.expectEmit(true, true, true, true, address(enforcer));
        emit VerifiedCodeEnforcer.VerifiedCodeGatePassed(
            address(this), DELEGATION_HASH, CODE_HASH, agent, UPBIT_ID, DOMAIN
        );
        enforcer.beforeHook(
            _terms(UPBIT_ID, DOMAIN), _args(CODE_HASH), mode, "", DELEGATION_HASH, address(0), agent
        );
    }

    /// @notice The freshness property: confirmations expire on Dojang's clock, so "a person
    ///         confirmed recently" is enforced by the attestation lifetime, not by trusting
    ///         the agent.
    function test_RevertWhen_ConfirmationExpired() public {
        scroll.issueCode(CODE_HASH, DOMAIN, UPBIT_ID, uint64(block.timestamp + 10 minutes));
        enforcer.beforeHook(
            _terms(UPBIT_ID, DOMAIN), _args(CODE_HASH), mode, "", DELEGATION_HASH, address(0), agent
        );

        vm.warp(block.timestamp + 11 minutes);

        vm.expectRevert(
            abi.encodeWithSelector(VerifiedCodeEnforcer.CodeNotVerified.selector, CODE_HASH, DOMAIN, UPBIT_ID)
        );
        enforcer.beforeHook(
            _terms(UPBIT_ID, DOMAIN), _args(CODE_HASH), mode, "", DELEGATION_HASH, address(0), agent
        );
    }

    function test_RevertWhen_ConfirmationRevoked() public {
        scroll.issueCode(CODE_HASH, DOMAIN, UPBIT_ID, 0);
        scroll.revokeCode(CODE_HASH, DOMAIN, UPBIT_ID);

        vm.expectRevert(
            abi.encodeWithSelector(VerifiedCodeEnforcer.CodeNotVerified.selector, CODE_HASH, DOMAIN, UPBIT_ID)
        );
        enforcer.beforeHook(
            _terms(UPBIT_ID, DOMAIN), _args(CODE_HASH), mode, "", DELEGATION_HASH, address(0), agent
        );
    }

    /// @notice Args are unsigned, and that is sound: the redeemer can only POINT at a
    ///         confirmation, never conjure one. A hash with no live attestation reverts.
    function test_RevertWhen_RedeemerInventsACodeHash() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                VerifiedCodeEnforcer.CodeNotVerified.selector, keccak256("made-up"), DOMAIN, UPBIT_ID
            )
        );
        enforcer.beforeHook(
            _terms(UPBIT_ID, DOMAIN),
            _args(keccak256("made-up")),
            mode,
            "",
            DELEGATION_HASH,
            address(0),
            agent
        );
    }

    /// @notice The issuer is signed: a confirmation attested by a different issuer does not count.
    function test_RevertWhen_ConfirmationFromDifferentIssuer() public {
        scroll.issueCode(CODE_HASH, DOMAIN, OTHER_ID, 0);

        vm.expectRevert(
            abi.encodeWithSelector(VerifiedCodeEnforcer.CodeNotVerified.selector, CODE_HASH, DOMAIN, UPBIT_ID)
        );
        enforcer.beforeHook(
            _terms(UPBIT_ID, DOMAIN), _args(CODE_HASH), mode, "", DELEGATION_HASH, address(0), agent
        );
    }

    /// @notice The domain is signed: a confirmation for another service does not count.
    function test_RevertWhen_ConfirmationForDifferentDomain() public {
        scroll.issueCode(CODE_HASH, "other.example", UPBIT_ID, 0);

        vm.expectRevert(
            abi.encodeWithSelector(VerifiedCodeEnforcer.CodeNotVerified.selector, CODE_HASH, DOMAIN, UPBIT_ID)
        );
        enforcer.beforeHook(
            _terms(UPBIT_ID, DOMAIN), _args(CODE_HASH), mode, "", DELEGATION_HASH, address(0), agent
        );
    }

    function test_RevertWhen_TermsTooShort() public {
        // 32 bytes = issuer only, empty domain: deny by default.
        vm.expectRevert(abi.encodeWithSelector(VerifiedCodeEnforcer.InvalidTermsLength.selector, 32));
        enforcer.beforeHook(
            abi.encodePacked(UPBIT_ID), _args(CODE_HASH), mode, "", DELEGATION_HASH, address(0), agent
        );
    }

    function test_RevertWhen_ArgsWrongLength() public {
        scroll.issueCode(CODE_HASH, DOMAIN, UPBIT_ID, 0);
        vm.expectRevert(abi.encodeWithSelector(VerifiedCodeEnforcer.InvalidArgsLength.selector, 31));
        enforcer.beforeHook(
            _terms(UPBIT_ID, DOMAIN), new bytes(31), mode, "", DELEGATION_HASH, address(0), agent
        );
    }

    function test_RevertWhen_ConstructedWithZeroScroll() public {
        vm.expectRevert(VerifiedCodeEnforcer.ZeroAddressArg.selector);
        new VerifiedCodeEnforcer(IDojangScroll(address(0)));
    }

    function testFuzz_GetTermsInfo_RoundTrip(bytes32 attesterId, string calldata domain) public view {
        vm.assume(bytes(domain).length > 0);
        (bytes32 a, string memory d) = enforcer.getTermsInfo(abi.encodePacked(attesterId, domain));
        assertEq(a, attesterId);
        assertEq(d, domain);
    }

    function _terms(bytes32 attesterId, string memory domain) internal pure returns (bytes memory) {
        return abi.encodePacked(attesterId, domain);
    }

    function _args(bytes32 codeHash) internal pure returns (bytes memory) {
        return abi.encodePacked(codeHash);
    }
}
