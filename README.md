# Mapae

**The authority layer for delegated payments on GIWA, rooted in verified identity.**

GIWA ships primitives that answer questions of identity: Dojang answers *who is this address*,
UP.ID answers *what is it called*, Bojagi answers *who may see this transfer*. None of them answer
the question that decides whether anyone will ever hand real spending power to software:

> **Who may act on my behalf — within what limits, until when, and revocable how?**

Mapae is that missing primitive. A person with a verified real-world identity grants scoped
spending authority to software — an AI agent, a bot, a service. The scope is enforced on-chain,
revocation is immediate, and after the fact, any payment resolves backwards to the verified human
who authorised it.

마패(馬牌)는 조선의 관리가 지녔던 위임 증표다: 범위가 새겨져 있고, 기한이 있고, 회수된다.
당시의 마패는 위조할 수 있었다. 이것은 위조할 수 없다.

---

## The one transaction that explains the whole system

[`0xd3843e…`](https://sepolia-explorer.giwa.io/tx/0xd3843e1f73178b78942fe5ebaeb1ac30611f7734786b7e4640098e5e1749ed65)
is a payment attempt where **everything a payment system checks was in order** — valid signature,
₩40,000 of unspent daily allowance, open time window, allowlisted payee, enabled delegation.

It failed anyway, with `NotDojangVerified`, because one block earlier the principal revoked their
Dojang identity attestation — in
[a transaction](https://sepolia-explorer.giwa.io/tx/0xf404289108feae99aa0c73db31b6c607fbfc9e19930765942fa91b2c78d7c546)
that never touched a Mapae contract.

The delegation layer did not need to be told. It reads identity liveness at the moment of use,
so revoking who you are revokes everything you delegated. No other agent-payment stack has this
property, because no other chain has an exchange-issued identity layer to anchor it to.

All fourteen demo transactions — payments, and every category of rejection with its decoded
error — are public and clickable in **[docs/DEMO.md](docs/DEMO.md)**.

---

## What is deployed

GIWA Sepolia (chain 91342), block 31,935,436. Every contract is source-verified on
[Blockscout](https://sepolia-explorer.giwa.io).

| Contract | Address | Role |
|---|---|---|
| `MapaeDelegationManager` | [`0xfd0f…e6Cd`](https://sepolia-explorer.giwa.io/address/0xfd0fCCCcF8071852783b5133b3CC47461f33e6Cd) | ERC-7710 redemption, byte-compatible with MetaMask's delegation framework |
| `MapaeAccountFactory` | [`0x157a…1299`](https://sepolia-explorer.giwa.io/address/0x157aF4D7b3f52685c817d5558b3468caD9b61299) | Deploys accounts; registry of owner-consented bindings |
| `DojangVerifiedEnforcer` | [`0xb290…6371`](https://sepolia-explorer.giwa.io/address/0xb2906a5079702B82C2973423d8cf91e8B41e6371) | **The contribution — see below** |
| `AllowedPayeeEnforcer` | [`0x7eF0…1bD1`](https://sepolia-explorer.giwa.io/address/0x7eF0f193B721B1749d890F1e231C8074670f1bD1) | Restricts the transfer *recipient*, not merely the target |
| `ERC20PeriodTransferEnforcer` | [`0xE33b…C892`](https://sepolia-explorer.giwa.io/address/0xE33ba891fa502A075D3E422258723eF4cB6AC892) | MetaMask's audited period cap, vendored unmodified |
| `TimestampEnforcer` | [`0x2911…cc02`](https://sepolia-explorer.giwa.io/address/0x2911cB5D4aeBCa3e42FAaa5488b6e04df3C9cc02) | MetaMask's time window, vendored unmodified |
| `VerifiedCodeEnforcer` | [`0x1C64…650e`](https://sepolia-explorer.giwa.io/address/0x1C640E0A70b1E18B120bB20952e81Df8F6b8650e) | Human-in-the-loop tier: redeems only while a live off-chain confirmation stands |
| `MockKRW` | [`0x8bd7…4F2B`](https://sepolia-explorer.giwa.io/address/0x8bd74916E3427B4eF8Bed3D2F49241056E5e4F2B) | Testnet stand-in for a KRW stablecoin. Zero decimals, no value |

## The contribution

Delegation frameworks already express almost every spending condition: amounts, periods, streams,
targets, methods, calldata, time windows, call counts. MetaMask's framework alone ships 38 audited
caveat enforcers.

**None of them — in any deployed framework, on any chain — conditions a delegation on identity.**

`DojangVerifiedEnforcer` closes that gap. It gates redemption on the delegator's principal holding
a live Dojang Verified Address attestation from an issuer the delegator named *in the signed
terms*, evaluated at redemption time. Its load-bearing decisions:

- **It gates the principal, not the agent.** The question an auditor, counterparty, or insurer
  asks is *which verified human authorised this spend* — not whether the software is verified.
- **The issuer is signed, not assumed.** A delegation scoped to Upbit Korea cannot be satisfied by
  a self-issued attestation. Proven live:
  [T4](https://sepolia-explorer.giwa.io/tx/0xfaf9880c21fabd04e1053275afcb01c4f308da7643fd6ff6c21a525f59c22ef4)
  rejects a faucet-attested principal under an Upbit-scoped delegation.
- **Liveness is read at use, never cached at issuance.** Dojang's own resolver documents that its
  index is not the source of truth for liveness. This inherits both revocation and expiry as
  instant, transaction-free kill switches.
- **It is portable in both directions.** The manager adopts MetaMask's structures byte-for-byte —
  typehashes, hook ordering, `ROOT_AUTHORITY`, terms conventions — so their enforcers run here
  unmodified (two are vendored and deployed), and this enforcer runs on their manager on any chain
  that gains an attestation issuer worth gating on.

A second, smaller gap fell out of the work: target allowlists gate the *token contract*, but an
ERC-20 payment's recipient lives at calldata bytes `[4:36]`, which nothing deployed inspects.
`AllowedPayeeEnforcer` is what makes *may pay only these merchants* expressible. It denies by
default: an empty payee list is an error, never an allow-all.

## Architecture

```
principal (EOA)  ──owns──▶  MapaeAccount  ──holds──▶  funds, delegation state
      │                          ▲
      │ holds Dojang             │ executeFromExecutor
      │ attestation              │
      ▼                          │
DojangScroll ◀──reads── MapaeDelegationManager ◀──redeemDelegations── agent / facilitator
 (liveness,                      │
  at use)                        └─ caveats: identity · period cap · payee · window
```

Identity and funds are deliberately separate addresses. Upbit attests a KYC'd **person's wallet**;
it will never attest a freshly deployed contract. So the account holds the money and the
delegation state, its immutable `owner` is the human the identity gate evaluates, and the factory
closes the forgery this split would otherwise open: creating an account requires an EIP-712
consent signature *from the named owner*, and the enforcer trusts `owner()` only for
factory-registered accounts. Without that, anyone could deploy a contract pointing `owner()` at a
stranger's verified address — stealing nothing, but forging the accountability chain, which is
the entire product.

Revocation is symmetric and orthogonal, proven as a 2×2 on-chain
([T5–T8](docs/DEMO.md)): disabling the delegation blocks payment while the identity stays live;
revoking the identity blocks payment while the delegation stays enabled; each is independently
reversible; and when both are thrown, the manager's disabled check wins deterministically because
chain validation runs strictly before any caveat.

## The x402 path

x402 v2's `exact` scheme on EVM defines three asset-transfer methods. Two of them — `eip3009`,
`permit2` — authorise at the token layer and die with their nonce. The third, `erc7710`, is
verified by *simulating the delegation manager*, and is the only one a single authorisation can
settle **more than once**.

Mapae plugs into that slot. The
[gosuda/x402-facilitator](https://github.com/gosuda/x402-facilitator) (branch
`feat/giwa-erc7710`) settles Mapae delegations while holding **no policy and no funds**: every
cap, payee, window, and identity check runs on-chain, and the facilitator's key pays gas and
nothing else. Proven live — the client signed two typed-data payloads and spoke HTTP, needing no
gas at all:

| | Result | Tx |
|---|---|---|
| `/verify` valid payment | `isValid: true`, payer = the account, not the agent | — |
| `/verify` over cap | `delegation_cap_exceeded` — decoded from chain, not policy code | — |
| `/settle` ₩20,000 | broadcast; funds move account → merchant | [`0x9fbe7b…`](https://sepolia-explorer.giwa.io/tx/0x9fbe7b2be9350e554688b13abc9b9ecb02d49ac0ea0ae893b51ad43637dc2422) |
| `/settle` same payload again | **second settlement of one authorisation** | [`0x8a1fba…`](https://sepolia-explorer.giwa.io/tx/0x8a1fba254777efe388617d6be2d4f5d6798352bda443642957d62666e52c2db6) |
| `/settle` third attempt | refused before broadcast; fee payer spent zero gas | — |

## Verification

The demo is asserted, not screenshotted; every claim above has either a transaction hash or a
test behind it.

| Layer | What it proves |
|---|---|
| 10 fork tests, pinned at block 31,909,542 | Every Dojang assumption, against the **real** deployment: a genuine Upbit-KYC'd address passes the gate, issuers discriminate, revocation and expiry close `isVerified` immediately |
| 16 encoding tests | Typehashes, hash exclusions (`signature`, `args` — fuzzed), ERC-7579 mode word and execution layout — pinned as literal constants, never recomputed |
| 54 unit tests | Enforcers (forgery paths included), account execution-shape refusals, factory consent binding |
| 13 integration tests | The full T1–T8 demo through the real manager; batch atomicity; the 2×2 kill-switch matrix |
| 5 invariants, 1000 runs × 256 calls | Against an independent ghost ledger: period cap holds, **no payment while identity is dead**, none while disabled, attacker never paid, tokens conserved |
| Cross-language byte parity | `abi.encode(Delegation[])`, the EIP-712 digest, and the packed execution are byte-identical across Solidity (reference), TypeScript (SDK), and Go (facilitator) — Solidity emits the fixtures, the other two are pinned to them |
| Slither | 0 high, 0 medium; five findings triaged and disabled inline with rationale |
| 14 + 5 live transactions | The T1–T8 demo and the facilitator flow, on the public chain |

Development surfaced four real bugs before deployment, each caught by a verification layer doing
its job: a mode-word packing error that silently disabled two execution-shape guards (caught by
non-zero round-trips after the all-zero test passed vacuously), a terms-length check that a
comment claimed and the code lacked, a foundry configuration that reported deployment success
while broadcasting nothing (caught by reading code back from the chain), and RPC read-consistency
races on GIWA's load-balanced public endpoint (documented in [docs/GAPS.md](docs/GAPS.md)).

## Reproduce

```bash
git clone --recursive https://github.com/GrapeInTheTree/mapae && cd mapae

# unit, integration, invariant tests
forge test --no-match-path 'test/fork/*'

# fork suite against the live Dojang deployment
GIWA_SEPOLIA_RPC_URL=https://sepolia-rpc.giwa.io forge test --match-path 'test/fork/*'

# cross-language byte parity
pnpm install && pnpm fixtures

# the live demo (needs two funded keys - see .env.example)
cp .env.example .env && pnpm demo
pnpm trace <any T1 hash>
```

## Roadmap

| | |
|---|---|
| **EIP-7702 path** | Verified active on GIWA by behavioural test. The principal's EOA becomes the delegator directly — the Upbit-attested address itself holds the delegation, no account contract. The enforcer already accepts this shape (`principal == delegator`). |
| **Graduated autonomy** | `VerifiedCodeEnforcer` is deployed and verified: Dojang's Verified Code attests an *off-chain human confirmation* (OTP-style, under a service domain), so high-value delegations can require a person in the loop per confirmation window while small ones run unattended — the historical mapae tiers, as caveats. Awaiting the first Verified Code issuer integration for a live flow; today only Upbit issues them, through its own channel. |
| **Attestation query API** | GIWA has no off-chain Dojang query surface ([docs/GAPS.md](docs/GAPS.md)). A Ponder-based index of real-issuer attestations and Mapae redemptions is measured and scoped. |
| **ERC-7715** | [docs/ERC7715.md](docs/ERC7715.md) maps Mapae onto `wallet_requestExecutionPermissions` — the wallet-side request surface GIWA Wallet could implement, including a proposed `dojang-verified` permission type. |
| **ERC-8004** | Deliberately not adopted. Its identity registry is permissionless self-registration, which proves nothing and adds no link to the accountability chain (and no 8004 registry exists on GIWA — verified by probing). Agent identity here is gated the GIWA-native way: attested code via `VerifiedCodeEnforcer`. If registries mature into something attestation-backed, the enforcer pattern extends to them in one caveat. |

## Documentation

- [docs/DEMO.md](docs/DEMO.md) — every live transaction, expected vs. on-chain result
- [docs/SPEC.md](docs/SPEC.md) — byte-level terms layouts, typehashes, conformance
- [docs/GAPS.md](docs/GAPS.md) — measured ecosystem gaps, with the measurements
- [docs/ERC7715.md](docs/ERC7715.md) — the wallet-integration mapping

## License

MIT. `src/enforcers/{CaveatEnforcer,TimestampEnforcer,ERC20PeriodTransferEnforcer}.sol` are
vendored from [MetaMask/delegation-framework](https://github.com/MetaMask/delegation-framework)
(MIT AND Apache-2.0) with pragma and import adaptations only — see [NOTICE](NOTICE).
