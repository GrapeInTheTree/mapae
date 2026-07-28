// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {DojangVerifiedEnforcer} from "../../src/enforcers/DojangVerifiedEnforcer.sol";
import {IMapaeAccountRegistry} from "../../src/enforcers/DojangVerifiedEnforcer.sol";
import {MockDojangScroll} from "../../src/mocks/MockDojangScroll.sol";
import {MapaeAccount} from "../../src/MapaeAccount.sol";
import {MapaeAccountFactory} from "../../src/MapaeAccountFactory.sol";
import {MapaeDelegationManager} from "../../src/MapaeDelegationManager.sol";
import {IDojangScroll} from "../../src/interfaces/IDojangScroll.sol";
import {ModeCode} from "../../src/utils/Types.sol";
import {ModeLib} from "../../src/libraries/ModeLib.sol";

/// @dev An attacker contract that reports whatever owner it likes - the forgery the factory
///      registry exists to defeat.
contract FakeAccount {
    address public owner;

    constructor(address _owner) {
        owner = _owner;
    }
}

/// @title DojangVerifiedEnforcerTest
/// @notice Exhaustive unit coverage of the contribution, against a mock whose behaviour the fork
///         suite proves faithful to the deployed DojangScroll.
contract DojangVerifiedEnforcerTest is Test {
    bytes32 internal constant UPBIT_ID = keccak256("dojang.dojangattesterids.upbitkorea");
    bytes32 internal constant FAUCET_ID = keccak256("dojang.dojangattesterids.testnetfaucet");
    bytes32 internal constant UID = keccak256("attestation-uid-1");
    bytes32 internal constant DELEGATION_HASH = keccak256("delegation-hash");

    MockDojangScroll internal scroll;
    MapaeDelegationManager internal manager;
    MapaeAccountFactory internal factory;
    DojangVerifiedEnforcer internal enforcer;

    Vm.Wallet internal alice; // principal
    Vm.Wallet internal mallory; // attacker
    address internal agent = address(0xA6E27);

    ModeCode internal mode;

    function setUp() public {
        scroll = new MockDojangScroll();
        manager = new MapaeDelegationManager();
        factory = new MapaeAccountFactory(address(manager));
        enforcer = new DojangVerifiedEnforcer(
            IDojangScroll(address(scroll)), IMapaeAccountRegistry(address(factory))
        );

        alice = vm.createWallet("alice");
        mallory = vm.createWallet("mallory");
        mode = ModeLib.encodeSimpleSingle();
    }

    /* -------------------------------------------------------------------------- */
    /*                                 Happy paths                                 */
    /* -------------------------------------------------------------------------- */

    /// @notice EOA path: the principal is the delegator itself.
    function test_EoaPath_VerifiedPrincipal_Passes() public {
        scroll.issue(alice.addr, FAUCET_ID, UID, 0);

        vm.expectEmit(true, true, true, true, address(enforcer));
        emit DojangVerifiedEnforcer.DojangGatePassed(
            address(this), DELEGATION_HASH, alice.addr, alice.addr, FAUCET_ID, UID
        );
        enforcer.beforeHook(_terms(FAUCET_ID, alice.addr), "", mode, "", DELEGATION_HASH, alice.addr, agent);
    }

    /// @notice Smart-account path: the delegator is a factory-made account owned by the principal.
    function test_AccountPath_VerifiedOwner_Passes() public {
        MapaeAccount account = _accountFor(alice);
        scroll.issue(alice.addr, FAUCET_ID, UID, 0);

        vm.expectEmit(true, true, true, true, address(enforcer));
        emit DojangVerifiedEnforcer.DojangGatePassed(
            address(this), DELEGATION_HASH, alice.addr, address(account), FAUCET_ID, UID
        );
        enforcer.beforeHook(
            _terms(FAUCET_ID, alice.addr), "", mode, "", DELEGATION_HASH, address(account), agent
        );
    }

    /* -------------------------------------------------------------------------- */
    /*                              Liveness failures                              */
    /* -------------------------------------------------------------------------- */

    function test_RevertWhen_PrincipalNeverAttested() public {
        vm.expectRevert(
            abi.encodeWithSelector(DojangVerifiedEnforcer.NotDojangVerified.selector, alice.addr, FAUCET_ID)
        );
        enforcer.beforeHook(_terms(FAUCET_ID, alice.addr), "", mode, "", DELEGATION_HASH, alice.addr, agent);
    }

    /// @notice The kill switch the delegation manager never sees: revoke the attestation and the
    ///         gate closes, with no Mapae-side transaction.
    function test_RevertWhen_AttestationRevoked() public {
        scroll.issue(alice.addr, FAUCET_ID, UID, 0);
        enforcer.beforeHook(_terms(FAUCET_ID, alice.addr), "", mode, "", DELEGATION_HASH, alice.addr, agent);

        scroll.revoke(alice.addr, FAUCET_ID);

        vm.expectRevert(
            abi.encodeWithSelector(DojangVerifiedEnforcer.NotDojangVerified.selector, alice.addr, FAUCET_ID)
        );
        enforcer.beforeHook(_terms(FAUCET_ID, alice.addr), "", mode, "", DELEGATION_HASH, alice.addr, agent);
    }

    /// @notice The second liveness axis, inherited for free by checking at redemption: expiry.
    function test_RevertWhen_AttestationExpired() public {
        scroll.issue(alice.addr, FAUCET_ID, UID, uint64(block.timestamp + 30 days));
        enforcer.beforeHook(_terms(FAUCET_ID, alice.addr), "", mode, "", DELEGATION_HASH, alice.addr, agent);

        vm.warp(block.timestamp + 31 days);

        vm.expectRevert(
            abi.encodeWithSelector(DojangVerifiedEnforcer.NotDojangVerified.selector, alice.addr, FAUCET_ID)
        );
        enforcer.beforeHook(_terms(FAUCET_ID, alice.addr), "", mode, "", DELEGATION_HASH, alice.addr, agent);
    }

    /// @notice Re-issuance reopens the gate: identity revocation is reversible without touching
    ///         the delegation. One axis of the demo's 2x2 kill-switch matrix.
    function test_ReissuanceReopensTheGate() public {
        scroll.issue(alice.addr, FAUCET_ID, UID, 0);
        scroll.revoke(alice.addr, FAUCET_ID);
        vm.expectRevert(
            abi.encodeWithSelector(DojangVerifiedEnforcer.NotDojangVerified.selector, alice.addr, FAUCET_ID)
        );
        enforcer.beforeHook(_terms(FAUCET_ID, alice.addr), "", mode, "", DELEGATION_HASH, alice.addr, agent);

        bytes32 newUid = keccak256("attestation-uid-2");
        scroll.issue(alice.addr, FAUCET_ID, newUid, 0);

        vm.expectEmit(true, true, true, true, address(enforcer));
        emit DojangVerifiedEnforcer.DojangGatePassed(
            address(this), DELEGATION_HASH, alice.addr, alice.addr, FAUCET_ID, newUid
        );
        enforcer.beforeHook(_terms(FAUCET_ID, alice.addr), "", mode, "", DELEGATION_HASH, alice.addr, agent);
    }

    /* -------------------------------------------------------------------------- */
    /*                           Issuer discrimination                             */
    /* -------------------------------------------------------------------------- */

    /// @notice A delegation scoped to Upbit cannot be satisfied by a faucet attestation.
    /// @dev This is what makes the caveat meaningful: the issuer is signed, not assumed.
    function test_RevertWhen_VerifiedUnderDifferentIssuer() public {
        scroll.issue(alice.addr, FAUCET_ID, UID, 0);

        vm.expectRevert(
            abi.encodeWithSelector(DojangVerifiedEnforcer.NotDojangVerified.selector, alice.addr, UPBIT_ID)
        );
        enforcer.beforeHook(_terms(UPBIT_ID, alice.addr), "", mode, "", DELEGATION_HASH, alice.addr, agent);
    }

    /* -------------------------------------------------------------------------- */
    /*                                  Forgery                                    */
    /* -------------------------------------------------------------------------- */

    /// @notice An unregistered contract claiming a verified owner is refused BEFORE its owner()
    ///         is ever trusted.
    function test_RevertWhen_DelegatorIsNotAFactoryAccount() public {
        scroll.issue(alice.addr, FAUCET_ID, UID, 0);
        FakeAccount fake = new FakeAccount(alice.addr);

        vm.expectRevert(abi.encodeWithSelector(DojangVerifiedEnforcer.UnknownAccount.selector, address(fake)));
        enforcer.beforeHook(
            _terms(FAUCET_ID, alice.addr), "", mode, "", DELEGATION_HASH, address(fake), agent
        );
    }

    /// @notice A genuine account cannot be gated under someone else's identity.
    function test_RevertWhen_TermsNamePrincipalOtherThanOwner() public {
        MapaeAccount account = _accountFor(mallory);
        scroll.issue(alice.addr, FAUCET_ID, UID, 0);

        vm.expectRevert(
            abi.encodeWithSelector(
                DojangVerifiedEnforcer.PrincipalMismatch.selector, address(account), alice.addr, mallory.addr
            )
        );
        enforcer.beforeHook(
            _terms(FAUCET_ID, alice.addr), "", mode, "", DELEGATION_HASH, address(account), agent
        );
    }

    /* -------------------------------------------------------------------------- */
    /*                                Terms shape                                  */
    /* -------------------------------------------------------------------------- */

    function test_RevertWhen_TermsWrongLength() public {
        uint256[3] memory bad = [uint256(0), 51, 53];
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(
                abi.encodeWithSelector(DojangVerifiedEnforcer.InvalidTermsLength.selector, bad[i])
            );
            enforcer.beforeHook(new bytes(bad[i]), "", mode, "", DELEGATION_HASH, alice.addr, agent);
        }
    }

    function testFuzz_GetTermsInfo_RoundTrip(bytes32 attesterId, address principal) public view {
        (bytes32 a, address p) = enforcer.getTermsInfo(abi.encodePacked(attesterId, principal));
        assertEq(a, attesterId);
        assertEq(p, principal);
    }

    function test_RevertWhen_ConstructedWithZeroAddresses() public {
        vm.expectRevert(DojangVerifiedEnforcer.ZeroAddressArg.selector);
        new DojangVerifiedEnforcer(IDojangScroll(address(0)), IMapaeAccountRegistry(address(factory)));

        vm.expectRevert(DojangVerifiedEnforcer.ZeroAddressArg.selector);
        new DojangVerifiedEnforcer(IDojangScroll(address(scroll)), IMapaeAccountRegistry(address(0)));
    }

    /* -------------------------------------------------------------------------- */
    /*                                   Helpers                                   */
    /* -------------------------------------------------------------------------- */

    function _terms(bytes32 attesterId, address principal) internal pure returns (bytes memory) {
        return abi.encodePacked(attesterId, principal);
    }

    function _accountFor(Vm.Wallet memory w) internal returns (MapaeAccount) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(w.privateKey, factory.creationDigest(w.addr, 0));
        return factory.createAccount(w.addr, 0, abi.encodePacked(r, s, v));
    }
}
