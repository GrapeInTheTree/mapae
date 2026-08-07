# mapae-mcp

A [Mapae](https://mapae.pages.dev) client for any MCP-speaking agent — Claude, Cursor, or anything
else that talks the protocol. The agent gets **use of a scoped authority, never the wallet**.

```bash
claude mcp add mapae -- npx mapae-mcp
```

That is the whole install. On first boot the server **generates the agent's own identity** and
persists it to `~/.mapae/agent.key` (chmod 600, never returned by any tool). The agent's key is
not the human's wallet — it is born with zero authority and holds only what a human later signs
to it, so generating it on the machine it will live on is strictly safer than pasting one in.
Fund the agent's address (shown by `list_permissions`) with a little GIWA Sepolia ETH for gas.

Optional env: `MAPAE_AGENT_PRIVATE_KEY` overrides the stored key;
`MAPAE_PERMISSION_CONTEXT` preloads contexts (comma-separated) instead of `load_context`;
`MAPAE_REFUSAL_MODE` chooses what happens to a refusal — see below.

## Is a refusal worth a transaction?

By default a refused payment is **broadcast**. It fails on-chain, costs gas, and leaves a
transaction anyone can open and read the enforcer's own error in. That is deliberate: for anyone
who has to show that a control fired — an auditor, a counterparty, an insurer — a refusal that
exists only in this process's logs is worth very little, because the process that produced it is
the process being questioned.

Set `MAPAE_REFUSAL_MODE=dry` and `pay` checks first and returns the same refusal with `tx: null`,
having spent nothing. The reason is identical; what is lost is the evidence.

Both are right for someone, which is why it is a setting rather than a decision baked into the
code. The default leans to evidence because on GIWA the trade-off is real in principle and
lopsided in practice: a refused redemption costs on the order of **0.0000003 ETH**, and a record
that outlives the process that made it is worth more than that.

`simulate_payment` is the third answer and needs no setting — ask before paying, and there is
nothing to refuse.

## Tools

| Tool | Signs with | What it does |
|---|---|---|
| `request_permission` | nothing | Composes a policy — period cap, per-payment ceiling, one or many named payees — and returns a prefilled link **for the human to review and sign in their own wallet** |
| `load_context` | nothing | Accepts the context the human hands back in conversation — the whole grant loop never leaves the chat |
| `list_permissions` | nothing | Held authorities with live on-chain state (disabled? identity live? budget left?) |
| `agent_status` | nothing | The agent's identity, gas tank, and one line of headroom per held authority |
| `check_budget` | nothing | Remaining period cap read from the enforcer, the per-payment ceiling, and the largest single payment both allow right now |
| `simulate_payment` | nothing | Asks whether an amount **would** settle, without broadcasting: names the condition that refuses it and the largest amount that would go through right now |
| `pay` | agent key | Spends within the signed policy — **the allowed payees and the token come from the policy**; when several payees are allowed, `payee` picks which one, and an address outside the signed list is rejected before any transaction. A broadcast whose receipt does not arrive in the window answers **UNKNOWN with its hash**, never REFUSED — the transaction may still settle, and calling that a refusal is how one payment becomes two |
| `redelegate` | agent key | Signs a *narrower* child authority to a sub-agent — tighter period cap and/or per-payment ceiling — no transaction |

The human's whole job is: click the link the agent composed, read the policy as a sentence, sign
in their own wallet, paste the context back. Composition knowledge lives with the agent; judgment
stays with the human.

There is deliberately no `issue` tool. Issuance is the principal's EIP-712 signature, and holding
that key here would hand the agent the wallet — the exact thing Mapae exists to prevent. The hand
that sets the limit is never the hand that spends it.

## What it talks to

GIWA's public RPC, and nothing else. No Mapae backend exists; the policy engine is entirely
on-chain, so a refusal comes back as the enforcer's own decoded reason:

```json
{ "status": "REFUSED", "reason": "Error(ERC20PeriodTransferEnforcer:transfer-amount-exceeded)",
  "trace": "https://mapae.pages.dev/tx/0x…" }
```

Refusals are normal results, not errors — the agent is expected to read the reason and tell the
human. The kill switches stay with the human throughout: disabling the delegation or revoking the
Dojang attestation stops the next `pay` instantly, with no notice to the agent required.

## Build

```bash
pnpm install && pnpm build   # bundles the SDK into dist/index.js
node dist/index.js           # or: npx mapae-mcp once published
```

Verified end-to-end against GIWA Sepolia by `harness.ts`: real payments settled to both of two
allowed payees, an over-ceiling attempt refused on-chain with the decoded reason
(`PerPaymentCapExceeded(1500, 1000)`), an off-policy payee rejected before any transaction, and
a 2-hop redelegated context carrying both narrowing caveats validated.
