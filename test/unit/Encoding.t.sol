// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {
    Delegation,
    Caveat,
    ModeCode,
    CallType,
    ExecType,
    ModeSelector,
    ModePayload
} from "../../src/utils/Types.sol";
import {
    DELEGATION_TYPEHASH,
    CAVEAT_TYPEHASH,
    EIP712_DOMAIN_TYPEHASH,
    ROOT_AUTHORITY,
    ANY_DELEGATE
} from "../../src/utils/Constants.sol";
import {EncoderLib} from "../../src/libraries/EncoderLib.sol";
import {ExecutionLib} from "../../src/libraries/ExecutionLib.sol";
import {
    ModeLib,
    CALLTYPE_SINGLE,
    CALLTYPE_DELEGATECALL,
    EXECTYPE_DEFAULT,
    EXECTYPE_TRY,
    MODE_DEFAULT
} from "../../src/libraries/ModeLib.sol";
import {IERC7710} from "../../src/interfaces/IERC7710.sol";

/// @title EncodingConformanceTest
/// @notice Pins every byte of the surface that makes a Mapae delegation portable to MetaMask's
///         DelegationManager, and theirs to ours.
/// @dev Expected values are LITERAL CONSTANTS, never recomputed from the same expression the
///      library uses - a test that recomputes proves only that keccak is deterministic. If any
///      assertion here fails, delegations signed for one manager have silently stopped being
///      redeemable on the other.
contract EncodingConformanceTest is Test {
    /* -------------------------------------------------------------------------- */
    /*                                  Typehashes                                 */
    /* -------------------------------------------------------------------------- */

    function test_DelegationTypehash_IsPinned() public pure {
        assertEq(
            DELEGATION_TYPEHASH,
            0x88c1d2ecf185adf710588203a5f263f0ff61be0d33da39792cde19ba9aa4331e,
            "DELEGATION_TYPEHASH drift"
        );
    }

    function test_CaveatTypehash_IsPinned() public pure {
        assertEq(
            CAVEAT_TYPEHASH,
            0x80ad7e1b04ee6d994a125f4714ca0720908bd80ed16063ec8aee4b88e9253e2d,
            "CAVEAT_TYPEHASH drift"
        );
    }

    function test_Eip712DomainTypehash_IsPinned() public pure {
        assertEq(
            EIP712_DOMAIN_TYPEHASH,
            0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f,
            "EIP712_DOMAIN_TYPEHASH drift"
        );
    }

    /// @notice The delegation typehash must NOT mention `signature`, and the caveat typehash must
    ///         NOT mention `args`. Those omissions are load-bearing, not cosmetic.
    function test_Typehashes_OmitSignatureAndArgs() public pure {
        assertEq(
            DELEGATION_TYPEHASH,
            keccak256(
                "Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)"
            )
        );
        assertEq(CAVEAT_TYPEHASH, keccak256("Caveat(address enforcer,bytes terms)"));
    }

    /* -------------------------------------------------------------------------- */
    /*                                  Constants                                  */
    /* -------------------------------------------------------------------------- */

    function test_RootAuthority_IsPinned() public pure {
        assertEq(
            ROOT_AUTHORITY,
            0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff,
            "ROOT_AUTHORITY drift"
        );
    }

    function test_AnyDelegate_IsPinned() public pure {
        assertEq(ANY_DELEGATE, address(0xa11), "ANY_DELEGATE drift");
    }

    function test_RedeemDelegationsSelector_IsPinned() public pure {
        assertEq(IERC7710.redeemDelegations.selector, bytes4(0xcef6d209), "ERC-7710 selector drift");
    }

    /* -------------------------------------------------------------------------- */
    /*                     Hashing ignores post-signature fields                   */
    /* -------------------------------------------------------------------------- */

    /// @notice Mutating `signature` must not change the delegation hash.
    /// @dev This is what lets a signature be attached after the payload is fixed.
    function testFuzz_DelegationHash_IgnoresSignature(bytes memory sigA, bytes memory sigB) public pure {
        Delegation memory a = _sampleDelegation();
        Delegation memory b = _sampleDelegation();
        a.signature = sigA;
        b.signature = sigB;
        assertEq(EncoderLib._getDelegationHash(a), EncoderLib._getDelegationHash(b));
    }

    /// @notice Mutating `Caveat.args` must not change the delegation hash.
    /// @dev This is what lets the redeemer supply args at redemption time. It also means an
    ///      enforcer must never trust `args` for anything the delegator needed to authorise.
    function testFuzz_CaveatHash_IgnoresArgs(bytes memory argsA, bytes memory argsB) public pure {
        Delegation memory a = _sampleDelegation();
        Delegation memory b = _sampleDelegation();
        a.caveats[0].args = argsA;
        b.caveats[0].args = argsB;
        assertEq(EncoderLib._getDelegationHash(a), EncoderLib._getDelegationHash(b));
    }

    /// @notice Changing anything that IS signed must change the hash.
    function test_DelegationHash_ChangesWithSignedFields() public pure {
        bytes32 base = EncoderLib._getDelegationHash(_sampleDelegation());

        Delegation memory d = _sampleDelegation();
        d.delegate = address(0xBEEF);
        assertTrue(EncoderLib._getDelegationHash(d) != base, "delegate not bound");

        d = _sampleDelegation();
        d.delegator = address(0xBEEF);
        assertTrue(EncoderLib._getDelegationHash(d) != base, "delegator not bound");

        d = _sampleDelegation();
        d.authority = bytes32(uint256(1));
        assertTrue(EncoderLib._getDelegationHash(d) != base, "authority not bound");

        d = _sampleDelegation();
        d.salt = 999;
        assertTrue(EncoderLib._getDelegationHash(d) != base, "salt not bound");

        d = _sampleDelegation();
        d.caveats[0].terms = hex"dead";
        assertTrue(EncoderLib._getDelegationHash(d) != base, "caveat terms not bound");

        d = _sampleDelegation();
        d.caveats[0].enforcer = address(0xBEEF);
        assertTrue(EncoderLib._getDelegationHash(d) != base, "caveat enforcer not bound");
    }

    /* -------------------------------------------------------------------------- */
    /*                            ERC-7579 encodings                               */
    /* -------------------------------------------------------------------------- */

    /// @notice A plain single call with revert-on-failure semantics is the zero word.
    function test_SimpleSingleMode_IsZero() public pure {
        assertEq(ModeCode.unwrap(ModeLib.encodeSimpleSingle()), bytes32(0));
    }

    function test_ModeCode_PacksAtDocumentedOffsets() public pure {
        (CallType ct, ExecType et,,) = ModeLib.decode(ModeLib.encodeSimpleSingle());
        assertEq(CallType.unwrap(ct), CallType.unwrap(CALLTYPE_SINGLE));
        assertEq(ExecType.unwrap(et), ExecType.unwrap(EXECTYPE_DEFAULT));
    }

    /// @notice Round-trips the mode word with NON-ZERO fields, at the exact byte offsets.
    /// @dev The simple-single case is all zeros, so it round-trips no matter how badly `encode`
    ///      misplaces its operands. An earlier revision shifted all four fields wrongly and still
    ///      passed that test - while `EXECTYPE_TRY` landed in the unused bytes and the account's
    ///      guard against it silently stopped firing. Non-zero values are the only real check.
    function test_ModeCode_RoundTripsNonZeroFields() public pure {
        ModeCode mode = ModeLib.encode(
            CALLTYPE_DELEGATECALL,
            EXECTYPE_TRY,
            ModeSelector.wrap(0xAABBCCDD),
            ModePayload.wrap(bytes22(hex"0102030405060708090A0B0C0D0E0F10111213141516"))
        );

        (CallType ct, ExecType et, ModeSelector sel, ModePayload pl) = ModeLib.decode(mode);
        assertEq(CallType.unwrap(ct), bytes1(0xFF), "callType offset");
        assertEq(ExecType.unwrap(et), bytes1(0x01), "execType offset");
        assertEq(ModeSelector.unwrap(sel), bytes4(0xAABBCCDD), "selector offset");
        assertEq(
            ModePayload.unwrap(pl),
            bytes22(hex"0102030405060708090A0B0C0D0E0F10111213141516"),
            "payload offset"
        );

        // And the packed word itself, byte for byte:
        // callType(1) | execType(1) | unused(4) | selector(4) | payload(22)
        assertEq(
            ModeCode.unwrap(mode),
            bytes32(hex"FF0100000000AABBCCDD0102030405060708090A0B0C0D0E0F10111213141516"),
            "packed layout"
        );
    }

    /// @notice The two bytes an account's execution guard reads must be exactly bytes 0 and 1.
    function testFuzz_ModeCode_CallAndExecTypeAreTheFirstTwoBytes(bytes1 ct, bytes1 et) public pure {
        ModeCode mode =
            ModeLib.encode(CallType.wrap(ct), ExecType.wrap(et), MODE_DEFAULT, ModePayload.wrap(0));
        bytes32 raw = ModeCode.unwrap(mode);
        assertEq(bytes1(raw), ct, "callType is not byte 0");
        assertEq(bytes1(raw << 8), et, "execType is not byte 1");
    }

    /// @notice Single-execution calldata is tightly packed target(20) | value(32) | callData.
    /// @dev Spending-limit enforcers index into `callData` at fixed offsets, so this layout is the
    ///      foundation every cap and payee check stands on.
    function test_ExecutionLib_SingleLayout() public view {
        address target = 0x1111111111111111111111111111111111111111;
        uint256 value = 42;
        bytes memory callData = abi.encodeWithSignature("transfer(address,uint256)", address(0x22), 7);

        bytes memory encoded = ExecutionLib.encodeSingle(target, value, callData);
        assertEq(encoded.length, 20 + 32 + callData.length, "not tightly packed");

        (address t, uint256 v, bytes memory cd) = this.decodeSingle(encoded);
        assertEq(t, target);
        assertEq(v, value);
        assertEq(keccak256(cd), keccak256(callData));
    }

    function test_ExecutionLib_RejectsTruncated() public {
        vm.expectRevert(abi.encodeWithSelector(ExecutionLib.InvalidSingleExecutionLength.selector, 51));
        this.decodeSingle(new bytes(51));
    }

    /// @dev External wrapper so the library can take a `bytes calldata` slice.
    function decodeSingle(bytes calldata data) external pure returns (address, uint256, bytes memory) {
        (address t, uint256 v, bytes calldata cd) = ExecutionLib.decodeSingle(data);
        return (t, v, cd);
    }

    /* -------------------------------------------------------------------------- */
    /*                                   Helpers                                   */
    /* -------------------------------------------------------------------------- */

    /// @notice EIP-3009's authorisation is six fields, and this pins the shape our documents argue
    ///         from.
    ///
    /// @dev The x402 section claims an EIP-3009 authorisation has nowhere to put a policy - no
    ///      payee set, no per-payment ceiling, no identity condition - and that the signer must be
    ///      the payer. Both follow from this typehash, so the typehash is asserted as a literal
    ///      rather than recomputed. If the standard ever grew a field, this fails and the claim
    ///      gets revisited instead of quietly becoming false.
    ///
    ///      Nothing here imports or depends on EIP-3009. It is a claim we make about a neighbour,
    ///      held to the same standard as claims we make about ourselves.
    function test_Eip3009_AuthorizationHasNoPolicyFields() public pure {
        assertEq(
            keccak256(
                "TransferWithAuthorization(address from,address to,uint256 value,"
                "uint256 validAfter,uint256 validBefore,bytes32 nonce)"
            ),
            bytes32(0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267),
            "EIP-3009 typehash drift - the x402 argument quotes this value"
        );
    }

    function _sampleDelegation() internal pure returns (Delegation memory d) {
        Caveat[] memory caveats = new Caveat[](1);
        caveats[0] = Caveat({enforcer: address(0xCAFE), terms: hex"1234", args: hex"5678"});
        d = Delegation({
            delegate: address(0xA11CE),
            delegator: address(0xB0B),
            authority: ROOT_AUTHORITY,
            caveats: caveats,
            salt: 1,
            signature: hex"00"
        });
    }
}
