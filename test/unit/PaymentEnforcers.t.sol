// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AllowedPayeeEnforcer} from "../../src/enforcers/AllowedPayeeEnforcer.sol";
import {ERC20PeriodTransferEnforcer} from "../../src/enforcers/ERC20PeriodTransferEnforcer.sol";
import {TimestampEnforcer} from "../../src/enforcers/TimestampEnforcer.sol";
import {ModeCode, ModePayload} from "../../src/utils/Types.sol";
import {
    ModeLib,
    CALLTYPE_SINGLE,
    CALLTYPE_BATCH,
    EXECTYPE_DEFAULT,
    EXECTYPE_TRY,
    MODE_DEFAULT
} from "../../src/libraries/ModeLib.sol";
import {ExecutionLib} from "../../src/libraries/ExecutionLib.sol";

/// @title PaymentEnforcersTest
/// @notice The Mapae-original payee gate, plus behavioural verification of the two vendored
///         MetaMask enforcers on this repo's toolchain. Vendored code is not exempt from tests:
///         the pragma and import adaptations must be shown to change nothing.
contract PaymentEnforcersTest is Test {
    AllowedPayeeEnforcer internal payeeEnforcer;
    ERC20PeriodTransferEnforcer internal periodEnforcer;
    TimestampEnforcer internal timestampEnforcer;

    address internal token = address(0x70CE2);
    address internal merchant = address(0xCAFE);
    address internal merchant2 = address(0xBEEF);
    address internal attacker = address(0xBAD);
    address internal agent = address(0xA6E27);

    bytes32 internal constant HASH = keccak256("delegation-hash");
    ModeCode internal mode;

    function setUp() public {
        payeeEnforcer = new AllowedPayeeEnforcer();
        periodEnforcer = new ERC20PeriodTransferEnforcer();
        timestampEnforcer = new TimestampEnforcer();
        mode = ModeLib.encodeSimpleSingle();
        // Period math needs a sane clock; foundry starts at 1.
        vm.warp(1_753_770_000);
    }

    /* -------------------------------------------------------------------------- */
    /*                            AllowedPayeeEnforcer                             */
    /* -------------------------------------------------------------------------- */

    function test_Payee_SingleEntry_Allows() public view {
        payeeEnforcer.beforeHook(
            abi.encodePacked(merchant), "", mode, _transfer(merchant, 100), HASH, address(0), agent
        );
    }

    /// @notice Order in the list must not matter; the last entry is as allowed as the first.
    function test_Payee_MultiEntry_AllowsLast() public view {
        bytes memory terms = abi.encodePacked(merchant2, address(0x1111), merchant);
        payeeEnforcer.beforeHook(terms, "", mode, _transfer(merchant, 100), HASH, address(0), agent);
    }

    function test_RevertWhen_PayeeNotListed() public {
        vm.expectRevert(abi.encodeWithSelector(AllowedPayeeEnforcer.PayeeNotAllowed.selector, attacker));
        payeeEnforcer.beforeHook(
            abi.encodePacked(merchant), "", mode, _transfer(attacker, 100), HASH, address(0), agent
        );
    }

    /// @notice Empty terms are a hard error, not an allow-all. Deny by default.
    function test_RevertWhen_PayeeTermsEmpty() public {
        vm.expectRevert(abi.encodeWithSelector(AllowedPayeeEnforcer.InvalidTermsLength.selector, 0));
        payeeEnforcer.beforeHook("", "", mode, _transfer(merchant, 100), HASH, address(0), agent);
    }

    function test_RevertWhen_PayeeTermsNotMultipleOf20() public {
        vm.expectRevert(abi.encodeWithSelector(AllowedPayeeEnforcer.InvalidTermsLength.selector, 21));
        payeeEnforcer.beforeHook(new bytes(21), "", mode, _transfer(merchant, 100), HASH, address(0), agent);
    }

    /// @notice `approve` is refused: an approval to an allowed payee would delegate onwards
    ///         off-ledger, escaping both this check and every amount cap.
    function test_RevertWhen_MethodIsApprove() public {
        bytes memory exec = ExecutionLib.encodeSingle(
            token, 0, abi.encodeWithSelector(IERC20.approve.selector, merchant, 100)
        );
        vm.expectRevert(
            abi.encodeWithSelector(AllowedPayeeEnforcer.InvalidMethod.selector, IERC20.approve.selector)
        );
        payeeEnforcer.beforeHook(abi.encodePacked(merchant), "", mode, exec, HASH, address(0), agent);
    }

    function test_RevertWhen_MethodIsTransferFrom() public {
        bytes memory exec = ExecutionLib.encodeSingle(
            token, 0, abi.encodeWithSelector(IERC20.transferFrom.selector, address(1), merchant, 100)
        );
        // transferFrom calldata is 100 bytes; the length gate fires before the selector gate.
        vm.expectRevert(abi.encodeWithSelector(AllowedPayeeEnforcer.InvalidExecutionLength.selector, 100));
        payeeEnforcer.beforeHook(abi.encodePacked(merchant), "", mode, exec, HASH, address(0), agent);
    }

    function test_RevertWhen_CallDataTruncated() public {
        bytes memory exec = ExecutionLib.encodeSingle(token, 0, hex"a9059cbb");
        vm.expectRevert(abi.encodeWithSelector(AllowedPayeeEnforcer.InvalidExecutionLength.selector, 4));
        payeeEnforcer.beforeHook(abi.encodePacked(merchant), "", mode, exec, HASH, address(0), agent);
    }

    /// @notice A recipient word with dirty upper bits is refused outright, never truncated.
    function test_RevertWhen_RecipientWordHasDirtyUpperBits() public {
        bytes32 dirty = bytes32(uint256(uint160(merchant)) | (uint256(0xFF) << 160));
        bytes memory callData = abi.encodePacked(IERC20.transfer.selector, dirty, uint256(100));
        bytes memory exec = ExecutionLib.encodeSingle(token, 0, callData);

        vm.expectRevert(abi.encodeWithSelector(AllowedPayeeEnforcer.DirtyRecipientWord.selector, dirty));
        payeeEnforcer.beforeHook(abi.encodePacked(merchant), "", mode, exec, HASH, address(0), agent);
    }

    function test_RevertWhen_PayeeBatchCallType() public {
        ModeCode batch = ModeLib.encode(CALLTYPE_BATCH, EXECTYPE_DEFAULT, MODE_DEFAULT, ModePayload.wrap(0));
        vm.expectRevert("CaveatEnforcer:invalid-call-type");
        payeeEnforcer.beforeHook(
            abi.encodePacked(merchant), "", batch, _transfer(merchant, 100), HASH, address(0), agent
        );
    }

    function test_RevertWhen_PayeeTryExecType() public {
        ModeCode tryMode = ModeLib.encode(CALLTYPE_SINGLE, EXECTYPE_TRY, MODE_DEFAULT, ModePayload.wrap(0));
        vm.expectRevert("CaveatEnforcer:invalid-execution-type");
        payeeEnforcer.beforeHook(
            abi.encodePacked(merchant), "", tryMode, _transfer(merchant, 100), HASH, address(0), agent
        );
    }

    function testFuzz_PayeeTerms_RoundTrip(address a, address b, address c) public view {
        address[] memory got = payeeEnforcer.getTermsInfo(abi.encodePacked(a, b, c));
        assertEq(got.length, 3);
        assertEq(got[0], a);
        assertEq(got[1], b);
        assertEq(got[2], c);
    }

    /* -------------------------------------------------------------------------- */
    /*                       ERC20PeriodTransferEnforcer (vendored)                */
    /* -------------------------------------------------------------------------- */

    function test_Period_ExactlyAtCap_Succeeds() public {
        bytes memory terms = _periodTerms(50_000, 1 days, block.timestamp);
        periodEnforcer.beforeHook(terms, "", mode, _transfer(merchant, 50_000), HASH, address(0), agent);

        (uint256 available,,) = periodEnforcer.getAvailableAmount(HASH, address(this), terms);
        assertEq(available, 0, "cap should be fully consumed");
    }

    function test_Period_CapPlusOne_Reverts() public {
        bytes memory terms = _periodTerms(50_000, 1 days, block.timestamp);
        periodEnforcer.beforeHook(terms, "", mode, _transfer(merchant, 30_000), HASH, address(0), agent);

        vm.expectRevert("ERC20PeriodTransferEnforcer:transfer-amount-exceeded");
        periodEnforcer.beforeHook(terms, "", mode, _transfer(merchant, 20_001), HASH, address(0), agent);
    }

    /// @notice The demo's T2: 30,000 then another 30,000 against a 50,000/day cap.
    function test_Period_DemoSequence() public {
        bytes memory terms = _periodTerms(50_000, 1 days, block.timestamp);
        periodEnforcer.beforeHook(terms, "", mode, _transfer(merchant, 30_000), HASH, address(0), agent);

        vm.expectRevert("ERC20PeriodTransferEnforcer:transfer-amount-exceeded");
        periodEnforcer.beforeHook(terms, "", mode, _transfer(merchant, 30_000), HASH, address(0), agent);
    }

    function test_Period_ResetsOnNextPeriod() public {
        bytes memory terms = _periodTerms(50_000, 1 days, block.timestamp);
        periodEnforcer.beforeHook(terms, "", mode, _transfer(merchant, 50_000), HASH, address(0), agent);

        vm.warp(block.timestamp + 1 days);
        periodEnforcer.beforeHook(terms, "", mode, _transfer(merchant, 50_000), HASH, address(0), agent);
    }

    /// @notice Unused allowance is forfeited, not accumulated, across periods.
    function test_Period_UnusedAllowanceDoesNotAccumulate() public {
        bytes memory terms = _periodTerms(50_000, 1 days, block.timestamp);
        periodEnforcer.beforeHook(terms, "", mode, _transfer(merchant, 1), HASH, address(0), agent);

        vm.warp(block.timestamp + 1 days);
        (uint256 available,,) = periodEnforcer.getAvailableAmount(HASH, address(this), terms);
        assertEq(available, 50_000, "new period must offer exactly periodAmount, not the rollover");
    }

    function test_Period_RevertWhen_WrongTargetToken() public {
        bytes memory terms = _periodTerms(50_000, 1 days, block.timestamp);
        bytes memory exec = ExecutionLib.encodeSingle(
            address(0xDEAD), 0, abi.encodeWithSelector(IERC20.transfer.selector, merchant, 1)
        );
        vm.expectRevert("ERC20PeriodTransferEnforcer:invalid-contract");
        periodEnforcer.beforeHook(terms, "", mode, exec, HASH, address(0), agent);
    }

    function test_Period_RevertWhen_NotStarted() public {
        bytes memory terms = _periodTerms(50_000, 1 days, block.timestamp + 1 hours);
        vm.expectRevert("ERC20PeriodTransferEnforcer:transfer-not-started");
        periodEnforcer.beforeHook(terms, "", mode, _transfer(merchant, 1), HASH, address(0), agent);
    }

    /// @notice State is keyed by (manager, delegationHash): two managers using the same hash do
    ///         not share accounting. This is the property that makes the enforcer manager-agnostic
    ///         and hence vendorable in both directions.
    function test_Period_StateIsolatedPerManager() public {
        bytes memory terms = _periodTerms(50_000, 1 days, block.timestamp);
        periodEnforcer.beforeHook(terms, "", mode, _transfer(merchant, 50_000), HASH, address(0), agent);

        // A different msg.sender (pranked) has a fresh allowance for the same hash.
        vm.prank(address(0x1234));
        periodEnforcer.beforeHook(terms, "", mode, _transfer(merchant, 50_000), HASH, address(0), agent);
    }

    /* -------------------------------------------------------------------------- */
    /*                          TimestampEnforcer (vendored)                       */
    /* -------------------------------------------------------------------------- */

    function test_Timestamp_WithinWindow_Passes() public view {
        bytes memory terms = abi.encodePacked(uint128(block.timestamp - 1), uint128(block.timestamp + 7 days));
        timestampEnforcer.beforeHook(terms, "", mode, "", HASH, address(0), agent);
    }

    function test_Timestamp_RevertWhen_Expired() public {
        bytes memory terms = abi.encodePacked(uint128(0), uint128(block.timestamp + 7 days));
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert("TimestampEnforcer:expired-delegation");
        timestampEnforcer.beforeHook(terms, "", mode, "", HASH, address(0), agent);
    }

    function test_Timestamp_RevertWhen_TooEarly() public {
        bytes memory terms = abi.encodePacked(uint128(block.timestamp + 1 hours), uint128(0));
        vm.expectRevert("TimestampEnforcer:early-delegation");
        timestampEnforcer.beforeHook(terms, "", mode, "", HASH, address(0), agent);
    }

    /* -------------------------------------------------------------------------- */
    /*                                   Helpers                                   */
    /* -------------------------------------------------------------------------- */

    function _transfer(address to, uint256 amount) internal view returns (bytes memory) {
        return
            ExecutionLib.encodeSingle(token, 0, abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
    }

    function _periodTerms(uint256 amount, uint256 duration, uint256 start)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodePacked(token, amount, duration, start);
    }
}
