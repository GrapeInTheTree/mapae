// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {
    IDojangScroll,
    IDojangVerifierErrors,
    IDojangAttesterBook,
    IGiwaFaucetExtension
} from "../../src/interfaces/IDojangScroll.sol";
import {DojangConstants} from "../../src/libraries/DojangConstants.sol";

/// @title DojangForkTest
/// @notice Block 0 gate. Proves, against the REAL Dojang deployment on GIWA Sepolia, that every
///         assumption Mapae's identity gate rests on actually holds.
/// @dev Pinned to a fixed block so the suite is deterministic, cacheable, and immune to the anchor
///      attestation later being revoked. Run with:
///        GIWA_SEPOLIA_RPC_URL=https://sepolia-rpc.giwa.io forge test --match-path 'test/fork/*'
contract DojangForkTest is Test {
    /// @dev Head at 2026-07-29. Every value asserted below was read live at this height.
    string internal constant GIWA_SEPOLIA_PUBLIC_RPC = "https://sepolia-rpc.giwa.io";

    /// True when the fork actually came up.
    ///
    /// `forge test` is the first command anyone runs after cloning, and these two suites are the
    /// only ones that can fail for a reason that is not ours: a public endpoint being down, rate
    /// limiting, or a timeout while the fork pulls state. Failing the whole run on that teaches a
    /// reader the repository is broken when it is the internet that is having a moment. Caught
    /// here and reported as SKIP, so a green run means what it says and a skipped one is legible.
    bool internal forked;
    uint256 internal constant FORK_BLOCK = 31_909_542;

    /// @dev A real EOA holding a live, never-expiring Upbit Korea Verified Address attestation.
    ///      We have no relationship with Upbit; this address is simply public chain state, which is
    ///      what lets us prove the gate works against genuine KYC without holding any KYC ourselves.
    address internal constant UPBIT_VERIFIED_EOA = 0x45C735549991552d8F6f38F8ac1b4D26Ce25C8Cc;
    bytes32 internal constant UPBIT_VERIFIED_UID =
        0xd6e7d84d15009c54298833d263dcc20f663262d886d95aae64f28f7233705fd1;

    address internal constant UPBIT_ATTESTER = 0x09B170CA2A006081042992bCE7379B85a02149C6;

    IDojangScroll internal scroll = IDojangScroll(DojangConstants.DOJANG_SCROLL);
    IDojangAttesterBook internal attesterBook = IDojangAttesterBook(DojangConstants.DOJANG_ATTESTER_BOOK);
    IGiwaFaucetExtension internal faucet = IGiwaFaucetExtension(DojangConstants.GIWA_FAUCET_EXTENSION);

    function setUp() public {
        // Defaulted rather than required. `forge test` is the first command anyone runs after
        // cloning, and a suite that dies on a missing variable teaches them the repository is
        // broken. The endpoint is public and already published in this file's header, so there is
        // nothing here to keep in a .env - set the variable only to point somewhere else.
        try vm.createSelectFork(
            vm.envOr("GIWA_SEPOLIA_RPC_URL", string(GIWA_SEPOLIA_PUBLIC_RPC)), FORK_BLOCK
        ) {
            forked = true;
        } catch {
            return;
        }
    }

    /* -------------------------------------------------------------------------- */
    /*                        Constants are derived, not copied                    */
    /* -------------------------------------------------------------------------- */

    /// @notice The attester ids are keccak namespaces, not magic numbers.
    function test_AttesterIdDerivation() public {
        vm.skip(!forked);
        assertEq(
            DojangConstants.UPBIT_KOREA,
            keccak256("dojang.dojangattesterids.upbitkorea"),
            "UPBIT_KOREA id mismatch"
        );
        assertEq(
            DojangConstants.TESTNET_FAUCET,
            keccak256("dojang.dojangattesterids.testnetfaucet"),
            "TESTNET_FAUCET id mismatch"
        );
    }

    /// @notice The attester ids resolve to the addresses we claim they do.
    function test_AttesterBookResolvesIssuers() public {
        vm.skip(!forked);
        assertEq(
            attesterBook.getAttester(DojangConstants.UPBIT_KOREA), UPBIT_ATTESTER, "Upbit attester mismatch"
        );
        assertEq(
            attesterBook.getAttester(DojangConstants.TESTNET_FAUCET),
            DojangConstants.GIWA_FAUCET_EXTENSION,
            "Faucet attester mismatch"
        );
    }

    /* -------------------------------------------------------------------------- */
    /*                          The gate, against real state                       */
    /* -------------------------------------------------------------------------- */

    /// @notice A genuine Upbit-KYC'd address passes under the Upbit attester id.
    function test_UpbitVerifiedEoa_Passes() public {
        vm.skip(!forked);
        assertTrue(
            scroll.isVerified(UPBIT_VERIFIED_EOA, DojangConstants.UPBIT_KOREA),
            "Upbit anchor should be verified"
        );
        assertEq(
            scroll.getVerifiedAddressAttestationUid(UPBIT_VERIFIED_EOA, DojangConstants.UPBIT_KOREA),
            UPBIT_VERIFIED_UID,
            "attestation uid mismatch"
        );
    }

    /// @notice The gate discriminates by ISSUER, not merely by "has some attestation".
    /// @dev This is the property that makes an identity caveat meaningful: a delegation scoped to
    ///      Upbit Korea cannot be satisfied by a self-issued testnet attestation.
    function test_UpbitVerifiedEoa_FailsUnderFaucetId() public {
        vm.skip(!forked);
        assertFalse(
            scroll.isVerified(UPBIT_VERIFIED_EOA, DojangConstants.TESTNET_FAUCET),
            "Upbit anchor must not be verified under the faucet issuer"
        );
    }

    /// @notice An address with no attestation fails.
    function test_UnattestedAddress_IsNotVerified() public {
        vm.skip(!forked);
        assertFalse(scroll.isVerified(address(0xdead), DojangConstants.UPBIT_KOREA));
        assertFalse(scroll.isVerified(address(0xdead), DojangConstants.TESTNET_FAUCET));
    }

    /// @notice `getVerifiedAddressAttestationUid` reverts for subjects with no attestation.
    /// @dev This is the empirical basis for the enforcer calling `isVerified` FIRST. Note the
    ///      revert is `AttestationVerifier.ZeroUid`, NOT the `NotVerifiedAddress(address)` that
    ///      Dojang's own interface declares - the declared error is never thrown by the deployed
    ///      implementation. Recorded in docs/GAPS.md.
    function test_GetUid_RevertsForUnattested() public {
        vm.skip(!forked);
        vm.expectRevert(IDojangVerifierErrors.ZeroUid.selector);
        scroll.getVerifiedAddressAttestationUid(address(0xdead), DojangConstants.UPBIT_KOREA);
    }

    /// @notice Pin the revert selector, so a Dojang upgrade that changes it fails loudly here.
    function test_ZeroUid_SelectorIsPinned() public {
        vm.skip(!forked);
        assertEq(bytes4(IDojangVerifierErrors.ZeroUid.selector), bytes4(0x6e7910da), "selector drift");
        // The declared-but-unthrown interface error, pinned so the discrepancy stays visible.
        assertEq(bytes4(IDojangScroll.NotVerifiedAddress.selector), bytes4(0xab9797df), "selector drift");
    }

    /// @notice After revocation, the boolean gate is false and the uid getter reverts as revoked.
    /// @dev Confirms the deployed implementation matches giwa-io/dojang @ main: revocation does NOT
    ///      de-index (`AddressIndexingResolverUpgradeable.onRevoke` returns true and clears
    ///      nothing, documenting that the indexer "is not the source of truth for an attestation's
    ///      liveness"). The uid stays indexed and `AttestationVerifier.verify` rejects it on the
    ///      revocation check, so the read path reverts `RevokedAttestation(uid, revocationTime)`.
    ///
    ///      That design is exactly what Mapae's identity gate depends on: liveness is decided at
    ///      the moment of the read, never cached at issuance. A delegation signed while verified
    ///      stops being redeemable the instant the attestation is revoked, with no action by us.
    function test_RevokedAttestation_KillsBothReadPaths() public {
        vm.skip(!forked);
        address bob = makeAddr("bob");
        vm.deal(bob, 1 ether);

        // Cache the fee BEFORE pranking: an inline `faucet.fee()` in the call arguments is
        // evaluated first and consumes the prank, so the attestation would be issued to this test
        // contract instead of `bob`.
        uint256 fee = faucet.fee();

        vm.prank(bob);
        faucet.payAndIssueEAS{value: fee}();
        bytes32 uid = scroll.getVerifiedAddressAttestationUid(bob, DojangConstants.TESTNET_FAUCET);
        assertTrue(uid != bytes32(0), "uid should exist after issuance");

        vm.prank(bob);
        faucet.revokeEAS();

        // The form Mapae gates on: simply false, no revert, no error-shape coupling.
        assertFalse(
            scroll.isVerified(bob, DojangConstants.TESTNET_FAUCET),
            "revocation must be visible to the boolean gate immediately"
        );

        // The reverting form: still indexed, but rejected as revoked. Unusable as a gate without a
        // prior isVerified check, and coupled to Dojang's internal error shape - which is why
        // Mapae never calls it before gating.
        vm.expectPartialRevert(IDojangVerifierErrors.RevokedAttestation.selector);
        scroll.getVerifiedAddressAttestationUid(bob, DojangConstants.TESTNET_FAUCET);
    }

    /// @notice Expiry is honoured by the same boolean gate, without any revocation involved.
    /// @dev Faucet attestations carry a 30-day expiry. Warping past it must close the gate - this
    ///      is the second liveness dimension Mapae inherits for free by checking at redemption
    ///      rather than caching at issuance.
    function test_ExpiredAttestation_ClosesTheGate() public {
        vm.skip(!forked);
        address carol = makeAddr("carol");
        vm.deal(carol, 1 ether);
        uint256 fee = faucet.fee(); // hoisted - see note in the revocation test

        vm.prank(carol);
        faucet.payAndIssueEAS{value: fee}();
        assertTrue(scroll.isVerified(carol, DojangConstants.TESTNET_FAUCET), "issued");

        vm.warp(block.timestamp + 31 days);
        assertFalse(scroll.isVerified(carol, DojangConstants.TESTNET_FAUCET), "expiry must close the gate");
    }

    /* -------------------------------------------------------------------------- */
    /*                     Self-service issuance and revocation                    */
    /* -------------------------------------------------------------------------- */

    /// @notice An arbitrary EOA can obtain, and then revoke, its own Dojang attestation.
    /// @dev This is what makes the live demo's "revoke identity -> payment dies -> re-issue ->
    ///      payment lives" sequence real transactions rather than a simulation. It also proves the
    ///      gate is driven by liveness at the point of use, exactly as Dojang's own resolver
    ///      documents.
    function test_FaucetAttester_IssueThenRevoke() public {
        vm.skip(!forked);
        address alice = makeAddr("alice");
        uint256 fee = faucet.fee();
        assertEq(fee, 1e15, "fee drifted from 0.001 ETH - read at runtime, never hardcode");
        vm.deal(alice, 1 ether);

        assertFalse(scroll.isVerified(alice, DojangConstants.TESTNET_FAUCET), "alice starts unverified");

        vm.prank(alice);
        faucet.payAndIssueEAS{value: fee}();
        assertTrue(scroll.isVerified(alice, DojangConstants.TESTNET_FAUCET), "issuance failed");

        // Holding a faucet attestation must not confer the Upbit one.
        assertFalse(scroll.isVerified(alice, DojangConstants.UPBIT_KOREA), "issuer isolation broken");

        vm.prank(alice);
        faucet.revokeEAS();
        assertFalse(
            scroll.isVerified(alice, DojangConstants.TESTNET_FAUCET),
            "revocation must be observed immediately at the read path"
        );
    }
}
