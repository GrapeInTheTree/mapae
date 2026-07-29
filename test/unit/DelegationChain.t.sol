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
import {Delegation, Caveat} from "../../src/utils/Types.sol";
import {ROOT_AUTHORITY, ANY_DELEGATE} from "../../src/utils/Constants.sol";
import {EncoderLib} from "../../src/libraries/EncoderLib.sol";
import {ExecutionLib} from "../../src/libraries/ExecutionLib.sol";
import {ModeLib} from "../../src/libraries/ModeLib.sol";

/// @title DelegationChainTest
/// @notice Re-delegation: the case where an agent passes part of its authority on to another
///         agent. ERC-7710 makes this a first-class operation and the manager implements it, so
///         the rules that hold a chain together are load-bearing security code:
///
///           - a link is only valid if it names its parent's hash as `authority`;
///           - the parent must have delegated to whoever signed the child;
///           - the last link must be a root, so a chain cannot be grafted onto thin air;
///           - EVERY link's caveats run, so a child can only ever narrow what it received.
///
///         All of it is also the one place the ECDSA signature path is exercised: a child's
///         delegator is the parent's delegate, which for an agent is a plain EOA, whereas the
///         root's delegator is a MapaeAccount validating through ERC-1271. One chain, both paths.
///
///         Two hops is also where the thesis gets its hardest test. A sub-agent three parties
///         removed from Alice, holding a perfectly valid signature from its own delegator, still
///         cannot move a won when Alice's real-world attestation is revoked.
contract DelegationChainTest is Test {
    bytes32 internal constant FAUCET_ID = keccak256("dojang.dojangattesterids.testnetfaucet");
    bytes32 internal constant UID = keccak256("uid-1");
    bytes32 internal constant REDEEMED_TOPIC = keccak256("RedeemedDelegation(address,address,bytes32)");

    MapaeDelegationManager internal manager;
    MapaeAccountFactory internal factory;
    MapaeAccount internal account;
    DojangVerifiedEnforcer internal dojangEnforcer;
    AllowedPayeeEnforcer internal payeeEnforcer;
    ERC20PeriodTransferEnforcer internal periodEnforcer;
    MockDojangScroll internal scroll;
    MockKRW internal krw;

    Vm.Wallet internal alice; // principal: holds the identity, owns the account
    Vm.Wallet internal agent; // first delegate, and delegator of the second hop
    Vm.Wallet internal sub; // second delegate, the one that actually redeems
    Vm.Wallet internal attacker; // holds a key, so it can sign forgeries for itself
    address internal merchant = address(0xCAFE);

    uint256 internal setupTime;
    /// @dev Cached: an external call inside a signing helper silently eats an armed
    ///      `vm.expectRevert` or `vm.prank`.
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
        krw = new MockKRW();

        alice = vm.createWallet("alice");
        agent = vm.createWallet("agent");
        sub = vm.createWallet("sub");
        attacker = vm.createWallet("attacker");

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alice.privateKey, factory.creationDigest(alice.addr, 0));
        account = factory.createAccount(alice.addr, 0, abi.encodePacked(r, s, v));

        krw.mint(address(account), 1_000_000);
        scroll.issue(alice.addr, FAUCET_ID, UID, 0);

        domainHash = manager.getDomainHash();
    }

    /* -------------------------------------------------------------------------- */
    /*                              The chain holds                                */
    /* -------------------------------------------------------------------------- */

    /// @notice Two hops, happy path. The sub-agent redeems, and the money leaves the ROOT
    ///         delegator's account - never the intermediate agent's, who holds no funds at all.
    function test_TwoHop_HappyPath_Redeems() public {
        _redeemTwoHop(_defaultChain(), merchant, 30_000);

        assertEq(krw.balanceOf(merchant), 30_000, "merchant paid");
        assertEq(krw.balanceOf(address(account)), 970_000, "funds left the root account");
        assertEq(krw.balanceOf(agent.addr), 0, "intermediate delegate never custodies");
    }

    /// @notice Three hops. Depth is not a special case; the same rules apply at every link.
    function test_ThreeHop_Redeems() public {
        Vm.Wallet memory sub2 = vm.createWallet("sub2");

        Delegation memory root_ = _signAsAccount(_rootDelegation());
        Delegation memory mid_ = _signAsEoa(
            _link(agent.addr, sub.addr, EncoderLib._getDelegationHash(root_), _noCaveats()), agent
        );
        Delegation memory leaf_ =
            _signAsEoa(_link(sub.addr, sub2.addr, EncoderLib._getDelegationHash(mid_), _noCaveats()), sub);

        Delegation[] memory chain_ = new Delegation[](3);
        chain_[0] = leaf_;
        chain_[1] = mid_;
        chain_[2] = root_;

        vm.prank(sub2.addr);
        _redeem(chain_, merchant, 10_000);
        assertEq(krw.balanceOf(merchant), 10_000);
    }

    /// @notice The manager emits one event per LINK, not per payment. This is deliberate - each
    ///         link is separately accountable - but it means anything counting payments must group
    ///         by transaction. Pinned here because the explorer once counted 8 payments for 6.
    function test_TwoHop_EmitsOneEventPerLink() public {
        vm.recordLogs();
        _redeemTwoHop(_defaultChain(), merchant, 10_000);

        Vm.Log[] memory logs_ = vm.getRecordedLogs();
        uint256 redeemed_;
        for (uint256 i; i < logs_.length; ++i) {
            if (logs_[i].topics[0] == REDEEMED_TOPIC) ++redeemed_;
        }
        assertEq(redeemed_, 2, "one RedeemedDelegation per hop, for a single payment");
    }

    /// @notice A bearer root may be redeemed by anyone, and re-delegated by anyone.
    function test_AnyDelegate_IsBearerAcrossAHop() public {
        Delegation memory root_ = _signAsAccount(_rootDelegationTo(ANY_DELEGATE));
        Delegation memory child_ = _signAsEoa(
            _link(attacker.addr, sub.addr, EncoderLib._getDelegationHash(root_), _noCaveats()), attacker
        );

        Delegation[] memory chain_ = new Delegation[](2);
        chain_[0] = child_;
        chain_[1] = root_;

        vm.prank(sub.addr);
        _redeem(chain_, merchant, 10_000);
        assertEq(krw.balanceOf(merchant), 10_000, "bearer authority carries through a hop");
    }

    /* -------------------------------------------------------------------------- */
    /*                     A child can only ever narrow                            */
    /* -------------------------------------------------------------------------- */

    /// @notice The whole point of the chain. The agent writes itself a child delegation with a
    ///         cap ten times larger than the one it was given. It does not help: every link's
    ///         caveats run, so the parent's 50,000 still binds.
    function test_Redelegation_ChildCannotWidenParentCap() public {
        Delegation[] memory chain_ = _chainWithChildCap(500_000);

        vm.prank(sub.addr);
        vm.expectRevert("ERC20PeriodTransferEnforcer:transfer-amount-exceeded");
        _redeem(chain_, merchant, 60_000);

        assertEq(krw.balanceOf(merchant), 0, "the parent's cap is not negotiable");
    }

    /// @notice A child restricting itself further is honoured: the binding constraint is whichever
    ///         link is tightest, in either direction.
    function test_Redelegation_ChildCanNarrow() public {
        Delegation[] memory chain_ = _chainWithChildCap(10_000);

        vm.prank(sub.addr);
        vm.expectRevert("ERC20PeriodTransferEnforcer:transfer-amount-exceeded");
        _redeem(chain_, merchant, 30_000); // the ROOT would allow this; the child does not

        vm.prank(sub.addr);
        _redeem(chain_, merchant, 10_000);
        assertEq(krw.balanceOf(merchant), 10_000);
    }

    /// @notice A child cannot escape the payee restriction either - the root's allowlist is
    ///         evaluated no matter what the child says.
    function test_Redelegation_ChildCannotAddAPayee() public {
        Caveat[] memory caveats_ = new Caveat[](1);
        caveats_[0] =
            Caveat({enforcer: address(payeeEnforcer), terms: abi.encodePacked(attacker.addr), args: ""});

        Delegation memory root_ = _signAsAccount(_rootDelegation());
        Delegation memory child_ =
            _signAsEoa(_link(agent.addr, sub.addr, EncoderLib._getDelegationHash(root_), caveats_), agent);

        Delegation[] memory chain_ = new Delegation[](2);
        chain_[0] = child_;
        chain_[1] = root_;

        vm.prank(sub.addr);
        vm.expectRevert(abi.encodeWithSelector(AllowedPayeeEnforcer.PayeeNotAllowed.selector, attacker.addr));
        _redeem(chain_, attacker.addr, 1000);
    }

    /* -------------------------------------------------------------------------- */
    /*                        Forged and broken chains                             */
    /* -------------------------------------------------------------------------- */

    /// @notice A child naming anything other than its parent's hash is not part of that chain.
    function test_RevertWhen_AuthorityLinkIsBroken() public {
        Delegation memory root_ = _signAsAccount(_rootDelegation());
        Delegation memory child_ =
            _signAsEoa(_link(agent.addr, sub.addr, keccak256("not-the-parent"), _noCaveats()), agent);

        Delegation[] memory chain_ = new Delegation[](2);
        chain_[0] = child_;
        chain_[1] = root_;

        vm.prank(sub.addr);
        vm.expectRevert(MapaeDelegationManager.InvalidAuthority.selector);
        _redeem(chain_, merchant, 1000);
    }

    /// @notice The deepest link must be a root. Otherwise a chain could be grafted onto a
    ///         delegation nobody ever signed as an origin.
    function test_RevertWhen_DeepestLinkIsNotARoot() public {
        Delegation memory d_ = _rootDelegation();
        d_.authority = keccak256("a parent that is not in this chain");
        Delegation memory root_ = _signAsAccount(d_);

        Delegation[] memory chain_ = new Delegation[](1);
        chain_[0] = root_;

        vm.prank(agent.addr);
        vm.expectRevert(MapaeDelegationManager.InvalidAuthority.selector);
        _redeem(chain_, merchant, 1000);
    }

    /// @notice The forgery this check exists to stop: the attacker points a child at a real root
    ///         it was never given, and signs it with its own key. The parent delegated to `agent`,
    ///         not to the attacker, so the link does not hold.
    function test_RevertWhen_ChildWasNotDelegatedToBySkippingTheParent() public {
        Delegation memory root_ = _signAsAccount(_rootDelegation());
        Delegation memory forged_ = _signAsEoa(
            _link(attacker.addr, sub.addr, EncoderLib._getDelegationHash(root_), _noCaveats()), attacker
        );

        Delegation[] memory chain_ = new Delegation[](2);
        chain_[0] = forged_;
        chain_[1] = root_;

        vm.prank(sub.addr);
        vm.expectRevert(MapaeDelegationManager.InvalidDelegate.selector);
        _redeem(chain_, merchant, 1000);
    }

    /// @notice The ECDSA path, which only a chain reaches: a child's delegator is an EOA. A
    ///         signature from the wrong key is refused with the EOA-specific error, distinct from
    ///         the ERC-1271 one the root would produce.
    function test_RevertWhen_ChildSignedByTheWrongKey() public {
        Delegation memory root_ = _signAsAccount(_rootDelegation());
        Delegation memory child_ = _signAsEoa(
            _link(agent.addr, sub.addr, EncoderLib._getDelegationHash(root_), _noCaveats()),
            sub // the delegate signing for its own delegator
        );

        Delegation[] memory chain_ = new Delegation[](2);
        chain_[0] = child_;
        chain_[1] = root_;

        vm.prank(sub.addr);
        vm.expectRevert(MapaeDelegationManager.InvalidEOASignature.selector);
        _redeem(chain_, merchant, 1000);
    }

    /// @notice Only the leaf's delegate may redeem, however deep the chain.
    function test_RevertWhen_RedeemerIsNotTheLeafDelegate() public {
        Delegation[] memory chain_ = _defaultChain();

        vm.prank(attacker.addr);
        vm.expectRevert(MapaeDelegationManager.InvalidDelegate.selector);
        _redeem(chain_, merchant, 1000);
    }

    /* -------------------------------------------------------------------------- */
    /*                    Kill switches reach the whole chain                      */
    /* -------------------------------------------------------------------------- */

    /// @notice Alice disables the delegation she signed. She has never heard of the sub-agent, and
    ///         does not need to: killing the root kills everything derived from it.
    function test_DisablingTheRoot_KillsTheChild() public {
        Delegation memory root_ = _signAsAccount(_rootDelegation());
        _disableAsAlice(root_);

        Delegation memory child_ = _signAsEoa(
            _link(agent.addr, sub.addr, EncoderLib._getDelegationHash(root_), _noCaveats()), agent
        );
        Delegation[] memory chain_ = new Delegation[](2);
        chain_[0] = child_;
        chain_[1] = root_;

        vm.prank(sub.addr);
        vm.expectRevert(MapaeDelegationManager.CannotUseADisabledDelegation.selector);
        _redeem(chain_, merchant, 1000);
    }

    /// @notice And the converse, so the two are known to be independent: the agent can retire its
    ///         own sub-delegation without touching the authority it still holds from Alice.
    function test_DisablingTheChild_LeavesTheRootUsable() public {
        Delegation memory root_ = _signAsAccount(_rootDelegation());
        Delegation memory child_ = _signAsEoa(
            _link(agent.addr, sub.addr, EncoderLib._getDelegationHash(root_), _noCaveats()), agent
        );

        vm.prank(agent.addr);
        manager.disableDelegation(child_);

        Delegation[] memory two_ = new Delegation[](2);
        two_[0] = child_;
        two_[1] = root_;
        vm.prank(sub.addr);
        vm.expectRevert(MapaeDelegationManager.CannotUseADisabledDelegation.selector);
        _redeem(two_, merchant, 1000);

        // The root still works for its own delegate.
        Delegation[] memory one_ = new Delegation[](1);
        one_[0] = root_;
        vm.prank(agent.addr);
        _redeem(one_, merchant, 1000);
        assertEq(krw.balanceOf(merchant), 1000);
    }

    /// @notice The thesis, at depth. The sub-agent holds a valid signature from its delegator, the
    ///         cap is unspent, the payee is allowed, no delegation is disabled - and the payment
    ///         dies anyway, because a person three parties away had their attestation revoked.
    ///         Nothing on this chain was touched to make that happen.
    function test_IdentityRevocation_KillsTheEntireChain() public {
        Delegation[] memory chain_ = _defaultChain();

        vm.prank(sub.addr);
        _redeem(chain_, merchant, 1000); // works beforehand

        scroll.revoke(alice.addr, FAUCET_ID);

        vm.prank(sub.addr);
        vm.expectRevert(
            abi.encodeWithSelector(DojangVerifiedEnforcer.NotDojangVerified.selector, alice.addr, FAUCET_ID)
        );
        _redeem(chain_, merchant, 1000);
    }

    /* -------------------------------------------------------------------------- */
    /*                        Salt separates budgets                               */
    /* -------------------------------------------------------------------------- */

    /// @notice Two delegations identical but for their salt are different delegations, with
    ///         independent spend tracking. This is how a delegator issues a second allowance
    ///         without widening the first - and why salt is in the signed payload.
    function test_Salt_SeparatesSpendBudgets() public {
        Delegation memory a_ = _signAsAccount(_rootDelegation());
        Delegation memory bRaw_ = _rootDelegation();
        bRaw_.salt = 2;
        Delegation memory b_ = _signAsAccount(bRaw_);

        assertTrue(
            EncoderLib._getDelegationHash(a_) != EncoderLib._getDelegationHash(b_), "salt changes the hash"
        );

        Delegation[] memory chainA_ = new Delegation[](1);
        chainA_[0] = a_;
        Delegation[] memory chainB_ = new Delegation[](1);
        chainB_[0] = b_;

        vm.prank(agent.addr);
        _redeem(chainA_, merchant, 50_000); // exhausts A

        vm.prank(agent.addr);
        vm.expectRevert("ERC20PeriodTransferEnforcer:transfer-amount-exceeded");
        _redeem(chainA_, merchant, 1);

        vm.prank(agent.addr);
        _redeem(chainB_, merchant, 50_000); // B is untouched
        assertEq(krw.balanceOf(merchant), 100_000);
    }

    /* -------------------------------------------------------------------------- */
    /*                                  Helpers                                    */
    /* -------------------------------------------------------------------------- */

    function _noCaveats() internal pure returns (Caveat[] memory) {
        return new Caveat[](0);
    }

    /// @dev The canonical root: agent may pay merchant up to 50,000/day from Alice's account, only
    ///      while Alice's faucet attestation is live.
    function _rootDelegation() internal view returns (Delegation memory) {
        return _rootDelegationTo(agent.addr);
    }

    function _rootDelegationTo(address delegate_) internal view returns (Delegation memory d) {
        Caveat[] memory caveats_ = new Caveat[](3);
        caveats_[0] = Caveat({
            enforcer: address(dojangEnforcer), terms: abi.encodePacked(FAUCET_ID, alice.addr), args: ""
        });
        caveats_[1] = Caveat({
            enforcer: address(periodEnforcer),
            terms: abi.encodePacked(address(krw), uint256(50_000), uint256(1 days), setupTime),
            args: ""
        });
        caveats_[2] = Caveat({enforcer: address(payeeEnforcer), terms: abi.encodePacked(merchant), args: ""});

        d = Delegation({
            delegate: delegate_,
            delegator: address(account),
            authority: ROOT_AUTHORITY,
            caveats: caveats_,
            salt: 1,
            signature: ""
        });
    }

    function _link(address delegator_, address delegate_, bytes32 authority_, Caveat[] memory caveats_)
        internal
        pure
        returns (Delegation memory)
    {
        return Delegation({
            delegate: delegate_,
            delegator: delegator_,
            authority: authority_,
            caveats: caveats_,
            salt: 1,
            signature: ""
        });
    }

    /// @dev Signed by Alice, validated through the account's ERC-1271.
    function _signAsAccount(Delegation memory d) internal view returns (Delegation memory) {
        return _sign(d, alice.privateKey);
    }

    /// @dev Signed by an EOA delegator, validated through ECDSA recovery.
    function _signAsEoa(Delegation memory d, Vm.Wallet memory signer)
        internal
        view
        returns (Delegation memory)
    {
        return _sign(d, signer.privateKey);
    }

    function _sign(Delegation memory d, uint256 pk) internal view returns (Delegation memory) {
        bytes32 typed_ = MessageHashUtils.toTypedDataHash(domainHash, EncoderLib._getDelegationHash(d));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, typed_);
        d.signature = abi.encodePacked(r, s, v);
        return d;
    }

    function _defaultChain() internal view returns (Delegation[] memory chain_) {
        Delegation memory root_ = _signAsAccount(_rootDelegation());
        Delegation memory child_ = _signAsEoa(
            _link(agent.addr, sub.addr, EncoderLib._getDelegationHash(root_), _noCaveats()), agent
        );
        chain_ = new Delegation[](2);
        chain_[0] = child_;
        chain_[1] = root_;
    }

    function _chainWithChildCap(uint256 cap_) internal view returns (Delegation[] memory chain_) {
        Caveat[] memory caveats_ = new Caveat[](1);
        caveats_[0] = Caveat({
            enforcer: address(periodEnforcer),
            terms: abi.encodePacked(address(krw), cap_, uint256(1 days), setupTime),
            args: ""
        });

        Delegation memory root_ = _signAsAccount(_rootDelegation());
        Delegation memory child_ =
            _signAsEoa(_link(agent.addr, sub.addr, EncoderLib._getDelegationHash(root_), caveats_), agent);
        chain_ = new Delegation[](2);
        chain_[0] = child_;
        chain_[1] = root_;
    }

    function _disableAsAlice(Delegation memory d) internal {
        vm.prank(alice.addr);
        account.execute(
            ModeLib.encodeSimpleSingle(),
            ExecutionLib.encodeSingle(
                address(manager), 0, abi.encodeCall(MapaeDelegationManager.disableDelegation, (d))
            )
        );
    }

    function _redeem(Delegation[] memory chain_, address to_, uint256 amount_) internal {
        bytes[] memory ctx_ = new bytes[](1);
        ctx_[0] = abi.encode(chain_);
        bytes32[] memory modes_ = new bytes32[](1);
        modes_[0] = bytes32(0);
        bytes[] memory execs_ = new bytes[](1);
        execs_[0] = ExecutionLib.encodeSingle(
            address(krw), 0, abi.encodeWithSelector(IERC20.transfer.selector, to_, amount_)
        );
        manager.redeemDelegations(ctx_, modes_, execs_);
    }

    function _redeemTwoHop(Delegation[] memory chain_, address to_, uint256 amount_) internal {
        vm.prank(sub.addr);
        _redeem(chain_, to_, amount_);
    }
}
