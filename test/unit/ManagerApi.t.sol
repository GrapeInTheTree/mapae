// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {MapaeDelegationManager} from "../../src/MapaeDelegationManager.sol";
import {MapaeAccount} from "../../src/MapaeAccount.sol";
import {MapaeAccountFactory} from "../../src/MapaeAccountFactory.sol";
import {CaveatEnforcer} from "../../src/enforcers/CaveatEnforcer.sol";
import {ERC20PeriodTransferEnforcer} from "../../src/enforcers/ERC20PeriodTransferEnforcer.sol";
import {MockKRW} from "../../src/mocks/MockKRW.sol";
import {Delegation, Caveat, ModeCode} from "../../src/utils/Types.sol";
import {ROOT_AUTHORITY} from "../../src/utils/Constants.sol";
import {EncoderLib} from "../../src/libraries/EncoderLib.sol";
import {ExecutionLib} from "../../src/libraries/ExecutionLib.sol";
import {ModeLib} from "../../src/libraries/ModeLib.sol";

/// @dev Records the exact sequence of hook calls it receives, so the manager's ordering can be
///      pinned rather than assumed. Ordering is part of the compatibility surface: MetaMask's
///      enforcers rely on beforeAll/afterAll bracketing an entire batch while before/after bracket
///      one execution.
contract RecordingEnforcer is CaveatEnforcer {
    string[] public calls;

    function callCount() external view returns (uint256) {
        return calls.length;
    }

    function _record(string memory phase_, bytes calldata terms_) internal {
        calls.push(string.concat(phase_, ":", string(terms_)));
    }

    function beforeAllHook(
        bytes calldata t,
        bytes calldata,
        ModeCode,
        bytes calldata,
        bytes32,
        address,
        address
    ) public override {
        _record("beforeAll", t);
    }

    function beforeHook(bytes calldata t, bytes calldata, ModeCode, bytes calldata, bytes32, address, address)
        public
        override
    {
        _record("before", t);
    }

    function afterHook(bytes calldata t, bytes calldata, ModeCode, bytes calldata, bytes32, address, address)
        public
        override
    {
        _record("after", t);
    }

    function afterAllHook(
        bytes calldata t,
        bytes calldata,
        ModeCode,
        bytes calldata,
        bytes32,
        address,
        address
    ) public override {
        _record("afterAll", t);
    }
}

/// @dev Overrides nothing, so every hook resolves to the base class's no-op. An enforcer only
///      implements the hooks its condition needs, and the manager calls all four regardless.
contract InertEnforcer is CaveatEnforcer {}

/// @dev Calls back into the manager from inside a hook. The reentrancy guard must stop it.
contract ReentrantEnforcer is CaveatEnforcer {
    MapaeDelegationManager public immutable MANAGER;

    constructor(MapaeDelegationManager _m) {
        MANAGER = _m;
    }

    function beforeHook(bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address)
        public
        override
    {
        MANAGER.redeemDelegations(new bytes[](0), new bytes32[](0), new bytes[](0));
    }
}

/// @title ManagerApiTest
/// @notice The manager's non-redemption surface: who may throw the delegation kill switch, what a
///         malformed batch does, and the two structural guarantees a caller depends on - hook
///         ordering, and that no hook can re-enter redemption.
contract ManagerApiTest is Test {
    MapaeDelegationManager internal manager;
    MapaeAccountFactory internal factory;
    MapaeAccount internal account;
    ERC20PeriodTransferEnforcer internal periodEnforcer;
    MockKRW internal krw;

    Vm.Wallet internal alice;
    Vm.Wallet internal agent;
    address internal merchant = address(0xCAFE);
    address internal stranger = address(0xBAD);

    uint256 internal setupTime;
    bytes32 internal domainHash;

    function setUp() public {
        vm.warp(1_753_770_000);
        setupTime = block.timestamp;

        manager = new MapaeDelegationManager();
        factory = new MapaeAccountFactory(address(manager));
        periodEnforcer = new ERC20PeriodTransferEnforcer();
        krw = new MockKRW();

        alice = vm.createWallet("alice");
        agent = vm.createWallet("agent");

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alice.privateKey, factory.creationDigest(alice.addr, 0));
        account = factory.createAccount(alice.addr, 0, abi.encodePacked(r, s, v));
        krw.mint(address(account), 1_000_000);

        domainHash = manager.getDomainHash();
    }

    /* -------------------------------------------------------------------------- */
    /*                          Who may throw the switch                           */
    /* -------------------------------------------------------------------------- */

    /// @notice The kill switch belongs to the delegator alone. Not the delegate, not the account
    ///         owner acting directly - the delegator, which for Mapae means a call routed through
    ///         the account.
    function test_RevertWhen_StrangerDisablesADelegation() public {
        Delegation memory d_ = _signed();

        vm.prank(stranger);
        vm.expectRevert(MapaeDelegationManager.NotDelegator.selector);
        manager.disableDelegation(d_);

        // Even the delegate cannot switch off a delegation made to it.
        vm.prank(agent.addr);
        vm.expectRevert(MapaeDelegationManager.NotDelegator.selector);
        manager.disableDelegation(d_);
    }

    /// @notice Alice owns the account, but she is not the delegator; the account is. Her direct
    ///         call is refused, and only the routed call works.
    function test_RevertWhen_OwnerDisablesWithoutRoutingThroughTheAccount() public {
        Delegation memory d_ = _signed();

        vm.prank(alice.addr);
        vm.expectRevert(MapaeDelegationManager.NotDelegator.selector);
        manager.disableDelegation(d_);

        _asAccount(abi.encodeCall(MapaeDelegationManager.disableDelegation, (d_)));
        assertTrue(manager.disabledDelegations(EncoderLib._getDelegationHash(d_)));
    }

    function test_RevertWhen_StrangerEnablesADelegation() public {
        Delegation memory d_ = _signed();
        _asAccount(abi.encodeCall(MapaeDelegationManager.disableDelegation, (d_)));

        vm.prank(stranger);
        vm.expectRevert(MapaeDelegationManager.NotDelegator.selector);
        manager.enableDelegation(d_);
    }

    /// @notice The switch is idempotent by refusal, not by silence: a redundant throw reverts, so
    ///         a caller can never mistake a no-op for a state change.
    function test_RevertWhen_EnablingALiveDelegation() public {
        Delegation memory d_ = _signed();

        vm.prank(address(account));
        vm.expectRevert(MapaeDelegationManager.AlreadyEnabled.selector);
        manager.enableDelegation(d_);
    }

    function test_RevertWhen_DisablingTwice() public {
        Delegation memory d_ = _signed();
        _asAccount(abi.encodeCall(MapaeDelegationManager.disableDelegation, (d_)));

        vm.prank(address(account));
        vm.expectRevert(MapaeDelegationManager.AlreadyDisabled.selector);
        manager.disableDelegation(d_);
    }

    /// @notice Disabling is keyed by the delegation hash, which excludes the signature. A
    ///         re-signed copy of the same delegation is the same delegation, and stays dead.
    function test_DisablingSurvivesAReSignature() public {
        Delegation memory d_ = _signed();
        _asAccount(abi.encodeCall(MapaeDelegationManager.disableDelegation, (d_)));

        Delegation memory resigned_ = _delegation();
        resigned_.signature = abi.encodePacked(d_.signature, hex"00"); // different bytes, same hash

        assertTrue(
            manager.disabledDelegations(EncoderLib._getDelegationHash(resigned_)),
            "the signature is not part of identity"
        );
    }

    /* -------------------------------------------------------------------------- */
    /*                              Malformed batches                              */
    /* -------------------------------------------------------------------------- */

    function test_RevertWhen_ModesArrayIsShorter() public {
        bytes[] memory ctx_ = new bytes[](2);
        bytes32[] memory modes_ = new bytes32[](1);
        bytes[] memory execs_ = new bytes[](2);

        vm.prank(agent.addr);
        vm.expectRevert(MapaeDelegationManager.BatchDataLengthMismatch.selector);
        manager.redeemDelegations(ctx_, modes_, execs_);
    }

    function test_RevertWhen_ExecutionsArrayIsShorter() public {
        bytes[] memory ctx_ = new bytes[](2);
        bytes32[] memory modes_ = new bytes32[](2);
        bytes[] memory execs_ = new bytes[](1);

        vm.prank(agent.addr);
        vm.expectRevert(MapaeDelegationManager.BatchDataLengthMismatch.selector);
        manager.redeemDelegations(ctx_, modes_, execs_);
    }

    /// @notice An empty permission context carries no authority and must not be treated as one.
    function test_RevertWhen_ChainIsEmpty() public {
        bytes[] memory ctx_ = new bytes[](1);
        ctx_[0] = abi.encode(new Delegation[](0));
        bytes32[] memory modes_ = new bytes32[](1);
        bytes[] memory execs_ = new bytes[](1);
        execs_[0] = _transfer(merchant, 1);

        vm.prank(agent.addr);
        vm.expectRevert(MapaeDelegationManager.EmptyDelegationChain.selector);
        manager.redeemDelegations(ctx_, modes_, execs_);
    }

    /// @notice An empty batch is a no-op rather than a revert - there is nothing to authorise and
    ///         nothing is executed. Pinned so the behaviour is a decision, not an accident.
    function test_EmptyBatchIsANoOp() public {
        vm.prank(agent.addr);
        manager.redeemDelegations(new bytes[](0), new bytes32[](0), new bytes[](0));
        assertEq(krw.balanceOf(merchant), 0);
    }

    /// @notice The same delegation twice in one batch does not double the allowance. Spend is
    ///         consumed in `beforeHook`, which runs once per batch item, so the second item sees
    ///         what the first already took.
    function test_RepeatingADelegationInOneBatchCannotExceedTheCap() public {
        Delegation[] memory chain_ = new Delegation[](1);
        chain_[0] = _signed();

        bytes[] memory ctx_ = new bytes[](2);
        ctx_[0] = abi.encode(chain_);
        ctx_[1] = abi.encode(chain_);
        bytes32[] memory modes_ = new bytes32[](2);
        bytes[] memory execs_ = new bytes[](2);
        execs_[0] = _transfer(merchant, 30_000);
        execs_[1] = _transfer(merchant, 30_000); // 60,000 total against a 50,000 cap

        vm.prank(agent.addr);
        vm.expectRevert("ERC20PeriodTransferEnforcer:transfer-amount-exceeded");
        manager.redeemDelegations(ctx_, modes_, execs_);

        assertEq(krw.balanceOf(merchant), 0, "nothing settles");
    }

    /* -------------------------------------------------------------------------- */
    /*                       Structural guarantees                                 */
    /* -------------------------------------------------------------------------- */

    /// @notice Hook ordering, pinned exactly. Across a two-item batch: every beforeAllHook fires
    ///         first, then each item is bracketed by before/after around its own execution, then
    ///         every afterAllHook. Before-phases run leaf to root; after-phases unwind root to
    ///         leaf. MetaMask's enforcers assume precisely this.
    function test_HookOrderAcrossABatchIsPinned() public {
        RecordingEnforcer rec_ = new RecordingEnforcer();

        Caveat[] memory caveats_ = new Caveat[](2);
        caveats_[0] = Caveat({enforcer: address(rec_), terms: "A", args: ""});
        caveats_[1] = Caveat({enforcer: address(rec_), terms: "B", args: ""});

        Delegation memory d_ = _sign(
            Delegation({
                delegate: agent.addr,
                delegator: address(account),
                authority: ROOT_AUTHORITY,
                caveats: caveats_,
                salt: 7,
                signature: ""
            })
        );

        Delegation[] memory chain_ = new Delegation[](1);
        chain_[0] = d_;
        bytes[] memory ctx_ = new bytes[](2);
        ctx_[0] = abi.encode(chain_);
        ctx_[1] = abi.encode(chain_);
        bytes32[] memory modes_ = new bytes32[](2);
        bytes[] memory execs_ = new bytes[](2);
        execs_[0] = _transfer(merchant, 1);
        execs_[1] = _transfer(merchant, 1);

        vm.prank(agent.addr);
        manager.redeemDelegations(ctx_, modes_, execs_);

        string[10] memory want_ = [
            "beforeAll:A", // both items' beforeAll first
            "beforeAll:B",
            "beforeAll:A",
            "beforeAll:B",
            "before:A", // item 0: bracket its execution
            "before:B",
            "after:B", // after unwinds in reverse caveat order
            "after:A",
            "before:A", // item 1
            "before:B"
        ];
        for (uint256 i; i < want_.length; ++i) {
            assertEq(rec_.calls(i), want_[i], "hook order");
        }
        assertEq(rec_.callCount(), 16, "4 phases x 2 caveats x 2 items");
        assertEq(rec_.calls(14), "afterAll:B", "afterAll runs last, reversed");
        assertEq(rec_.calls(15), "afterAll:A");
    }

    /// @notice The other half of the ordering guarantee, which a single-link chain cannot show:
    ///         across a CHAIN, before-phases run leaf to root and after-phases unwind root to leaf.
    ///         An after-hook therefore always sees the same nesting its before-hook opened.
    function test_HookOrderAcrossAChainIsPinned() public {
        RecordingEnforcer rec_ = new RecordingEnforcer();
        Vm.Wallet memory sub_ = vm.createWallet("sub");

        Caveat[] memory rootCaveats_ = new Caveat[](1);
        rootCaveats_[0] = Caveat({enforcer: address(rec_), terms: "R", args: ""});
        Delegation memory root_ = _sign(
            Delegation({
                delegate: agent.addr,
                delegator: address(account),
                authority: ROOT_AUTHORITY,
                caveats: rootCaveats_,
                salt: 11,
                signature: ""
            })
        );

        Caveat[] memory childCaveats_ = new Caveat[](1);
        childCaveats_[0] = Caveat({enforcer: address(rec_), terms: "C", args: ""});
        Delegation memory child_ = Delegation({
            delegate: sub_.addr,
            delegator: agent.addr,
            authority: EncoderLib._getDelegationHash(root_),
            caveats: childCaveats_,
            salt: 12,
            signature: ""
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            agent.privateKey,
            MessageHashUtils.toTypedDataHash(domainHash, EncoderLib._getDelegationHash(child_))
        );
        child_.signature = abi.encodePacked(r, s, v);

        Delegation[] memory chain_ = new Delegation[](2);
        chain_[0] = child_;
        chain_[1] = root_;

        bytes[] memory ctx_ = new bytes[](1);
        ctx_[0] = abi.encode(chain_);
        bytes32[] memory modes_ = new bytes32[](1);
        bytes[] memory execs_ = new bytes[](1);
        execs_[0] = _transfer(merchant, 1);

        vm.prank(sub_.addr);
        manager.redeemDelegations(ctx_, modes_, execs_);

        string[8] memory want_ = [
            "beforeAll:C", // leaf first
            "beforeAll:R",
            "before:C",
            "before:R",
            "after:R", // root first: the nesting unwinds
            "after:C",
            "afterAll:R",
            "afterAll:C"
        ];
        assertEq(rec_.callCount(), want_.length, "4 phases x 2 links");
        for (uint256 i; i < want_.length; ++i) {
            assertEq(rec_.calls(i), want_[i], "chain hook order");
        }
    }

    /// @notice No hook can re-enter redemption. Without this, an enforcer could recurse to spend
    ///         the same allowance before its own consumption was written.
    function test_RevertWhen_AnEnforcerReentersRedemption() public {
        ReentrantEnforcer bad_ = new ReentrantEnforcer(manager);

        Caveat[] memory caveats_ = new Caveat[](1);
        caveats_[0] = Caveat({enforcer: address(bad_), terms: "", args: ""});

        Delegation memory d_ = _sign(
            Delegation({
                delegate: agent.addr,
                delegator: address(account),
                authority: ROOT_AUTHORITY,
                caveats: caveats_,
                salt: 9,
                signature: ""
            })
        );

        Delegation[] memory chain_ = new Delegation[](1);
        chain_[0] = d_;
        bytes[] memory ctx_ = new bytes[](1);
        ctx_[0] = abi.encode(chain_);
        bytes32[] memory modes_ = new bytes32[](1);
        bytes[] memory execs_ = new bytes[](1);
        execs_[0] = _transfer(merchant, 1);

        vm.prank(agent.addr);
        vm.expectRevert(bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        manager.redeemDelegations(ctx_, modes_, execs_);
    }

    /// @notice A caveat whose enforcer implements none of the four hooks is valid and inert. This
    ///         is what lets an enforcer declare only the hook it needs, and it means the manager
    ///         must never assume a hook does anything.
    function test_AnEnforcerNeedNotImplementAnyHook() public {
        Caveat[] memory caveats_ = new Caveat[](1);
        caveats_[0] = Caveat({enforcer: address(new InertEnforcer()), terms: "", args: ""});

        Delegation memory d_ = _sign(
            Delegation({
                delegate: agent.addr,
                delegator: address(account),
                authority: ROOT_AUTHORITY,
                caveats: caveats_,
                salt: 13,
                signature: ""
            })
        );

        Delegation[] memory chain_ = new Delegation[](1);
        chain_[0] = d_;
        bytes[] memory ctx_ = new bytes[](1);
        ctx_[0] = abi.encode(chain_);
        bytes[] memory execs_ = new bytes[](1);
        execs_[0] = _transfer(merchant, 5);

        vm.prank(agent.addr);
        manager.redeemDelegations(ctx_, new bytes32[](1), execs_);
        assertEq(krw.balanceOf(merchant), 5);
    }

    /// @notice The public hash view is the same function the manager validates against, so a
    ///         client can compute what it is about to sign.
    function test_GetDelegationHashMatchesTheEncoder() public view {
        Delegation memory d_ = _delegation();
        assertEq(manager.getDelegationHash(d_), EncoderLib._getDelegationHash(d_));
    }

    /* -------------------------------------------------------------------------- */
    /*                                  Helpers                                    */
    /* -------------------------------------------------------------------------- */

    function _delegation() internal view returns (Delegation memory) {
        Caveat[] memory caveats_ = new Caveat[](1);
        caveats_[0] = Caveat({
            enforcer: address(periodEnforcer),
            terms: abi.encodePacked(address(krw), uint256(50_000), uint256(1 days), setupTime),
            args: ""
        });

        return Delegation({
            delegate: agent.addr,
            delegator: address(account),
            authority: ROOT_AUTHORITY,
            caveats: caveats_,
            salt: 1,
            signature: ""
        });
    }

    function _signed() internal view returns (Delegation memory) {
        return _sign(_delegation());
    }

    function _sign(Delegation memory d) internal view returns (Delegation memory) {
        bytes32 typed_ = MessageHashUtils.toTypedDataHash(domainHash, EncoderLib._getDelegationHash(d));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alice.privateKey, typed_);
        d.signature = abi.encodePacked(r, s, v);
        return d;
    }

    function _transfer(address to_, uint256 amount_) internal view returns (bytes memory) {
        return ExecutionLib.encodeSingle(
            address(krw), 0, abi.encodeWithSelector(IERC20.transfer.selector, to_, amount_)
        );
    }

    function _asAccount(bytes memory call_) internal {
        vm.prank(alice.addr);
        account.execute(ModeLib.encodeSimpleSingle(), ExecutionLib.encodeSingle(address(manager), 0, call_));
    }
}
