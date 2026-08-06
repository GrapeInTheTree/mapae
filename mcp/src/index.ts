/**
 * mapae-mcp - a Mapae client for any MCP-speaking agent.
 *
 * The asymmetry IS the design. The one thing this server cannot do is issue an authority:
 * issuance is the principal's EIP-712 signature, and putting that key here would hand the agent
 * the wallet - the exact thing Mapae exists to prevent. What the agent CAN do maps exactly to
 * what a delegate can do on-chain:
 *
 *   request_permission  compose a policy and hand the human a link to review and sign
 *   list_permissions    what authorities this agent holds, with live on-chain state
 *   check_budget        what remains of this period's cap, read from the enforcer
 *   pay                 spend within the signed policy (payee and token come FROM the policy)
 *   redelegate          sign a narrower child of a held authority to another agent
 *
 * The server talks to nothing but GIWA's public RPC. There is no Mapae backend to reach, and the
 * static site is only ever a link handed to a human - if it vanished, every tool here would keep
 * working, because the contracts are the product.
 *
 * Env: MAPAE_AGENT_PRIVATE_KEY (or AGENT_PRIVATE_KEY) - the agent's own key, never the human's.
 *      MAPAE_PERMISSION_CONTEXT - comma-separated permission context hex, as copied from the
 *      Composer's "Copy permission context" or returned by redelegate.
 *      MAPAE_RPC_URL, MAPAE_APP_URL - optional overrides.
 */
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {z} from "zod";
import {
    createPublicClient,
    createWalletClient,
    decodeAbiParameters,
    decodeErrorResult,
    getAddress,
    http,
    isAddress,
    parseEventLogs,
    type Address,
    type Hex,
} from "viem";
import {generatePrivateKey, privateKeyToAccount} from "viem/accounts";
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";

import {enforcerErrorsAbi, managerAbi, periodEnforcerAbi, dojangScrollAbi} from "../../sdk/src/abi.js";
import {
    DELEGATION_TYPES,
    delegationDomain,
    delegationHash,
    encodeErc20Transfer,
    encodeExecutionSingle,
    encodePermissionContext,
    periodTerms,
    perPaymentTerms,
    type Delegation,
} from "../../sdk/src/delegation.js";
import {decodeConditions, type Condition, type EnforcerBook} from "../../sdk/src/policy.js";
import {MODE_SIMPLE_SINGLE} from "../../sdk/src/protocol.js";
import {addresses, APP_URL, giwaSepolia} from "./config.js";

/* ---------------------------------- setup ---------------------------------- */

/**
 * The agent's key: env override > persisted local key > generated on first boot.
 *
 * Nobody should have to know how to mint a keypair to try this. The agent's key is not the
 * human's wallet - it is the agent's own identity, born with zero authority and holding only
 * what a human later signs to it - so generating it here, on the machine it will live on, is
 * strictly safer than asking a person to make one elsewhere and paste it through a terminal.
 * The file never leaves ~/.mapae, is chmod 600, and no tool ever returns it.
 */
/**
 * MAPAE_PROFILE selects WHICH identity this registration runs as - "work" and "research" each
 * get their own key and their own contexts under ~/.mapae/<profile>/. Chosen at registration
 * time, deliberately not by a tool: an identity switch is the human's configuration act, and a
 * model that could rotate its own key mid-conversation could be talked into abandoning one.
 */
const PROFILE_DIR = process.env.MAPAE_PROFILE
    ? join(homedir(), ".mapae", process.env.MAPAE_PROFILE.replace(/[^a-zA-Z0-9_-]/g, "_"))
    : join(homedir(), ".mapae");

function loadOrCreateKey(): Hex {
    const fromEnv = (process.env.MAPAE_AGENT_PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY) as Hex | undefined;
    if (fromEnv?.startsWith("0x")) return fromEnv;

    const dir = PROFILE_DIR;
    const file = join(dir, "agent.key");
    if (existsSync(file)) {
        const onDisk = readFileSync(file, "utf8").trim() as Hex;
        if (onDisk.startsWith("0x")) return onDisk;
    }
    const fresh = generatePrivateKey();
    mkdirSync(dir, {recursive: true});
    writeFileSync(file, fresh + "\n", {mode: 0o600});
    chmodSync(file, 0o600);
    console.error(`mapae-mcp: generated a new agent identity -> ${file} (chmod 600)`);
    return fresh;
}
const agent = privateKeyToAccount(loadOrCreateKey());
const pub = createPublicClient({chain: giwaSepolia, transport: http()});
const wallet = createWalletClient({account: agent, chain: giwaSepolia, transport: http()});

const BOOK: EnforcerBook = {
    dojangEnforcer: addresses.dojangEnforcer,
    periodEnforcer: addresses.periodEnforcer,
    payeeEnforcer: addresses.payeeEnforcer,
    timestampEnforcer: addresses.timestampEnforcer,
    verifiedCodeEnforcer: addresses.verifiedCodeEnforcer,
    perPaymentEnforcer: addresses.perPaymentEnforcer,
};

const DELEGATION_PARAMS = [
    {
        type: "tuple[]",
        components: [
            {name: "delegate", type: "address"},
            {name: "delegator", type: "address"},
            {name: "authority", type: "bytes32"},
            {
                name: "caveats",
                type: "tuple[]",
                components: [
                    {name: "enforcer", type: "address"},
                    {name: "terms", type: "bytes"},
                    {name: "args", type: "bytes"},
                ],
            },
            {name: "salt", type: "uint256"},
            {name: "signature", type: "bytes"},
        ],
    },
] as const;

interface Held {
    context: Hex;
    chain: Delegation[];
    /** Root = whose account pays and whose conditions always bind. */
    root: Delegation;
    leaf: Delegation;
    hash: Hex;
    conditions: Condition[];
}

function decodeHeld(context: Hex): Held {
    const [chain] = decodeAbiParameters(DELEGATION_PARAMS, context) as unknown as [Delegation[]];
    const root = chain[chain.length - 1];
    return {
        context,
        chain,
        root,
        leaf: chain[0],
        hash: delegationHash(root),
        conditions: decodeConditions(root.caveats, BOOK),
    };
}

/**
 * Contexts are handed in - via env, via load_context, or from the last session's persisted
 * file - and never fetched from anywhere: the agent holds exactly what a human (or a parent
 * agent) chose to give it, and cannot enumerate what else that human has granted.
 *
 * Persistence closed the loop the first real session kept warning about: a context loaded in
 * conversation now survives a restart, in the same ~/.mapae the identity lives in. Safe to
 * store for the same reason it is safe to paste: a context is only spendable by the delegate
 * it names, and this machine IS that delegate.
 */
const CONTEXTS_FILE = join(PROFILE_DIR, "contexts.json");

function persistedContexts(): Hex[] {
    try {
        const raw = JSON.parse(readFileSync(CONTEXTS_FILE, "utf8"));
        return Array.isArray(raw) ? raw.filter((s): s is Hex => typeof s === "string" && s.startsWith("0x")) : [];
    } catch {
        return [];
    }
}

function persistContexts() {
    mkdirSync(PROFILE_DIR, {recursive: true});
    writeFileSync(CONTEXTS_FILE, JSON.stringify(held.map((h) => h.context), null, 2) + "\n", {mode: 0o600});
}

const held: Held[] = [];
for (const s of [
    ...(process.env.MAPAE_PERMISSION_CONTEXT ?? "").split(",").map((x) => x.trim()),
    ...persistedContexts(),
]) {
    if (!s.startsWith("0x")) continue;
    try {
        const h = decodeHeld(s as Hex);
        if (!held.some((x) => x.hash === h.hash && x.leaf.delegate === h.leaf.delegate)) held.push(h);
    } catch {
        /* a corrupt entry must not take the server down */
    }
}

const pick = (index?: number): Held => {
    const h = held[index ?? 0];
    if (!h) throw new Error(`no permission context at index ${index ?? 0} - the server holds ${held.length}`);
    return h;
};

/* --------------------------------- helpers --------------------------------- */

const fmtWon = (n: bigint) => `₩${n.toLocaleString("en-US")} mKRW`;

function describe(c: Condition): string {
    switch (c.kind) {
        case "identity":
            return `the delegator's principal must hold a live Dojang attestation (checked at every payment)`;
        case "period":
            return `up to ${fmtWon(c.amount)} per ${Number(c.duration) === 86_400 ? "day" : `${Number(c.duration)}s`}, unused allowance forfeited each rollover`;
        case "payee":
            return `payments may only go to ${c.payees.join(", ")}`;
        case "perPayment":
            return `no single payment may exceed ${fmtWon(c.max)} (each transfer checked on its own, independent of the period cap)`;
        case "window":
            return c.until > 0n ? `expires ${new Date(Number(c.until) * 1000).toISOString()}` : "no expiry";
        case "humanloop":
            return `requires a human confirmation code for ${c.domain}`;
        case "unknown":
            return `unrecognised condition at ${c.enforcer}`;
    }
}

async function liveState(h: Held) {
    const [disabled, budget] = await Promise.all([
        pub.readContract({
            address: addresses.manager,
            abi: managerAbi,
            functionName: "disabledDelegations",
            args: [h.hash],
        }) as Promise<boolean>,
        (async () => {
            const caveat = h.root.caveats.find(
                (c) => c.enforcer.toLowerCase() === addresses.periodEnforcer.toLowerCase(),
            );
            if (!caveat) return null;
            const [available] = (await pub.readContract({
                address: addresses.periodEnforcer,
                abi: periodEnforcerAbi,
                functionName: "getAvailableAmount",
                args: [h.hash, addresses.manager, caveat.terms],
            })) as readonly [bigint, boolean, bigint];
            return available;
        })(),
    ]);
    const identity = h.conditions.find((c) => c.kind === "identity");
    const identityLive =
        identity?.kind === "identity"
            ? ((await pub.readContract({
                  address: addresses.dojangScroll,
                  abi: dojangScrollAbi,
                  functionName: "isVerified",
                  args: [identity.principal, identity.attesterId],
              })) as boolean)
            : null;
    return {disabled, available: budget, identityLive};
}

/** Decoded custom error out of viem's nested cause chain - the refusal REASON is the payload
 *  the agent needs, not an exception. */
function reasonOf(err: unknown): string {
    let e = err as {data?: unknown; cause?: unknown} | undefined;
    while (e) {
        const data = (e as {data?: Hex}).data;
        if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
            try {
                const d = decodeErrorResult({abi: [...managerAbi, ...enforcerErrorsAbi], data});
                return `${d.errorName}${d.args?.length ? `(${d.args.join(", ")})` : ""}`;
            } catch {
                /* not one of ours */
            }
        }
        const short = (e as {shortMessage?: string}).shortMessage;
        if (short && !e.cause) return short;
        e = e.cause as typeof e;
    }
    return "reverted";
}

const text = (v: unknown) => ({
    content: [{type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, bigintSafe, 2)}],
});
const bigintSafe = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

/* ---------------------------------- tools ---------------------------------- */

const server = new McpServer(
    {name: "mapae", version: "0.6.0"},
    {
        /** Read by the client's model at session start - this is where the server earns its
         *  Korean name, and where the kill-switch boundary is stated so no model ever promises
         *  a disable it cannot perform. */
        instructions: [
            "이 서버는 '마패'(Mapae)다. 사용자가 마패, 마패로 결제, 권한, 위임이라 말하면 이 도구들을 뜻한다.",
            "마패 = GIWA 체인 위의 범위 제한·즉시 취소·실명 역추적 지출 권한. 에이전트는 사람이 서명해준 권한만 쓴다.",
            "결제(pay)의 수취인·토큰은 서명된 정책에서 나오므로 임의 주소로는 보낼 수 없다. REFUSED는 오류가 아니라 시스템이 동작한 결과다 - 사유를 사람에게 설명하라.",
            "비활성화·재활성화·도장 취소는 이 서버의 도구가 아니다. 킬스위치는 권한을 준 사람의 것이며(온체인이 delegator만 허용), 요청받으면 mapae.pages.dev/permissions 에서 직접 끄도록 안내하라.",
            "발급(issue)도 없다: 발급은 사람의 서명이다. request_permission으로 요청서를 만들어 사람에게 링크를 건네라.",
        ].join("\n"),
    },
);

server.tool(
    "list_permissions",
    "[마패] 이 에이전트가 보유한 마패(지출 권한) 목록과 온체인 라이브 상태. Every spending authority this agent holds, with its signed conditions and live on-chain state (disabled? identity still live? budget left?). Nothing here is stored anywhere - it is read from GIWA at call time.",
    {},
    async () => {
        if (held.length === 0)
            return text({
                held: 0,
                agentAddress: agent.address,
                howToGetAuthority:
                    "Compose the ask with request_permission, have the human sign it at " +
                    `${APP_URL}/create, then hand the issued context to load_context.`,
                gasNote:
                    "This agent pays its own gas - fund its address with a little GIWA Sepolia " +
                    "ETH from any Sepolia faucet before the first pay.",
            });
        const out = await Promise.all(
            held.map(async (h, index) => {
                const live = await liveState(h);
                return {
                    index,
                    delegationHash: h.hash,
                    payingAccount: h.root.delegator,
                    agent: h.leaf.delegate,
                    hops: h.chain.length,
                    conditions: h.conditions.map(describe),
                    live: {
                        disabled: live.disabled,
                        identityLive: live.identityLive,
                        remainingThisPeriod: live.available === null ? null : fmtWon(live.available),
                    },
                    usable:
                        !live.disabled &&
                        live.identityLive !== false &&
                        h.leaf.delegate.toLowerCase() === agent.address.toLowerCase(),
                };
            }),
        );
        return text(out);
    },
);

server.tool(
    "agent_status",
    "[마패] 이 에이전트의 신원·가스 잔액·보유한 마패별 남은 여력 한눈에. Who this agent is on this machine: address, gas balance, roughly how many payments that covers, and one line of headroom per held authority (remaining budget, per-payment ceiling, usable or not). Gas cannot be fetched programmatically - GIWA's ETH faucets are web pages with captchas - so when the tank is low, hand the human this address to fund.",
    {},
    async () => {
        const [balance, block] = await Promise.all([
            pub.getBalance({address: agent.address}),
            pub.getBlock(),
        ]);
        // ~1.5M gas ceiling per redemption at 3x base fee - the same posture pay uses.
        const perPay = 1_500_000n * ((block.baseFeePerGas ?? 1_000_000n) * 3n);
        // One line per held Mapae: enough to pick a context without a second tool call.
        const authorities = await Promise.all(
            held.map(async (h, index) => {
                const live = await liveState(h);
                const perPayment = h.conditions.find((c) => c.kind === "perPayment");
                return {
                    index,
                    delegationHash: h.hash,
                    remainingThisPeriod: live.available === null ? null : fmtWon(live.available),
                    maxPerPayment: perPayment?.kind === "perPayment" ? fmtWon(perPayment.max) : null,
                    usable:
                        !live.disabled &&
                        live.identityLive !== false &&
                        h.leaf.delegate.toLowerCase() === agent.address.toLowerCase(),
                };
            }),
        );
        return text({
            agentAddress: agent.address,
            gasBalanceEth: Number(balance) / 1e18,
            approxPaymentsRemaining: perPay > 0n ? Number(balance / perPay) : null,
            contextsHeld: held.length,
            authorities,
            identityFile: join(PROFILE_DIR, "agent.key"),
            profile: process.env.MAPAE_PROFILE ?? "(default)",
            contextsFile: CONTEXTS_FILE,
            fundingNote:
                "Send GIWA Sepolia ETH to agentAddress from any funded wallet. There is no " +
                "programmatic faucet - the human does this once, a fraction of a cent covers hundreds of payments.",
        });
    },
);

server.tool(
    "check_budget",
    "[마패] 이 마패의 남은 한도 확인(기간 한도 + 회당 한도). What remains of the period cap for one held authority, read live from the period enforcer - plus the per-payment ceiling, which no single transfer may exceed regardless of how much of the period remains.",
    {contextIndex: z.number().int().min(0).optional().describe("Which held context (default 0)")},
    async ({contextIndex}) => {
        const h = pick(contextIndex);
        const period = h.conditions.find((c) => c.kind === "period");
        const perPayment = h.conditions.find((c) => c.kind === "perPayment");
        if (period?.kind !== "period" && perPayment?.kind !== "perPayment") {
            return text("This authority carries no spending cap.");
        }
        const live = await liveState(h);
        // The largest single payment that can settle right now is bounded by BOTH caps -
        // stating it saves the model an arithmetic mistake at the moment it matters.
        const ceiling = perPayment?.kind === "perPayment" ? perPayment.max : null;
        const payableNow =
            live.available === null ? ceiling : ceiling === null ? live.available : ceiling < live.available ? ceiling : live.available;
        return text({
            cap: period?.kind === "period" ? fmtWon(period.amount) : null,
            per: period?.kind === "period" ? (Number(period.duration) === 86_400 ? "day" : `${Number(period.duration)}s`) : null,
            remaining: live.available === null ? null : fmtWon(live.available),
            spent: period?.kind === "period" && live.available !== null ? fmtWon(period.amount - live.available) : null,
            maxPerPayment: ceiling === null ? null : fmtWon(ceiling),
            largestSinglePaymentNow: payableNow === null ? null : fmtWon(payableNow),
            disabled: live.disabled,
            identityLive: live.identityLive,
        });
    },
);

server.tool(
    "pay",
    "[마패] 마패로 결제한다. Spend within a held authority. The allowed payees and the token come from the SIGNED POLICY, not from arguments - when the policy names several payees, `payee` picks WHICH of them to pay, and an address outside the signed list is rejected before any transaction. A refusal is a normal result carrying the on-chain reason, because refusals are the product working.",
    {
        amount: z.number().int().positive().describe("Amount in mKRW base units (1 = ₩1)"),
        payee: z
            .string()
            .optional()
            .describe("Which of the policy's allowed payees to pay (address). Defaults to the first. Must be on the signed allowlist - anything else is refused without a transaction."),
        contextIndex: z.number().int().min(0).optional(),
    },
    async ({amount, payee: payeeArg, contextIndex}) => {
        const h = pick(contextIndex);
        if (h.leaf.delegate.toLowerCase() !== agent.address.toLowerCase()) {
            return text({
                status: "NOT_MINE",
                detail: `this context is delegated to ${h.leaf.delegate}, but I sign as ${agent.address}`,
            });
        }
        const payee = h.conditions.find((c) => c.kind === "payee");
        const period = h.conditions.find((c) => c.kind === "period");
        if (payee?.kind !== "payee" || period?.kind !== "period") {
            return text({status: "UNSUPPORTED", detail: "this authority has no payee/period policy to spend against"});
        }
        // The choice is only ever WHICH allowed payee - the argument selects from the signed
        // list, it can never add to it. The enforcer would refuse an outsider anyway; refusing
        // here first saves the gas and names the list.
        let recipient = payee.payees[0];
        if (payeeArg !== undefined) {
            const match = payee.payees.find((p) => p.toLowerCase() === payeeArg.toLowerCase());
            if (!match) {
                return text({
                    status: "NOT_IN_POLICY",
                    detail: `${payeeArg} is not on this authority's signed allowlist`,
                    allowedPayees: payee.payees,
                });
            }
            recipient = match;
        }

        const execution = encodeExecutionSingle(
            period.token,
            0n,
            encodeErc20Transfer(recipient, BigInt(amount)),
        );
        const args = [[h.context], [MODE_SIMPLE_SINGLE as Hex], [execution]] as const;

        // Fee headroom: GIWA's shared mempool evicts market-priced transactions under load.
        const base = (await pub.getBlock()).baseFeePerGas ?? 1_000_000n;

        try {
            const hash = await wallet.writeContract({
                address: addresses.manager,
                abi: managerAbi,
                functionName: "redeemDelegations",
                args,
                gas: 1_500_000n,
                maxFeePerGas: base * 3n,
                maxPriorityFeePerGas: base,
            });
            const receipt = await pub.waitForTransactionReceipt({hash, timeout: 90_000});
            const ok = receipt.status === "success";
            // The receipt is the authoritative budget source: GIWA's load-balanced RPC can serve
            // a stale read for a few blocks, but the enforcer's own event cannot be stale.
            let spentThisPeriod: bigint | undefined;
            if (ok) {
                const spends = parseEventLogs({
                    abi: periodEnforcerAbi,
                    logs: receipt.logs,
                    eventName: "TransferredInPeriod",
                });
                spentThisPeriod = spends[0]?.args.transferredInCurrentPeriod;
            }
            let reason: string | undefined;
            if (!ok) {
                // Re-run against the state the block executed on, to recover WHY.
                try {
                    await pub.simulateContract({
                        address: addresses.manager,
                        abi: managerAbi,
                        functionName: "redeemDelegations",
                        args,
                        account: agent.address,
                        blockNumber: receipt.blockNumber - 1n,
                    });
                } catch (e) {
                    reason = reasonOf(e);
                }
            }
            return text({
                status: ok ? "PAID" : "REFUSED",
                amount: fmtWon(BigInt(amount)),
                payee: recipient,
                reason,
                spentThisPeriod: spentThisPeriod !== undefined ? fmtWon(spentThisPeriod) : undefined,
                remainingThisPeriod:
                    spentThisPeriod !== undefined ? fmtWon(period.amount - spentThisPeriod) : undefined,
                tx: hash,
                trace: `${APP_URL}/tx/${hash}`,
            });
        } catch (e) {
            return text({status: "REFUSED", reason: reasonOf(e), trace: null});
        }
    },
);

server.tool(
    "request_permission",
    "[마패] 사람에게 마패 발급을 요청한다(서명 링크 생성). Compose a permission REQUEST for the human to review and sign in their own wallet. This server cannot issue: issuance is the principal's signature, and holding that key would hand the agent the wallet. Returns a prefilled link - send it to the human.",
    {
        agentName: z.string().min(1).describe("How the human should see this agent named"),
        amountPerPeriod: z.number().int().positive().describe("Requested cap in mKRW base units"),
        period: z.enum(["day", "week", "30d"]).default("day"),
        maxPerPayment: z
            .number()
            .int()
            .positive()
            .optional()
            .describe(
                "Optional ceiling on any SINGLE payment, in mKRW base units. Ask for it when many small payments are fine but one large one would not be - the classic lunch-money shape. Enforced per transfer, independent of the period cap.",
            ),
        merchants: z
            .array(z.string())
            .min(1)
            .max(10)
            .describe(
                "Every address this authority may pay. One is the common case; a benefit card or an expense policy names several. The allowlist denies by default - an address not listed here cannot be paid.",
            ),
        merchantNames: z
            .array(z.string())
            .optional()
            .describe(
                "Optional labels, matched by position to merchants. Shown to the human so the list is checkable; they never reach the signed terms, which carry addresses.",
            ),
        validDays: z.number().int().positive().max(365).default(30),
    },
    async ({agentName, amountPerPeriod, period, maxPerPayment, merchants, merchantNames, validDays}) => {
        const bad = merchants.find((m) => !isAddress(m, {strict: false}));
        if (bad) return text({error: `not an address: ${bad}`});
        const canonical = merchants.map((m) => getAddress(m));
        if (new Set(canonical.map((m) => m.toLowerCase())).size !== canonical.length) {
            return text({error: "the same address is listed twice"});
        }
        if (maxPerPayment !== undefined && maxPerPayment > amountPerPeriod) {
            // The period cap binds first, so a larger per-payment ceiling would never fire -
            // a request that asks for it is a composition mistake, not a policy.
            return text({error: "maxPerPayment exceeds amountPerPeriod - it could never bind. Lower it, or drop it."});
        }
        const q = new URLSearchParams({
            agentName,
            agent: agent.address,
            amount: String(amountPerPeriod),
            period: {day: "86400", week: "604800", "30d": "2592000"}[period],
            merchants: canonical.join(","),
            validDays: String(validDays),
        });
        if (maxPerPayment !== undefined) q.set("perTx", String(maxPerPayment));
        if (merchantNames?.some((n) => n.trim())) {
            q.set("merchantNames", merchantNames.map((n) => n.trim()).join(","));
        }
        return text({
            askTheHuman: `${APP_URL}/create?${q.toString()}`,
            note: "The human reviews the policy as a sentence and signs in their own wallet; nothing is issued until they do. Once issued, they hand back the permission context.",
        });
    },
);

server.tool(
    "load_context",
    "[마패] 사람이 발급해준 마패(권한 컨텍스트)를 대화에서 인계받는다. Load a permission context the human just handed over in conversation - the step after they signed what request_permission asked for. Pasting it here is safe by construction: a context is only spendable by the delegate it names, so it is a capability for that agent alone, not a secret.",
    {context: z.string().describe("The permission context hex, copied from the Composer's issued screen")},
    async ({context}) => {
        if (!context.startsWith("0x")) return text({error: "not a permission context (expected 0x…)"});
        let h: Held;
        try {
            h = decodeHeld(context as Hex);
        } catch {
            return text({error: "could not decode - copy the whole context, unmodified"});
        }
        const existing = held.findIndex((x) => x.hash === h.hash && x.leaf.delegate === h.leaf.delegate);
        if (existing >= 0) return text({index: existing, note: "already held"});
        held.push(h);
        persistContexts();
        const live = await liveState(h);
        return text({
            index: held.length - 1,
            delegationHash: h.hash,
            forThisAgent: h.leaf.delegate.toLowerCase() === agent.address.toLowerCase(),
            conditions: h.conditions.map(describe),
            remainingThisPeriod: live.available === null ? null : fmtWon(live.available),
            note: `Persisted to ${CONTEXTS_FILE} - future sessions on this machine hold it automatically.`,
        });
    },
);

server.tool(
    "redelegate",
    "[마패] 보유한 마패를 더 좁혀 하위 에이전트에 재위임한다. Sign a NARROWER child of a held authority to another agent, without any transaction. The child can only narrow: its own caps ride on top of every parent condition, the root human's kill switch still severs the whole chain, and the identity gate still reads the root principal at every payment.",
    {
        to: z.string().describe("The sub-agent's address"),
        capAmount: z.number().int().positive().optional()
            .describe("Optional tighter per-period cap for the child, in mKRW base units"),
        maxPerPayment: z.number().int().positive().optional()
            .describe("Optional per-payment ceiling for the child, in mKRW base units - no single transfer by the sub-agent may exceed it"),
        contextIndex: z.number().int().min(0).optional(),
    },
    async ({to, capAmount, maxPerPayment, contextIndex}) => {
        const h = pick(contextIndex);
        if (!isAddress(to, {strict: false})) return text({error: "to is not an address"});
        if (h.leaf.delegate.toLowerCase() !== agent.address.toLowerCase()) {
            return text({error: `cannot redelegate a context held by ${h.leaf.delegate}`});
        }
        const period = h.conditions.find((c) => c.kind === "period");
        const caveats = [
            ...(capAmount && period?.kind === "period"
                ? [
                      {
                          enforcer: addresses.periodEnforcer,
                          terms: periodTerms(
                              period.token,
                              BigInt(capAmount),
                              period.duration,
                              BigInt(Math.floor(Date.now() / 1000)) - 60n,
                          ),
                          args: "0x" as Hex,
                      },
                  ]
                : []),
            ...(maxPerPayment
                ? [
                      {
                          enforcer: addresses.perPaymentEnforcer,
                          terms: perPaymentTerms(BigInt(maxPerPayment)),
                          args: "0x" as Hex,
                      },
                  ]
                : []),
        ];

        const salt = BigInt(`0x${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
        const unsigned: Delegation = {
            delegate: getAddress(to),
            delegator: agent.address,
            authority: delegationHash(h.leaf),
            caveats,
            salt,
            signature: "0x",
        };
        const signature = await agent.signTypedData({
            domain: delegationDomain(giwaSepolia.id, addresses.manager),
            types: DELEGATION_TYPES,
            primaryType: "Delegation",
            message: {
                delegate: unsigned.delegate,
                delegator: unsigned.delegator,
                authority: unsigned.authority,
                caveats: unsigned.caveats.map((c) => ({enforcer: c.enforcer, terms: c.terms})),
                salt: unsigned.salt,
            },
        });
        const child: Delegation = {...unsigned, signature};
        return text({
            childOf: h.hash,
            delegate: child.delegate,
            narrowedCap: capAmount ? fmtWon(BigInt(capAmount)) : "(inherits parent conditions only)",
            narrowedPerPayment: maxPerPayment ? fmtWon(BigInt(maxPerPayment)) : undefined,
            permissionContext: encodePermissionContext([child, ...h.chain]),
            note: "Hand this context to the sub-agent's MAPAE_PERMISSION_CONTEXT. Disabling the root, or revoking the principal's Dojang, still stops it instantly.",
        });
    },
);

/* ---------------------------------- start ---------------------------------- */

await server.connect(new StdioServerTransport());
console.error(`mapae-mcp: agent ${agent.address}, ${held.length} context(s) held, chain ${giwaSepolia.id}`);
