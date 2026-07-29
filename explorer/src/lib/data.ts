import {
    createPublicClient,
    decodeAbiParameters,
    decodeErrorResult,
    decodeFunctionData,
    http,
    parseAbi,
    parseEventLogs,
    type Address,
    type Hex,
} from "viem";
import {
    accountAbi,
    dojangEnforcerAbi,
    dojangScrollAbi,
    easAbi,
    attesterBookAbi,
    enforcerErrorsAbi,
    factoryAbi,
    managerAbi,
    periodEnforcerAbi,
} from "@mapae/abi";
import {addresses, giwaSepolia, ISSUERS, BLOCKSCOUT} from "./config";
import snapshot from "../data/snapshot.json";

export const client = createPublicClient({chain: giwaSepolia, transport: http()});

const errorAbi = [...managerAbi, ...enforcerErrorsAbi, ...factoryAbi];

/** Manager events - the SDK's managerAbi carries functions and errors only. */
const managerEventsAbi = parseAbi([
    "event RedeemedDelegation(address indexed rootDelegator, address indexed redeemer, bytes32 indexed delegationHash)",
    "event DisabledDelegation(bytes32 indexed delegationHash, address indexed delegator)",
    "event EnabledDelegation(bytes32 indexed delegationHash, address indexed delegator)",
]);

/* ----------------------------- delegation decoding ----------------------------- */

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

export interface DecodedCaveat {
    enforcer: Address;
    kind: "identity" | "period" | "payee" | "window" | "humanloop" | "unknown";
    title: string;
    lines: string[];
}

export interface DecodedDelegation {
    delegate: Address;
    delegator: Address;
    authority: Hex;
    salt: bigint;
    caveats: DecodedCaveat[];
    raw: {enforcer: Address; terms: Hex; args: Hex}[];
}

function hexToBigint(h: string): bigint {
    return BigInt(h);
}

export function decodeCaveat(enforcer: Address, terms: Hex): DecodedCaveat {
    const e = enforcer.toLowerCase();
    const body = terms.slice(2);
    try {
        if (e === addresses.dojangEnforcer.toLowerCase()) {
            const attesterId = `0x${body.slice(0, 64)}`;
            const principal = `0x${body.slice(64, 104)}` as Address;
            const issuer = ISSUERS[attesterId];
            return {
                enforcer,
                kind: "identity",
                title: "신원 — 도장 검증",
                lines: [
                    `위임자 본인: ${principal}`,
                    `요구 발급자: ${issuer ? issuer.nameKo : attesterId.slice(0, 18) + "…"}`,
                    "결제 순간마다 attestation 유효성을 다시 읽습니다",
                ],
            };
        }
        if (e === addresses.periodEnforcer.toLowerCase()) {
            const amount = hexToBigint(`0x${body.slice(40, 104)}`);
            const duration = hexToBigint(`0x${body.slice(104, 168)}`);
            const days = Number(duration) / 86_400;
            return {
                enforcer,
                kind: "period",
                title: "한도 — 기간당 상한",
                lines: [
                    `₩${amount.toLocaleString("ko-KR")} / ${days === 1 ? "1일" : `${days}일`}`,
                    "기간이 지나면 초기화, 남은 한도는 이월되지 않습니다",
                ],
            };
        }
        if (e === addresses.payeeEnforcer.toLowerCase()) {
            const count = body.length / 40;
            const payees: string[] = [];
            for (let i = 0; i < count; i++) payees.push(`0x${body.slice(i * 40, i * 40 + 40)}`);
            return {
                enforcer,
                kind: "payee",
                title: `수취인 — 허용 목록 ${count}곳`,
                lines: payees.map((p) => p),
            };
        }
        if (e === addresses.timestampEnforcer.toLowerCase()) {
            const before = hexToBigint(`0x${body.slice(32, 64)}`);
            return {
                enforcer,
                kind: "window",
                title: "기한",
                lines: [
                    before === 0n
                        ? "만료 없음"
                        : `${new Date(Number(before) * 1000).toLocaleString("ko-KR")} 까지`,
                ],
            };
        }
        if (addresses.verifiedCodeEnforcer && e === addresses.verifiedCodeEnforcer.toLowerCase()) {
            const attesterId = `0x${body.slice(0, 64)}`;
            const domain = new TextDecoder().decode(
                Uint8Array.from(body.slice(64).match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? []),
            );
            const issuer = ISSUERS[attesterId];
            return {
                enforcer,
                kind: "humanloop",
                title: "사람 확인 — 실시간 인증",
                lines: [
                    `도메인: ${domain}`,
                    `발급자: ${issuer ? issuer.nameKo : attesterId.slice(0, 18) + "…"}`,
                    "결제마다 유효한 오프체인 확인(OTP)이 있어야 합니다",
                ],
            };
        }
    } catch {
        /* fall through to unknown */
    }
    return {enforcer, kind: "unknown", title: "조건", lines: [terms.slice(0, 40) + "…"]};
}

export function decodeContext(context: Hex): DecodedDelegation[] {
    const [chain] = decodeAbiParameters(DELEGATION_PARAMS, context);
    return chain.map((d) => ({
        delegate: d.delegate,
        delegator: d.delegator,
        authority: d.authority,
        salt: d.salt,
        caveats: d.caveats.map((c) => decodeCaveat(c.enforcer, c.terms)),
        raw: d.caveats.map((c) => ({enforcer: c.enforcer, terms: c.terms, args: c.args})),
    }));
}

/* --------------------------------- the feed --------------------------------- */

export interface FeedItem {
    hash: Hex;
    ok: boolean;
    timestamp: string;
    from: Address;
}

/** Redemption attempts against the manager - successes AND failures - via Blockscout. */
export async function fetchFeed(): Promise<FeedItem[]> {
    const res = await fetch(
        `${BLOCKSCOUT}/api/v2/addresses/${addresses.manager}/transactions?filter=to`,
    );
    const data = await res.json();
    return (data.items ?? [])
        .filter((t: {raw_input?: string}) => t.raw_input?.startsWith("0xcef6d209"))
        .map((t: {hash: Hex; status: string; timestamp: string; from: {hash: Address}}) => ({
            hash: t.hash,
            ok: t.status === "ok",
            timestamp: t.timestamp,
            from: t.from.hash,
        }));
}

/* --------------------------------- statistics -------------------------------- */

export interface Stats {
    delegations: number;
    redemptions: number;
    rejections: number;
    principals: number;
    headBlock: bigint;
    /** Blocks scanned live on top of the build-time checkpoint. */
    deltaBlocks: bigint;
}

let statsCache: Promise<Stats> | null = null;

/**
 * Checkpoint + catch-up, which is what an indexer does - here with the checkpoint baked in at
 * build time and the catch-up run in the browser.
 *
 * GIWA mints a block per second, so scanning from the deploy block on every page load costs one
 * getLogs call today and 351 within a year. Starting from the shipped checkpoint keeps it at one
 * call for as long as deployments are reasonably fresh, and degrades gently rather than
 * catastrophically if a build goes stale.
 */
export function fetchStats(): Promise<Stats> {
    statsCache ??= (async () => {
        const head = await client.getBlockNumber();
        const CHUNK = 90_000n;

        const delegations = new Set<string>(snapshot.delegationHashes);
        const principals = new Set<string>(snapshot.principalAddresses);
        // Counted by TRANSACTION, not by event: the manager emits one RedeemedDelegation per hop,
        // so a two-hop redelegation (as the x402 facilitator uses) would otherwise count twice.
        const paymentTxs = new Set<string>(snapshot.paymentTxHashes);

        const from0 = BigInt(snapshot.checkpointBlock) + 1n;
        for (let from = from0; from <= head; from += CHUNK) {
            const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
            const logs = await client.getLogs({
                address: [addresses.manager, addresses.dojangEnforcer],
                fromBlock: from,
                toBlock: to,
            });
            for (const l of parseEventLogs({abi: managerEventsAbi, logs, eventName: "RedeemedDelegation"})) {
                paymentTxs.add(l.transactionHash);
                delegations.add(l.args.delegationHash);
            }
            for (const l of parseEventLogs({
                abi: dojangEnforcerAbi,
                logs,
                eventName: "DojangGatePassed",
            })) {
                principals.add(l.args.principal.toLowerCase());
            }
        }

        const feed = await fetchFeed();
        return {
            delegations: delegations.size,
            redemptions: paymentTxs.size,
            rejections: feed.filter((f) => !f.ok).length,
            principals: principals.size,
            headBlock: head,
            deltaBlocks: head > from0 ? head - from0 : 0n,
        };
    })();
    return statsCache;
}

/* ---------------------------------- tracing ---------------------------------- */

export interface Attestation {
    uid: Hex;
    recipient: Address;
    attester: Address;
    issuedAt: number;
    expiresAt: number;
    revokedAt: number;
}

export interface Trace {
    hash: Hex;
    ok: boolean;
    blockNumber: bigint;
    redeemer: Address;
    /** Decoded reason, failures only. */
    rejection?: string;
    delegation?: DecodedDelegation;
    delegationHash?: Hex;
    /** The transfer this redemption performed (or attempted). */
    payment?: {token: Address; to: Address; amount: bigint};
    /** Identity chain, resolved live. */
    identity?: {
        principal: Address;
        attesterId: Hex;
        attestationUid?: Hex;
        attestation?: Attestation;
        attesterFromBook?: Address;
        liveNow: boolean;
        accountRegistered?: boolean;
        accountOwner?: Address;
    };
    spentInPeriod?: bigint;
    periodCap?: bigint;
}

function extractRevert(err: unknown): Hex | undefined {
    let e = err as {data?: unknown; cause?: unknown} | undefined;
    while (e) {
        if (typeof e.data === "string" && e.data.startsWith("0x") && e.data.length > 2)
            return e.data as Hex;
        const inner = (e.data as {data?: string})?.data;
        if (typeof inner === "string" && inner.startsWith("0x")) return inner as Hex;
        e = e.cause as typeof e;
    }
    return undefined;
}

function decodeRejection(data: Hex | undefined): string {
    if (!data) return "사유를 복원할 수 없음";
    try {
        const d = decodeErrorResult({abi: errorAbi, data});
        return d.args?.length ? `${d.errorName}(${d.args.map(String).join(", ")})` : `${d.errorName}()`;
    } catch {
        return `raw ${data.slice(0, 20)}…`;
    }
}

const transferEventAbi = parseAbi([
    "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export async function traceTx(hash: Hex): Promise<Trace> {
    const [receipt, tx] = await Promise.all([
        client.getTransactionReceipt({hash}),
        client.getTransaction({hash}),
    ]);
    const ok = receipt.status === "success";

    const trace: Trace = {
        hash,
        ok,
        blockNumber: receipt.blockNumber,
        redeemer: tx.from,
    };

    // The delegation itself comes from CALLDATA, so failed payments decode just as richly as
    // successful ones - a rejection page shows exactly what was refused.
    try {
        const {args} = decodeFunctionData({abi: managerAbi, data: tx.input});
        const [contexts, , execs] = args as [Hex[], Hex[], Hex[]];
        const chain = decodeContext(contexts[0]);
        trace.delegation = chain[chain.length - 1]; // root: whose money, whose rules
        const exec = execs[0];
        const token = `0x${exec.slice(2, 42)}` as Address;
        const callData = exec.slice(2 + 40 + 64);
        if (callData.startsWith("a9059cbb")) {
            trace.payment = {
                token,
                to: `0x${callData.slice(8 + 24, 8 + 64)}` as Address,
                amount: BigInt(`0x${callData.slice(8 + 64, 8 + 128)}`),
            };
        }
    } catch {
        /* not a redemption call */
    }

    if (ok) {
        const gates = parseEventLogs({
            abi: dojangEnforcerAbi,
            logs: receipt.logs,
            eventName: "DojangGatePassed",
        });
        if (gates.length > 0) {
            const g = gates[0].args;
            trace.delegationHash = g.delegationHash;
            trace.identity = {
                principal: g.principal,
                attesterId: g.attesterId,
                attestationUid: g.attestationUid,
                liveNow: false,
            };
        }
        const spends = parseEventLogs({
            abi: periodEnforcerAbi,
            logs: receipt.logs,
            eventName: "TransferredInPeriod",
        });
        if (spends.length > 0) {
            trace.spentInPeriod = spends[0].args.transferredInCurrentPeriod;
            trace.periodCap = spends[0].args.periodAmount;
        }
        const transfers = parseEventLogs({
            abi: transferEventAbi,
            logs: receipt.logs,
            eventName: "Transfer",
        });
        if (!trace.payment && transfers.length > 0) {
            trace.payment = {
                token: transfers[0].address,
                to: transfers[0].args.to,
                amount: transfers[0].args.value,
            };
        }
    } else {
        // Replay against the state just before the block to recover WHY it was refused.
        try {
            await client.call({
                account: tx.from,
                to: tx.to ?? undefined,
                data: tx.input,
                blockNumber: receipt.blockNumber - 1n,
            });
            trace.rejection = "재실행에서는 통과 — 블록 내 상태 변화로 거부된 케이스";
        } catch (err) {
            trace.rejection = decodeRejection(extractRevert(err));
        }
    }

    // Identity: for failures, recover principal/issuer from the signed caveat terms instead.
    if (!trace.identity && trace.delegation) {
        const idCaveat = trace.delegation.raw.find(
            (c) => c.enforcer.toLowerCase() === addresses.dojangEnforcer.toLowerCase(),
        );
        if (idCaveat) {
            const body = idCaveat.terms.slice(2);
            trace.identity = {
                principal: `0x${body.slice(64, 104)}` as Address,
                attesterId: `0x${body.slice(0, 64)}` as Hex,
                liveNow: false,
            };
        }
    }

    if (trace.identity) {
        const id = trace.identity;
        const [liveNow, attesterFromBook] = await Promise.all([
            client.readContract({
                address: addresses.dojangScroll,
                abi: dojangScrollAbi,
                functionName: "isVerified",
                args: [id.principal, id.attesterId],
            }),
            client.readContract({
                address: addresses.attesterBook,
                abi: attesterBookAbi,
                functionName: "getAttester",
                args: [id.attesterId],
            }),
        ]);
        id.liveNow = liveNow;
        id.attesterFromBook = attesterFromBook;

        if (id.attestationUid) {
            const att = await client.readContract({
                address: addresses.eas,
                abi: easAbi,
                functionName: "getAttestation",
                args: [id.attestationUid],
            });
            id.attestation = {
                uid: att.uid,
                recipient: att.recipient,
                attester: att.attester,
                issuedAt: Number(att.time),
                expiresAt: Number(att.expirationTime),
                revokedAt: Number(att.revocationTime),
            };
        }

        if (trace.delegation && trace.delegation.delegator.toLowerCase() !== id.principal.toLowerCase()) {
            const [registered, owner] = await Promise.all([
                client.readContract({
                    address: addresses.factory,
                    abi: factoryAbi,
                    functionName: "isMapaeAccount",
                    args: [trace.delegation.delegator],
                }),
                client
                    .readContract({
                        address: trace.delegation.delegator,
                        abi: accountAbi,
                        functionName: "owner",
                    })
                    .catch(() => undefined),
            ]);
            id.accountRegistered = registered;
            id.accountOwner = owner;
        }
    }

    return trace;
}
