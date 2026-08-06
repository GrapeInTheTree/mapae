<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/mark-dark.svg">
  <img src="docs/brand/mark-light.svg" width="60" alt="Mapae">
</picture>

<h1>M&nbsp;A&nbsp;P&nbsp;A&nbsp;E</h1>

**Authority moves. Identity stays.**

Don't give AI your wallet — give it bounded authority, granted by someone the chain can name.<br>
AI에게 지갑을 주지 마세요. 범위를 정한 권한만 주세요.

<sub>
  <a href="#the-one-transaction-that-explains-the-whole-system">Live demo</a> ·
  <a href="#what-is-deployed">Contracts</a> ·
  <a href="#the-contribution">The contribution</a> ·
  <a href="#verification">Verification</a> ·
  <a href="docs/DEMO.md">Every transaction</a>
</sub>

<br>

<sub>
  <img alt="GIWA Sepolia" src="https://img.shields.io/badge/GIWA_Sepolia-91342-8A5A35?style=flat-square&labelColor=11100E">
  <img alt="Solidity" src="https://img.shields.io/badge/Solidity-0.8.29-8A5A35?style=flat-square&labelColor=11100E">
  <img alt="Tests" src="https://img.shields.io/badge/tests-172_passing-1D7A5F?style=flat-square&labelColor=11100E">
  <img alt="Slither" src="https://img.shields.io/badge/Slither-0_high_·_0_medium-1D7A5F?style=flat-square&labelColor=11100E">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-8A5A35?style=flat-square&labelColor=11100E">
</sub>

</div>

<br>

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

Every category of settlement and refusal is live on the ledger — period cap, per-payment
ceiling, unlisted payee, expired window, disabled delegation, revoked identity — each with its
decoded error, public and clickable in **[docs/DEMO.md](docs/DEMO.md)**. Four of them were signed by
a person in MetaMask rather than by a script, which is the difference between a system that
demonstrably works and two programs agreeing with themselves.

---

## What two regulators are asking, in 2026

Nothing here is a compliance claim. Mapae is not a licensed institution and does not implement
any reporting obligation. What follows is only this: the questions being asked in public right
now have a shape, and it is the shape of this repository.

**The United Kingdom.** HM Treasury published *Modernising Payment Services Regulation* in July
2026 (PU 3657, open until 6 October). It observes at 3.35 that "the PSRs were designed before the
development of AI and may not fully facilitate the use of agentic AI", and then asks two questions
verbatim:

> **Question 12:** How does the payment services regulatory framework need to adapt to support the
> use of smart contracts and programmable payments underpinning them?
>
> **Question 15:** How does existing payment services regulation need to adapt to support agentic
> payments? For example, do provisions relating to authentication and consent of payments
> transactions, and liability for unauthorised payment transactions, need updating?

Authentication, consent, and liability for what was never authorised. A Mapae delegation is a
person's consent written as machine-readable scope; the identity condition is what binds a payment
to that person at the moment it settles; and a payment outside the scope does not settle at all.

**Korea.** The amended Act on Reporting and Using Specified Financial Transaction Information
takes effect on **20 August 2026**, and the subordinate rules the Financial Services Commission
put out for comment on 30 March are phased in behind it. Two dates matter and they are not the
same one. The Act sets the perimeter this August — who may operate as a virtual asset service
provider at all. The floor closes later: from **1 January 2027**, the Travel Rule, applied today
only to transfers of ₩1,000,000 or more between providers, extends below that threshold, and the
*receiving* provider takes on an obligation of its own — obtain the originator information,
request it where it is missing, and where it still does not arrive, **refuse the transfer**.

The FSC's stated reason is a number worth sitting with: **about 60% of domestic VASP-to-VASP transfers,
by count in the second half of 2025, were under ₩1,000,000.** Small and numerous is exactly what
agent traffic looks like, and it is what stops being exempt on 1 January 2027.

Two things follow, and neither is a claim about compliance.

The first is that the direction is toward every transfer carrying an identifiable originator, with
no de-minimis floor to hide beneath. The second is subtler and it is the one worth reading twice:
**the remedy the rule prescribes for a transfer whose originator cannot be established is to
refuse it.** That is not an approximation of what `DojangVerifiedEnforcer` does. It is the same
sentence, one written for institutions to execute and one written in Solidity.

GIWA is where those two sentences can meet, because Dojang attestations are issued by the very
institutions the rule governs. Identity does not have to be imported from somewhere it can be
disputed; it is already on the chain the payment settles on.

---

## What is deployed

GIWA Sepolia (chain 91342). All nine are source-verified on
[Blockscout](https://sepolia-explorer.giwa.io) — re-checkable with `pnpm check-verified`, which
reads `is_verified` from the API rather than trusting that a browser displays source.

That distinction is not pedantry. `MockKRW` showed source in the explorer and `forge
verify-contract` reported "already verified", while the API said `is_verified: false`: Blockscout
was borrowing source from a `verified_twin_address_hash`, a different address with identical
bytecode that someone else had verified. It is verified in its own right now.

| Contract | Address | Role |
|---|---|---|
| `MapaeDelegationManager` | [`0xfd0f…e6Cd`](https://sepolia-explorer.giwa.io/address/0xfd0fCCCcF8071852783b5133b3CC47461f33e6Cd) | ERC-7710 redemption, byte-compatible with MetaMask's delegation framework |
| `MapaeAccountFactory` | [`0x157a…1299`](https://sepolia-explorer.giwa.io/address/0x157aF4D7b3f52685c817d5558b3468caD9b61299) | Deploys accounts; registry of owner-consented bindings |
| `DojangVerifiedEnforcer` | [`0xb290…6371`](https://sepolia-explorer.giwa.io/address/0xb2906a5079702B82C2973423d8cf91e8B41e6371) | **The contribution — see below** |
| `AllowedPayeeEnforcer` | [`0x7eF0…1bD1`](https://sepolia-explorer.giwa.io/address/0x7eF0f193B721B1749d890F1e231C8074670f1bD1) | Restricts the transfer *recipient*, not merely the target |
| `ERC20PeriodTransferEnforcer` | [`0xE33b…C892`](https://sepolia-explorer.giwa.io/address/0xE33ba891fa502A075D3E422258723eF4cB6AC892) | MetaMask's audited period cap, vendored unmodified |
| `TimestampEnforcer` | [`0x2911…cc02`](https://sepolia-explorer.giwa.io/address/0x2911cB5D4aeBCa3e42FAaa5488b6e04df3C9cc02) | MetaMask's time window, vendored unmodified |
| `PerPaymentLimitEnforcer` | [`0x8900…93d8`](https://sepolia-explorer.giwa.io/address/0x8900b56d714b902b7AfdbeC4722a9b098C8993d8) | Caps a single payment; shapes the period budget into pieces. Proven live: [at the cap settles](https://sepolia-explorer.giwa.io/tx/0x3e922d55e1dfbbe705aaf80fef79ea4ad5a2042e6476d0b204aaebccdc159b0a), [one over is refused](https://sepolia-explorer.giwa.io/tx/0xdac9db98fe72c7aa67f043f7728e68815cd65ee9b1515b85494e4bf84a5c5eac) |
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
- **It is portable in both directions, and that is tested rather than asserted.** The manager
  adopts MetaMask's structures byte-for-byte — typehashes, hook ordering, `ROOT_AUTHORITY`, terms
  conventions — so their enforcers run here unmodified (two are vendored and deployed). The other
  direction now runs against **MetaMask's own deployed manager** on Ethereum Sepolia
  ([test/fork/MetaMaskPortability.t.sol](test/fork/MetaMaskPortability.t.sol)): their contract
  validates the signature, walks the chain and calls these conditions, and a revoked principal is
  refused there just as here.

  What that test cannot carry across is the point. Dojang exists only on GIWA, so the identity
  registry has to be mocked on Sepolia: **the machine ports, the meaning does not.** An enforcer
  that asks *is this person verified* is only worth deploying on a chain that can answer.

A second, smaller gap fell out of the work. Target allowlists gate the *token contract*, while an
ERC-20 payment's recipient lives at calldata bytes `[4:36]`. A generic calldata enforcer can pin
that word — but to **one exact value**, so *may pay only these three merchants* costs three
delegations, or a fresh signature for every payment. `AllowedPayeeEnforcer` reads the same word
against a **set**, which makes that policy one signature. It denies by default: an empty payee
list is an error, never an allow-all.

## Compared with spend permissions

The closest deployed thing to Mapae is not another delegation framework. It is Coinbase's
[Spend Permissions](https://github.com/coinbase/spend-permissions), which lets a smart account
grant a recurring allowance to a spender. It is well built and widely used, and reading it is the
fastest way to see what a spending allowance leaves undecided.

```solidity
struct SpendPermission {
    address account;      address spender;   address token;
    uint160 allowance;    uint48  period;    uint48  start;   uint48 end;
    uint256 salt;         bytes   extraData;
}

// SpendPermissionManager.spend()
_transferFrom(spendPermission.token, spendPermission.account, spendPermission.spender, value);
```

There is no recipient parameter, because there is no recipient concept: funds move to the
`spender`. That is not a weakness in the design — it is the design. A spend permission answers
*how much may leave this account, how often*, and the chain's involvement ends when the spender
receives it. Where the money goes next, and on whose authority it left, are questions settled
somewhere the chain cannot see. `extraData` is the natural place to write an intent or an
authorising identity into the grant, and the manager hashes it but never reads it: whatever it
says is enforced by convention among the parties, not by the contract.

Two consequences, stated as differences rather than faults.

|  | Spend permission | Mapae delegation |
|---|---|---|
| Who receives the funds | The `spender` named in the grant | Any payee in a signed set, checked at calldata `[4:36]` |
| Where the chain stops caring | When the spender is paid | When the payee is paid |
| Who authorised it | Known off-chain, if recorded at all | A live attestation, read at every redemption |
| Revoking the person | Not a concept — the grant is the unit | Revokes every grant that named them, in one transaction they never send |

Mapae is not a better allowance. It is an allowance with two more questions answered on-chain:
**where it may go, and who is standing behind it.** That second question is the one an auditor,
a counterparty, or a regulator asks first, and it is the one no deployed grant format asks at all.

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

Re-delegation is a first-class ERC-7710 operation, so an agent can pass part of its authority on.
Every link's caveats are evaluated, which is what makes a child able to **narrow** what it
received and never widen it — the property the chain suite exists to defend, and which is also
[mined live three hops deep](docs/DEMO.md): a person signs once to A, A hires B, B hires C, and
neither hire is a transaction or carries the person's signature. B is free to *write* C a ceiling
five times the root's; nothing prevents signing it. It simply does not survive redemption.

That run exists for the row after it. The person revokes their own attestation — one transaction,
no Mapae contract in it, no delegation named — and both the leaf and the branch they actually
remember stop together. The narrow claim is the true one: **disabling a root severs a chain in any
ERC-7710 framework**, and that is the standard working rather than something we add. What is ours
runs the other way — the person acts on their identity, and every tree they ever rooted stops,
including the branches they never signed and cannot enumerate. Revoking what you remember is easy.
The authority that hurts you is the one you cannot list.

## The product

`explorer/` is not only an explorer. It is the three surfaces the primitive needs to be usable by
a person, bilingual throughout (한국어 / English), a pure static SPA with **no backend** — the
browser reads GIWA directly.

| | |
|---|---|
| **Explorer** | Paste any payment hash and it renders the full chain: every link of the delegation with its conditions in plain language, each naming the contract that enforces it, the funding account with its consent binding, the principal's identity with its live status, and the attestation read back from EAS. Verified on the spot, nothing stored. |
| **Create** | A person who has never read ERC-7710 composes a scoped authority, reads it back as one sentence in their own language, and signs it. No gas, no transaction — a grant is off-chain by design and leaves no trace until an agent spends it. The sentence and the bytes are generated from the same structure, so what is read cannot drift from what is signed. |
| **Permissions** | What I granted, what it has spent against its cap, and the switch that stops it. Two truths joined: what was *issued* comes from the browser, what *happened* is read live from the chain on every mount. Where they disagree, the chain wins, and the UI says which is which. |

Two properties distinguish the trace from a block explorer. **Rejections are first-class**: a
refused payment has no logs, so the delegation is decoded from calldata and the refusal reason
recovered by replaying the call against pre-block state — a rejection page tells a richer story
than a success. And **time is honest**: a payment that was valid when made shows both facts —
proven valid then by the gate event, revoked now by the live read — the tense distinction an
auditor actually needs.

The round trip is closed, not asserted. `pnpm verify-signing` runs the Composer's exact
construction headlessly — the same SDK modules, with viem substituted where MetaMask signs — and
checks eleven things against the deployed contracts, ending at a disabled delegation refusing the
payment it had just made. A person then did it in a browser: [P1–P4 in
docs/DEMO.md](docs/DEMO.md) are that same sequence with MetaMask doing the signing.

```bash
cd explorer && pnpm install && pnpm dev

pnpm preflight <your wallet>      # gas, attestation, account, funds - each with its fix
pnpm redeem <permission context>  # spend a Mapae the browser issued
```

## The agent surface — MCP

The three surfaces above are for the person. The agent's surface is MCP: `npx mapae-mcp`,
published to npm, gives any MCP-speaking model seven tools that map to what a delegate can do
on-chain — and nothing more. There is deliberately no tool to issue or revoke. Issuance is the
principal's EIP-712 signature, and a server holding that key would be handing the agent the
wallet; revocation belongs to the delegator alone, enforced by the manager itself. What the
agent can do is ask: `request_permission` composes the whole policy — period cap, per-payment
ceiling, one or many named payees — into a link, and the Composer opens with that policy armed,
spelled out as a sentence, waiting for a signature only the person can give.

Payment is structurally confined. The token and the allowed payees come from the signed policy,
never from arguments. When the policy allows several payees, the `payee` argument chooses among
them, and an address outside the signed list is rejected before a transaction exists — a prompt
injection that fully controls the model can, at worst, pick which of the approved merchants gets
paid. Refusals come back as results carrying the enforcer's decoded reason, because a refusal is
the system working.

`mcp/harness.ts` exercises the built server over stdio JSON-RPC, exactly as a model's client
would: it paid both allowed payees of a live authority —
[₩700 to the first](https://sepolia-explorer.giwa.io/tx/0x18ee370c2e6321801a528629f7061542150c312ea2080c3584d3064577c2e332),
[₩300 to the second by name](https://sepolia-explorer.giwa.io/tx/0x26a8e5ac484cb1122ec18f9b337be30f895d007f6370ff0a8c795e43b2913843)
— had an outsider rejected without a transaction, was refused on-chain with
[`PerPaymentCapExceeded(1500, 1000)`](https://sepolia-explorer.giwa.io/tx/0x8091a929dc6f3f72d51d1b824924dd38ab71804692135b43895dca785adc3e5a),
and signed a two-hop child authority narrowed to ₩500/day and ₩200 per payment without any
transaction. The package on npm was then verified cold — fresh cache, throwaway profile,
straight from the registry — to behave as shipped.

### Is a refusal worth a transaction?

By default a refused payment is broadcast: it fails on-chain, costs gas, and leaves a transaction
anyone can open and read the enforcer's own error in. To someone who must show that a control
fired, a refusal that exists only in this process's logs is worth very little — the process that
produced it is the process being questioned. `MAPAE_REFUSAL_MODE=dry` returns the same refusal
with `tx: null` and spends nothing; the reason is identical and the evidence is what is lost.

Both are right for someone, so it is a setting rather than a decision baked in. The default leans
to evidence because on GIWA the trade-off is real in principle and lopsided in practice: a refused
redemption costs on the order of **0.0000003 ETH**. The facilitator stands the other way round —
x402 `/verify` refuses before broadcasting, because a facilitator has no licence to burn someone
else's gas. Two positions, different obligations.

## The index — an accelerator, never a dependency

[**index.mapae.org**](https://index.mapae.org/api/stats) serves the aggregates and the attempt
list the explorer used to compute per visit ([GrapeInTheTree/mapae-ponder](https://github.com/GrapeInTheTree/mapae-ponder),
a Ponder monorepo, self-hosted). Every row in it is derivable from logs alone, so the database
can be dropped and rebuilt from the chain at any time — it is a cache, and the explorer treats
it as one. The client asks the index first with a two-second deadline and falls back to reading
GIWA directly, which is why losing the machine costs speed and nothing else. Verified against a
server that accepts connections and never answers: the page still rendered, from the chain, in
275ms.

Two things are worth naming. **Refusals are recovered, not skipped** — a reverted transaction has
no logs, so the one thing a log indexer structurally cannot see is the thing Mapae treats as
first-class; the API supplies them with their intent decoded from calldata. And `/api/stats`
reports **`ready`**, because Ponder advances one checkpoint across every source: while any source
is still backfilling, its counts are a fraction of the truth, and a fast wrong number is worse
than a slow right one. The explorer ignores an index that says it is not ready.

## The x402 path

x402 v2's `exact` scheme on EVM defines three asset-transfer methods. Two of them — `eip3009`,
`permit2` — authorise at the token layer and die with their nonce. The third, `erc7710`, is
verified by *simulating the delegation manager*, and is the only one a single authorisation can
settle **more than once**. This is not a niche rail: x402 has settled 157M+ payments on-chain
(July 2026), and the foundation governing it — under the Linux Foundation, alongside Coinbase,
Google, Visa and Mastercard — counts **KakaoPay as its only Korean founding member**.

**It runs, publicly, at [x402.mapae.org](https://x402.mapae.org/supported).** Point an x402 client
at it and the settlement path below is the one that answers.

Mapae plugs into that slot. The `erc7710` method is
[implemented upstream in gosuda/x402-facilitator](https://github.com/gosuda/x402-facilitator/tree/feature/erc7710)
— contributed as a general implementation against any pinned ERC-7710 manager, not as a Mapae
adapter — and it settles Mapae delegations while holding **no policy and no funds**: every
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
test behind it. **172 tests**, all passing.

| Layer | Count | What it proves |
|---|---|---|
| Fork tests, pinned at block 31,909,542 | 10 | Every Dojang assumption against the **real** deployment: a genuine Upbit-KYC'd address passes the gate, issuers discriminate, revocation and expiry close `isVerified` immediately |
| Encoding conformance | 16 | Typehashes, hash exclusions (`signature`, `args` — fuzzed), ERC-7579 mode word and execution layout — pinned as literal constants, never recomputed |
| Delegation chain | 16 | Re-delegation: a child cannot widen its parent's cap, broken authority links and forged grafts are refused, disabling the root kills a sub-agent nobody upstream has heard of. The only path that exercises ECDSA, since a child's delegator is an EOA where the root's is an account on ERC-1271 |
| Manager API | 16 | Who may throw the kill switch, malformed batches, and two structural guarantees: no hook can re-enter redemption, and hook ordering across both a batch and a chain is pinned rather than assumed |
| Enforcers and account | 89 | Forgery paths, execution-shape refusals, factory consent binding, and the vendored MetaMask code exercised rather than merely present |
| Integration | 13 | The full T1–T8 demo through the real manager; batch atomicity; the 2×2 kill-switch matrix |
| Invariants, 1000 runs × 256 calls | 5 | Against an independent ghost ledger: period cap holds, **no payment while identity is dead**, none while disabled, attacker never paid, tokens conserved |
| Portability, on MetaMask's own manager | 5 | Mapae's conditions driven by **MetaMask's deployed DelegationManager** on Ethereum Sepolia — their signature validation, their chain walking, their hook ordering. The identity gate refuses a revoked principal there exactly as it does here, and the EIP-712 domain is read from their contract rather than assumed |
| Cross-language byte parity | 4 + 33 | `abi.encode(Delegation[])`, the EIP-712 digest and the packed execution are byte-identical across Solidity (reference), TypeScript (SDK) and Go (facilitator). The policy codec is proven a pair of inverses, so the sentence a person reads cannot drift from the terms they sign |
| Slither | 0 high, 0 medium | Five findings triaged and disabled inline with rationale |
| Live transactions | every path | The full demo matrix, the facilitator flow, a six-persona campaign collecting every refusal kind, four signed by a person in MetaMask, and the MCP server paying, choosing among payees, and being refused over stdio |
| Source verification | 8 of 8 | Every deployed contract, checked against Blockscout's API by `pnpm check-verified` |

Development surfaced real bugs before deployment, each caught by a verification layer doing its
job: a mode-word packing error that silently disabled two execution-shape guards (caught by
non-zero round-trips after the all-zero test passed vacuously), a foundry configuration that
reported deployment success while broadcasting nothing (caught by reading code back from the
chain), an account-creation signature that was well-formed and rejected on-chain because it was
signed as EIP-191 rather than the factory's EIP-712 digest, and an address field that refused
valid addresses because viem's `isAddress` is checksum-strict by default. RPC read-consistency
races on GIWA's load-balanced public endpoint are documented in [docs/GAPS.md](docs/GAPS.md).

## Reproduce

```bash
git clone --recursive https://github.com/GrapeInTheTree/mapae && cd mapae

# everything: 157 unit, integration and invariant tests, plus 15 against two live chains.
# No configuration - the fork suites default to public endpoints. Set GIWA_SEPOLIA_RPC_URL
# or ETH_SEPOLIA_RPC_URL only to point them somewhere else.
forge test

# cross-language byte parity and the policy codec
pnpm install && pnpm fixtures

# every deployed contract is source-verified, right now
pnpm check-verified

# the Composer's signing path, against the deployed contracts
pnpm verify-signing

# the live demo (needs two funded keys - see .env.example)
cp .env.example .env && pnpm demo
pnpm trace <any T1 hash>
```

## Roadmap

| | |
|---|---|
| **EIP-7702 path** | Verified active on GIWA by behavioural test. The principal's EOA becomes the delegator directly — the Upbit-attested address itself holds the delegation, no account contract. The enforcer already accepts this shape (`principal == delegator`). |
| **Graduated autonomy** | `VerifiedCodeEnforcer` is deployed and verified: Dojang's Verified Code attests an *off-chain human confirmation* (OTP-style, under a service domain), so high-value delegations can require a person in the loop per confirmation window while small ones run unattended — the historical mapae tiers, as caveats. Awaiting the first Verified Code issuer integration for a live flow; today only Upbit issues them, through its own channel. |
| **More conditions** | Lifetime total, call count, allowed function selector, and an approved-order hash that binds a payment to a purpose without any Dojang change. The per-payment ceiling shipped first - deployed, verified, and proven live with a settle/refuse pair. |
| **Attestation query API** | The index is live (below); what remains is extending it to real-issuer Dojang attestations, the off-chain query surface GIWA does not have ([docs/GAPS.md](docs/GAPS.md)). |
| **ERC-7715** | [docs/ERC7715.md](docs/ERC7715.md) maps Mapae onto `wallet_requestExecutionPermissions` — the wallet-side request surface GIWA Wallet could implement, including a proposed `dojang-verified` permission type. The Composer is already that screen. |
| **ERC-8004** | Deliberately not adopted. Its identity registry is permissionless self-registration, which proves nothing and adds no link to the accountability chain (and no 8004 registry exists on GIWA — verified by probing). Agent identity here is gated the GIWA-native way: attested code via `VerifiedCodeEnforcer`. If registries mature into something attestation-backed, the enforcer pattern extends to them in one caveat. |

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the architecture, and why each decision was made
- [mapae.pages.dev/tech](https://mapae.pages.dev/tech) — 한국어판 기술 문서 (one-pager)
- [docs/DEMO.md](docs/DEMO.md) — every live transaction, expected vs. on-chain result
- [docs/SPEC.md](docs/SPEC.md) — byte-level terms layouts, typehashes, conformance
- [docs/GAPS.md](docs/GAPS.md) — measured ecosystem gaps, with the measurements
- [docs/ERC7715.md](docs/ERC7715.md) — the wallet-integration mapping
- [mcp/README.md](mcp/README.md) — the MCP server: the seven tools, and what is deliberately absent
- [GrapeInTheTree/mapae-ponder](https://github.com/GrapeInTheTree/mapae-ponder) — the index, and why refusals are the hard part to index
- [docs/DEPLOY.md](docs/DEPLOY.md) — deploying the explorer, and why it has no backend

## License

MIT. `src/enforcers/{CaveatEnforcer,TimestampEnforcer,ERC20PeriodTransferEnforcer}.sol` are
vendored from [MetaMask/delegation-framework](https://github.com/MetaMask/delegation-framework)
(MIT AND Apache-2.0) with pragma and import adaptations only — see [NOTICE](NOTICE).
