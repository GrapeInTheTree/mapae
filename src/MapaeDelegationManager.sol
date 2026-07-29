// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IERC7710} from "./interfaces/IERC7710.sol";
import {ICaveatEnforcer} from "./interfaces/ICaveatEnforcer.sol";
import {IDeleGatorCore} from "./interfaces/IDeleGatorCore.sol";
import {Delegation, Caveat, ModeCode} from "./utils/Types.sol";
import {ROOT_AUTHORITY, ANY_DELEGATE} from "./utils/Constants.sol";
import {EncoderLib} from "./libraries/EncoderLib.sol";

/// @title MapaeDelegationManager
/// @notice ERC-7710 delegation manager: redeems scoped authority granted off-chain by a delegator.
/// @dev Mapae does not invent a delegation mechanism. This manager implements ERC-7710's single
///      mandated function and adopts MetaMask's delegation-framework structures byte-for-byte -
///      same `Delegation`/`Caveat` layout, same typehashes, same `ICaveatEnforcer` hook signatures
///      and ordering. That buys portability in both directions:
///        - MetaMask's audited caveat enforcers work on this manager unmodified, because their
///          state is keyed by `(msg.sender, delegationHash)` and is therefore manager-agnostic;
///        - Mapae's identity enforcer works on MetaMask's manager on any chain it is deployed to.
///
///      We reimplement rather than redeploy their framework because the framework carries an
///      account stack (P256 hybrid signers, ERC-4337 EntryPoint wiring) that GIWA has no bundler
///      for, and because the contribution here is the missing enforcer, not a redeployment.
///
///      Deliberately omitted relative to MetaMask's manager: pausing, and delegatecall execution.
///      Both widen the trusted surface without serving the primitive.
contract MapaeDelegationManager is IERC7710, EIP712, ReentrancyGuardTransient {
    using EncoderLib for Delegation;

    /// @notice Authority value marking a delegation as a root.
    bytes32 public constant ROOT_AUTHORITY_VALUE = ROOT_AUTHORITY;

    /// @notice Sentinel delegate making a delegation bearer.
    address public constant ANY_DELEGATE_VALUE = ANY_DELEGATE;

    /// @notice Delegations the delegator has switched off. One of the two independent kill
    ///         switches; the other is revoking the identity the delegation is gated on, which
    ///         lives entirely outside this contract.
    mapping(bytes32 delegationHash => bool disabled) public disabledDelegations;

    event RedeemedDelegation(
        address indexed rootDelegator, address indexed redeemer, bytes32 indexed delegationHash
    );
    event EnabledDelegation(bytes32 indexed delegationHash, address indexed delegator);
    event DisabledDelegation(bytes32 indexed delegationHash, address indexed delegator);

    error BatchDataLengthMismatch();
    error EmptyDelegationChain();
    error CannotUseADisabledDelegation();
    error InvalidDelegate();
    error InvalidAuthority();
    error InvalidEOASignature();
    error InvalidERC1271Signature();
    error NotDelegator();
    error AlreadyDisabled();
    error AlreadyEnabled();

    constructor() EIP712("Mapae", "1") {}

    /* -------------------------------------------------------------------------- */
    /*                                   Redeem                                    */
    /* -------------------------------------------------------------------------- */

    /// @inheritdoc IERC7710
    /// @dev Validation runs strictly before any caveat, in this order:
    ///        1. array lengths match
    ///        2. the caller is the leaf delegate (or the delegation is bearer)
    ///        3. every signature in the chain is valid
    ///        4. no link is disabled, and the authority chain is intact
    ///        5. only then are caveats evaluated
    ///      Step 4 preceding step 5 is what makes the two kill switches independently observable:
    ///      disabling a delegation always surfaces `CannotUseADisabledDelegation`, never an
    ///      identity error, regardless of whether the identity is also revoked. This ordering is
    ///      pinned by tests rather than assumed.
    function redeemDelegations(
        bytes[] calldata _permissionContexts,
        bytes32[] calldata _modes,
        bytes[] calldata _executionCallDatas
    ) external nonReentrant {
        uint256 batchSize_ = _permissionContexts.length;
        if (batchSize_ != _modes.length || batchSize_ != _executionCallDatas.length) {
            revert BatchDataLengthMismatch();
        }

        Delegation[][] memory batchDelegations_ = new Delegation[][](batchSize_);
        bytes32[][] memory batchHashes_ = new bytes32[][](batchSize_);

        for (uint256 b; b < batchSize_; ++b) {
            Delegation[] memory delegations_ = abi.decode(_permissionContexts[b], (Delegation[]));
            if (delegations_.length == 0) revert EmptyDelegationChain();

            batchDelegations_[b] = delegations_;
            batchHashes_[b] = _validateChain(delegations_);
        }

        // beforeAllHook, leaf -> root
        for (uint256 b; b < batchSize_; ++b) {
            _runHooks(batchDelegations_[b], batchHashes_[b], _modes[b], _executionCallDatas[b], 0);
        }

        for (uint256 b; b < batchSize_; ++b) {
            // beforeHook, leaf -> root
            _runHooks(batchDelegations_[b], batchHashes_[b], _modes[b], _executionCallDatas[b], 1);

            // The root delegator's account performs the execution: funds always leave the account
            // that granted the authority, never an intermediate delegate's.
            Delegation[] memory ds_ = batchDelegations_[b];
            // The account's return data is for callers
            // who need it, not for the manager: success is signalled by not reverting
            // (EXECTYPE_TRY, which swallows failure, is refused by the account). Matches
            // MetaMask's manager, which also discards it.
            // slither-disable-next-line unused-return
            IDeleGatorCore(ds_[ds_.length - 1].delegator)
                .executeFromExecutor(ModeCode.wrap(_modes[b]), _executionCallDatas[b]);

            // afterHook, root -> leaf
            _runHooks(batchDelegations_[b], batchHashes_[b], _modes[b], _executionCallDatas[b], 2);
        }

        // afterAllHook, root -> leaf
        for (uint256 b; b < batchSize_; ++b) {
            _runHooks(batchDelegations_[b], batchHashes_[b], _modes[b], _executionCallDatas[b], 3);
        }

        for (uint256 b; b < batchSize_; ++b) {
            Delegation[] memory ds_ = batchDelegations_[b];
            address root_ = ds_[ds_.length - 1].delegator;
            for (uint256 i; i < ds_.length; ++i) {
                emit RedeemedDelegation(root_, msg.sender, batchHashes_[b][i]);
            }
        }
    }

    /* -------------------------------------------------------------------------- */
    /*                              Delegator controls                             */
    /* -------------------------------------------------------------------------- */

    /// @notice Switches a delegation off. Effective immediately, for every future redemption.
    function disableDelegation(Delegation calldata _delegation) external {
        if (msg.sender != _delegation.delegator) revert NotDelegator();
        bytes32 hash_ = EncoderLib._getDelegationHash(_delegation);
        if (disabledDelegations[hash_]) revert AlreadyDisabled();
        disabledDelegations[hash_] = true;
        emit DisabledDelegation(hash_, msg.sender);
    }

    /// @notice Switches a previously disabled delegation back on.
    /// @dev Reversibility is deliberate and demonstrated: disabling must be shown to be a
    ///      delegation-scoped action that leaves the identity binding untouched.
    function enableDelegation(Delegation calldata _delegation) external {
        if (msg.sender != _delegation.delegator) revert NotDelegator();
        bytes32 hash_ = EncoderLib._getDelegationHash(_delegation);
        if (!disabledDelegations[hash_]) revert AlreadyEnabled();
        disabledDelegations[hash_] = false;
        emit EnabledDelegation(hash_, msg.sender);
    }

    /* -------------------------------------------------------------------------- */
    /*                                    Views                                    */
    /* -------------------------------------------------------------------------- */

    function getDelegationHash(Delegation calldata _delegation) external pure returns (bytes32) {
        return EncoderLib._getDelegationHash(_delegation);
    }

    function getDomainHash() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /* -------------------------------------------------------------------------- */
    /*                                   Internal                                  */
    /* -------------------------------------------------------------------------- */

    /// @dev Validates caller, signatures, disabled flags and the authority chain. Returns the
    ///      delegation hashes, leaf first.
    function _validateChain(Delegation[] memory _delegations)
        internal
        view
        returns (bytes32[] memory hashes_)
    {
        uint256 n_ = _delegations.length;
        hashes_ = new bytes32[](n_);

        if (_delegations[0].delegate != msg.sender && _delegations[0].delegate != ANY_DELEGATE) {
            revert InvalidDelegate();
        }

        bytes32 domain_ = _domainSeparatorV4();
        for (uint256 i; i < n_; ++i) {
            Delegation memory d_ = _delegations[i];
            bytes32 hash_ = EncoderLib._getDelegationHash(d_);
            hashes_[i] = hash_;

            bytes32 typed_ = MessageHashUtils.toTypedDataHash(domain_, hash_);
            if (d_.delegator.code.length == 0) {
                if (ECDSA.recover(typed_, d_.signature) != d_.delegator) {
                    revert InvalidEOASignature();
                }
            } else if (
                IERC1271(d_.delegator).isValidSignature(typed_, d_.signature)
                    != IERC1271.isValidSignature.selector
            ) {
                revert InvalidERC1271Signature();
            }
        }

        for (uint256 i; i < n_; ++i) {
            if (disabledDelegations[hashes_[i]]) revert CannotUseADisabledDelegation();

            if (i != n_ - 1) {
                if (_delegations[i].authority != hashes_[i + 1]) revert InvalidAuthority();
                address nextDelegate_ = _delegations[i + 1].delegate;
                if (nextDelegate_ != ANY_DELEGATE && _delegations[i].delegator != nextDelegate_) {
                    revert InvalidDelegate();
                }
            } else if (_delegations[i].authority != ROOT_AUTHORITY) {
                revert InvalidAuthority();
            }
        }
    }

    /// @dev Dispatches one hook across every caveat of every delegation in a chain.
    ///      `_phase`: 0 beforeAll, 1 before, 2 after, 3 afterAll. Phases 0 and 1 run leaf to root;
    ///      2 and 3 run root to leaf, so an after-hook unwinds in the reverse order of its
    ///      matching before-hook.
    /// @dev Split from {_runCaveats} to keep each frame under the stack limit. `via_ir` would also
    ///      solve it, but it is deliberately off: it breaks Blockscout source verification, and an
    ///      unverifiable primitive is not a primitive.
    function _runHooks(
        Delegation[] memory _delegations,
        bytes32[] memory _hashes,
        bytes32 _mode,
        bytes calldata _executionCallData,
        uint8 _phase
    ) internal {
        uint256 n_ = _delegations.length;
        for (uint256 k; k < n_; ++k) {
            uint256 i = _phase < 2 ? k : n_ - 1 - k;
            _runCaveats(_delegations[i], _hashes[i], _mode, _executionCallData, _phase);
        }
    }

    function _runCaveats(
        Delegation memory _delegation,
        bytes32 _hash,
        bytes32 _mode,
        bytes calldata _executionCallData,
        uint8 _phase
    ) internal {
        Caveat[] memory caveats_ = _delegation.caveats;
        uint256 m_ = caveats_.length;
        for (uint256 j; j < m_; ++j) {
            _callHook(
                caveats_[_phase < 2 ? j : m_ - 1 - j],
                _phase,
                _mode,
                _executionCallData,
                _hash,
                _delegation.delegator
            );
        }
    }

    function _callHook(
        Caveat memory _caveat,
        uint8 _phase,
        bytes32 _mode,
        bytes calldata _executionCallData,
        bytes32 _delegationHash,
        address _delegator
    ) internal {
        ICaveatEnforcer enforcer_ = ICaveatEnforcer(_caveat.enforcer);
        ModeCode mode_ = ModeCode.wrap(_mode);

        if (_phase == 0) {
            enforcer_.beforeAllHook(
                _caveat.terms,
                _caveat.args,
                mode_,
                _executionCallData,
                _delegationHash,
                _delegator,
                msg.sender
            );
        } else if (_phase == 1) {
            enforcer_.beforeHook(
                _caveat.terms,
                _caveat.args,
                mode_,
                _executionCallData,
                _delegationHash,
                _delegator,
                msg.sender
            );
        } else if (_phase == 2) {
            enforcer_.afterHook(
                _caveat.terms,
                _caveat.args,
                mode_,
                _executionCallData,
                _delegationHash,
                _delegator,
                msg.sender
            );
        } else {
            enforcer_.afterAllHook(
                _caveat.terms,
                _caveat.args,
                mode_,
                _executionCallData,
                _delegationHash,
                _delegator,
                msg.sender
            );
        }
    }
}
