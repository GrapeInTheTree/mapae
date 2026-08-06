# Architecture

The authority layer for agent payments. This document covers the architecture and **why each
decision was made**; [SPEC.md](SPEC.md) is the byte-level reference, [DEMO.md](DEMO.md) is the
ledger of live transactions, and [GAPS.md](GAPS.md) records ecosystem gaps with the measurements
behind them.

A Korean edition, typeset as a standalone one-pager, is at
**[mapae.pages.dev/tech](https://mapae.pages.dev/tech)**.

---

## 1. What this solves

x402 opened the path for an agent to pay for things on its own. What is still missing is a way to
**hand over the authority to do so**. Today there are two options: give the agent a private key —
no cap, no payee restriction, no expiry — or trust a custodial service, which reintroduces the
intermediary that on-chain payment was supposed to remove.

Mapae is a third option. The delegation mechanism itself is not invented here: ERC-7710/7715 and
x402 are adopted as they stand, and the contribution is **one condition that did not exist
anywhere** — the identity of the person who granted the authority.

## 2. Architecture

```
principal (EOA, a person)  ──owns──▶  MapaeAccount  ──holds──▶  funds, delegation state
      │                                   ▲
      │ holds a Dojang attestation        │ executeFromExecutor
      ▼                                   │
  DojangScroll ◀──reads── MapaeDelegationManager ◀──redeemDelegations── agent / facilitator
   (liveness,                             │
    at time of use)                       └─ caveats: identity · period cap · payee · window
```

| Contract | Role |
|---|---|
| `MapaeDelegationManager` | ERC-7710 redemption. Validates signatures, chain linkage and disabled flags, evaluates the caveats, and only then delegates execution to the account |
| `MapaeAccount` | Holds the funds and the delegation state. `owner` is immutable |
| `MapaeAccountFactory` | CREATE2 deployment + EIP-712 owner-consent verification + registry |
| `DojangVerifiedEnforcer` | **The contribution.** Conditions a delegation on the delegator's real-world identity |
| `AllowedPayeeEnforcer` | Inspects the *recipient* inside the transfer calldata, not merely the target |
| `ERC20PeriodTransferEnforcer`<br>`TimestampEnforcer` | MetaMask's audited enforcers, vendored unmodified — compatibility demonstrated rather than claimed |
| `PerPaymentLimitEnforcer` | Caps a single payment. A period cap bounds the total; this shapes it into pieces — "₩50,000 a day, at most ₩10,000 per payment" |
| `VerifiedCodeEnforcer` | Human-in-the-loop tier: redeems only while a live off-chain confirmation stands |

## 3. Why identity and funds live at different addresses

**A Dojang attestation does not attach to a contract.** An exchange attests the wallet address of
a person who passed KYC; it will never attest a freshly deployed contract. So a design that gates
on the delegator address directly would leave the delegator unattested in production, and the demo
would pass only on a self-issued attestation — which proves nothing.

The addresses are therefore split. **The account holds the money and the delegation state; the
person who owns that account holds the identity.** The gate evaluates `owner`, not the account.

That split opens exactly one forgery path: anyone can deploy a contract whose `owner()` points at
a stranger's verified address. Nothing is stolen, but **the accountability chain is forged** — and
that chain is the entire product. Two defences close it:

1. **Creating an account requires an EIP-712 consent signature from the named owner.** The factory
   verifies it and records the binding. Without consent, no account claiming that owner can exist.
2. **The gate checks `factory.isMapaeAccount(delegator)` *before* it trusts `owner()`.** On an
   unregistered contract, `owner()` is a value the attacker chooses. Reverse the order and the
   defence is worthless.

A risk disappears as a side effect: because the owner EOA claims its attestation directly, the
question of whether a contract *can* receive one never arises.

## 4. What a payment passes through

1. The agent calls `redeemDelegations(permissionContexts, modes, executionCalldatas)`
2. The manager checks array lengths → the caller is the leaf delegate → **every signature in the
   chain** (ECDSA for EOAs, ERC-1271 for accounts) → disabled flags and authority linkage
3. Caveats: `beforeAll`, then `before` **leaf to root**
4. Execution runs on the **root delegator's account** (ERC-7579 single execution)
5. `after`, then `afterAll`, root to leaf

**Validation always precedes caveats.** That ordering is pinned by a test rather than assumed
(`test_KillSwitches_AreOrthogonal`), which is what makes the outcome deterministic when both kill
switches are thrown at once. Batches are atomic: if the second of two executions fails, the first
rolls back.

## 5. Caveats — what is actually signed

A caveat is `{enforcer, terms, args}`. **`terms` is signed by the delegator**; `args` is supplied
by the redeemer at use. The delegation hash excludes `signature` and `args`, so nothing the
redeemer supplies can alter what was signed.

All terms are tightly packed at fixed offsets, and a wrong length reverts rather than truncating.
Layouts are in [SPEC.md](SPEC.md#terms-layouts). Caveats are a conjunction — the last won of an
allowance is spendable, and one won past it is not.

## 6. The contribution — `DojangVerifiedEnforcer`

Delegation frameworks already express nearly every spending condition: amounts, periods, streams,
targets, methods, calldata, time windows, call counts. MetaMask's framework alone ships **38
audited caveat enforcers**.

**None of them — in any deployed framework, on any chain — conditions a delegation on identity**,
because there was no on-chain identity to condition on.

Four load-bearing decisions:

**It gates the principal, not the agent.** The question an auditor, counterparty or insurer asks
is *which verified human authorised this spend*, not whether the software is verified.

**The issuer is signed, not assumed.** The attester id lives inside the signed terms, so a
delegation scoped to Upbit Korea cannot be satisfied by a self-issued attestation — proven live in
[T4](DEMO.md). The issuer is a choice made at signing time rather than a deployment constant,
which means the gate widens as the Dojang ecosystem grows without any contract change.

**Liveness is read at use, never cached at issuance.** Dojang's own resolver documents that its
index is not the source of truth for liveness. Following that inherits revocation and expiry as
**instant, transaction-free kill switches**.

**The boolean read first, the uid getter second.** The uid getter reverts on an unverified
address. `isVerified` collapses absent, expired and revoked into `false`, so the payer always
receives Mapae's one actionable error.

The enforcer is stateless and never parses execution calldata, so it composes with any call shape
and has no per-delegation accounting to poison by calling the hook directly.

### A second gap — `AllowedPayeeEnforcer`

Target allowlists gate the **token contract**, but an ERC-20 payment's recipient lives at calldata
bytes `[4:36]`, which nothing deployed inspects. This enforcer is what makes *may pay only these
merchants* expressible. It denies by default: an empty payee list is an error, never an allow-all.

## 7. Kill switches — a 2×2

| | Delegation enabled | Delegation disabled |
|---|---|---|
| **Attestation live** | payment settles | `CannotUseADisabledDelegation` |
| **Attestation revoked** | `NotDojangVerified` | `CannotUseADisabledDelegation` (validation precedes caveats) |

Each axis was exercised **while the other stayed intact** — the delegation disabled with the
attestation live, the attestation revoked with the delegation enabled — so no result depends on an
unverified assumption about the manager's check order. Each is independently reversible: switching
a delegation back on **resumes against the allowance already spent**, it does not reset it.

What makes the identity switch different: revoking one attestation stops **every delegation that
person ever granted**, without a single transaction touching a Mapae contract.

## 8. Re-delegation

Re-delegation is a first-class ERC-7710 operation, so an agent can pass part of its authority on.
Every link's caveats are evaluated, which is what lets a child **narrow** what it received and
never widen it. Disabling the root kills a sub-agent nobody upstream has heard of.

## 9. The x402 path

x402 v2's `exact` scheme on EVM defines three asset-transfer methods. Two authorise at the token
layer and die with their nonce. The third, `erc7710`, is verified by **simulating the delegation
manager**, and is the only one a single authorisation can settle more than once.

Mapae plugs into that slot. The facilitator holds **no policy and no funds**: every cap, payee,
window and identity check runs on-chain, and its key pays gas and nothing else. That is not a
shortcut but the point — the policy engine being entirely on-chain is what lets the settler be
ignorant and unprivileged.

GIWA has no EIP-3009 token ([GAPS.md](GAPS.md)), so the other two methods are not available here
at all. See [DEMO.md](DEMO.md#x402-facilitator---the-erc7710-path-live) for the live run, where one
signed payload settles twice and the third attempt is refused before broadcast.

## 10. Agent integration — MCP

`npx mapae-mcp`, published to npm. Seven tools: `list_permissions`, `check_budget`, `pay`,
`agent_status`, `request_permission`, `load_context`, `redelegate`.

**There is deliberately no tool to issue or revoke.** That authority belongs to a person's
signature, and on-chain only the delegator holds it. An agent may spend and may pass a narrower
grant along — nothing else.

A payment's **recipients and token come from the signed policy, not from arguments**, so prompt
injection cannot redirect funds — when the policy allows several payees, the `payee` argument
selects among them and an outsider is rejected before any transaction. `request_permission`
composes the full policy shape (period cap, per-payment ceiling, named payees) into a link the
human reviews and signs. The agent key is generated locally on first run and never leaves
the machine; `MAPAE_PROFILE` separates identities, and it is set where a human configures the
server, never by a tool.

## 11. The product

`explorer/` is a static SPA with **no backend** — the browser reads GIWA directly. Three surfaces:

- **Create** — compose a scoped authority, read it back **as one sentence in your own language**,
  and sign. No gas, no transaction. The sentence and the bytes are generated from the same
  structure, and a test enforces that encode and decode are inverses, so what is read cannot drift
  from what is signed.
- **Permissions** — what was granted, what it has spent against its cap, and the switch that stops
  it. What was *issued* comes from the browser; what *happened* is read live from the chain on
  every mount. Where they disagree the chain wins, and the UI says which is which.
- **Explorer** — paste a payment hash and the full delegation chain unfolds with its conditions.

Two things separate the trace from a block explorer. **Rejections are first-class**: a refused
payment emits no logs, so the delegation is decoded from calldata and the reason recovered by
replaying the call against pre-block state. And **tense is honest**: a payment that was valid when
made shows both facts — proven valid then by the gate event, revoked now by the live read.

## 12. Verification

**155 tests**, all passing. What each layer proves matters more than the count.

| Layer | Count | What it proves |
|---|---|---|
| Fork tests, pinned at block 31,909,542 | 10 | Every Dojang assumption against the **real deployment**: a genuine Upbit-KYC'd address passes, issuers discriminate, revocation and expiry close the gate immediately |
| Encoding conformance | 16 | Typehashes, hash exclusions, ERC-7579 mode word — pinned as literal constants, never recomputed |
| Delegation chain | 16 | A child cannot widen its parent's cap; broken authority links and forged grafts are refused; disabling the root kills a sub-agent |
| Manager API | 16 | Kill-switch authority, malformed batches, no hook can re-enter redemption, hook ordering pinned |
| Enforcers and account | 89 | Forgery paths, execution-shape refusals, factory consent binding |
| Integration | 13 | The full scenario end to end, batch atomicity, the 2×2 matrix |
| Invariants, 1000 runs × 256 calls | 5 | Against an independent ghost ledger: the cap holds, **no payment while identity is dead**, none while disabled, tokens conserved |
| Cross-language byte parity | 37 | The same delegation encoded by Solidity, TypeScript and Go, byte-identical |
| Slither | 0 high, 0 medium | Five findings triaged and disabled inline with rationale |
| Source verification | 8 of 8 | Read from Blockscout's **API**, not from what a browser displays |

That last row is not pedantry. `MockKRW` showed source in the explorer and `forge verify-contract`
reported "already verified", while the API said `is_verified: false` — Blockscout was borrowing
source from a `verified_twin_address_hash`, a different address with identical bytecode that
someone else had verified. It is verified in its own right now.

**Bugs verification actually caught:** a mode-word packing error that silently disabled two
execution-shape guards, hiding while the all-zero test passed vacuously and surfacing on a
non-zero round-trip; a foundry configuration that reported deployment success while broadcasting
nothing, caught by reading code back from the chain; and an account-creation signature that was
well-formed yet rejected on-chain because it was signed as EIP-191 rather than the factory's
EIP-712 digest.

## 13. What was deliberately not built

| | |
|---|---|
| **A wallet** | That is GIWA Wallet's place. The ERC-7715 request path is already implemented ([ERC7715.md](ERC7715.md)) — when the wallet turns the standard on, this is a switch rather than an integration |
| **A stablecoin** | When a KRW stablecoin ships, only an address changes. The test token implements **no standard extension on purpose**, and everything working on top of a bare ERC-20 is the proof that the design is asset-agnostic |
| **A delegation standard** | Adopted, not invented. Audited enforcers run unmodified on this manager, and this identity enforcer runs on theirs |
| **An on-chain registry** | Requiring storage at grant time would break the model where a grant is an off-chain signature with no transaction. One gate event closes the traceback loop instead |
| **ERC-8004** | Permissionless self-registration adds nothing to an accountability chain, and no registry exists on GIWA (verified by probing). Agent identity is gated the GIWA-native way, through attested code |
| **A backend** | Whether an authority is valid must be answered by the chain. An index for fast queries is on the roadmap, but that is caching and shaping — not the source of truth |

## 14. Deployed — GIWA Sepolia (91342)

| Contract | Address |
|---|---|
| `MapaeDelegationManager` | [`0xfd0fCCCcF8071852783b5133b3CC47461f33e6Cd`](https://sepolia-explorer.giwa.io/address/0xfd0fCCCcF8071852783b5133b3CC47461f33e6Cd) |
| `MapaeAccountFactory` | [`0x157aF4D7b3f52685c817d5558b3468caD9b61299`](https://sepolia-explorer.giwa.io/address/0x157aF4D7b3f52685c817d5558b3468caD9b61299) |
| `DojangVerifiedEnforcer` | [`0xb2906a5079702B82C2973423d8cf91e8B41e6371`](https://sepolia-explorer.giwa.io/address/0xb2906a5079702B82C2973423d8cf91e8B41e6371) |
| `AllowedPayeeEnforcer` | [`0x7eF0f193B721B1749d890F1e231C8074670f1bD1`](https://sepolia-explorer.giwa.io/address/0x7eF0f193B721B1749d890F1e231C8074670f1bD1) |
| `ERC20PeriodTransferEnforcer` | [`0xE33ba891fa502A075D3E422258723eF4cB6AC892`](https://sepolia-explorer.giwa.io/address/0xE33ba891fa502A075D3E422258723eF4cB6AC892) |
| `TimestampEnforcer` | [`0x2911cB5D4aeBCa3e42FAaa5488b6e04df3C9cc02`](https://sepolia-explorer.giwa.io/address/0x2911cB5D4aeBCa3e42FAaa5488b6e04df3C9cc02) |
| `PerPaymentLimitEnforcer` | [`0x8900b56d714b902b7AfdbeC4722a9b098C8993d8`](https://sepolia-explorer.giwa.io/address/0x8900b56d714b902b7AfdbeC4722a9b098C8993d8) |
| `VerifiedCodeEnforcer` | [`0x1C640E0A70b1E18B120bB20952e81Df8F6b8650e`](https://sepolia-explorer.giwa.io/address/0x1C640E0A70b1E18B120bB20952e81Df8F6b8650e) |
| `MockKRW` | [`0x8bd74916E3427B4eF8Bed3D2F49241056E5e4F2B`](https://sepolia-explorer.giwa.io/address/0x8bd74916E3427B4eF8Bed3D2F49241056E5e4F2B) |

## 15. Next

**All 38 audited conditions.** Six are deployed — the ones a payment needs, now including a
per-payment ceiling, deployed and proven live with a settle/refuse pair. Because the structures
are byte-compatible, the rest is verification work rather than authoring: lifetime total, call
count, allowed selector, and an approved-order hash that binds a payment to a purpose.
Productised as scenario presets — subscription, corporate expense — so the combinations are a
choice rather than an exercise.

**Wallet integration and Dojang granularity.** The ERC-7715 request path exists; only the wallet
side remains. And as per-exchange and per-tier attestations appear, the expressible conditions
narrow **without a contract change**, because the issuer is a signed choice rather than a constant.

**A query layer.** GIWA has no off-chain Dojang query surface. Indexing real-issuer attestations
and Mapae redemptions opens one for the ecosystem: truth stays on the chain, speed comes from the
index.

**EIP-7702.** Verified active on GIWA by behavioural test. The owner EOA becomes the delegator
directly, so the attested address itself holds the delegation with no account contract. The
enforcer already accepts that shape (`principal == delegator`).

---

- **[mapae.pages.dev/tech](https://mapae.pages.dev/tech)** — 한국어판, 원페이저로 조판
- [SPEC.md](SPEC.md) — byte-level terms layouts, typehashes, conformance matrix
- [DEMO.md](DEMO.md) — every live transaction, expected vs. on-chain result
- [GAPS.md](GAPS.md) — measured ecosystem gaps, with the measurements
- [ERC7715.md](ERC7715.md) — the wallet-integration mapping
