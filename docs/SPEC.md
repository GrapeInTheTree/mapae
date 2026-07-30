# Mapae — Specification

Byte-level reference for everything an integrator signs, encodes, or decodes. Every constant
below is pinned by a test that compares against a literal, and the encodings are pinned across
three implementations: Solidity is the reference, and the TypeScript SDK and Go facilitator are
asserted byte-identical to fixtures it emits (`script/GenFixtures.s.sol`).

## Structures

```solidity
struct Delegation {
    address delegate;    // who may redeem; ANY_DELEGATE (0x0a11) makes it bearer
    address delegator;   // whose account executes; a MapaeAccount or (EIP-7702 path) an EOA
    bytes32 authority;   // parent delegation hash, or ROOT_AUTHORITY for a root
    Caveat[] caveats;    // conjunction: every one must pass
    uint256 salt;
    bytes signature;     // excluded from the hash
}

struct Caveat {
    address enforcer;
    bytes terms;         // signed by the delegator; layout fixed per enforcer
    bytes args;          // supplied by the redeemer; excluded from the hash
}
```

Field order, typehashes, and both hash exclusions are byte-identical to
MetaMask/delegation-framework. A Mapae delegation is redeemable on their `DelegationManager`
and theirs on ours.

## Constants

| Constant | Value |
|---|---|
| `DELEGATION_TYPEHASH` | `0x88c1d2ecf185adf710588203a5f263f0ff61be0d33da39792cde19ba9aa4331e` |
| `CAVEAT_TYPEHASH` | `0x80ad7e1b04ee6d994a125f4714ca0720908bd80ed16063ec8aee4b88e9253e2d` |
| `ROOT_AUTHORITY` | `0xffff…ffff` (`bytes32(type(uint256).max)`) |
| `ANY_DELEGATE` | `0x0000000000000000000000000000000000000a11` |
| `redeemDelegations` selector | `0xcef6d209` |
| EIP-712 domain | `name "Mapae"`, `version "1"`, chainId, manager address |

Hashing (`EncoderLib`): caveat hash = `keccak256(abi.encode(CAVEAT_TYPEHASH, enforcer,
keccak256(terms)))`; caveat array hash = `keccak256(abi.encodePacked(caveatHashes))`; delegation
hash = `keccak256(abi.encode(DELEGATION_TYPEHASH, delegate, delegator, authority,
caveatArrayHash, salt))`. Note `abi.encodePacked` for the array — not `abi.encode`.

## Execution encoding (ERC-7579)

Mode word, most significant byte first: `callType(1) ‖ execType(1) ‖ unused(4) ‖ selector(4) ‖
payload(22)`. A plain single call with revert-on-failure semantics is `bytes32(0)`.

Single execution calldata, tightly packed: `target(20) ‖ value(32) ‖ callData`.

`MapaeAccount` accepts only `CALLTYPE_SINGLE` + `EXECTYPE_DEFAULT`. Delegatecall would let a
delegate rewrite account storage past every caveat; `EXECTYPE_TRY` would let a spend be recorded
against a transfer that silently failed.

## Terms layouts

All terms are tightly packed at fixed offsets, following the MetaMask convention. Lengths are
validated on-chain; a wrong length is a revert, never a truncation.

| Enforcer | Length | Layout |
|---|---|---|
| `DojangVerifiedEnforcer` | 52 | `attesterId(32) ‖ principal(20)` |
| `ERC20PeriodTransferEnforcer` | 116 | `token(20) ‖ periodAmount(32) ‖ periodDuration(32) ‖ startDate(32)` |
| `AllowedPayeeEnforcer` | 20 × N, N ≥ 1 | packed payee addresses; empty terms revert (deny by default) |
| `TimestampEnforcer` | 32 | `afterThreshold(uint128) ‖ beforeThreshold(uint128)`, 0 = unset |
| `VerifiedCodeEnforcer` | ≥ 33 | `attesterId(32) ‖ domain(string, non-empty tail)`; **args** carry `codeHash(32)`, supplied at redemption — unsigned but conjure-proof: the gate passes only if a live attestation for that hash exists under the signed issuer and domain |

### `DojangVerifiedEnforcer` semantics

At `beforeHook` (the last gate before this delegation's execution):

1. If `principal != delegator`: require `factory.isMapaeAccount(delegator)`, then require
   `IMapaeAccount(delegator).owner() == principal`. Registry first — `owner()` on an unregistered
   contract is attacker-controlled. If `principal == delegator`, this is the EOA / EIP-7702 path.
2. Require `DojangScroll.isVerified(principal, attesterId)`. The boolean read, never the reverting
   uid getter: `isVerified` collapses absent / expired / revoked into `false`, so the payer always
   receives Mapae's one actionable error.
3. Emit `DojangGatePassed(manager, delegationHash, principal, delegator, attesterId,
   attestationUid)` — the traceback anchor. The uid getter is called only here, after `isVerified`
   guarantees it cannot revert.

The enforcer is stateless and never parses the execution calldata, so it composes with any call
shape and there is no per-delegation accounting to poison by calling the hook directly.

### Redemption pipeline (manager)

Validation strictly precedes caveats, in this order: array lengths → caller is leaf delegate (or
bearer) → every signature in the chain (ECDSA for EOAs, ERC-1271 for contracts) → disabled flags
and authority linkage → caveats. Hooks run `beforeAll` and `before` leaf→root, execution on the
**root** delegator's account, then `after` and `afterAll` root→leaf. Batches are atomic. The
ordering is pinned by `test_KillSwitches_AreOrthogonal`.

## Revert surface

| Error | Raised by | Meaning |
|---|---|---|
| `NotDojangVerified(principal, attesterId)` | identity gate | attestation absent, expired, or revoked |
| `UnknownAccount(delegator)` | identity gate | delegator is not a factory-registered account |
| `PrincipalMismatch(delegator, expected, actual)` | identity gate | account owner is not the signed principal |
| `PayeeNotAllowed(payee)` | payee gate | recipient outside the signed allowlist |
| `DirtyRecipientWord(word)` | payee gate | recipient word has non-zero upper bits |
| `CannotUseADisabledDelegation()` | manager | delegation switched off by its delegator |
| `InvalidEOASignature()` / `InvalidERC1271Signature()` | manager | signature does not bind the delegator |
| `InvalidDelegate()` / `InvalidAuthority()` | manager | caller or chain linkage wrong |
| `"ERC20PeriodTransferEnforcer:transfer-amount-exceeded"` | period cap | over the per-period allowance |
| `"TimestampEnforcer:expired-delegation"` / `"…early-delegation"` | window | outside the signed time range |

The x402 facilitator maps these to stable machine reasons: `identity_not_verified`,
`delegation_disabled`, `payee_not_allowed`, `delegation_cap_exceeded`,
`delegation_window_closed`, `invalid_signature`, with the decoded detail preserved as the
human-readable message.

## x402 conformance

x402 v2, `exact` scheme, EVM, `assetTransferMethod: "erc7710"`.

Payment requirements: `extra.assetTransferMethod = "erc7710"`. Payload:

```json
{"permissionContext": "0x<abi.encode(Delegation[])>", "delegationManager": "0x<manager>"}
```

Verification is simulation of `redeemDelegations` from the facilitator's settlement address;
settlement is the same call broadcast. The facilitator pins one manager (an attacker-supplied
manager would turn the fee payer into a gas faucet), fixes settlement gas rather than estimating
(GIWA's load-balanced RPC makes estimation race canonical state), and reports the root delegator
as `payer`. `/supported` advertises the settlement address in `signers` — clients append a leaf
delegation to it; a leaf cannot widen the root's scope
(`test_Redelegation_ChildCannotWidenParentCap`).

## Standards matrix

| Standard | Status |
|---|---|
| ERC-7710 | Implemented: the mandated `redeemDelegations(bytes[],bytes32[],bytes[])`, length-mismatch revert, batch atomicity |
| MetaMask delegation-framework | Byte-compatible structures and hashing; two enforcers vendored unmodified and deployed |
| ERC-7579 | Mode word and single-execution encoding, verified against the reference implementation |
| x402 v2 exact/EVM | `erc7710` method served end-to-end by an HTTP facilitator, live |
| EAS | Consumed via DojangScroll; attestation liveness (revocationTime, expirationTime) read at use |
| ERC-1271 / EIP-712 | Account signatures; owner-consent account creation; delegation signing |
| ERC-7715 | Mapping documented in [ERC7715.md](ERC7715.md); no wallet exists on GIWA to implement it yet |
