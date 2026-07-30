# mapae-mcp

A [Mapae](https://mapae.pages.dev) client for any MCP-speaking agent — Claude, Cursor, or anything
else that talks the protocol. The agent gets **use of a scoped authority, never the wallet**.

```bash
claude mcp add mapae \
  --env MAPAE_AGENT_PRIVATE_KEY=0x… \
  --env MAPAE_PERMISSION_CONTEXT=0x… \
  -- npx mapae-mcp
```

`MAPAE_AGENT_PRIVATE_KEY` is the **agent's own key** — it needs a little GIWA Sepolia ETH for gas.
`MAPAE_PERMISSION_CONTEXT` is what a human hands the agent after signing at
[mapae.pages.dev/create](https://mapae.pages.dev/create) (comma-separate to hold several).

## Tools

| Tool | Signs with | What it does |
|---|---|---|
| `request_permission` | nothing | Composes a policy and returns a prefilled link **for the human to review and sign in their own wallet** |
| `list_permissions` | nothing | Held authorities with live on-chain state (disabled? identity live? budget left?) |
| `check_budget` | nothing | Remaining period cap, read from the enforcer |
| `pay` | agent key | Spends within the signed policy — **payee and token come from the policy, not from arguments** |
| `redelegate` | agent key | Signs a *narrower* child authority to a sub-agent, no transaction |

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

Verified end-to-end against GIWA Sepolia by `harness.ts`: a real payment settled, an over-cap
attempt refused with the decoded reason, and a 2-hop redelegated context validated.
