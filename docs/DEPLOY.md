# Deploying the explorer

The explorer is a static single-page app with **no backend**. It reads GIWA Sepolia directly from
the browser — CORS is open on both the public RPC and the Blockscout API — and keeps signed Mapae
in `localStorage`. There is nothing to run, nothing to keep alive, and nothing that can be down
while the chain is up.

That is a deliberate property, not a shortcut. The whole product argues that the contract is the
only authority on whether a permission can be spent; putting a server in the path would create a
second place to ask, and a second place to be wrong.

## Cloudflare Pages

**Build settings**

| Field | Value |
|---|---|
| Framework preset | None |
| Build command | `pnpm install && pnpm --dir explorer build` |
| Build output directory | `explorer/dist` |
| Root directory | *(repository root)* |
| Node version | `22` (set `NODE_VERSION=22` in the environment variables) |

The build runs `pnpm snapshot` first, which re-reads the chain and writes
`explorer/src/data/snapshot.json`. That is the build-time checkpoint the stats are counted from,
so **every deploy refreshes it** and the browser only ever scans the delta since. No indexer, no
cron.

**Files that make it behave**

- `explorer/public/_redirects` — `/* /index.html 200`. Client routes (`/create`, `/permissions`,
  `/tx/0x…`) have no file behind them; without this a reload or a shared link 404s, which is
  precisely what someone following a link from the application would hit.
- `explorer/public/_headers` — frame-deny, nosniff, a referrer policy, and cache rules:
  fingerprinted assets immutable for a year, `index.html` never cached so a deploy actually
  reaches an open tab.

Both are copied verbatim into `dist` by Vite.

**Custom domain**

Add it under Pages → Custom domains. Cloudflare issues the certificate; no other configuration is
needed, because there is no origin to point at.

## Why Pages rather than Workers

Workers exist to run code per request. Nothing here needs to. Every read is either static or made
by the visitor's own browser against GIWA, so a Worker would add a hop, a failure mode, and a bill
without changing a single byte of what is served.

The one thing that would justify a Worker is the Permission API — the service that would let a
signed Mapae be discovered from another device before it has ever been spent. That is deliberately
Phase 3, for the same reason the indexer is: a permission that only exists on a server is a
permission whose existence depends on that server answering.

## Verifying a deploy

```bash
curl -sI https://<domain>/create | head -1        # 200, not 404 - the SPA fallback works
curl -s https://<domain>/ | grep -o '<title>.*'   # the shell rendered
```

Then open `/tx/0xd3843e1f73178b78942fe5ebaeb1ac30611f7734786b7e4640098e5e1749ed65` — the
identity-revocation refusal. If that page explains why the payment was refused, every layer is
working: routing, the RPC read, the terms decoder, and the live attestation lookup.
