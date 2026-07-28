// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {MapaeDelegationManager} from "../../src/MapaeDelegationManager.sol";
import {MapaeAccount} from "../../src/MapaeAccount.sol";
import {MapaeAccountFactory} from "../../src/MapaeAccountFactory.sol";
import {DojangVerifiedEnforcer, IMapaeAccountRegistry} from "../../src/enforcers/DojangVerifiedEnforcer.sol";
import {AllowedPayeeEnforcer} from "../../src/enforcers/AllowedPayeeEnforcer.sol";
import {ERC20PeriodTransferEnforcer} from "../../src/enforcers/ERC20PeriodTransferEnforcer.sol";
import {TimestampEnforcer} from "../../src/enforcers/TimestampEnforcer.sol";
import {MockDojangScroll} from "../../src/mocks/MockDojangScroll.sol";
import {MockKRW} from "../../src/mocks/MockKRW.sol";
import {IDojangScroll} from "../../src/interfaces/IDojangScroll.sol";
import {Delegation, Caveat} from "../../src/utils/Types.sol";
import {ROOT_AUTHORITY} from "../../src/utils/Constants.sol";
import {EncoderLib} from "../../src/libraries/EncoderLib.sol";
import {ExecutionLib} from "../../src/libraries/ExecutionLib.sol";
import {ModeLib} from "../../src/libraries/ModeLib.sol";

/// @title EndToEndTest
/// @notice The full demo scenario, T1-T8, run locally through the real manager with all four
///         caveats live at once. Every assertion here is re-run as a real transaction on GIWA
///         Sepolia by scripts/demo.ts; this suite is the rehearsal that makes those transactions
///         boring.
///
///         The delegation under test: agent may pay MERCHANT up to ₩50,000/day from Alice's
///         account until +7d, and only while Alice holds a live Dojang attestation from the
///         faucet issuer.
contract EndToEndTest is Test {
    bytes32 internal constant FAUCET_ID = keccak256("dojang.dojangattesterids.testnetfaucet");
    bytes32 internal constant UID = keccak256("uid-1");

    MapaeDelegationManager internal manager;
    MapaeAccountFactory internal factory;
    MapaeAccount internal account;
    DojangVerifiedEnforcer internal dojangEnforcer;
    AllowedPayeeEnforcer internal payeeEnforcer;
    ERC20PeriodTransferEnforcer internal periodEnforcer;
    TimestampEnforcer internal timestampEnforcer;
    MockDojangScroll internal scroll;
    MockKRW internal krw;

    Vm.Wallet internal alice; // principal - holds the identity, signs the delegation
    Vm.Wallet internal agent; // delegate - redeems
    address internal merchant = address(0xCAFE);
    address internal attacker = address(0xBAD);

    /// @dev A struct containing `Caveat[]` cannot be copied to storage on the legacy pipeline
    ///      (and via_ir is deliberately off), so the signed delegation is rebuilt per test from
    ///      this pinned timestamp - identical inputs, identical hash, identical signature.
    uint256 internal setupTime;
    bytes32 internal delegationHash;
    /// @dev Cached so `_signDelegation` makes no external call. An external call inside a signing
    ///      helper silently consumes an armed `vm.expectRevert` or `vm.prank` - the same trap
    ///      this suite already hit twice with inline `fee()` and `creationDigest` calls.
    bytes32 internal domainHash;

    function setUp() public {
        vm.warp(1_753_770_000);
        setupTime = block.timestamp;

        scroll = new MockDojangScroll();
        manager = new MapaeDelegationManager();
        factory = new MapaeAccountFactory(address(manager));
        dojangEnforcer = new DojangVerifiedEnforcer(
            IDojangScroll(address(scroll)), IMapaeAccountRegistry(address(factory))
        );
        payeeEnforcer = new AllowedPayeeEnforcer();
        periodEnforcer = new ERC20PeriodTransferEnforcer();
        timestampEnforcer = new TimestampEnforcer();
        krw = new MockKRW();

        alice = vm.createWallet("alice");
        agent = vm.createWallet("agent");

        // Setup mirrors the live demo: create the account, fund it, attest the PRINCIPAL (not the
        // account - Upbit would never attest a contract), sign the delegation.
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alice.privateKey, factory.creationDigest(alice.addr, 0));
        account = factory.createAccount(alice.addr, 0, abi.encodePacked(r, s, v));

        krw.mint(address(account), 1_000_000);
        scroll.issue(alice.addr, FAUCET_ID, UID, 0);

        delegationHash = EncoderLib._getDelegationHash(_demoDelegation());
        domainHash = manager.getDomainHash();
    }

    /// @dev Rebuilds and signs the canonical demo delegation. Deterministic across warps because
    ///      every time-dependent term is anchored to `setupTime`.
    function _signedDemo() internal returns (Delegation memory) {
        return _signDelegation(_demoDelegation());
    }

    /* -------------------------------------------------------------------------- */
    /*                              T1-T4: scope works                             */
    /* -------------------------------------------------------------------------- */

    /// @notice T1 - an authorised payment inside every bound succeeds.
    function test_T1_AuthorizedPayment_Succeeds() public {
        _redeem(_signedDemo(), merchant, 30_000);
        assertEq(krw.balanceOf(merchant), 30_000);
        assertEq(krw.balanceOf(address(account)), 970_000);
    }

    /// @notice T2 - the second payment breaching the daily cap is rejected ON-CHAIN.
    function test_T2_OverCap_Reverts() public {
        _redeem(_signedDemo(), merchant, 30_000);

        vm.expectRevert("ERC20PeriodTransferEnforcer:transfer-amount-exceeded");
        _redeem(_signedDemo(), merchant, 30_000);

        // And the merchant received nothing further.
        assertEq(krw.balanceOf(merchant), 30_000);
    }

    /// @notice T3 - scope is not only about amounts: an unlisted payee is rejected.
    function test_T3_UnlistedPayee_Reverts() public {
        vm.expectRevert(abi.encodeWithSelector(AllowedPayeeEnforcer.PayeeNotAllowed.selector, attacker));
        _redeem(_signedDemo(), attacker, 10_000);
        assertEq(krw.balanceOf(attacker), 0);
    }

    /// @notice T4 - the identity gate discriminates by ISSUER. Alice holds a faucet attestation;
    ///         a delegation demanding an Upbit one fails.
    function test_T4_WrongIssuer_Reverts() public {
        bytes32 upbitId = keccak256("dojang.dojangattesterids.upbitkorea");
        Delegation memory d = _demoDelegation();
        d.caveats[0].terms = abi.encodePacked(upbitId, alice.addr);
        Delegation memory signed_ = _signDelegation(d);

        vm.expectRevert(
            abi.encodeWithSelector(DojangVerifiedEnforcer.NotDojangVerified.selector, alice.addr, upbitId)
        );
        _redeem(signed_, merchant, 10_000);
    }

    /* -------------------------------------------------------------------------- */
    /*                    T5-T8: the 2x2 kill-switch matrix                        */
    /* -------------------------------------------------------------------------- */

    /// @notice T5 - the delegation kill switch, alone. Identity stays LIVE; disabling the
    ///         delegation is what blocks, and it surfaces its own error.
    function test_T5_DisableDelegation_BlocksWhileIdentityLive() public {
        vm.prank(alice.addr);
        account.execute(
            ModeLib.encodeSimpleSingle(),
            ExecutionLib.encodeSingle(
                address(manager), 0, abi.encodeCall(MapaeDelegationManager.disableDelegation, (_signedDemo()))
            )
        );

        assertTrue(scroll.isVerified(alice.addr, FAUCET_ID), "precondition: identity must be live");
        vm.expectRevert(MapaeDelegationManager.CannotUseADisabledDelegation.selector);
        _redeem(_signedDemo(), merchant, 10_000);
    }

    /// @notice T6 - disabling is reversible, and touching it never touched the identity.
    function test_T6_ReenableDelegation_RestoresPayment() public {
        vm.prank(alice.addr);
        account.execute(
            ModeLib.encodeSimpleSingle(),
            ExecutionLib.encodeSingle(
                address(manager), 0, abi.encodeCall(MapaeDelegationManager.disableDelegation, (_signedDemo()))
            )
        );
        vm.prank(alice.addr);
        account.execute(
            ModeLib.encodeSimpleSingle(),
            ExecutionLib.encodeSingle(
                address(manager), 0, abi.encodeCall(MapaeDelegationManager.enableDelegation, (_signedDemo()))
            )
        );

        _redeem(_signedDemo(), merchant, 10_000);
        assertEq(krw.balanceOf(merchant), 10_000);
    }

    /// @notice T7 - THE thesis. Signature valid, cap unspent, window open, payee allowed,
    ///         delegation enabled - and the payment still dies, purely because the real-world
    ///         identity attestation was revoked. No transaction touched Mapae.
    function test_T7_IdentityRevocation_KillsPayment() public {
        assertFalse(manager.disabledDelegations(delegationHash), "precondition: delegation enabled");

        scroll.revoke(alice.addr, FAUCET_ID);

        vm.expectRevert(
            abi.encodeWithSelector(DojangVerifiedEnforcer.NotDojangVerified.selector, alice.addr, FAUCET_ID)
        );
        _redeem(_signedDemo(), merchant, 10_000);
    }

    /// @notice T8 - identity revocation is also reversible, and never touched the delegation.
    function test_T8_Reissuance_RestoresPayment() public {
        scroll.revoke(alice.addr, FAUCET_ID);
        scroll.issue(alice.addr, FAUCET_ID, keccak256("uid-2"), 0);

        _redeem(_signedDemo(), merchant, 10_000);
        assertEq(krw.balanceOf(merchant), 10_000);
    }

    /// @notice The full 2x2: each switch blocks alone, and when BOTH are thrown the manager's
    ///         disabled check wins because chain validation runs before any caveat. That ordering
    ///         is why the demo can exercise the switches in any order without the errors bleeding
    ///         into each other.
    function test_KillSwitches_AreOrthogonal() public {
        // (disabled, revoked) -> disabled error wins.
        vm.prank(alice.addr);
        account.execute(
            ModeLib.encodeSimpleSingle(),
            ExecutionLib.encodeSingle(
                address(manager), 0, abi.encodeCall(MapaeDelegationManager.disableDelegation, (_signedDemo()))
            )
        );
        scroll.revoke(alice.addr, FAUCET_ID);

        vm.expectRevert(MapaeDelegationManager.CannotUseADisabledDelegation.selector);
        _redeem(_signedDemo(), merchant, 10_000);

        // Restore identity only: still the disabled error.
        scroll.issue(alice.addr, FAUCET_ID, keccak256("uid-3"), 0);
        vm.expectRevert(MapaeDelegationManager.CannotUseADisabledDelegation.selector);
        _redeem(_signedDemo(), merchant, 10_000);

        // Re-enable delegation, revoke identity again: now the identity error.
        vm.prank(alice.addr);
        account.execute(
            ModeLib.encodeSimpleSingle(),
            ExecutionLib.encodeSingle(
                address(manager), 0, abi.encodeCall(MapaeDelegationManager.enableDelegation, (_signedDemo()))
            )
        );
        scroll.revoke(alice.addr, FAUCET_ID);
        vm.expectRevert(
            abi.encodeWithSelector(DojangVerifiedEnforcer.NotDojangVerified.selector, alice.addr, FAUCET_ID)
        );
        _redeem(_signedDemo(), merchant, 10_000);

        // Both restored: payment flows.
        scroll.issue(alice.addr, FAUCET_ID, keccak256("uid-4"), 0);
        _redeem(_signedDemo(), merchant, 10_000);
        assertEq(krw.balanceOf(merchant), 10_000);
    }

    /* -------------------------------------------------------------------------- */
    /*                          Chain-integrity negatives                          */
    /* -------------------------------------------------------------------------- */

    /// @notice Only the named delegate may redeem.
    function test_RevertWhen_RedeemerIsNotTheDelegate() public {
        (bytes[] memory ctx, bytes32[] memory modes, bytes[] memory execs) =
            _redemptionArgs(_signedDemo(), merchant, 10_000);

        vm.prank(attacker);
        vm.expectRevert(MapaeDelegationManager.InvalidDelegate.selector);
        manager.redeemDelegations(ctx, modes, execs);
    }

    /// @notice A tampered signature is rejected on the ERC-1271 path.
    function test_RevertWhen_SignatureForged() public {
        Delegation memory d = _demoDelegation();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            agent.privateKey, // wrong signer
            MessageHashUtils.toTypedDataHash(manager.getDomainHash(), EncoderLib._getDelegationHash(d))
        );
        d.signature = abi.encodePacked(r, s, v);

        (bytes[] memory ctx, bytes32[] memory modes, bytes[] memory execs) =
            _redemptionArgs(d, merchant, 10_000);
        vm.prank(agent.addr);
        vm.expectRevert(MapaeDelegationManager.InvalidERC1271Signature.selector);
        manager.redeemDelegations(ctx, modes, execs);
    }

    /// @notice Expiry via the timestamp caveat, distinct from identity expiry.
    function test_RevertWhen_DelegationWindowExpired() public {
        vm.warp(block.timestamp + 8 days);
        vm.expectRevert("TimestampEnforcer:expired-delegation");
        _redeem(_signedDemo(), merchant, 10_000);
    }

    /// @notice ERC-7710 batch atomicity: if the second item fails, the first item's transfer must
    ///         roll back - no partial settlement.
    function test_BatchAtomicity_SecondFailureRollsBackFirst() public {
        bytes[] memory ctx = new bytes[](2);
        bytes32[] memory modes = new bytes32[](2);
        bytes[] memory execs = new bytes[](2);

        Delegation[] memory chain = new Delegation[](1);
        chain[0] = _signedDemo();
        ctx[0] = abi.encode(chain);
        ctx[1] = abi.encode(chain);
        modes[0] = bytes32(0);
        modes[1] = bytes32(0);
        execs[0] = _transferExec(merchant, 30_000);
        execs[1] = _transferExec(attacker, 1); // fails on the payee caveat

        vm.prank(agent.addr);
        vm.expectRevert(abi.encodeWithSelector(AllowedPayeeEnforcer.PayeeNotAllowed.selector, attacker));
        manager.redeemDelegations(ctx, modes, execs);

        assertEq(krw.balanceOf(merchant), 0, "first item must roll back");
    }

    /* -------------------------------------------------------------------------- */
    /*                                   Helpers                                   */
    /* -------------------------------------------------------------------------- */

    function _demoDelegation() internal view returns (Delegation memory d) {
        Caveat[] memory caveats = new Caveat[](4);
        // Order mirrors the live demo: identity first - it is the reason the rest exist.
        caveats[0] = Caveat({
            enforcer: address(dojangEnforcer), terms: abi.encodePacked(FAUCET_ID, alice.addr), args: ""
        });
        caveats[1] = Caveat({
            enforcer: address(periodEnforcer),
            terms: abi.encodePacked(address(krw), uint256(50_000), uint256(1 days), setupTime),
            args: ""
        });
        caveats[2] = Caveat({enforcer: address(payeeEnforcer), terms: abi.encodePacked(merchant), args: ""});
        caveats[3] = Caveat({
            enforcer: address(timestampEnforcer),
            terms: abi.encodePacked(uint128(0), uint128(setupTime + 7 days)),
            args: ""
        });

        d = Delegation({
            delegate: agent.addr,
            delegator: address(account),
            authority: ROOT_AUTHORITY,
            caveats: caveats,
            salt: 1,
            signature: ""
        });
    }

    /// @dev Alice signs for the account; the manager validates via the account's ERC-1271, which
    ///      recognises exactly her key.
    function _signDelegation(Delegation memory d) internal returns (Delegation memory) {
        bytes32 typed_ = MessageHashUtils.toTypedDataHash(domainHash, EncoderLib._getDelegationHash(d));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alice.privateKey, typed_);
        d.signature = abi.encodePacked(r, s, v);
        return d;
    }

    function _transferExec(address to, uint256 amount) internal view returns (bytes memory) {
        return ExecutionLib.encodeSingle(
            address(krw), 0, abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
    }

    function _redemptionArgs(Delegation memory d, address to, uint256 amount)
        internal
        view
        returns (bytes[] memory ctx, bytes32[] memory modes, bytes[] memory execs)
    {
        Delegation[] memory chain = new Delegation[](1);
        chain[0] = d;
        ctx = new bytes[](1);
        ctx[0] = abi.encode(chain);
        modes = new bytes32[](1);
        modes[0] = bytes32(0); // simple single, default exec
        execs = new bytes[](1);
        execs[0] = _transferExec(to, amount);
    }

    function _redeem(Delegation memory d, address to, uint256 amount) internal {
        (bytes[] memory ctx, bytes32[] memory modes, bytes[] memory execs) = _redemptionArgs(d, to, amount);
        vm.prank(agent.addr);
        manager.redeemDelegations(ctx, modes, execs);
    }
}
