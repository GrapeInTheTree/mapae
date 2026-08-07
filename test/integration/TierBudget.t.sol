// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {MapaeDelegationManager} from "../../src/MapaeDelegationManager.sol";
import {MapaeAccount} from "../../src/MapaeAccount.sol";
import {MapaeAccountFactory} from "../../src/MapaeAccountFactory.sol";
import {DojangVerifiedEnforcer, IMapaeAccountRegistry} from "../../src/enforcers/DojangVerifiedEnforcer.sol";
import {AllowedPayeeEnforcer} from "../../src/enforcers/AllowedPayeeEnforcer.sol";
import {ERC20PeriodTransferEnforcer} from "../../src/enforcers/ERC20PeriodTransferEnforcer.sol";
import {PerPaymentLimitEnforcer} from "../../src/enforcers/PerPaymentLimitEnforcer.sol";
import {VerifiedCodeEnforcer} from "../../src/enforcers/VerifiedCodeEnforcer.sol";
import {MockDojangScroll} from "../../src/mocks/MockDojangScroll.sol";
import {MockKRW} from "../../src/mocks/MockKRW.sol";
import {IDojangScroll} from "../../src/interfaces/IDojangScroll.sol";
import {Delegation, Caveat, ModeCode} from "../../src/utils/Types.sol";
import {ROOT_AUTHORITY} from "../../src/utils/Constants.sol";
import {EncoderLib} from "../../src/libraries/EncoderLib.sol";
import {ExecutionLib} from "../../src/libraries/ExecutionLib.sol";
import {ModeLib} from "../../src/libraries/ModeLib.sol";

/// @notice Does a tier ladder share one budget, or does each tier get its own?
///
/// @dev The question is load-bearing and easy to get wrong, because the two arrangements look
///      identical when you draw them and behave differently when you spend.
///
///      `ERC20PeriodTransferEnforcer` keys its ledger on `(manager, delegationHash)`. Two sibling
///      delegations therefore have two ledgers: sign "₩200,000 a day" twice and the agent may
///      spend ₩400,000 a day, which is not what the person believes they granted.
///
///      A chain does not have that problem, and the reason is in the manager: `_runCaveats` hands
///      each delegation's caveats *that delegation's* hash. Put the period cap on the root, hang
///      the tiers off it as children, and every redemption through any tier runs the root's cap
///      against the root's hash - one ledger, shared.
///
///      Both are proven below, because "tiers share a budget" is only worth saying if the
///      arrangement that does not share it is shown to be a real hazard rather than a hypothesis.
contract TierBudgetTest is Test {
    bytes32 internal constant FAUCET_ID = keccak256("dojang.dojangattesterids.testnetfaucet");

    MapaeDelegationManager internal manager;
    MapaeAccountFactory internal factory;
    MapaeAccount internal account;
    DojangVerifiedEnforcer internal dojang;
    AllowedPayeeEnforcer internal payee;
    ERC20PeriodTransferEnforcer internal period;
    PerPaymentLimitEnforcer internal perPayment;
    VerifiedCodeEnforcer internal verifiedCode;
    MockDojangScroll internal scroll;
    MockKRW internal krw;

    Vm.Wallet internal alice; // the person
    Vm.Wallet internal agent; // tier 1 and tier 2 both redeem as this agent
    address internal merchant = address(0xCAFE);

    uint256 internal constant DAY_CAP = 200_000;
    bytes32 internal domainHash;
    uint256 internal start;

    function setUp() public {
        vm.warp(1_753_770_000);
        start = block.timestamp;

        scroll = new MockDojangScroll();
        manager = new MapaeDelegationManager();
        factory = new MapaeAccountFactory(address(manager));
        dojang = new DojangVerifiedEnforcer(
            IDojangScroll(address(scroll)), IMapaeAccountRegistry(address(factory))
        );
        payee = new AllowedPayeeEnforcer();
        period = new ERC20PeriodTransferEnforcer();
        perPayment = new PerPaymentLimitEnforcer();
        verifiedCode = new VerifiedCodeEnforcer(IDojangScroll(address(scroll)));
        krw = new MockKRW();

        alice = vm.createWallet("alice");
        agent = vm.createWallet("agent");

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alice.privateKey, factory.creationDigest(alice.addr, 0));
        account = factory.createAccount(alice.addr, 0, abi.encodePacked(r, s, v));
        krw.mint(address(account), 10_000_000);
        scroll.issue(alice.addr, FAUCET_ID, keccak256("uid"), 0);

        domainHash = manager.getDomainHash();
    }

    /// @notice Two sibling delegations, each capped at ₩200,000 a day, spend ₩400,000 a day.
    ///
    /// @dev This is the arrangement a tier ladder falls into by default, and nothing about it
    ///      reverts - the chain does exactly what was signed. The gap is between what was signed
    ///      and what the person thinks they signed, which is why it belongs in a test rather than
    ///      in a footnote.
    function test_SiblingTiers_EachGetTheirOwnBudget() public {
        // Per-payment ceilings are set wide here on purpose. The question is which ledger the
        // period cap writes to, and a ceiling refusing first would answer a different question.
        Delegation memory tier1 = _signed(_root(_caveats(DAY_CAP), 1));
        Delegation memory tier2 = _signed(_root(_caveats(DAY_CAP), 2));

        _redeem(_chain(tier1), DAY_CAP); // the whole day's budget, on tier 1
        _redeem(_chain(tier2), DAY_CAP); // and the whole day's budget again, on tier 2

        assertEq(krw.balanceOf(merchant), DAY_CAP * 2, "sibling tiers did not double the budget");
    }

    /// @notice Tiers hung off one root share that root's budget.
    ///
    /// @dev The fix needs no new contract. It needs the period cap to live one level up, where
    ///      every tier's redemption passes through it.
    function test_ChildTiers_ShareTheRootBudget() public {
        Delegation memory root = _signed(_root(_caveats(100_000), 1));
        Delegation memory tier1 = _child(root, 10_000); // unattended
        Delegation memory tier2 = _child(root, 100_000); // the larger tier

        _redeem(_chain(tier2, root), 100_000);
        _redeem(_chain(tier2, root), 100_000); // the day's ₩200,000 is now spent

        (uint256 available,,) =
            period.getAvailableAmount(EncoderLib._getDelegationHash(root), address(manager), _periodTerms());
        assertEq(available, 0, "the root ledger did not carry what tier 2 spent");

        // ₩1,000 is far inside tier 1's own ₩10,000 ceiling, and its own condition allows it.
        // What refuses is the root's exhausted budget - reached through a different tier.
        vm.expectRevert();
        _redeem(_chain(tier1, root), 1000);

        assertEq(krw.balanceOf(merchant), DAY_CAP, "the two tiers spent more than one day's budget");
    }

    /// @notice Who signs a tier decides whether its human gate is a promise or a preference.
    ///
    /// @dev Fixing the shared budget means hanging tiers off one root, and the obvious way to do
    ///      that is to let the agent redelegate to itself. Sharing works. The gate does not.
    ///
    ///      A caveat can only be added going down a chain, never removed - so a gate on the ROOT
    ///      binds everyone beneath it. A gate on a tier the AGENT signed binds nobody, because the
    ///      agent can sign a second tier without it and redeem through that instead. The authority
    ///      is identical; the condition the person cared about is simply absent.
    ///
    ///      Putting the gate on the root is not the answer either: then every ₩1,000 payment needs
    ///      a human, and the ladder has no rungs.
    ///
    ///      What works is the signer. Root delegates to the PERSON, the person signs each tier to
    ///      the agent, and the agent - not being the person - cannot mint a tier of its own.
    function test_AgentSignedTiers_LetTheAgentSkipItsOwnGate() public {
        Delegation memory root = _signed(_root(_caveats(100_000), 7));

        // The tier the person intended: larger payments, but only with a live confirmation.
        Delegation memory gated = _childBy(agent, root, 100_000, true);
        vm.expectRevert(); // nothing has issued a Verified Code to this agent
        _redeem(_chain(gated, root), 50_000);

        // The tier the agent can write for itself: same ceiling, no gate, same root authority.
        Delegation memory ungated = _childBy(agent, root, 100_000, false);
        _redeem(_chain(ungated, root), 50_000);

        assertEq(krw.balanceOf(merchant), 50_000, "the agent could not route around its own gate");
    }

    /// @notice Tiers signed by the person cannot be reissued by the agent.
    function test_HumanSignedTiers_KeepTheGate() public {
        // The root now delegates to the PERSON, who hands out the tiers.
        Delegation memory root = _signed(_rootTo(alice.addr, _caveats(100_000), 8));
        Delegation memory gated = _childBy(alice, root, 100_000, true);

        vm.expectRevert();
        _redeem(_chain(gated, root), 50_000);

        // The agent is not the root's delegate, so a tier it signs is not part of this authority.
        Delegation memory forged = _childBy(agent, root, 100_000, false);
        vm.expectRevert();
        _redeem(_chain(forged, root), 50_000);

        assertEq(krw.balanceOf(merchant), 0, "a gate the person signed was routed around");
    }

    /* ------------------------------------ helpers ----------------------------------- */

    function _periodTerms() internal view returns (bytes memory) {
        return abi.encodePacked(address(krw), uint256(DAY_CAP), uint256(86_400), uint256(start - 60));
    }

    function _caveats(uint256 ceiling) internal view returns (Caveat[] memory c) {
        c = new Caveat[](4);
        c[0] = Caveat({enforcer: address(dojang), terms: abi.encodePacked(FAUCET_ID, alice.addr), args: ""});
        c[1] = Caveat({enforcer: address(period), terms: _periodTerms(), args: ""});
        c[2] = Caveat({enforcer: address(payee), terms: abi.encodePacked(merchant), args: ""});
        c[3] = Caveat({enforcer: address(perPayment), terms: abi.encode(ceiling), args: ""});
    }

    function _root(Caveat[] memory caveats, uint256 salt) internal view returns (Delegation memory) {
        return Delegation({
            delegate: agent.addr,
            delegator: address(account),
            authority: ROOT_AUTHORITY,
            caveats: caveats,
            salt: salt,
            signature: ""
        });
    }

    function _rootTo(address delegate, Caveat[] memory caveats, uint256 salt)
        internal
        view
        returns (Delegation memory)
    {
        return Delegation({
            delegate: delegate,
            delegator: address(account),
            authority: ROOT_AUTHORITY,
            caveats: caveats,
            salt: salt,
            signature: ""
        });
    }

    /// A tier signed by `who`, optionally carrying the human-confirmation gate.
    function _childBy(Vm.Wallet memory who, Delegation memory parent, uint256 ceiling, bool gate)
        internal
        returns (Delegation memory)
    {
        Caveat[] memory c = new Caveat[](gate ? 2 : 1);
        c[0] = Caveat({enforcer: address(perPayment), terms: abi.encode(ceiling), args: ""});
        if (gate) {
            c[1] = Caveat({
                enforcer: address(verifiedCode),
                terms: abi.encodePacked(FAUCET_ID, "mapae.tier.gate"),
                args: abi.encode(keccak256("nobody-confirmed-this"))
            });
        }
        Delegation memory d = Delegation({
            delegate: agent.addr,
            delegator: who.addr,
            authority: EncoderLib._getDelegationHash(parent),
            caveats: c,
            salt: ceiling + (gate ? 1 : 0),
            signature: ""
        });
        bytes32 typed = MessageHashUtils.toTypedDataHash(domainHash, EncoderLib._getDelegationHash(d));
        (uint8 v, bytes32 r, bytes32 s2) = vm.sign(who.privateKey, typed);
        d.signature = abi.encodePacked(r, s2, v);
        return d;
    }

    /// A tier: narrows the per-payment ceiling, inherits everything above it.
    function _child(Delegation memory parent, uint256 ceiling) internal returns (Delegation memory) {
        Caveat[] memory c = new Caveat[](1);
        c[0] = Caveat({enforcer: address(perPayment), terms: abi.encode(ceiling), args: ""});
        Delegation memory d = Delegation({
            delegate: agent.addr,
            delegator: agent.addr,
            authority: EncoderLib._getDelegationHash(parent),
            caveats: c,
            salt: ceiling,
            signature: ""
        });
        bytes32 typed = MessageHashUtils.toTypedDataHash(domainHash, EncoderLib._getDelegationHash(d));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agent.privateKey, typed);
        d.signature = abi.encodePacked(r, s, v);
        return d;
    }

    function _signed(Delegation memory d) internal returns (Delegation memory) {
        bytes32 typed = MessageHashUtils.toTypedDataHash(domainHash, EncoderLib._getDelegationHash(d));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alice.privateKey, typed);
        d.signature = abi.encodePacked(r, s, v);
        return d;
    }

    function _chain(Delegation memory leaf) internal pure returns (Delegation[] memory c) {
        c = new Delegation[](1);
        c[0] = leaf;
    }

    function _chain(Delegation memory leaf, Delegation memory root)
        internal
        pure
        returns (Delegation[] memory c)
    {
        c = new Delegation[](2);
        c[0] = leaf;
        c[1] = root;
    }

    function _redeem(Delegation[] memory chain, uint256 amount) internal {
        bytes[] memory ctx = new bytes[](1);
        ctx[0] = abi.encode(chain);
        bytes32[] memory modes = new bytes32[](1);
        modes[0] = ModeCode.unwrap(ModeLib.encodeSimpleSingle());
        bytes[] memory execs = new bytes[](1);
        execs[0] = ExecutionLib.encodeSingle(
            address(krw), 0, abi.encodeWithSignature("transfer(address,uint256)", merchant, amount)
        );
        vm.prank(agent.addr);
        manager.redeemDelegations(ctx, modes, execs);
    }
}
