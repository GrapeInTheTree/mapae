import {useEffect, useState, type ReactNode} from "react";
import {useParams} from "react-router-dom";
import type {Hex} from "viem";
import {traceTx, type DecodedDelegation, type Trace} from "../lib/data";
import {Card, Check, ExtLink, Mono, Spinner, StatusPill, Tag} from "../components/ui";
import {useLang} from "../i18n";
import {short} from "../lib/config";
import {fmtToken, issuerIsReal, issuerName, renderCondition} from "../lib/policy";

/**
 * The authority trace.
 *
 * Every other explorer answers "did this transfer happen". This one answers "who allowed it, and
 * is that person still who they said they were" - and, when the answer is no, exactly which
 * condition refused and what the alternative would have had to be.
 *
 * The refusals are the point. A demo that ends at "payment succeeded" proves a payment system
 * works; only a refusal proves an authority system does.
 */

type Kind =
    | "identity"
    | "payee"
    | "period"
    | "window"
    | "disabled"
    | "notDelegate"
    | "authority"
    | "signature"
    | "unknown";

/** Maps a revert to the sentence a person needs, in their language. */
function classify(reason: string): Kind {
    if (reason.startsWith("NotDojangVerified")) return "identity";
    if (reason.startsWith("PayeeNotAllowed")) return "payee";
    if (reason.includes("transfer-amount-exceeded")) return "period";
    if (reason.includes("expired-delegation") || reason.includes("not-yet-valid")) return "window";
    if (reason.startsWith("CannotUseADisabledDelegation")) return "disabled";
    if (reason.startsWith("InvalidDelegate")) return "notDelegate";
    if (reason.startsWith("InvalidAuthority")) return "authority";
    if (reason.startsWith("Invalid") && reason.includes("Signature")) return "signature";
    return "unknown";
}

export default function Tx() {
    const {hash} = useParams<{hash: Hex}>();
    const {t, lang} = useLang();
    const [trace, setTrace] = useState<Trace | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        setTrace(null);
        setError(false);
        if (hash) traceTx(hash).then(setTrace).catch(() => setError(true));
    }, [hash]);

    if (error)
        return (
            <div className="mx-auto max-w-2xl px-6 py-24 text-center">
                <p className="text-[15px] text-ink-2">{t("tx", "notFound")}</p>
                <p className="mt-2 font-mono text-[12px] break-all text-mute">{hash}</p>
            </div>
        );
    if (!trace) return <Spinner />;

    const id = trace.identity;
    const att = id?.attestation;
    const usedAccount =
        trace.delegation &&
        id &&
        trace.delegation.delegator.toLowerCase() !== id.principal.toLowerCase();

    let step = 0;
    const next = () => ++step;

    return (
        <div className="mx-auto max-w-3xl px-6 py-12">
            {/* ------------------------------- verdict ------------------------------- */}
            <div className="mb-10">
                <div className="flex flex-wrap items-center gap-3">
                    <StatusPill ok={trace.ok} label={trace.ok ? t("tx", "allowed") : t("tx", "rejected")} />
                    <ExtLink path={`/tx/${trace.hash}`}>
                        <Mono>{short(trace.hash, 10)} ↗</Mono>
                    </ExtLink>
                    {trace.batchSize > 1 && (
                        <Tag tone="bronze">
                            {lang === "ko"
                                ? `배치 ${trace.batchSize}건 · 원자적`
                                : `Batch of ${trace.batchSize} · atomic`}
                        </Tag>
                    )}
                </div>

                {trace.payment && (
                    <div className="tnum mt-4 text-[30px] font-semibold tracking-tight text-ink">
                        {fmtToken(trace.payment.token, trace.payment.amount)}
                        <span className="mx-3 text-[20px] text-mute">→</span>
                        <Mono className="!text-[16px] text-ink-2">{short(trace.payment.to, 8)}</Mono>
                    </div>
                )}

                {!trace.ok && trace.rejection && (
                    <div className="mt-5 rounded-xl border border-reject-dim bg-reject/[0.06] px-5 py-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-reject/80">
                            {t("tx", "whyRefused")}
                        </div>
                        <p className="mt-2 text-[15px] leading-relaxed text-ink">
                            {t("reject", classify(trace.rejection))}
                        </p>
                        <div className="mt-3 border-t border-reject-dim/50 pt-2.5">
                            <span className="text-[11.5px] text-mute">{t("tx", "rawSelector")}: </span>
                            <Mono className="text-[12px] break-all text-reject/90">
                                {trace.rejection}
                            </Mono>
                        </div>
                    </div>
                )}
            </div>

            {/* -------------------------------- the chain ---------------------------- */}
            <h2 className="mb-6 text-[12px] font-medium uppercase tracking-widest text-mute">
                {t("tx", "title")}
            </h2>

            <Step n={next()} title={t("tx", "payment")}>
                <Card className="px-4 py-1.5">
                    <Row k={t("tx", "redeemer")} v={<Mono>{short(trace.redeemer, 8)}</Mono>} />
                    <Row k={t("tx", "block")} v={<Mono>{trace.blockNumber.toString()}</Mono>} />
                </Card>
            </Step>

            {/* Every link. Showing only the root would hide a re-delegation's extra conditions;
                showing only the leaf would hide the root's limit, which is usually the binding
                one.

                The context is encoded leaf-first, but it is read root-first here, because that
                is the direction authority actually travels: a person grants, an agent passes part
                of it on. Numbering follows the same direction, so link 1 is always the origin. */}
            {trace.chain.length > 0 && (
                <Step n={next()} title={t("tx", "delegation")}>
                    <div className="space-y-3">
                        {[...trace.chain].reverse().map((link, i) => (
                            <Link key={i} link={link} index={i} total={trace.chain.length} />
                        ))}
                    </div>
                    <p className="mt-3 text-[12.5px] leading-relaxed text-mute">
                        {trace.chain.length > 1
                            ? t("tx", "everyLinkNote")
                            : lang === "ko"
                              ? "조건 전부를 통과해야 결제가 실행됩니다 — 조건은 위임자가 서명했고, 강제는 컨트랙트가 합니다."
                              : "Every condition must pass. The delegator signed them; the contract is what enforces them."}
                    </p>
                </Step>
            )}

            {usedAccount && trace.delegation && (
                <Step n={next()} title={t("tx", "account")}>
                    <Card className="px-4 py-1.5">
                        <Row
                            k="MapaeAccount"
                            v={<Mono>{short(trace.delegation.delegator, 8)}</Mono>}
                        />
                    </Card>
                    <div className="mt-2.5 space-y-1.5">
                        <Check ok={id?.accountRegistered ?? false}>
                            {lang === "ko"
                                ? "팩토리 등록 계정 — 소유자가 EIP-712로 결박에 동의했음"
                                : "Registered by the factory - the owner consented to the binding by EIP-712"}
                        </Check>
                        <Check
                            ok={
                                !!id?.accountOwner &&
                                id.accountOwner.toLowerCase() === id.principal.toLowerCase()
                            }
                        >
                            {lang === "ko"
                                ? "계정 소유자가 아래의 실명 주소와 일치"
                                : "The account's owner is the verified address below"}
                        </Check>
                    </div>
                </Step>
            )}

            {id && (
                <Step n={next()} title={t("tx", "principal")} last={!att}>
                    <Card className="px-4 py-1.5">
                        <Row k={t("tx", "principal")} v={<Mono>{short(id.principal, 8)}</Mono>} />
                        <Row
                            k={t("tx", "issuer")}
                            v={
                                <span className={issuerIsReal(id.attesterId) ? "text-bronze-bright" : undefined}>
                                    {issuerName(id.attesterId, lang)}
                                </span>
                            }
                        />
                        <Row
                            k={t("common", "status")}
                            v={
                                id.liveNow ? (
                                    <span className="text-jade">{t("tx", "liveNow")}</span>
                                ) : (
                                    <span className="text-reject">{t("tx", "revoked")}</span>
                                )
                            }
                        />
                    </Card>

                    {/* The tense distinction an auditor needs: what was true then, versus now. */}
                    {trace.ok && !id.liveNow && (
                        <p className="mt-2.5 text-[12.5px] leading-relaxed text-mute">
                            {lang === "ko"
                                ? "결제 시점에는 유효했습니다 — 게이트 통과 이벤트가 그 증거입니다. 이후 취소되었고, 위 상태는 지금 체인을 읽은 값입니다."
                                : "It was live at the moment of payment - the gate event is the proof. It has since been revoked, and the status above is read from the chain right now."}
                        </p>
                    )}
                    {!trace.ok && id.liveNow && trace.rejection?.startsWith("NotDojangVerified") && (
                        <p className="mt-2.5 text-[12.5px] leading-relaxed text-mute">
                            {lang === "ko"
                                ? "결제 시점에는 무효였습니다 — 위의 거부 사유가 그 증거입니다. 이후 재발급되어 현재는 유효합니다."
                                : "It was dead at the moment of payment - the refusal above is the proof. It has since been reissued and is live again."}
                        </p>
                    )}
                </Step>
            )}

            {att && id && (
                <Step n={next()} title={t("tx", "attestation")} last>
                    <Card className="px-4 py-1.5">
                        <Row k={t("tx", "uid")} v={<Mono>{short(att.uid, 10)}</Mono>} />
                        <Row k={lang === "ko" ? "발급" : "Issued"} v={fmtStamp(att.issuedAt, lang)} />
                        <Row
                            k={lang === "ko" ? "만료" : "Expires"}
                            v={att.expiresAt === 0 ? t("common", "never") : fmtStamp(att.expiresAt, lang)}
                        />
                        <Row
                            k={lang === "ko" ? "취소" : "Revoked"}
                            v={
                                att.revokedAt === 0 ? (
                                    <span className="text-jade">{lang === "ko" ? "아니오" : "No"}</span>
                                ) : (
                                    <span className="text-reject">{fmtStamp(att.revokedAt, lang)}</span>
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
                            {lang === "ko"
                                ? "발급자 결합 — 발급자 명부의 주소와 attestation 서명자가 일치"
                                : "Issuer binding - the attester matches the address in the issuer registry"}
                        </Check>
                        <Check ok={att.recipient.toLowerCase() === id.principal.toLowerCase()}>
                            {lang === "ko"
                                ? "수령인 결합 — attestation이 위 실명 주소 앞으로 발급됨"
                                : "Recipient binding - the attestation was issued to the address above"}
                        </Check>
                    </div>
                    <p className="mt-3 text-[12.5px] text-mute">
                        {lang === "ko"
                            ? "모든 결합은 신뢰가 아니라 검증입니다 — 이 페이지의 어떤 값도 저장된 데이터가 아닌 체인에서 지금 읽은 것입니다."
                            : "Every binding here is verified rather than trusted. Nothing on this page is stored data; all of it was read from the chain just now."}
                    </p>
                </Step>
            )}
        </div>
    );

    function Link({
        link,
        index,
        total,
    }: {
        link: DecodedDelegation;
        index: number;
        total: number;
    }) {
        const conditions = link.conditions.map((c) => renderCondition(c, t as never, lang));
        return (
            <Card className="px-4 py-3.5">
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                    <Tag tone={link.isRoot ? "bronze" : "mute"}>
                        {link.isRoot ? t("tx", "delegation") : t("tx", "redelegation")}
                    </Tag>
                    {total > 1 && (
                        <span className="text-[11.5px] text-mute">
                            {t("tx", "chainOf", {n: index + 1, total})} ·{" "}
                            {link.isRoot ? t("tx", "rootLink") : t("tx", "childLink")}
                        </span>
                    )}
                    <span className="ml-auto font-mono text-[11.5px] text-mute">
                        {short(link.delegator, 5)} → {short(link.delegate, 5)}
                    </span>
                </div>

                {conditions.length === 0 ? (
                    <p className="text-[12.5px] text-mute">
                        {lang === "ko" ? "조건 없음 — 무제한 위임" : "No conditions - unbounded"}
                    </p>
                ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                        {conditions.map((c, i) => (
                            <div
                                key={i}
                                className={`rounded-lg border bg-surface-2 px-3.5 py-3 ${
                                    c.kind === "identity" || c.kind === "humanloop"
                                        ? "border-bronze-dim/60"
                                        : "border-line-strong"
                                }`}
                            >
                                <div className="text-[12.5px] font-semibold text-ink">{c.title}</div>
                                {c.lines.map((l, j) => (
                                    <div
                                        key={j}
                                        className={
                                            j === 0
                                                ? "mt-1 text-[12.5px] text-ink-2"
                                                : "mt-0.5 text-[11.5px] leading-relaxed text-mute"
                                        }
                                    >
                                        {l}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </Card>
        );
    }
}

function fmtStamp(unix: number, lang: "en" | "ko"): string {
    return new Date(unix * 1000).toLocaleString(lang === "ko" ? "ko-KR" : "en-GB", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

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
