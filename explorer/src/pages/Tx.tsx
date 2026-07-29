import {useEffect, useState, type ReactNode} from "react";
import {useParams} from "react-router-dom";
import type {Hex} from "viem";
import {traceTx, type Trace, type DecodedCaveat} from "../lib/data";
import {Card, StatusPill, Check, Spinner, Mono, ExtLink} from "../components/ui";
import {fmtAmount, ISSUERS, short} from "../lib/config";

/* ------------------------------- rejection copy ------------------------------- */

function rejectionStory(reason: string): {headline: string; body: string} | null {
    if (reason.startsWith("NotDojangVerified"))
        return {
            headline: "위임자의 신원이 더 이상 유효하지 않습니다",
            body: "서명은 유효하고 한도도 남아 있었지만, 위임의 뿌리인 실명 attestation이 취소·만료되어 결제가 거부되었습니다. 신원 취소는 마패 컨트랙트를 거치지 않고도 모든 위임을 즉시 멈추는 킬스위치입니다.",
        };
    if (reason.startsWith("PayeeNotAllowed"))
        return {
            headline: "허용 목록에 없는 수취인입니다",
            body: "이 위임은 서명된 수취인 목록 밖으로는 한 푼도 보낼 수 없습니다. 금액이 아무리 작아도 대상이 다르면 거부됩니다.",
        };
    if (reason.includes("transfer-amount-exceeded"))
        return {
            headline: "기간당 한도를 초과했습니다",
            body: "이 기간에 이미 사용한 금액과 합치면 서명된 상한을 넘습니다. 한도는 프롬프트가 아니라 컨트랙트가 지킵니다.",
        };
    if (reason.startsWith("CannotUseADisabledDelegation"))
        return {
            headline: "위임자가 이 위임을 꺼 두었습니다",
            body: "위임자는 언제든 위임을 비활성화할 수 있고, 즉시 발효됩니다. 신원과는 독립적인 두 번째 킬스위치입니다.",
        };
    if (reason.includes("expired-delegation"))
        return {
            headline: "위임 기한이 지났습니다",
            body: "서명에 담긴 유효 기간을 벗어난 시점의 결제 시도입니다.",
        };
    return null;
}

/* --------------------------------- chain step --------------------------------- */

function Step({
    n,
    title,
    children,
    last = false,
}: {
    n: number;
    title: string;
    children: ReactNode;
    last?: boolean;
}) {
    return (
        <div className="relative pl-12">
            {!last && <div className="absolute top-9 bottom-0 left-[15px] w-px bg-line" />}
            <div className="absolute top-1 left-0 flex h-8 w-8 items-center justify-center rounded-full border border-bronze-dim bg-surface font-serif text-[14px] font-bold text-bronze">
                {n}
            </div>
            <div className="pb-8">
                <h3 className="mb-2.5 pt-1.5 text-[15px] font-semibold text-ink">{title}</h3>
                {children}
            </div>
        </div>
    );
}

function Row({k, v}: {k: string; v: ReactNode}) {
    return (
        <div className="flex items-baseline justify-between gap-6 py-1.5">
            <span className="shrink-0 text-[13px] text-mute">{k}</span>
            <span className="text-right text-[13.5px] text-ink-2">{v}</span>
        </div>
    );
}

function CaveatCard({c}: {c: DecodedCaveat}) {
    const tone: Record<DecodedCaveat["kind"], string> = {
        identity: "border-bronze-dim/60",
        period: "border-line-strong",
        payee: "border-line-strong",
        window: "border-line-strong",
        humanloop: "border-bronze-dim/60",
        unknown: "border-line",
    };
    return (
        <div className={`rounded-lg border ${tone[c.kind]} bg-surface-2 px-3.5 py-3`}>
            <div className="text-[13px] font-semibold text-ink">{c.title}</div>
            <div className="mt-1 space-y-0.5">
                {c.lines.map((l, i) => (
                    <div
                        key={i}
                        className={`text-[12.5px] ${l.startsWith("0x") ? "font-mono text-mute" : "text-ink-2"}`}
                    >
                        {l}
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ----------------------------------- page ----------------------------------- */

export default function Tx() {
    const {hash} = useParams<{hash: Hex}>();
    const [trace, setTrace] = useState<Trace | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setTrace(null);
        setError(null);
        if (hash) traceTx(hash).then(setTrace).catch((e) => setError(String(e)));
    }, [hash]);

    if (error)
        return (
            <div className="mx-auto max-w-2xl px-6 py-24 text-center">
                <p className="text-[15px] text-ink-2">트랜잭션을 찾을 수 없습니다.</p>
                <p className="mt-2 font-mono text-[12px] break-all text-mute">{hash}</p>
            </div>
        );
    if (!trace) return <Spinner />;

    const story = trace.rejection ? rejectionStory(trace.rejection) : null;
    const id = trace.identity;
    const issuer = id ? ISSUERS[id.attesterId] : undefined;
    const att = id?.attestation;
    const usedAccount =
        trace.delegation && id && trace.delegation.delegator.toLowerCase() !== id.principal.toLowerCase();

    return (
        <div className="mx-auto max-w-3xl px-6 py-12">
            {/* ------------------------------ verdict ------------------------------ */}
            <div className="mb-10">
                <div className="flex items-center gap-3">
                    <StatusPill ok={trace.ok} label={trace.ok ? "승인된 결제" : "거부된 결제"} />
                    <ExtLink path={`/tx/${trace.hash}`}>
                        <Mono>{short(trace.hash, 10)} ↗</Mono>
                    </ExtLink>
                </div>

                {trace.payment && (
                    <div className="mt-4 text-[30px] font-semibold tracking-tight text-ink tabular-nums">
                        {fmtAmount(trace.payment.token, trace.payment.amount)}
                        <span className="mx-3 text-[20px] text-mute">→</span>
                        <Mono className="!text-[16px] text-ink-2">{short(trace.payment.to, 8)}</Mono>
                    </div>
                )}

                {!trace.ok && (
                    <div className="mt-5 rounded-xl border border-reject-dim bg-reject/[0.06] px-5 py-4">
                        <div className="font-mono text-[13px] break-all text-reject">{trace.rejection}</div>
                        {story && (
                            <>
                                <div className="mt-2.5 text-[15px] font-semibold text-ink">
                                    {story.headline}
                                </div>
                                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{story.body}</p>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* --------------------------- the chain --------------------------- */}
            <h2 className="mb-6 text-[13px] font-medium tracking-widest text-mute uppercase">
                책임의 사슬 — 결제에서 사람까지
            </h2>

            <Step n={1} title="결제 실행">
                <Card className="px-4 py-1.5">
                    <Row k="실행 주체 (에이전트/정산자)" v={<Mono>{short(trace.redeemer, 8)}</Mono>} />
                    <Row k="블록" v={<Mono>{trace.blockNumber.toString()}</Mono>} />
                </Card>
            </Step>

            {trace.delegation && (
                <Step n={2} title="위임 — 서명된 범위">
                    <div className="grid gap-2 sm:grid-cols-2">
                        {trace.delegation.caveats.map((c, i) => (
                            <CaveatCard key={i} c={c} />
                        ))}
                    </div>
                    <p className="mt-2.5 text-[12.5px] text-mute">
                        네 조건 전부를 통과해야 결제가 실행됩니다 — 조건은 위임자가 서명했고, 강제는
                        컨트랙트가 합니다.
                    </p>
                </Step>
            )}

            {usedAccount && trace.delegation && (
                <Step n={3} title="자금 계정">
                    <Card className="px-4 py-1.5">
                        <Row k="MapaeAccount" v={<Mono>{short(trace.delegation.delegator, 8)}</Mono>} />
                    </Card>
                    <div className="mt-2.5 space-y-1.5">
                        <Check ok={id?.accountRegistered ?? false}>
                            팩토리 등록 계정 — 소유자가 EIP-712로 결박에 동의했음
                        </Check>
                        <Check
                            ok={
                                !!id?.accountOwner &&
                                id.accountOwner.toLowerCase() === id.principal.toLowerCase()
                            }
                        >
                            계정 소유자가 아래의 실명 주소와 일치
                        </Check>
                    </div>
                </Step>
            )}

            {id && (
                <Step n={usedAccount ? 4 : 3} title="실명 신원 — 이 결제를 허락한 사람" last={!att}>
                    <Card className="px-4 py-1.5">
                        <Row k="위임자 본인" v={<Mono>{short(id.principal, 8)}</Mono>} />
                        <Row
                            k="요구 발급자"
                            v={
                                issuer ? (
                                    <span className={issuer.real ? "text-bronze-bright" : undefined}>
                                        {issuer.nameKo}
                                    </span>
                                ) : (
                                    <Mono>{short(id.attesterId, 8)}</Mono>
                                )
                            }
                        />
                        <Row
                            k="현재 신원 상태"
                            v={
                                id.liveNow ? (
                                    <span className="text-jade">유효 — 지금 이 순간 기준</span>
                                ) : (
                                    <span className="text-reject">무효 — 취소되었거나 만료됨</span>
                                )
                            }
                        />
                    </Card>
                    {trace.ok && !id.liveNow && (
                        <p className="mt-2.5 text-[12.5px] leading-relaxed text-mute">
                            결제 <em className="not-italic text-ink-2">시점</em>에는 유효했습니다 — 게이트
                            통과 이벤트가 그 증거입니다. 이후 신원이 취소되었고, 위 상태는 지금 체인을
                            읽은 값입니다. 감사가 필요한 시제 구분이 그대로 보입니다.
                        </p>
                    )}
                    {!trace.ok &&
                        id.liveNow &&
                        trace.rejection?.startsWith("NotDojangVerified") && (
                            <p className="mt-2.5 text-[12.5px] leading-relaxed text-mute">
                                결제 <em className="not-italic text-ink-2">시점</em>에는 무효였습니다 —
                                위의 거부 사유가 그 증거입니다. 이후 재발급되어 현재는 유효하며, 위
                                상태는 지금 체인을 읽은 값입니다.
                            </p>
                        )}
                </Step>
            )}

            {att && id && (
                <Step n={usedAccount ? 5 : 4} title="Attestation — 도장 원본" last>
                    <Card className="px-4 py-1.5">
                        <Row k="uid" v={<Mono>{short(att.uid, 10)}</Mono>} />
                        <Row
                            k="발급"
                            v={new Date(att.issuedAt * 1000).toLocaleString("ko-KR")}
                        />
                        <Row
                            k="만료"
                            v={
                                att.expiresAt === 0
                                    ? "없음"
                                    : new Date(att.expiresAt * 1000).toLocaleString("ko-KR")
                            }
                        />
                        <Row
                            k="취소"
                            v={
                                att.revokedAt === 0 ? (
                                    <span className="text-jade">아니오</span>
                                ) : (
                                    <span className="text-reject">
                                        {new Date(att.revokedAt * 1000).toLocaleString("ko-KR")}
                                    </span>
                                )
                            }
                        />
                    </Card>
                    <div className="mt-3 space-y-1.5">
                        <Check
                            ok={
                                !!id.attesterFromBook &&
                                id.attesterFromBook.toLowerCase() === att.attester.toLowerCase()
                            }
                        >
                            발급자 결합 — 발급자 명부의 주소와 attestation 서명자가 일치
                        </Check>
                        <Check ok={att.recipient.toLowerCase() === id.principal.toLowerCase()}>
                            수령인 결합 — attestation이 위 실명 주소 앞으로 발급됨
                        </Check>
                    </div>
                    <p className="mt-3 text-[12.5px] text-mute">
                        모든 결합은 신뢰가 아니라 검증입니다 — 이 페이지의 어떤 값도 저장된 데이터가 아닌
                        체인에서 지금 읽은 것입니다.
                    </p>
                </Step>
            )}
        </div>
    );
}
