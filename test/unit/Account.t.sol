// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

import {MapaeAccount} from "../../src/MapaeAccount.sol";
import {MapaeAccountFactory} from "../../src/MapaeAccountFactory.sol";
import {MapaeDelegationManager} from "../../src/MapaeDelegationManager.sol";
import {ModeCode, CallType, ExecType, ModePayload, ModeSelector} from "../../src/utils/Types.sol";
import {
    ModeLib,
    CALLTYPE_SINGLE,
    CALLTYPE_BATCH,
    CALLTYPE_DELEGATECALL,
    EXECTYPE_DEFAULT,
    EXECTYPE_TRY,
    MODE_DEFAULT
} from "../../src/libraries/ModeLib.sol";
import {ExecutionLib} from "../../src/libraries/ExecutionLib.sol";

/// @dev Minimal call target. `boom()` reverts with a custom error so revert bubbling is testable.
contract Target {
    error Boom(uint256 code);

    uint256 public value;
    uint256 public received;

    function setValue(uint256 v) external payable {
        value = v;
        received += msg.value;
    }

    function boom() external pure {
        revert Boom(7);
    }
}

/// @dev An owner that is itself a contract, approving via ERC-1271.
contract ContractOwner is IERC1271 {
    bytes32 public approved;

    function approve(bytes32 h) external {
        approved = h;
    }

    function isValidSignature(bytes32 h, bytes calldata) external view returns (bytes4) {
        return h == approved ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}

/// @title AccountAndFactoryTest
/// @notice Covers the identity binding that the whole accountability claim rests on, and the
///         execution shapes the account must refuse.
contract AccountAndFactoryTest is Test {
    MapaeDelegationManager internal manager;
    MapaeAccountFactory internal factory;
    Target internal target;

    Vm.Wallet internal alice;
    Vm.Wallet internal mallory;
    /// @dev Stands in for a real Upbit-verified person in the forgery test.
    Vm.Wallet internal victim;

    function setUp() public {
        manager = new MapaeDelegationManager();
        factory = new MapaeAccountFactory(address(manager));
        target = new Target();

        alice = vm.createWallet("alice");
        mallory = vm.createWallet("mallory");
        victim = vm.createWallet("victim");
    }

    /* -------------------------------------------------------------------------- */
    /*                          Identity binding / forgery                         */
    /* -------------------------------------------------------------------------- */

    function test_CreateAccount_BindsOwnerAndRegisters() public {
        address predicted = factory.predict(alice.addr, 0);
        vm.expectEmit(true, true, false, true);
        emit MapaeAccountFactory.MapaeAccountCreated(predicted, alice.addr, 0);

        MapaeAccount account = factory.createAccount(alice.addr, 0, _consent(alice, 0));

        assertEq(address(account), predicted, "CREATE2 address mismatch");
        assertEq(account.owner(), alice.addr, "owner not bound");
        assertEq(account.DELEGATION_MANAGER(), address(manager));
        assertTrue(factory.isMapaeAccount(address(account)), "not registered");
    }

    /// @notice THE forgery this factory exists to prevent.
    /// @dev Mallory tries to deploy an account naming a real Upbit-verified address as its owner.
    ///      She could never steal funds - a delegation only ever spends its own delegator's
    ///      balance - but every payment from that account would trace back to an innocent verified
    ///      person, forging the accountability chain that is the entire product.
    function test_RevertWhen_ForgingOwnershipOfAVerifiedIdentity() public {
        // Build the signature BEFORE arming expectRevert: `_consent` calls `creationDigest` on the
        // factory, and that external call would otherwise be the one expectRevert inspects.
        bytes memory mallorySig = _consent(mallory, 0);

        vm.prank(mallory.addr);
        vm.expectRevert(MapaeAccountFactory.InvalidOwnerSignature.selector);
        factory.createAccount(victim.addr, 0, mallorySig);
    }

    /// @notice A signature by the right owner but over a different salt must not be replayable.
    function test_RevertWhen_ConsentSignedForDifferentSalt() public {
        bytes memory sigForSalt0 = _consent(alice, 0);

        vm.expectRevert(MapaeAccountFactory.InvalidOwnerSignature.selector);
        factory.createAccount(alice.addr, 1, sigForSalt0);
    }

    /// @notice Consent is domain-separated: a signature from another factory instance is invalid.
    function test_RevertWhen_ConsentFromAnotherFactory() public {
        MapaeAccountFactory other = new MapaeAccountFactory(address(manager));
        bytes32 digest = other.creationDigest(alice.addr, 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alice.privateKey, digest);

        vm.expectRevert(MapaeAccountFactory.InvalidOwnerSignature.selector);
        factory.createAccount(alice.addr, 0, abi.encodePacked(r, s, v));
    }

    function test_RevertWhen_ZeroOwner() public {
        vm.expectRevert(MapaeAccountFactory.ZeroOwner.selector);
        factory.createAccount(address(0), 0, hex"");
    }

    /// @notice A relayer may pay the gas; the signature, not the caller, authorises the binding.
    function test_AnyoneMayRelayCreation() public {
        bytes memory sig = _consent(alice, 0);
        vm.prank(mallory.addr);
        MapaeAccount account = factory.createAccount(alice.addr, 0, sig);
        assertEq(account.owner(), alice.addr);
    }

    /// @notice A principal may itself be a smart account, approving via ERC-1271.
    function test_ContractOwner_ApprovesViaErc1271() public {
        ContractOwner co = new ContractOwner();
        co.approve(factory.creationDigest(address(co), 0));

        MapaeAccount account = factory.createAccount(address(co), 0, hex"00");
        assertEq(account.owner(), address(co));
        assertTrue(factory.isMapaeAccount(address(account)));
    }

    /// @notice Salt spaces are per-owner: one owner cannot squat another's address.
    function test_SaltSpacesAreSeparatedByOwner() public {
        address a0 = factory.predict(alice.addr, 0);
        address a1 = factory.predict(alice.addr, 1);
        address m0 = factory.predict(mallory.addr, 0);
        assertTrue(a0 != a1, "salt not mixed in");
        assertTrue(a0 != m0, "owner not mixed in");
    }

    function test_RevertWhen_CreatingTheSameAccountTwice() public {
        bytes memory sig = _consent(alice, 0);
        factory.createAccount(alice.addr, 0, sig);

        vm.expectRevert();
        factory.createAccount(alice.addr, 0, sig);
    }

    /* -------------------------------------------------------------------------- */
    /*                              Access control                                 */
    /* -------------------------------------------------------------------------- */

    function test_RevertWhen_ExecuteFromExecutorNotCalledByManager() public {
        MapaeAccount account = _account(alice);
        bytes memory exec = _setValueCall(1);

        vm.prank(mallory.addr);
        vm.expectRevert(abi.encodeWithSelector(MapaeAccount.NotDelegationManager.selector, mallory.addr));
        account.executeFromExecutor(ModeLib.encodeSimpleSingle(), exec);
    }

    function test_RevertWhen_ExecuteNotCalledByOwner() public {
        MapaeAccount account = _account(alice);
        bytes memory exec = _setValueCall(1);

        vm.prank(mallory.addr);
        vm.expectRevert(abi.encodeWithSelector(MapaeAccount.NotOwner.selector, mallory.addr));
        account.execute(ModeLib.encodeSimpleSingle(), exec);
    }

    function test_OwnerCanExecuteDirectly() public {
        MapaeAccount account = _account(alice);
        vm.prank(alice.addr);
        account.execute(ModeLib.encodeSimpleSingle(), _setValueCall(42));
        assertEq(target.value(), 42);
    }

    /* -------------------------------------------------------------------------- */
    /*                          Refused execution shapes                           */
    /* -------------------------------------------------------------------------- */

    /// @notice Delegatecall would let a delegate rewrite this account's storage, escaping every
    ///         caveat that was just checked.
    function test_RevertWhen_Delegatecall() public {
        MapaeAccount account = _account(alice);
        ModeCode mode =
            ModeLib.encode(CALLTYPE_DELEGATECALL, EXECTYPE_DEFAULT, MODE_DEFAULT, ModePayload.wrap(0));

        vm.prank(alice.addr);
        vm.expectRevert(
            abi.encodeWithSelector(MapaeAccount.UnsupportedCallType.selector, CALLTYPE_DELEGATECALL)
        );
        account.execute(mode, _setValueCall(1));
    }

    /// @notice EXECTYPE_TRY swallows call failure. A spending limit would record the spend while
    ///         the transfer silently failed, so the on-chain accounting would claim a payment that
    ///         never happened.
    function test_RevertWhen_TryExecType() public {
        MapaeAccount account = _account(alice);
        ModeCode mode = ModeLib.encode(CALLTYPE_SINGLE, EXECTYPE_TRY, MODE_DEFAULT, ModePayload.wrap(0));

        vm.prank(alice.addr);
        vm.expectRevert(abi.encodeWithSelector(MapaeAccount.UnsupportedExecType.selector, EXECTYPE_TRY));
        account.execute(mode, _setValueCall(1));
    }

    function test_RevertWhen_BatchCallType() public {
        MapaeAccount account = _account(alice);
        ModeCode mode = ModeLib.encode(CALLTYPE_BATCH, EXECTYPE_DEFAULT, MODE_DEFAULT, ModePayload.wrap(0));

        vm.prank(alice.addr);
        vm.expectRevert(abi.encodeWithSelector(MapaeAccount.UnsupportedCallType.selector, CALLTYPE_BATCH));
        account.execute(mode, _setValueCall(1));
    }

    /// @notice A failed call must not be swallowed, and its reason must survive.
    function test_BubblesCalleeRevertData() public {
        MapaeAccount account = _account(alice);
        bytes memory exec = ExecutionLib.encodeSingle(address(target), 0, abi.encodeCall(Target.boom, ()));

        vm.prank(alice.addr);
        vm.expectRevert(abi.encodeWithSelector(Target.Boom.selector, 7));
        account.execute(ModeLib.encodeSimpleSingle(), exec);
    }

    function test_ForwardsValue() public {
        MapaeAccount account = _account(alice);
        vm.deal(address(account), 1 ether);

        bytes memory exec =
            ExecutionLib.encodeSingle(address(target), 0.5 ether, abi.encodeCall(Target.setValue, (9)));
        vm.prank(alice.addr);
        account.execute(ModeLib.encodeSimpleSingle(), exec);

        assertEq(target.received(), 0.5 ether);
        assertEq(address(account).balance, 0.5 ether);
    }

    /* -------------------------------------------------------------------------- */
    /*                                  ERC-1271                                   */
    /* -------------------------------------------------------------------------- */

    function test_IsValidSignature_AcceptsOwner() public {
        MapaeAccount account = _account(alice);
        bytes32 digest = keccak256("hello");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alice.privateKey, digest);

        assertEq(
            account.isValidSignature(digest, abi.encodePacked(r, s, v)), IERC1271.isValidSignature.selector
        );
    }

    function test_IsValidSignature_RejectsOthers() public {
        MapaeAccount account = _account(alice);
        bytes32 digest = keccak256("hello");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(mallory.privateKey, digest);

        assertEq(account.isValidSignature(digest, abi.encodePacked(r, s, v)), bytes4(0xffffffff));
    }

    /* -------------------------------------------------------------------------- */
    /*                                   Helpers                                   */
    /* -------------------------------------------------------------------------- */

    function _consent(Vm.Wallet memory w, uint256 salt) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(w.privateKey, factory.creationDigest(w.addr, salt));
        return abi.encodePacked(r, s, v);
    }

    function _account(Vm.Wallet memory w) internal returns (MapaeAccount) {
        return factory.createAccount(w.addr, 0, _consent(w, 0));
    }

    function _setValueCall(uint256 v) internal view returns (bytes memory) {
        return ExecutionLib.encodeSingle(address(target), 0, abi.encodeCall(Target.setValue, (v)));
    }
}
