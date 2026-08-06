// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {MapaeAccount} from "../../src/MapaeAccount.sol";
import {MapaeAccountFactory} from "../../src/MapaeAccountFactory.sol";
import {DojangVerifiedEnforcer, IMapaeAccountRegistry} from "../../src/enforcers/DojangVerifiedEnforcer.sol";
import {AllowedPayeeEnforcer} from "../../src/enforcers/AllowedPayeeEnforcer.sol";
import {PerPaymentLimitEnforcer} from "../../src/enforcers/PerPaymentLimitEnforcer.sol";
import {MockDojangScroll} from "../../src/mocks/MockDojangScroll.sol";
import {MockKRW} from "../../src/mocks/MockKRW.sol";
import {IDojangScroll} from "../../src/interfaces/IDojangScroll.sol";
import {Delegation, Caveat, ModeCode} from "../../src/utils/Types.sol";
import {ROOT_AUTHORITY} from "../../src/utils/Constants.sol";
import {EncoderLib} from "../../src/libraries/EncoderLib.sol";
import {ExecutionLib} from "../../src/libraries/ExecutionLib.sol";
import {ModeLib} from "../../src/libraries/ModeLib.sol";

interface IForeignDelegationManager {
    function getDomainHash() external view returns (bytes32);
    function redeemDelegations(
        bytes[] calldata permissionContexts,
        bytes32[] calldata modes,
        bytes[] calldata executionCallDatas
    ) external;
}

/// @notice Mapae's conditions, executed by a delegation manager Mapae did not write.
///
/// @dev This repository claims its conditions are portable: that adopting the MetaMask delegation
///      framework's structures byte-for-byte means an enforcer written here runs anywhere that
///      framework runs. The claim costs nothing to make. This suite makes something outside the
///      repository confirm it.
///
///      The manager is **MetaMask's own**, deployed by MetaMask on Ethereum Sepolia at the address
///      their repository publishes for v1.3.0. Nothing here is deployed by us and nothing here is
///      on GIWA. `redeemDelegations` is called on their contract, so their signature validation,
///      their chain walking and their hook ordering are what drive the enforcers below. Pranking
///      as their address would have proven nothing - any address can be pranked.
///
///      The EIP-712 domain is READ from their contract rather than assumed. If the two frameworks
///      had drifted, that read is where this test would start failing.
///
///      **What does not port is the point.** DojangScroll exists only on GIWA, so identity has to
///      be mocked here: the machine travels, the meaning does not. An enforcer that asks "is this
///      person verified" is only worth deploying on a chain that can answer, which is the argument
///      for GIWA stated as a test rather than a sentence. Liveness against the real DojangScroll
///      is proven separately, on a GIWA fork, in DojangFork.t.sol.
///
///      The fork is not pinned to a block: public Sepolia endpoints keep no archive state, and the
///      property under test - their deployed bytecode - does not change between blocks.
///
///      Run: ETH_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com \
///           forge test --match-path 'test/fork/MetaMaskPortability.t.sol'
contract MetaMaskPortabilityTest is Test {
    /// MetaMask delegation-framework v1.3.0, deployed by MetaMask.
    /// Source: MetaMask/delegation-framework documents/Deployments.md
    address internal constant METAMASK_DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;

    /// True when the fork actually came up.
    ///
    /// `forge test` is the first command anyone runs after cloning, and these two suites are the
    /// only ones that can fail for a reason that is not ours: a public endpoint being down, rate
    /// limiting, or a timeout while the fork pulls state. Failing the whole run on that teaches a
    /// reader the repository is broken when it is the internet that is having a moment. Caught
    /// here and reported as SKIP, so a green run means what it says and a skipped one is legible.
    bool internal forked;
    string internal constant ETH_SEPOLIA_PUBLIC_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

    bytes32 internal constant ATTESTER = keccak256("dojang.dojangattesterids.upbitkorea");

    IForeignDelegationManager internal theirManager = IForeignDelegationManager(METAMASK_DELEGATION_MANAGER);

    MapaeAccountFactory internal factory;
    MapaeAccount internal account;
    DojangVerifiedEnforcer internal dojang;
    AllowedPayeeEnforcer internal payee;
    PerPaymentLimitEnforcer internal perPayment;
    MockDojangScroll internal scroll;
    MockKRW internal krw;

    Vm.Wallet internal alice;
    address internal agent = address(0xA9E17);
    address internal merchant = address(0x8ACD);
    address internal outsider = address(0xBAD);

    bytes32 internal theirDomain;

    function setUp() public {
        // Defaulted, for the same reason DojangFork defaults its own: a fresh clone has no .env,
        // and `forge test` failing on that reads as a broken repository rather than a missing
        // setting. Set the variable to use a different endpoint.
        // Two gates, and they answer different questions.
        //
        // The first is intent. `forge test` is the first command anyone runs after cloning, and it
        // should tell them whether OUR code works - so it must not depend on a shared public
        // endpoint being healthy. Measured across cold clones, one run in three failed on rate
        // limits or timeouts that had nothing to do with this repository. These suites are
        // therefore opt-in, and CI opts in.
        //
        // The second is reality. Even when asked for, the endpoint can be down, so the fork is
        // attempted rather than assumed. Either way the result is SKIP, never a red run someone
        // has to investigate.
        if (!vm.envOr("FORK_TESTS", false)) return;
        try vm.createSelectFork(vm.envOr("ETH_SEPOLIA_RPC_URL", string(ETH_SEPOLIA_PUBLIC_RPC))) {
            forked = true;
        } catch {
            return;
        }

        // A seed whose address is not already occupied on the live chain.
        //
        // The obvious one is not safe here: vm.createWallet("alice") derives an address that
        // carries 23 bytes of code on Sepolia - the length of an EIP-7702 delegation designator,
        // because somebody has delegated that well-known test address. SignatureChecker sees code
        // and takes the ERC-1271 path, so owner consent fails for a reason that has nothing to do
        // with this test. The assertion below makes that failure mode loud rather than puzzling.
        alice = vm.createWallet("mapae-portability-principal");
        require(alice.addr.code.length == 0, "seed address is occupied on this chain - pick another");
        scroll = new MockDojangScroll();
        krw = new MockKRW();
        scroll.issue(alice.addr, ATTESTER, keccak256("uid"), 0);

        // Everything on the Mapae side is built pointing at THEIR manager.
        factory = new MapaeAccountFactory(METAMASK_DELEGATION_MANAGER);
        dojang = new DojangVerifiedEnforcer(
            IDojangScroll(address(scroll)), IMapaeAccountRegistry(address(factory))
        );
        payee = new AllowedPayeeEnforcer();
        perPayment = new PerPaymentLimitEnforcer();

        bytes32 digest_ = factory.creationDigest(alice.addr, 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alice.privateKey, digest_);
        account = MapaeAccount(payable(factory.createAccount(alice.addr, 0, abi.encodePacked(r, s, v))));
        krw.mint(address(account), 1_000_000);

        theirDomain = theirManager.getDomainHash();
    }

    /// @notice The address holds their manager, and it answers as a delegation manager should.
    function test_TheirManagerIsLiveAndSpeaksTheSameProtocol() public {
        vm.skip(!forked);
        assertGt(METAMASK_DELEGATION_MANAGER.code.length, 1000, "their manager is not deployed here");
        assertTrue(theirDomain != bytes32(0), "their EIP-712 domain did not read back");
    }

    /// @notice A payment authorised by a Mapae delegation, executed by their manager.
    ///
    /// @dev Every condition in this delegation was written in this repository; every line that
    ///      validates the signature, walks the chain and calls those conditions belongs to
    ///      MetaMask. If the structures had drifted by one byte, this reverts.
    function test_TheirManagerSettlesAMapaeDelegation() public {
        vm.skip(!forked);
        Delegation memory d_ = _signed(_mapaeCaveats());

        vm.prank(agent);
        theirManager.redeemDelegations(_ctx(d_), _modes(), _execs(_transfer(merchant, 10_000)));

        assertEq(krw.balanceOf(merchant), 10_000, "their manager did not move the funds");
        assertEq(krw.balanceOf(address(account)), 990_000, "the account was not debited");
    }

    /// @notice The identity condition refuses under their manager, exactly as under ours.
    ///
    /// @dev The revoked attestation is the whole Mapae thesis, and this is it running on somebody
    ///      else's redemption path: nothing about the delegation changed except who the principal
    ///      is to the identity registry.
    function test_TheirManagerRefusesWhenIdentityIsRevoked() public {
        vm.skip(!forked);
        Delegation memory d_ = _signed(_mapaeCaveats());
        scroll.revoke(alice.addr, ATTESTER);

        vm.prank(agent);
        vm.expectRevert();
        theirManager.redeemDelegations(_ctx(d_), _modes(), _execs(_transfer(merchant, 10_000)));

        assertEq(krw.balanceOf(merchant), 0, "a payment settled without a live identity");
    }

    /// @notice The payee set refuses an address outside it, under their manager.
    function test_TheirManagerRefusesAnUnlistedPayee() public {
        vm.skip(!forked);
        Delegation memory d_ = _signed(_mapaeCaveats());

        vm.prank(agent);
        vm.expectRevert();
        theirManager.redeemDelegations(_ctx(d_), _modes(), _execs(_transfer(outsider, 1000)));

        assertEq(krw.balanceOf(outsider), 0, "an unlisted payee was paid");
    }

    /// @notice The per-payment ceiling refuses one over, under their manager.
    function test_TheirManagerRefusesOverTheCeiling() public {
        vm.skip(!forked);
        Delegation memory d_ = _signed(_mapaeCaveats());

        vm.prank(agent);
        vm.expectRevert();
        theirManager.redeemDelegations(_ctx(d_), _modes(), _execs(_transfer(merchant, 10_001)));

        assertEq(krw.balanceOf(merchant), 0, "a payment over the ceiling settled");
    }

    /* ------------------------------------ helpers ----------------------------------- */

    /// The three conditions written in this repository: identity, payee set, per-payment ceiling.
    function _mapaeCaveats() internal view returns (Caveat[] memory caveats_) {
        caveats_ = new Caveat[](3);
        caveats_[0] =
            Caveat({enforcer: address(dojang), terms: abi.encodePacked(ATTESTER, alice.addr), args: ""});
        caveats_[1] = Caveat({enforcer: address(payee), terms: abi.encodePacked(merchant), args: ""});
        caveats_[2] = Caveat({enforcer: address(perPayment), terms: abi.encode(uint256(10_000)), args: ""});
    }

    /// Signed against THEIR domain, by the account's owner, validated through ERC-1271.
    function _signed(Caveat[] memory caveats_) internal returns (Delegation memory) {
        Delegation memory d_ = Delegation({
            delegate: agent,
            delegator: address(account),
            authority: ROOT_AUTHORITY,
            caveats: caveats_,
            salt: 1,
            signature: ""
        });
        bytes32 typed_ = MessageHashUtils.toTypedDataHash(theirDomain, EncoderLib._getDelegationHash(d_));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alice.privateKey, typed_);
        d_.signature = abi.encodePacked(r, s, v);
        return d_;
    }

    function _transfer(address to_, uint256 amount_) internal view returns (bytes memory) {
        return ExecutionLib.encodeSingle(
            address(krw), 0, abi.encodeWithSignature("transfer(address,uint256)", to_, amount_)
        );
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
