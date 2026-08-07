# Mapae Live Demo - GIWA Sepolia

Run at 2026-07-28T23:30:25.546Z · chain 91342 · every hash below is clickable and public.

**The delegation:** the agent `0x8D62720694c8f71095202E049C31C25B48496232` may pay the merchant up to ₩50,000/day from
the principal's MapaeAccount for 7 days - and only while the principal `0x2875B01Abf0E5EB98253274d62Db08FA7630B783`
holds a live Dojang attestation from the testnet faucet issuer.

**Cast**

| Role | Address |
|---|---|
| Principal (human; holds the Dojang attestation; signs the delegation) | `0x2875B01Abf0E5EB98253274d62Db08FA7630B783` |
| MapaeAccount (holds funds and delegation state; owner = principal) | `0x28e3ad56826F42Ca4d602766BcBc39Ff60A49a99` |
| Agent (delegate; redeems) | `0x8D62720694c8f71095202E049C31C25B48496232` |
| Merchant (allowed payee) | `0x8ACD1cB724AAe8CDCD737aC97A5aF4414012a617` |
| Attacker (unlisted payee) | `0x4Fe81416D2534Eea4c94F6b6dB21faC58eF6d336` |

**Transactions**

| # | What happened | Expected | On-chain result | Tx |
|---|---|---|---|---|
| S1 | Create MapaeAccount (owner EIP-712 consent) | success | success | [0x18d4315f…](https://sepolia-explorer.giwa.io/tx/0x18d4315fc79da1e2cc287c9db66d127131853d9351943aa17e4f041ebc291d62) |
| S2 | Fund account with 1,000,000 mKRW | success | success | [0x0c2b865b…](https://sepolia-explorer.giwa.io/tx/0x0c2b865b1f74750a03195bb1f74bce778d678307967f0c5d08e2e1e7f96c337f) |
| S3 | Principal already holds a live Dojang attestation | - | skipped | - |
| T1 | Authorized payment: 30,000 mKRW -> merchant | success | success | [0xa01e6e86…](https://sepolia-explorer.giwa.io/tx/0xa01e6e8696d4fe4d505c8636ed1f09a0a0da3d4dcf01bd045f0046d99757e568) |
| T2 | Over daily cap: +30,000 (total would be 60,000 > 50,000) | revert: transfer-amount-exceeded | **reverted** `Error(ERC20PeriodTransferEnforcer:transfer-amount-exceeded)` | [0xe7563dfa…](https://sepolia-explorer.giwa.io/tx/0xe7563dfa365db67b5a26ecd4719e1824ce1411feb87580fca916d0ea1eb5703d) |
| T3 | Unlisted payee: 10,000 -> attacker | revert: PayeeNotAllowed | **reverted** `PayeeNotAllowed(0x4Fe81416D2534Eea4c94F6b6dB21faC58eF6d336)` | [0x131e9744…](https://sepolia-explorer.giwa.io/tx/0x131e97448767531427849ff9d716702481a6a7de3cc5d5e2026182028daee1cd) |
| T4 | Issuer discrimination: delegation demands UPBIT KOREA | revert: NotDojangVerified | **reverted** `NotDojangVerified(0x2875B01Abf0E5EB98253274d62Db08FA7630B783, 0xd99b42e778498aa3c9c1f6a012359130252780511687a35982e8e52735453034)` | [0xfaf9880c…](https://sepolia-explorer.giwa.io/tx/0xfaf9880c21fabd04e1053275afcb01c4f308da7643fd6ff6c21a525f59c22ef4) |
| T5a | Principal disables the delegation | success | success | [0x580e3165…](https://sepolia-explorer.giwa.io/tx/0x580e31657bc56dfc9c65879587b019747af5c1a3952bb59024f32f51b4a17bc3) |
| T5 | Payment while disabled (identity still LIVE) | revert: CannotUseADisabledDelegation | **reverted** `CannotUseADisabledDelegation()` | [0x0dbdc013…](https://sepolia-explorer.giwa.io/tx/0x0dbdc013e6c7f69c180fb4f047ef8d3700d495483a8e79c30e7d57df2f23325e) |
| T6a | Principal re-enables the delegation | success | success | [0x5f6a50c9…](https://sepolia-explorer.giwa.io/tx/0x5f6a50c90cf1cbe96d3a93234a112ad1cc749271279ccf1387d79adb1fc2df10) |
| T6 | Payment after re-enable: 10,000 -> merchant | success | success | [0xd0b461f6…](https://sepolia-explorer.giwa.io/tx/0xd0b461f686795397c881eb2383f41bd5de0e7cfdfe73e5a6a6d0de12b74db389) |
| T7a | Principal revokes their Dojang attestation | success | success | [0xf4042891…](https://sepolia-explorer.giwa.io/tx/0xf404289108feae99aa0c73db31b6c607fbfc9e19930765942fa91b2c78d7c546) |
| T7 | Payment after identity revocation (delegation ENABLED, cap unspent, window open) | revert: NotDojangVerified | **reverted** `NotDojangVerified(0x2875B01Abf0E5EB98253274d62Db08FA7630B783, 0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678)` | [0xd3843e1f…](https://sepolia-explorer.giwa.io/tx/0xd3843e1f73178b78942fe5ebaeb1ac30611f7734786b7e4640098e5e1749ed65) |
| T8a | Principal re-issues their attestation | success | success | [0x1a5e8ddd…](https://sepolia-explorer.giwa.io/tx/0x1a5e8ddd476a7a6a4f1f092d18853c0b07dc01da2196e3304fd1b70a90281cdb) |
| T8 | Payment after re-issuance: 10,000 -> merchant | success | success | [0x250b424e…](https://sepolia-explorer.giwa.io/tx/0x250b424ec82668c4e876b8a844f1eeaed1411add85a5b42a41616a0d5fa04217) |

**Final balances (this run):** merchant +₩50000 · account ₩950000 · attacker ₩0

## Why T7 is the thesis

At T7 the delegation signature is valid, the daily cap has ₩40,000 unspent, the time window is
open, the payee is allowed, and the delegation is enabled. The payment still fails - purely
because the principal revoked their real-world identity attestation, in a transaction that never
touched a Mapae contract. Identity revocation is a kill switch the delegation layer does not even
see; it is inherited from Dojang reading liveness at the moment of use.

T5-T8 form a 2x2 matrix: each kill switch (disable-delegation / revoke-identity) blocks alone
while the other is untouched, and each is reversible. No ordering assumptions - the manager checks
disabled-state before any caveat, so the errors never bleed into each other.

## The per-payment ceiling - the sixth condition, proven live

One delegation carrying all five payment conditions at once - identity, 50,000/day period cap,
10,000 per-payment ceiling, one allowlisted payee, 7-day window - redeemed twice. The pair is
chosen so only the ceiling can refuse: the day budget had 40,000 of room when the second payment
was attempted.

| Step | Expected | On-chain | Tx |
|---|---|---|---|
| pay 10,000 - exactly at the ceiling | success | success | [0x3e922d55…](https://sepolia-explorer.giwa.io/tx/0x3e922d55e1dfbbe705aaf80fef79ea4ad5a2042e6476d0b204aaebccdc159b0a) |
| pay 10,001 - one over | revert: PerPaymentCapExceeded | **reverted** `PerPaymentCapExceeded(10001, 10000)` | [0xdac9db98…](https://sepolia-explorer.giwa.io/tx/0xdac9db98fe72c7aa67f043f7728e68815cd65ee9b1515b85494e4bf84a5c5eac) |

Delegation `0xbecc5c5f7790413bf21d87c99861553021c890408d2546c97ab3f7af28415260`. Reproduce with
`pnpm tsx scripts/perpayment-proof.ts`.

## Traceback

`pnpm trace 0xa01e6e8696d4fe4d505c8636ed1f09a0a0da3d4dcf01bd045f0046d99757e568` resolves T1's hash backwards:
payment -> delegation hash -> principal -> attestation uid -> issuer, entirely from public state.

## Reproduce

```bash
cp .env.example .env   # two fresh keys; fund the principal from the faucets
pnpm install && pnpm fixtures && pnpm demo
```

## x402 facilitator - the erc7710 path, live

An HTTP facilitator ([gosuda/x402-facilitator, branch
`feature/erc7710`](https://github.com/gosuda/x402-facilitator/tree/feature/erc7710)) settling
Mapae delegations. The client signed two typed-data payloads and
spoke HTTP - it broadcast nothing and needed no gas. The facilitator held no policy and no funds:
verification is simulation of the delegation manager, and every cap, payee, window and identity
check ran on-chain.

Chain: principal -> agent (4 caveats) -> facilitator settlement signer `0x0Cde5B7742B2C67c5BF6f5aEa339db868684336a`.

| Step | Result | Tx |
|---|---|---|
| F1 /verify 20,000 | isValid=true, payer=0x28e3ad56826F42Ca4d602766BcBc39Ff60A49a99 (the account, not the agent) | - |
| F2 /verify 60,000 | isValid=false, reason=delegation_cap_exceeded - the facilitator evaluated NO policy; the chain did | - |
| F3 /settle 20,000 | success, gas paid by facilitator, funds account->merchant | [0x9fbe7b2b…](https://sepolia-explorer.giwa.io/tx/0x9fbe7b2be9350e554688b13abc9b9ecb02d49ac0ea0ae893b51ad43637dc2422) |
| F4 /settle 20,000 again | success - one payload, second settlement. An EIP-3009 authorization cannot do this | [0x8a1fba25…](https://sepolia-explorer.giwa.io/tx/0x8a1fba254777efe388617d6be2d4f5d6798352bda443642957d62666e52c2db6) |
| F5 /settle third 20,000 | rejected before broadcast: reason=delegation_cap_exceeded - fee payer wasted zero gas | - |

Merchant received exactly ₩40,000 across two settlements of ONE signed payload - multi-use is the
property that distinguishes erc7710 from eip3009/permit2 in the x402 exact/EVM spec.

## The MCP surface - an agent paid, chose, and was refused over stdio

`mcp/harness.ts` plays both roles: phase 1 is the human, signing a fresh authority - ₩5,000/day,
₩1,000 per payment, TWO allowed payees; phase 2 speaks only stdio JSON-RPC to the built server,
the way a model's MCP client does. Amounts are chosen so exactly one condition can refuse each
step.

| Step | Result | Tx |
|---|---|---|
| `pay 700` | PAID to the first allowed payee - the default | [0x18ee370c…](https://sepolia-explorer.giwa.io/tx/0x18ee370c2e6321801a528629f7061542150c312ea2080c3584d3064577c2e332) |
| `pay 300, payee=second` | PAID - the argument chose among the SIGNED list | [0x26a8e5ac…](https://sepolia-explorer.giwa.io/tx/0x26a8e5ac484cb1122ec18f9b337be30f895d007f6370ff0a8c795e43b2913843) |
| `pay 100` to an outsider | NOT_IN_POLICY - rejected before any transaction existed, zero gas | - |
| `pay 1,500` | REFUSED on-chain: `PerPaymentCapExceeded(1500, 1000)` - the day budget had ₩4,000 of room | [0x8091a929…](https://sepolia-explorer.giwa.io/tx/0x8091a929dc6f3f72d51d1b824924dd38ab71804692135b43895dca785adc3e5a) |
| `redelegate` cap 500, per-payment 200 | a two-hop child carrying both narrowing caveats, signed with no transaction | - |

The package on npm (`mapae-mcp@0.6.0`) was then verified cold from the registry - fresh npm
cache, throwaway profile - confirming the request link it composes carries the whole policy
shape (`perTx` ceiling, named payees), which the Composer arms on open.

Reproduce: `pnpm tsx mcp/harness.ts` (uses the demo keys from `.env.example`).

## The product path - a person signed these in a browser

Every transaction above was produced by a script that built its own delegation and then spent it:
two programs agreeing with themselves. These four are different. A human connected MetaMask,
composed a permission in the Composer, read it back as a sentence, and signed EIP-712 in the
extension. The delegation hash the browser displayed - `0x7e74004e13…c680` - is character-for-
character the hash `pnpm redeem` computed from the copied bytes, which is what proves the two
halves encode the same thing.

The permission: agent `0x8D6272…6232` may pay one address up to ₩5,000 per day for 7 days, only
while `0x2875B0…B783` holds a live testnet-faucet attestation.

| Step | Amount | Result | Tx |
|---|---|---|---|
| P1 first payment | 1,250 | paid | [0xf320b785…](https://sepolia-explorer.giwa.io/tx/0xf320b7855492f9b77e4bd0904ded8bf1f06e0cfd0e6cf85d78c3f5ca7497dbde) |
| P2 after the owner clicked **Disable** in My Permissions | 1,250 | refused - `CannotUseADisabledDelegation` | [0x97a3376c…](https://sepolia-explorer.giwa.io/tx/0x97a3376cb594c7a156dd340e1912e8151b64d532537556c51b16051c11dfac1f) |
| P3 after the owner clicked **Re-enable** | 3,750 | paid | [0xd8f49b02…](https://sepolia-explorer.giwa.io/tx/0xd8f49b02949e9d6de81bbe139aeb4e655fd898524d66a69c9adb0383d125948e) |
| P4 one won past the cap | 1 | refused - `ERC20PeriodTransferEnforcer:transfer-amount-exceeded` | [0xd75079a8…](https://sepolia-explorer.giwa.io/tx/0xd75079a89cb927c9439de4f6f39e8a497e4c778987ecc379cd24fae7457f79ce) |

Four things fall out of the sequence, and the third is the one worth pausing on.

**The kill switch is reversible.** P2 blocked and P3 went through. Without that, "two independent
kill switches" is unprovable: you could only show that throwing one stops payment, never that it
stopped payment *by itself*.

**Re-enabling is a resume, not a reset.** P3 was for 3,750 - the remainder of a ₩5,000 cap with
1,250 already spent - and it succeeded, then P4's single won did not. Had the budget reset,
disable → enable would be an unlimited-spend bypass: spend the cap, toggle, spend it again. It
does not reset because the enforcer keys spend by `(manager, delegationHash)`, and that hash
excludes the signature, so re-signing the same delegation returns to the same budget. A fresh
budget requires a different salt, which is what salt is for.

**The boundary is exact.** 3,750 passed and the next single won was refused. Not approximately
the cap.

**The total is the signed number.** Across two refusals, a disable and a re-enable, the payee
received exactly ₩5,000. Not a digit more.

Reproduce it yourself:

```bash
pnpm preflight <your wallet>     # gas, attestation, account, funds - each with the fix
cd explorer && pnpm dev          # issue one, copy the permission context
pnpm redeem <context> [amount]   # spend it as the agent; payee and policy come from the signature
```

## x402 facilitator - the erc7710 path, live

An HTTP facilitator ([gosuda/x402-facilitator](https://github.com/gosuda/x402-facilitator),
`feat/giwa-erc7710`) settling Mapae delegations. The client signed two typed-data payloads and
spoke HTTP - it broadcast nothing and needed no gas. The facilitator held no policy and no funds:
verification is simulation of the delegation manager, and every cap, payee, window and identity
check ran on-chain.

Chain: principal -> agent (4 caveats) -> facilitator settlement signer `0x0Cde5B7742B2C67c5BF6f5aEa339db868684336a`.

| Step | Result | Tx |
|---|---|---|
| F1 /verify 20,000 | isValid=true, payer=0x4b6B26Cc68011FB4e9c9B6C0a4E15df040BFc23e (the account, not the agent) | - |
| F2 /verify 60,000 | isValid=false, reason=delegation_cap_exceeded - the facilitator evaluated NO policy; the chain did | - |
| F3 /settle 20,000 | success, gas paid by facilitator, funds account->merchant | [0xf91e431c…](https://sepolia-explorer.giwa.io/tx/0xf91e431cfc021f898e20a18e94f24495ac0bb0c2dba6168a4887aac15dda0f40) |
| F4 /settle 20,000 again | success - one payload, second settlement. An EIP-3009 authorization cannot do this | [0x4c792c10…](https://sepolia-explorer.giwa.io/tx/0x4c792c1025f3cf668fb678cd2771d9438e6bd923ce7d6aa1e65fbc5812d128d8) |
| F5 /settle third 20,000 | rejected before broadcast: reason=delegation_cap_exceeded - fee payer wasted zero gas | - |

Merchant received exactly ₩40,000 across two settlements of ONE signed payload - multi-use is the
property that distinguishes erc7710 from eip3009/permit2 in the x402 exact/EVM spec.

## x402 facilitator - the erc7710 path, live

An HTTP facilitator ([gosuda/x402-facilitator](https://github.com/gosuda/x402-facilitator),
`feat/giwa-erc7710`) settling Mapae delegations. The client signed two typed-data payloads and
spoke HTTP - it broadcast nothing and needed no gas. The facilitator held no policy and no funds:
verification is simulation of the delegation manager, and every cap, payee, window and identity
check ran on-chain.

Chain: principal -> agent (4 caveats) -> facilitator settlement signer `0x0Cde5B7742B2C67c5BF6f5aEa339db868684336a`.

| Step | Result | Tx |
|---|---|---|
| F1 /verify 20,000 | isValid=true, payer=0x4b6B26Cc68011FB4e9c9B6C0a4E15df040BFc23e (the account, not the agent) | - |
| F2 /verify 60,000 | isValid=false, reason=delegation_cap_exceeded - the facilitator evaluated NO policy; the chain did | - |
| F3 /settle 20,000 | success, gas paid by facilitator, funds account->merchant | [0xbf506e8f…](https://sepolia-explorer.giwa.io/tx/0xbf506e8fe914b92bc91c840b739a4fb68573e6b7db882f2600eb5abef968301b) |
| F4 /settle 20,000 again | success - one payload, second settlement. An EIP-3009 authorization cannot do this | [0x63bdf487…](https://sepolia-explorer.giwa.io/tx/0x63bdf4875c46b4848a9daec8dbd214b6bc30f1bb26fd57f21bf2d2497ec22957) |
| F5 /settle third 20,000 | rejected before broadcast: reason=delegation_cap_exceeded - fee payer wasted zero gas | - |

Merchant received exactly ₩40,000 across two settlements of ONE signed payload - multi-use is the
property that distinguishes erc7710 from eip3009/permit2 in the x402 exact/EVM spec.

## Graduated autonomy - how much may the agent decide alone?

One authority, three rungs. The person signs a root that carries the identity condition,
a ₩50,000 day budget, one merchant and a seven-day window, then signs each rung off
it. Every rung inherits all of that and narrows one thing further.

| Rung | Per payment | Human in the loop |
|---|---|---|
| 1 | ₩10,000 | no |
| 2 | ₩30,000 | no |
| 3 | ₩200,000 | yes |

**Who signs a rung decides whether its gate means anything.** The root delegates to the
*person*, not to the agent, and the person signs each rung. Conditions can only be added
going down a chain, never removed - so a rung the agent signed would bind nobody, because
the agent could sign a second rung without the gate and redeem through that instead. Both
arrangements are pinned in `test/integration/TierBudget.t.sol`.

| What the agent tried | Outcome on chain | Transaction |
|---|---|---|
| ₩10,000 on rung 1 | **settled** | [0xd17f165d…](https://sepolia-explorer.giwa.io/tx/0xd17f165da972389366dda0411c7afc772e6d40fb41a4952f3284f7c8bbf3d52f) |
| ₩30,000 on rung 1, above its ₩10,000 ceiling | **refused** `PerPaymentCapExceeded(30000, 10000)` | [0x49b9dcba…](https://sepolia-explorer.giwa.io/tx/0x49b9dcba2a52808e0d6fbe282dd68cc438002656cffcfc7dadb111faa583155e) |
| ₩5,000 to an unlisted payee | **refused** `PayeeNotAllowed(0x8627eEE60293Eb53646d30031186c5B83D5889ae)` | [0x6429c669…](https://sepolia-explorer.giwa.io/tx/0x6429c66977894a6b538fad2076424d4b36229155a659eae0d7b0da6bb96c022d) |
| ₩150,000 on rung 3, presenting a code nobody confirmed | **refused** `CodeNotVerified(0xcde44ed867b9bce97f3e687eb4537822a871742b6fb41147551659f06749ff07, mapae.tiers.demo, 0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678)` | [0xfdeaf01b…](https://sepolia-explorer.giwa.io/tx/0xfdeaf01b2ab2dafc31a4854dd03bc26a8553698c3cf7ace28e036d5dc861091c) |
| ₩5,000 after the identity was revoked | **refused** `NotDojangVerified(0x2875B01Abf0E5EB98253274d62Db08FA7630B783, 0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678)` | [0xef36af5d…](https://sepolia-explorer.giwa.io/tx/0xef36af5d12c038dcb19276caad058f8480e57bcb01bf29c9a54861b7c56beed2) |
| ₩5,000 after the identity was restored | **settled** | [0x87459ecc…](https://sepolia-explorer.giwa.io/tx/0x87459ecc48cc9efc3eeda1e956744bd8ca975038201e2c7f99cb13dad23884cd) |
| ₩30,000 on rung 2 | **settled** | [0x832fa392…](https://sepolia-explorer.giwa.io/tx/0x832fa3921237a5272200ab06689070fc523f538c590c3a3f41a87e7cf48b7230) |
| ₩20,000 on rung 2, inside its ceiling but past the shared budget | **refused** `Error(ERC20PeriodTransferEnforcer:transfer-amount-exceeded)` | [0xc949e811…](https://sepolia-explorer.giwa.io/tx/0xc949e811c7e90d660dcf943552707cf08811af9f2723e5a164ffbcd5f0114248) |
| ₩5,000 on rung 2, exactly the remaining budget | **settled** | [0x12600cf4…](https://sepolia-explorer.giwa.io/tx/0x12600cf4facfda4fc123355c3dab06149b30a235a3d96e2353e3e725f830e0af) |
| ₩5,000 on rung 1, after rung 2 spent the day | **refused** `Error(ERC20PeriodTransferEnforcer:transfer-amount-exceeded)` | [0x2e7d9c44…](https://sepolia-explorer.giwa.io/tx/0x2e7d9c44a85007eea985d59e6c5d9eca2183087fd99888c7583c3e39af5c1982) |

The last three rows are the reason this is one authority rather than three. Rung 2 spends
the day down to nothing; rung 1 is then refused even though it never once exceeded its own
₩10,000 ceiling. **A rung cannot be read on its own** - the budget belongs to the root
they hang from, and `ERC20PeriodTransferEnforcer` keys its ledger on the delegation hash it
is attached to.

Signed as siblings instead - two roots, each saying ₩50,000 a day - the same ladder
would spend ₩100,000, because two delegation hashes mean two ledgers. Nothing reverts;
the chain does exactly what was signed. The gap is between what was signed and what the
person believes they signed, which is why it is a test and not a footnote.

Row 4 is the other one worth reading twice. That payment is inside every limit, from a live
identity, on an enabled delegation, to an allowed merchant. It is refused because no live
human confirmation stands behind it. Verified Codes are issued by exchanges through their
own channels, so the confirming half cannot be staged here - the refusal is the half that
can be proven, and it is the half that matters.

Reproduce with `pnpm tsx scripts/tiers-demo.ts <account>`.
