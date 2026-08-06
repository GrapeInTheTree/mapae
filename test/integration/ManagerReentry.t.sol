// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {MapaeDelegationManager} from "../../src/MapaeDelegationManager.sol";
import {MapaeAccount} from "../../src/MapaeAccount.sol";
import {MapaeAccountFactory} from "../../src/MapaeAccountFactory.sol";
import {DojangVerifiedEnforcer, IMapaeAccountRegistry} from "../../src/enforcers/DojangVerifiedEnforcer.sol";
import {MockDojangScroll} from "../../src/mocks/MockDojangScroll.sol";
import {MockKRW} from "../../src/mocks/MockKRW.sol";
import {IDojangScroll} from "../../src/interfaces/IDojangScroll.sol";
import {Delegation, Caveat} from "../../src/utils/Types.sol";
import {ROOT_AUTHORITY} from "../../src/utils/Constants.sol";
import {EncoderLib} from "../../src/libraries/EncoderLib.sol";
import {ExecutionLib} from "../../src/libraries/ExecutionLib.sol";
import {ModeLib} from "../../src/libraries/ModeLib.sol";
import {ModeCode} from "../../src/utils/Types.sol";

/// @notice Can a delegate turn the account's own authority back against the manager?
///
/// @dev The execution a redemption performs is NOT part of what the delegator signed - it is
///      supplied as calldata at redemption time, and only the caveats stand between a delegate
///      and an arbitrary call made *as the account*. Since the account is the delegator, any
///      manager function gated on `msg.sender == delegator` is reachable that way, and
///      `enableDelegation` is exactly such a function. If a delegate could reach it, a delegate
///      could undo the kill switch - the guarantee this whole system is built to make.
///
///      The tests below take the most permissive delegation this system can issue (identity
///      alone, since the identity caveat is the one condition the Composer never lets you remove)
///      and try it from both directions.
contract ManagerReentryTest is Test {
    bytes32 internal constant ATTESTER = keccak256("dojang.dojangattesterids.testnetfaucet");

    MapaeDelegationManager internal manager;
    MapaeAccountFactory internal factory;
    MapaeAccount internal account;
    DojangVerifiedEnforcer internal dojang;
    MockDojangScroll internal scroll;
    MockKRW internal krw;

    Vm.Wallet internal alice;
    address internal agent = address(0xA9E17);

    bytes32 internal domainHash;

    function setUp() public {
        alice = vm.createWallet("alice");
        scroll = new MockDojangScroll();
        krw = new MockKRW();
        manager = new MapaeDelegationManager();
        factory = new MapaeAccountFactory(address(manager));
        dojang = new DojangVerifiedEnforcer(IDojangScroll(address(scroll)), IMapaeAccountRegistry(address(factory)));

        domainHash = manager.getDomainHash();
        scroll.issue(alice.addr, ATTESTER, keccak256("uid"), 0);

        bytes32 digest_ = factory.creationDigest(alice.addr, 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alice.privateKey, digest_);
        account = MapaeAccount(payable(factory.createAccount(alice.addr, 0, abi.encodePacked(r, s, v))));
        krw.mint(address(account), 1_000_000);
    }

    /// @notice A delegate cannot re-enable a delegation the principal switched off.
    function test_Delegate_CannotReEnableThroughTheAccount() public {
        Delegation memory victim_ = _identityOnly(agent, 1);
        Delegation memory weapon_ = _identityOnly(agent, 2);

        vm.prank(address(account));
        manager.disableDelegation(victim_);
        assertTrue(manager.disabledDelegations(EncoderLib._getDelegationHash(victim_)), "kill switch set");

        // The execution targets the MANAGER, not a token: enableDelegation(victim). Routed through
        // the account it would arrive with msg.sender == the delegator the manager checks for.
        bytes memory exec_ = ExecutionLib.encodeSingle(
            address(manager), 0, abi.encodeWithSelector(MapaeDelegationManager.enableDelegation.selector, victim_)
        );

        vm.prank(agent);
        vm.expectRevert();
        manager.redeemDelegations(_ctx(weapon_), _modes(), _execs(exec_));

        assertTrue(
            manager.disabledDelegations(EncoderLib._getDelegationHash(victim_)),
            "a disabled delegation must stay disabled"
        );
    }

    /// @notice The same attempt aimed at the account itself, which is where a manager whose
    ///         account permits self-calls would hand over deposits, upgrades and re-enablement.
    function test_Delegate_CannotDriveTheAccountAgainstItself() public {
        Delegation memory weapon_ = _identityOnly(agent, 3);

        bytes memory exec_ = ExecutionLib.encodeSingle(
            address(account),
            0,
            abi.encodeWithSelector(
                MapaeAccount.execute.selector,
                ModeLib.encodeSimpleSingle(),
                ExecutionLib.encodeSingle(address(krw), 0, abi.encodeWithSignature("transfer(address,uint256)", agent, uint256(1_000_000)))
            )
        );

        vm.prank(agent);
        vm.expectRevert();
        manager.redeemDelegations(_ctx(weapon_), _modes(), _execs(exec_));

        assertEq(krw.balanceOf(address(account)), 1_000_000, "funds must not move");
        assertEq(krw.balanceOf(agent), 0, "the delegate must not be paid");
    }

    /* ------------------------------------ helpers ----------------------------------- */

    /// The widest delegation this system can issue: identity, and nothing else.
    function _identityOnly(address delegate_, uint256 salt_) internal returns (Delegation memory) {
        Caveat[] memory caveats_ = new Caveat[](1);
        caveats_[0] = Caveat({
            enforcer: address(dojang),
            terms: abi.encodePacked(ATTESTER, alice.addr),
            args: ""
        });
        Delegation memory d_ = Delegation({
            delegate: delegate_,
            delegator: address(account),
            authority: ROOT_AUTHORITY,
            caveats: caveats_,
            salt: salt_,
            signature: ""
        });
        bytes32 typed_ = MessageHashUtils.toTypedDataHash(domainHash, EncoderLib._getDelegationHash(d_));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alice.privateKey, typed_);
        d_.signature = abi.encodePacked(r, s, v);
        return d_;
    }

    function _ctx(Delegation memory d_) internal pure returns (bytes[] memory ctx_) {
        Delegation[] memory chain_ = new Delegation[](1);
        chain_[0] = d_;
        ctx_ = new bytes[](1);
        ctx_[0] = abi.encode(chain_);
    }

    function _modes() internal pure returns (bytes32[] memory modes_) {
        modes_ = new bytes32[](1);
        modes_[0] = ModeCode.unwrap(ModeLib.encodeSimpleSingle());
    }

    function _execs(bytes memory exec_) internal pure returns (bytes[] memory execs_) {
        execs_ = new bytes[](1);
        execs_[0] = exec_;
    }
}
