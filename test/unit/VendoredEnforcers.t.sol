// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MapaeAccount} from "../../src/MapaeAccount.sol";
import {MapaeAccountFactory} from "../../src/MapaeAccountFactory.sol";
import {MapaeDelegationManager} from "../../src/MapaeDelegationManager.sol";
import {CaveatEnforcer} from "../../src/enforcers/CaveatEnforcer.sol";
import {ERC20PeriodTransferEnforcer} from "../../src/enforcers/ERC20PeriodTransferEnforcer.sol";
import {TimestampEnforcer} from "../../src/enforcers/TimestampEnforcer.sol";
import {MockKRW} from "../../src/mocks/MockKRW.sol";
import {ModeCode, ModePayload} from "../../src/utils/Types.sol";
import {ExecutionLib} from "../../src/libraries/ExecutionLib.sol";
import {
    ModeLib,
    CALLTYPE_SINGLE,
    CALLTYPE_BATCH,
    EXECTYPE_DEFAULT,
    EXECTYPE_TRY,
    MODE_DEFAULT
} from "../../src/libraries/ModeLib.sol";

/// @dev Exercises the two base modifiers no Mapae enforcer uses. They are part of the vendored
///      surface MetaMask's own enforcers rely on, so "their enforcers drop into our manager" is a
///      claim about this base class working, not merely being present.
contract ModeGatedEnforcer is CaveatEnforcer {
    function requireBatch(ModeCode _mode) external onlyBatchCallTypeMode(_mode) {}

    function requireTry(ModeCode _mode) external onlyTryExecutionMode(_mode) {}
}

/// @dev Reverts with no return data at all, which is the one execution failure the account cannot
///      bubble and must translate itself.
contract SilentReverter {
    fallback() external payable {
        assembly {
            revert(0, 0)
        }
    }
}

/// @title VendoredEnforcersTest
/// @notice Coverage for the code Mapae vendored rather than wrote: MetaMask's spend and time
///         enforcers and their shared base. The demo only ever walks the happy path and the
///         cap-exceeded path through these; everything else - malformed terms, misconfigured
///         periods, the read-only projection a client uses to show a remaining balance - is
///         equally live in production and is pinned here.
contract VendoredEnforcersTest is Test {
    ERC20PeriodTransferEnforcer internal period;
    TimestampEnforcer internal timestamps;
    MockKRW internal krw;

    address internal merchant = address(0xCAFE);
    bytes32 internal constant H = keccak256("delegation");
    uint256 internal start;

    function setUp() public {
        vm.warp(1_753_770_000);
        start = block.timestamp;
        period = new ERC20PeriodTransferEnforcer();
        timestamps = new TimestampEnforcer();
        krw = new MockKRW();
    }

    /* -------------------------------------------------------------------------- */
    /*                     Period enforcer: malformed inputs                       */
    /* -------------------------------------------------------------------------- */

    function test_RevertWhen_PeriodTermsAreNot116Bytes() public {
        vm.expectRevert("ERC20PeriodTransferEnforcer:invalid-terms-length");
        period.getTermsInfo(abi.encodePacked(address(krw), uint256(1)));
    }

    function test_RevertWhen_ExecutionIsNotATransferCall() public {
        // A 68-byte calldata is required; anything else cannot be an ERC20 transfer.
        bytes memory exec_ =
            ExecutionLib.encodeSingle(address(krw), 0, abi.encodePacked(IERC20.transfer.selector));
        vm.expectRevert("ERC20PeriodTransferEnforcer:invalid-execution-length");
        _before(_terms(50_000, 1 days, start), exec_);
    }

    /// @notice The right length and the right token, but the wrong method. `approve(address,uint256)`
    ///         is byte-for-byte the same shape as a transfer, and would hand over an unbounded
    ///         allowance while consuming nothing from the period budget.
    function test_RevertWhen_MethodIsApproveRatherThanTransfer() public {
        bytes memory exec_ = ExecutionLib.encodeSingle(
            address(krw), 0, abi.encodeWithSelector(IERC20.approve.selector, merchant, uint256(30_000))
        );
        vm.expectRevert("ERC20PeriodTransferEnforcer:invalid-method");
        _before(_terms(50_000, 1 days, start), exec_);
    }

    /// @notice The three configuration guards. Each fires only on a delegation's FIRST use, when
    ///         the allowance is written from terms - which is exactly when a bad configuration
    ///         would otherwise be locked in.
    function test_RevertWhen_PeriodIsMisconfigured() public {
        vm.expectRevert("ERC20PeriodTransferEnforcer:invalid-zero-start-date");
        _before(_terms(50_000, 1 days, 0), _transfer(30_000));

        vm.expectRevert("ERC20PeriodTransferEnforcer:invalid-zero-period-amount");
        _before(_terms(0, 1 days, start), _transfer(30_000));

        vm.expectRevert("ERC20PeriodTransferEnforcer:invalid-zero-period-duration");
        _before(_terms(50_000, 0, start), _transfer(30_000));
    }

    /* -------------------------------------------------------------------------- */
    /*                  Period enforcer: the read-only projection                  */
    /* -------------------------------------------------------------------------- */

    /// @notice Before a delegation has ever been used there is no stored allowance, so the view
    ///         projects one from the signed terms. A wallet can show a remaining balance for a
    ///         delegation that has never been redeemed.
    function test_AvailableAmount_IsSimulatedBeforeFirstUse() public view {
        (uint256 available_, bool isNew_, uint256 currentPeriod_) =
            period.getAvailableAmount(H, address(this), _terms(50_000, 1 days, start));

        assertEq(available_, 50_000, "full period amount");
        assertTrue(isNew_, "nothing spent yet, so the period is fresh");
        assertEq(currentPeriod_, 1, "periods are 1-indexed");
    }

    /// @notice A delegation whose window has not opened yet reports nothing available, rather than
    ///         a period index computed from a negative elapsed time.
    function test_AvailableAmount_IsZeroBeforeTheStartDate() public view {
        (uint256 available_, bool isNew_, uint256 currentPeriod_) =
            period.getAvailableAmount(H, address(this), _terms(50_000, 1 days, start + 7 days));

        assertEq(available_, 0);
        assertFalse(isNew_);
        assertEq(currentPeriod_, 0);
    }

    /// @notice After a partial spend the view reflects the remainder, and after the period rolls
    ///         over it reports the full amount again - the unused part of a period is forfeited,
    ///         not carried.
    function test_AvailableAmount_TracksSpendThenResetsOnRollover() public {
        bytes memory terms_ = _terms(50_000, 1 days, start);
        _before(terms_, _transfer(30_000));

        (uint256 available_,, uint256 periodA_) = period.getAvailableAmount(H, address(this), terms_);
        assertEq(available_, 20_000, "remainder of the current period");
        assertEq(periodA_, 1);

        vm.warp(start + 1 days);
        (uint256 afterRoll_, bool isNew_, uint256 periodB_) =
            period.getAvailableAmount(H, address(this), terms_);
        assertEq(afterRoll_, 50_000, "a new period starts whole");
        assertTrue(isNew_);
        assertEq(periodB_, 2);

        // And the enforcer agrees when actually spending.
        _before(terms_, _transfer(50_000));
    }

    /// @notice Once initialised, the stored allowance wins over the terms passed to the view. A
    ///         caller cannot ask "what if the cap were larger" and get a useful answer.
    function test_AvailableAmount_IgnoresTermsOnceInitialised() public {
        bytes memory terms_ = _terms(50_000, 1 days, start);
        _before(terms_, _transfer(50_000));

        (uint256 available_,,) = period.getAvailableAmount(H, address(this), _terms(999_999, 1 days, start));
        assertEq(available_, 0, "the stored allowance is the source of truth");
    }

    /* -------------------------------------------------------------------------- */
    /*                             Timestamp enforcer                              */
    /* -------------------------------------------------------------------------- */

    function test_TimestampTermsRoundTrip() public view {
        (uint128 after_, uint128 before_) =
            timestamps.getTermsInfo(abi.encodePacked(uint128(111), uint128(222)));
        assertEq(after_, 111);
        assertEq(before_, 222);
    }

    function test_RevertWhen_TimestampTermsAreNot32Bytes() public {
        vm.expectRevert("TimestampEnforcer:invalid-terms-length");
        timestamps.getTermsInfo(abi.encodePacked(uint128(1)));
    }

    /* -------------------------------------------------------------------------- */
    /*                       The shared enforcer base                              */
    /* -------------------------------------------------------------------------- */

    /// @notice The batch and try-mode gates, which Mapae's own enforcers deliberately never use
    ///         but MetaMask's do. Both directions of each are checked so the vendored base is
    ///         known to work, not merely known to compile.
    function test_BaseModifiersGateOnMode() public {
        ModeGatedEnforcer gated_ = new ModeGatedEnforcer();
        ModeCode batch_ = ModeLib.encode(CALLTYPE_BATCH, EXECTYPE_DEFAULT, MODE_DEFAULT, ModePayload.wrap(0));
        ModeCode trySingle_ = ModeLib.encode(CALLTYPE_SINGLE, EXECTYPE_TRY, MODE_DEFAULT, ModePayload.wrap(0));

        gated_.requireBatch(batch_);
        vm.expectRevert("CaveatEnforcer:invalid-call-type");
        gated_.requireBatch(ModeLib.encodeSimpleSingle());

        gated_.requireTry(trySingle_);
        vm.expectRevert("CaveatEnforcer:invalid-execution-type");
        gated_.requireTry(ModeLib.encodeSimpleSingle());
    }

    /* -------------------------------------------------------------------------- */
    /*                     Account and factory leftovers                           */
    /* -------------------------------------------------------------------------- */

    /// @notice A callee that reverts with no data at all cannot be bubbled, so the account must
    ///         supply an error of its own rather than succeeding silently.
    function test_RevertWhen_CalleeRevertsWithNoData() public {
        MapaeDelegationManager manager_ = new MapaeDelegationManager();
        MapaeAccountFactory factory_ = new MapaeAccountFactory(address(manager_));
        Vm.Wallet memory owner_ = vm.createWallet("owner");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(owner_.privateKey, factory_.creationDigest(owner_.addr, 0));
        MapaeAccount account_ = factory_.createAccount(owner_.addr, 0, abi.encodePacked(r, s, v));

        address silent_ = address(new SilentReverter());

        vm.prank(owner_.addr);
        vm.expectRevert(MapaeAccount.ExecutionFailed.selector);
        account_.execute(ModeLib.encodeSimpleSingle(), ExecutionLib.encodeSingle(silent_, 0, hex"1234"));
    }

    function test_FactoryDomainSeparatorIsStable() public {
        MapaeDelegationManager manager_ = new MapaeDelegationManager();
        MapaeAccountFactory factory_ = new MapaeAccountFactory(address(manager_));
        assertTrue(factory_.domainSeparator() != bytes32(0));
        assertEq(factory_.domainSeparator(), factory_.domainSeparator());
    }

    /* -------------------------------------------------------------------------- */
    /*                                  Helpers                                    */
    /* -------------------------------------------------------------------------- */

    function _terms(uint256 amount_, uint256 duration_, uint256 start_) internal view returns (bytes memory) {
        return abi.encodePacked(address(krw), amount_, duration_, start_);
    }

    function _transfer(uint256 amount_) internal view returns (bytes memory) {
        return ExecutionLib.encodeSingle(
            address(krw), 0, abi.encodeWithSelector(IERC20.transfer.selector, merchant, amount_)
        );
    }

    /// @dev Calls the hook the way the manager would, with this test standing in as the manager -
    ///      which is the whole reason the enforcer's state is keyed by `msg.sender`.
    function _before(bytes memory terms_, bytes memory exec_) internal {
        period.beforeHook(terms_, "", ModeLib.encodeSimpleSingle(), exec_, H, address(0), address(0));
    }
}
