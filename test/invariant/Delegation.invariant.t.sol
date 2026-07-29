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
import {MockDojangScroll} from "../../src/mocks/MockDojangScroll.sol";
import {MockKRW} from "../../src/mocks/MockKRW.sol";
import {IDojangScroll} from "../../src/interfaces/IDojangScroll.sol";
import {Delegation, Caveat, ModeCode} from "../../src/utils/Types.sol";
import {ROOT_AUTHORITY} from "../../src/utils/Constants.sol";
import {EncoderLib} from "../../src/libraries/EncoderLib.sol";
import {ExecutionLib} from "../../src/libraries/ExecutionLib.sol";

/// @dev The fuzzer's toy box. Every external function is an action it may call in any order with
///      any arguments: redeem toward the merchant or the attacker, warp time across period
///      boundaries, revoke and re-issue the identity, disable and re-enable the delegation.
///      Ghost variables record what ACTUALLY happened so the invariants can compare the system's
///      accounting against an independent ledger.
contract DelegationHandler is Test {
    uint256 internal constant PERIOD_CAP = 50_000;
    uint256 internal constant PERIOD = 1 days;
    bytes32 internal constant FAUCET_ID = keccak256("dojang.dojangattesterids.testnetfaucet");

    MapaeDelegationManager public immutable manager;
    ERC20PeriodTransferEnforcer public immutable periodEnforcer;
    MockDojangScroll public immutable scroll;
    MockKRW public immutable krw;
    MapaeAccount public immutable account;

    Vm.Wallet internal principal;
    Vm.Wallet internal agent;
    address public immutable merchant = address(0xCAFE);
    address public immutable attacker = address(0xBAD);

    uint256 public immutable startTime;
    bytes32 public immutable delegationHash;
    bytes internal permissionContext;

    /* --------------------------------- ghosts --------------------------------- */

    /// @notice Sum of every successful transfer, per period index. The period cap invariant
    ///         checks this ledger, not the enforcer's own bookkeeping.
    mapping(uint256 period => uint256 spent) public ghost_spentInPeriod;
    /// @notice Set if a redemption ever succeeded while the principal's attestation was dead.
    bool public ghost_identityViolation;
    /// @notice Set if a redemption ever succeeded while the delegation was disabled.
    bool public ghost_disabledViolation;
    /// @notice Total successfully transferred, for the conservation invariant.
    uint256 public ghost_totalTransferred;

    constructor() {
        vm.warp(1_753_770_000);
        startTime = block.timestamp;

        scroll = new MockDojangScroll();
        manager = new MapaeDelegationManager();
        MapaeAccountFactory factory = new MapaeAccountFactory(address(manager));
        DojangVerifiedEnforcer dojangEnforcer = new DojangVerifiedEnforcer(
            IDojangScroll(address(scroll)), IMapaeAccountRegistry(address(factory))
        );
        AllowedPayeeEnforcer payeeEnforcer = new AllowedPayeeEnforcer();
        periodEnforcer = new ERC20PeriodTransferEnforcer();
        krw = new MockKRW();

        principal = vm.createWallet("principal");
        agent = vm.createWallet("agent");

        (uint8 cv, bytes32 cr, bytes32 cs) =
            vm.sign(principal.privateKey, factory.creationDigest(principal.addr, 0));
        account = factory.createAccount(principal.addr, 0, abi.encodePacked(cr, cs, cv));

        krw.mint(address(account), 10_000_000);
        scroll.issue(principal.addr, FAUCET_ID, keccak256("uid"), 0);

        Caveat[] memory caveats = new Caveat[](3);
        caveats[0] = Caveat({
            enforcer: address(dojangEnforcer), terms: abi.encodePacked(FAUCET_ID, principal.addr), args: ""
        });
        caveats[1] = Caveat({
            enforcer: address(periodEnforcer),
            terms: abi.encodePacked(address(krw), PERIOD_CAP, PERIOD, startTime),
            args: ""
        });
        caveats[2] = Caveat({enforcer: address(payeeEnforcer), terms: abi.encodePacked(merchant), args: ""});

        Delegation memory d = Delegation({
            delegate: agent.addr,
            delegator: address(account),
            authority: ROOT_AUTHORITY,
            caveats: caveats,
            salt: 1,
            signature: ""
        });
        bytes32 hash_ = EncoderLib._getDelegationHash(d);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(principal.privateKey, MessageHashUtils.toTypedDataHash(manager.getDomainHash(), hash_));
        d.signature = abi.encodePacked(r, s, v);

        delegationHash = hash_;
        Delegation[] memory chain = new Delegation[](1);
        chain[0] = d;
        permissionContext = abi.encode(chain);
    }

    /* --------------------------------- actions -------------------------------- */

    function redeem(uint96 rawAmount, bool aimAtAttacker) external {
        uint256 amount = bound(uint256(rawAmount), 1, PERIOD_CAP + 10_000);
        address payee = aimAtAttacker ? attacker : merchant;

        bool identityLive = scroll.isVerified(principal.addr, FAUCET_ID);
        bool disabled = manager.disabledDelegations(delegationHash);

        bytes[] memory ctx = new bytes[](1);
        ctx[0] = permissionContext;
        bytes32[] memory modes = new bytes32[](1);
        bytes[] memory execs = new bytes[](1);
        execs[0] = ExecutionLib.encodeSingle(
            address(krw), 0, abi.encodeWithSelector(IERC20.transfer.selector, payee, amount)
        );

        vm.prank(agent.addr);
        try manager.redeemDelegations(ctx, modes, execs) {
            if (!identityLive) ghost_identityViolation = true;
            if (disabled) ghost_disabledViolation = true;
            ghost_spentInPeriod[currentPeriod()] += amount;
            ghost_totalTransferred += amount;
        } catch {
            // A rejected redemption must move nothing; conservation is asserted globally.
        }
    }

    function warp(uint32 dt) external {
        vm.warp(block.timestamp + bound(uint256(dt), 1, 3 days));
    }

    function revokeIdentity() external {
        scroll.revoke(principal.addr, FAUCET_ID);
    }

    function reissueIdentity() external {
        scroll.issue(principal.addr, FAUCET_ID, keccak256(abi.encode(block.timestamp)), 0);
    }

    function disableDelegation() external {
        _ownerCall(abi.encodeCall(MapaeDelegationManager.disableDelegation, (_delegation())));
    }

    function enableDelegation() external {
        _ownerCall(abi.encodeCall(MapaeDelegationManager.enableDelegation, (_delegation())));
    }

    /* --------------------------------- helpers -------------------------------- */

    function currentPeriod() public view returns (uint256) {
        if (block.timestamp < startTime) return 0;
        return (block.timestamp - startTime) / PERIOD + 1;
    }

    function _delegation() internal view returns (Delegation memory d) {
        Delegation[] memory chain = abi.decode(permissionContext, (Delegation[]));
        return chain[0];
    }

    function _ownerCall(bytes memory callData) internal {
        vm.prank(principal.addr);
        try account.execute(
            ModeCode.wrap(bytes32(0)), ExecutionLib.encodeSingle(address(manager), 0, callData)
        ) {}
            catch {}
    }
}

/// @title DelegationInvariants
/// @notice Properties that must survive ANY interleaving of payments, time travel, identity
///         revocation and delegation toggling. The thesis of the whole system is #2: money never
///         moves while the real-world identity behind the delegation is dead.
contract DelegationInvariants is Test {
    DelegationHandler internal handler;

    function setUp() public {
        handler = new DelegationHandler();
        targetContract(address(handler));
    }

    /// @notice The per-period spend, tallied by an independent ghost ledger, never exceeds the
    ///         cap the principal signed - across any number of period rollovers.
    function invariant_NeverExceedsPeriodCap() public view {
        assertLe(
            handler.ghost_spentInPeriod(handler.currentPeriod()),
            50_000,
            "period ledger exceeded the signed cap"
        );
    }

    /// @notice THE THESIS. No redemption ever succeeded while the principal's Dojang attestation
    ///         was revoked or expired.
    function invariant_NoTransferWithoutLiveAttestation() public view {
        assertFalse(handler.ghost_identityViolation(), "a payment moved while the identity was dead");
    }

    /// @notice No redemption ever succeeded while the delegation was disabled.
    function invariant_NoTransferWhileDisabled() public view {
        assertFalse(handler.ghost_disabledViolation(), "a payment moved while the delegation was off");
    }

    /// @notice Funds only ever reach the signed payee; the attacker's balance stays zero forever.
    function invariant_AttackerNeverPaid() public view {
        assertEq(handler.krw().balanceOf(handler.attacker()), 0, "funds escaped the payee allowlist");
    }

    /// @notice Conservation: account + merchant always equals the initial mint, and the merchant's
    ///         balance equals exactly what the ghost ledger says was transferred.
    function invariant_Conservation() public view {
        uint256 accountBal = handler.krw().balanceOf(address(handler.account()));
        uint256 merchantBal = handler.krw().balanceOf(handler.merchant());
        assertEq(accountBal + merchantBal, 10_000_000, "tokens created or destroyed");
        assertEq(merchantBal, handler.ghost_totalTransferred(), "merchant balance drifts from ledger");
    }
}
