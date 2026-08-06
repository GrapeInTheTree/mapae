# GIWA — measured ecosystem gaps

Findings from building Mapae against GIWA Sepolia, 2026-07-28/29. Everything here was measured or
reproduced directly, not read from documentation; where documentation exists and disagrees, that
is noted. Offered as input to the ecosystem, not as criticism — half of these gaps are the reason
Mapae has something to contribute.

## Identity and attestation

**No off-chain Dojang query surface exists.** No REST API, no GraphQL, no EAS-style explorer. The
`AttestationIndexer` is an on-chain contract, so every consumer must either call contracts
directly or build their own index. Measured while scoping ours: the EAS predeploy holds ~28.4M
blocks of history, the public RPC caps `eth_getLogs` at 100,000 blocks and 20,000 results per
call, and an unfiltered scan of the busiest ranges exceeds the result cap. Filtered by a real
issuer, the entire history is ~285 calls at 200–460 ms each — roughly 100 seconds — because real
issuance is rare: a 400k-block sample around the head contained 15 Upbit-issued attestations
against ~920,000 farm-issued faucet attestations. The noise, not the volume, is the obstacle.

**The `@giwa-io/dojang-contracts` npm package is not linked from the documentation.** It exports
typed viem ABIs and per-chain addresses and is exactly what an integrator needs first; we found
it only by reading the GitHub repository.

**Three resolver addresses render truncated (39 hex characters) on the Dojang contracts page.**
The hyperlinks underneath are correct; the visible text is not. The reliable source is
`deployments/91342-deploy.json` in the dojang repository.

**`IDojangScroll` declares an error its implementation never raises.** The interface declares
`NotVerifiedAddress(address)` (selector `0xab9797df`); the deployed read path actually reverts
with `AttestationVerifier`'s errors — `ZeroUid()` (`0x6e7910da`) when absent,
`RevokedAttestation(uid, time)` when revoked, `ExpiredAttestation(uid, time)` when expired.
Consumers matching on the declared error will never match. Mapae gates on the boolean
`isVerified` read partly for this reason.

## Infrastructure

**The public RPC is a load balancer over backends that lag each other by several blocks.** The
sequencer executes against canonical state, so broadcasts are never wrong — but reads issued
immediately after a receipt can return pre-transaction state, and `eth_estimateGas` can disagree
with a simulation served moments earlier by a different backend. Both bit us as concrete
failures: a just-issued attestation reading as absent, and a gas estimation reverting on state a
simulation had accepted. Under heavy filtered log queries the endpoint also returns
`no backend is currently healthy to serve traffic`. Any serious client needs local nonce
tracking, fixed gas limits, and visibility polling after every state transition; there is no
commercial RPC alternative for GIWA yet to escalate to.

**Account abstraction is half-present.** ERC-4337 EntryPoints v0.6 and v0.7 are deployed and
documented (an undocumented v0.8 is also live), but there is no bundler endpoint — the RPC
rejects `eth_sendUserOperation` — and no paymaster. The documented Stable Paymaster is
aspirational. Mapae's design avoids the 4337 path entirely for this reason.

**EIP-7702 is active but undocumented.** Chain config (`pragueTime`), block headers
(`requestsHash`), and a behavioural test (a `0xef0100` delegation designator resolving and
executing under `eth_call` state override) all confirm Prague — and a CLZ probe confirms Osaka —
yet no GIWA document mentions the fork level. Builders deserve a statement here; 7702 changes
what account architectures are possible.

**No EIP-3009 token exists.** The playground token and every third-party "KRW"/"USDC" token we
probed reverts on `DOMAIN_SEPARATOR()` and `authorizationState()`. x402's default `eip3009`
method therefore cannot run on GIWA today — which makes the `erc7710` method not just an option
but the only currently viable x402 path on this chain.

**A read taken right after a receipt can answer from before it.** The public RPC load-balances
across backends at different heights, so a state change is not immediately visible to every
caller. We hit this three times in one day and in both directions: a settled total that came out
₩5,000 short of the transfers it summarised, a re-enabled delegation that still read as disabled,
and — the one that matters — a **disabled delegation that still read as enabled**.

That last direction is the uncomfortable one, because it reports more authority than exists. It is
not something a caveat can fix: the enforcer is correct, the block is correct, and the client is
being told about an older block. Simulating against the chain does not help either, since the
simulation runs on the same stale backend. What we do about it is bounded and worth stating
plainly: figures that can be derived from a receipt are read from the receipt's own events rather
than from a follow-up call, and anything that must poll, polls for the state it just wrote instead
of asserting once. Beyond that the honest answer is that a production deployment wants a dedicated
RPC endpoint, and this is the clearest single reason why.

## Delegation

**No delegation framework is deployed.** MetaMask's delegation framework is absent, and nothing
equivalent exists. More broadly — and this is the gap Mapae exists for — among the 38 audited
caveat enforcers MetaMask ships, and every enforcer we could find on any chain, **none conditions
a delegation on identity**. The chain with a licensed exchange as its attestation issuer is
precisely where that enforcer belongs.

We are not the only ones who notice the shape of this. Writing in February 2026, before any of
this existed, [Oso Knows](https://www.osoknows.com/caveat/who-authorized-the-agent) put it as a
property of the standard rather than an oversight:

> ERC-7710 is deliberately identity-agnostic: it handles permissions without opining on who "who"
> actually is. That's a feature for composability, but for the broader agent ecosystem, identity
> and permissions need to work together.

That is the more honest framing, and we adopt it. The count of zero is ours and is a measurement;
what the quotation adds is that the absence is by design at the standard layer, which is precisely
why it has to be filled at the enforcer layer instead. An enforcer is the one place where identity
can be made a condition without asking ERC-7710 to become opinionated about identity — which it
should not.

Filling it needs a chain that can answer the question. That is the argument for doing this on
GIWA rather than anywhere else, and it is why the portability test can carry the machine to
Ethereum Sepolia but has to leave the meaning behind.

**Target allowlists cannot express payees; calldata pinning expresses only one.** Target enforcers
gate the execution target, which for an ERC-20 payment is the token contract. The recipient sits at
calldata `[4:36]`, and a generic calldata enforcer does reach it — pinned to one exact value, which
is one payee per delegation. Expressing *a set* of merchants in a single signed policy is what
`AllowedPayeeEnforcer` adds.

## Tooling notes for other builders

Declaring chain 91342 under `[etherscan]` in `foundry.toml` makes `forge script --broadcast` fail
with `Chain 91342 not supported` *before* broadcasting — while the dry run still writes the
deployments JSON, so the failure looks like success. Verify with explicit
`--verifier blockscout --verifier-url https://sepolia-explorer.giwa.io/api/` flags instead, and
read the deployed code back from the chain before trusting any address file. Blockscout
verification works cleanly with solc 0.8.29 and the optimizer on; `via_ir` breaks it.
