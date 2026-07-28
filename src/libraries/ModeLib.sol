// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ModeCode, CallType, ExecType, ModeSelector, ModePayload} from "../utils/Types.sol";

/// @dev Single call. The only call type Mapae accounts execute.
CallType constant CALLTYPE_SINGLE = CallType.wrap(0x00);
/// @dev Batch of calls.
CallType constant CALLTYPE_BATCH = CallType.wrap(0x01);
/// @dev Static call.
CallType constant CALLTYPE_STATIC = CallType.wrap(0xFE);
/// @dev Delegatecall. Never accepted by a Mapae account - it would let a delegate rewrite storage.
CallType constant CALLTYPE_DELEGATECALL = CallType.wrap(0xFF);

/// @dev Revert the whole redemption if the call fails. The only exec type Mapae accepts, because
///      a caveat that passed must not be silently followed by a failed transfer.
ExecType constant EXECTYPE_DEFAULT = ExecType.wrap(0x00);
/// @dev Swallow call failure.
ExecType constant EXECTYPE_TRY = ExecType.wrap(0x01);

ModeSelector constant MODE_DEFAULT = ModeSelector.wrap(bytes4(0x00000000));

/// @title ModeLib
/// @notice Packs and unpacks the ERC-7579 execution mode word.
/// @dev Layout, most significant byte first:
///      callType(1) | execType(1) | unused(4) | modeSelector(4) | modePayload(22)
///      Matches erc7579/erc7579-implementation exactly; verified against that source.
library ModeLib {
    function decode(ModeCode mode)
        internal
        pure
        returns (CallType callType_, ExecType execType_, ModeSelector selector_, ModePayload payload_)
    {
        assembly {
            callType_ := mode
            execType_ := shl(8, mode)
            selector_ := shl(48, mode)
            payload_ := shl(80, mode)
        }
    }

    function encode(CallType callType, ExecType execType, ModeSelector selector, ModePayload payload)
        internal
        pure
        returns (ModeCode mode)
    {
        assembly {
            mode := or(or(shr(8, callType), shr(16, execType)), or(shr(80, selector), shr(176, payload)))
        }
    }

    /// @notice A plain single call with revert-on-failure semantics.
    /// @dev Equals bytes32(0): every packed field is zero.
    function encodeSimpleSingle() internal pure returns (ModeCode mode) {
        mode = encode(CALLTYPE_SINGLE, EXECTYPE_DEFAULT, MODE_DEFAULT, ModePayload.wrap(0x00));
    }
}
