import {useEffect, useState, type ReactNode} from "react";
import {useParams} from "react-router-dom";
import type {Hex} from "viem";
import {traceTx, type DecodedDelegation, type Trace} from "../lib/data";
import {Card, Check, CopyButton, ExtLink, Mono, Spinner, StatusPill, Tag} from "../components/ui";
import {useLang} from "../i18n";
import {BLOCKSCOUT, short} from "../lib/config";
import {fmtToken, issuerIsReal, issuerName, renderCondition, tokenSymbol} from "../lib/policy";

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

    const rejectionKind: Kind | null = !trace.ok && trace.rejection ? classify(trace.rejection) : null;
    /** The signed condition the revert points at, when it points at one. This is what lets the
     *  trace mark the exact card that refused, instead of leaving the reader to map an error
     *  string onto a grid of conditions themselves. */
    const culprit: "identity" | "payee" | "period" | "window" | null =
        rejectionKind === "identity" ||
        rejectionKind === "payee" ||
        rejectionKind === "period" ||
        rejectionKind === "window"
            ? rejectionKind
            : null;

    let step = 0;
    const next = () => ++step;

    return (
        <div className="mx-auto max-w-3xl px-6 py-12">
            {/* ------------------------------- verdict ------------------------------- */}
            <div className="mb-10">
                <div className="flex flex-wrap items-center gap-3">
                    <StatusPill ok={trace.ok} label={trace.ok ? t("tx", "allowed") : t("tx", "rejected")} />
                    <span className="inline-flex items-center gap-1">
                        <ExtLink path={`/tx/${trace.hash}`}>
                            <Mono>{short(trace.hash, 10)} ↗</Mono>
                        </ExtLink>
                        <CopyButton
                            value={trace.hash}
                            label={t("tx", "copy")}
                            copiedLabel={t("tx", "copied")}
                        />
                    </span>
                    {trace.batchSize > 1 && (
                        <Tag tone="bronze">
                            {lang === "ko"
                                ? `배치 ${trace.batchSize}건 · 원자적`
                                : `Batch of ${trace.batchSize} · atomic`}
                        </Tag>
                    )}
                </div>

                {trace.payment && (
                    <div className="mt-5">
                        {/* Names the tense: a refused amount never moved, and the page must not
                            let a large figure imply that it did. */}
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">
                            {trace.ok ? t("tx", "settledAmount") : t("tx", "attempted")}
                        </div>
                        <div className="tnum mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span className="text-[32px] font-semibold tracking-tight text-ink">
                                {fmtToken(trace.payment.token, trace.payment.amount)}
                                <span className="ml-2 text-[15px] font-normal text-mute">
                                    {tokenSymbol(trace.payment.token)}
                                </span>
                            </span>
                            <span className="text-[18px] text-mute">→</span>
                            <span className="inline-flex items-center gap-1">
                                <Mono className="!text-[15px] text-ink-2">
                                    {short(trace.payment.to, 8)}
                                </Mono>
                                <CopyButton
                                    value={trace.payment.to}
                                    label={t("tx", "copy")}
                                    copiedLabel={t("tx", "copied")}
                                />
                            </span>
                        </div>
                    </div>
                )}

                {/* Overview strip: the four facts every explorer answers first, in one glance. */}
                <Card className="mt-6 grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
                    {/* Numeric, not locale prose: the Korean long form wraps to two lines and the
                        strip's whole point is four facts of equal weight on one line each. The
                        format is also identical in both languages, so switching cannot reflow it. */}
                    <Fact
                        k={t("common", "time")}
                        v={
                            <Mono className="!text-[12.5px]">
                                {trace.timestamp ? fmtStampShort(trace.timestamp) : "—"}
                            </Mono>
                        }
                    />
                    <Fact k={t("tx", "block")} v={<Mono className="!text-[12.5px]">{trace.blockNumber.toLocaleString()}</Mono>} />
                    <Fact
                        k={t("tx", "redeemer")}
                        v={
                            <span className="inline-flex items-center gap-0.5">
                                <Mono className="!text-[12.5px]">{short(trace.redeemer, 5)}</Mono>
                                <CopyButton
                                    value={trace.redeemer}
                                    label={t("tx", "copy")}
                                    copiedLabel={t("tx", "copied")}
                                />
                            </span>
                        }
                    />
                    <Fact
                        k={t("tx", "gasUsed")}
                        v={
                            <Mono className="!text-[12.5px]">
                                {trace.gasUsed !== undefined ? trace.gasUsed.toLocaleString() : "—"}
                            </Mono>
                        }
                    />
                </Card>

                {!trace.ok && trace.rejection && (
                    <div className="mt-5 overflow-hidden rounded-xl border border-reject-dim bg-reject/[0.06]">
                        <div className="px-5 py-4">
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-reject/80">
                                {t("tx", "whyRefused")}
                            </div>
                            <p className="mt-2 text-[15px] leading-relaxed text-ink">
                                {t("reject", classify(trace.rejection))}
                            </p>
                            {culprit && (
                                <p className="mt-1.5 text-[12.5px] leading-relaxed text-mute">
                                    {t("tx", "refusedPointer")}
                                </p>
                            )}
                        </div>
                        <div className="border-t border-reject-dim/50 bg-reject/[0.04] px-5 py-2.5">
                            <span className="text-[11.5px] text-mute">{t("tx", "rawSelector")} </span>
                            <Mono className="text-[12px] break-all text-reject/90">
                                {trace.rejection}
                            </Mono>
                            <CopyButton
                                value={trace.rejection}
                                label={t("tx", "copy")}
                                copiedLabel={t("tx", "copied")}
                                className="ml-1"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* -------------------------------- the chain ---------------------------- */}
            <div className="mb-7">
                <h2 className="text-[12px] font-medium uppercase tracking-widest text-mute">
                    {t("tx", "title")}
                </h2>
                <p className="mt-1.5 text-[12.5px] text-mute">{t("tx", "traceDirection")}</p>
            </div>

            <Step n={next()} title={t("tx", "payment")} question={t("tx", "q1")}>
                <Card className="px-4 py-1.5">
                    {trace.payment ? (
                        <>
                            <Row
                                k={t("tx", "execution")}
                                v={<Mono>ERC-20 transfer</Mono>}
                            />
                            <Row
                                k={t("tx", "token")}
                                v={
                                    <span className="inline-flex items-center gap-1">
                                        <span>{tokenSymbol(trace.payment.token)}</span>
                                        <Mono className="text-mute">{short(trace.payment.token, 5)}</Mono>
                                        <CopyButton
                                            value={trace.payment.token}
                                            label={t("tx", "copy")}
                                            copiedLabel={t("tx", "copied")}
                                        />
                                    </span>
                                }
                            />
                            <Row
                                k={t("tx", "recipient")}
                                v={
                                    <span className="inline-flex items-center gap-1">
                                        <Mono>{short(trace.payment.to, 8)}</Mono>
                                        <CopyButton
                                            value={trace.payment.to}
                                            label={t("tx", "copy")}
                                            copiedLabel={t("tx", "copied")}
                                        />
                                    </span>
                                }
                            />
                            <Row
                                k={t("common", "amount")}
                                v={
                                    <span className="tnum">
                                        {fmtToken(trace.payment.token, trace.payment.amount, true)}
                                    </span>
                                }
                            />
                        </>
                    ) : (
                        <>
                            <Row k={t("tx", "redeemer")} v={<Mono>{short(trace.redeemer, 8)}</Mono>} />
                            <Row k={t("tx", "block")} v={<Mono>{trace.blockNumber.toString()}</Mono>} />
                        </>
                    )}
                </Card>
            </Step>

            {/* Every link. Showing only the root would hide a re-delegation's extra conditions;
                showing only the leaf would hide the root's limit, which is usually the binding
                one.

                The context is encoded leaf-first, but it is read root-first here, because that
                is the direction authority actually travels: a person grants, an agent passes part
                of it on. Numbering follows the same direction, so link 1 is always the origin. */}
            {trace.chain.length > 0 && (
                <Step n={next()} title={t("tx", "delegation")} question={t("tx", "q2")}>
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
                <Step n={next()} title={t("tx", "account")} question={t("tx", "q3")}>
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
                <Step n={next()} title={t("tx", "principal")} question={t("tx", "q4")} last={!att}>
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
                <Step n={next()} title={t("tx", "attestation")} question={t("tx", "q5")} last>
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
        const conditions = link.conditions.map((c, i) => ({
            ...renderCondition(c, t as never, lang),
            enforcer: link.raw[i]?.enforcer,
        }));
        const linkDisabled = rejectionKind === "disabled" && link.isRoot;
        return (
            <Card className="overflow-hidden">
                {/* Who granted to whom, labelled - two bare truncated addresses with an arrow
                    made every reader work out which side was which. */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface-2/50 px-4 py-2.5">
                    <Tag tone={link.isRoot ? "bronze" : "mute"}>
                        {link.isRoot ? t("tx", "delegation") : t("tx", "redelegation")}
                    </Tag>
                    {total > 1 && (
                        <span className="text-[11.5px] text-mute">
                            {t("tx", "chainOf", {n: index + 1, total})} ·{" "}
                            {link.isRoot ? t("tx", "rootLink") : t("tx", "childLink")}
                        </span>
                    )}
                    {linkDisabled && (
                        <span className="rounded border border-reject-dim bg-reject/10 px-1.5 py-px text-[10.5px] font-medium text-reject">
                            {t("tx", "linkDisabled")}
                        </span>
                    )}
                    <span className="ml-auto flex items-center gap-2 text-[11px]">
                        <span className="text-mute">{t("tx", "delegator")}</span>
                        <span className="inline-flex items-center">
                            <Mono className="!text-[11.5px] text-ink-2">{short(link.delegator, 5)}</Mono>
                            <CopyButton
                                value={link.delegator}
                                label={t("tx", "copy")}
                                copiedLabel={t("tx", "copied")}
                            />
                        </span>
                        <span className="text-mute">→</span>
                        <span className="text-mute">{t("tx", "delegate")}</span>
                        <span className="inline-flex items-center">
                            <Mono className="!text-[11.5px] text-ink-2">{short(link.delegate, 5)}</Mono>
                            <CopyButton
                                value={link.delegate}
                                label={t("tx", "copy")}
                                copiedLabel={t("tx", "copied")}
                            />
                        </span>
                    </span>
                </div>

                <div className="px-4 py-3.5">
                    {conditions.length === 0 ? (
                        <p className="text-[12.5px] text-mute">
                            {lang === "ko" ? "조건 없음 — 무제한 위임" : "No conditions - unbounded"}
                        </p>
                    ) : (
                        <>
                            <div className="grid items-stretch gap-2 sm:grid-cols-2">
                                {conditions.map((c, i) => {
                                    const refused = culprit !== null && c.kind === culprit;
                                    const headline =
                                        !refused && (c.kind === "identity" || c.kind === "humanloop");
                                    return (
                                        /* h-full + mt-auto footer: every card in a row is the
                                           same height and every enforcer line sits on the same
                                           bottom edge, whatever the prose above it did. */
                                        <div
                                            key={i}
                                            className={`flex h-full flex-col rounded-lg border px-3.5 py-3 ${
                                                refused
                                                    ? "border-reject bg-reject/[0.08]"
                                                    : headline
                                                      ? "border-bronze-dim bg-bronze/[0.07]"
                                                      : "border-line-strong bg-surface-2"
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <span
                                                    className={`text-[12.5px] font-semibold ${
                                                        refused
                                                            ? "text-reject"
                                                            : headline
                                                              ? "text-bronze-bright"
                                                              : "text-ink"
                                                    }`}
                                                >
                                                    {c.title}
                                                </span>
                                                {refused ? (
                                                    <span className="shrink-0 rounded border border-reject-dim bg-reject/10 px-1.5 py-px text-[10px] font-medium text-reject">
                                                        {t("tx", "refusedBy")}
                                                    </span>
                                                ) : headline ? (
                                                    <span className="shrink-0 rounded border border-bronze-dim px-1.5 py-px text-[10px] text-bronze">
                                                        {t("tx", "contribution")}
                                                    </span>
                                                ) : null}
                                            </div>
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
                                            {c.enforcer && (
                                                <div className="mt-auto flex items-center gap-1 pt-2.5">
                                                    <div className="flex w-full items-center gap-1 border-t border-line pt-2 text-[10.5px] text-mute">
                                                        <span className="shrink-0">
                                                            {t("tx", "enforcedBy")}
                                                        </span>
                                                        <a
                                                            href={`${BLOCKSCOUT}/address/${c.enforcer}`}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="truncate font-mono transition-colors hover:text-bronze-bright"
                                                        >
                                                            {short(c.enforcer, 6)} ↗
                                                        </a>
                                                        <CopyButton
                                                            value={c.enforcer}
                                                            label={t("tx", "copy")}
                                                            copiedLabel={t("tx", "copied")}
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            <p className="mt-2.5 text-[11.5px] leading-relaxed text-mute">
                                {t("tx", "enforcedNote")}
                            </p>
                        </>
                    )}
                </div>
            </Card>
        );
    }
}

/** One cell of the overview strip. */
function Fact({k, v}: {k: string; v: ReactNode}) {
    return (
        <div className="px-4 py-3">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] whitespace-nowrap text-mute">
                {k}
            </div>
            <div className="tnum mt-1 text-[13px] whitespace-nowrap text-ink-2">{v}</div>
        </div>
    );
}

function fmtStampShort(unix: number): string {
    const d = new Date(unix * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
    question,
    children,
    last = false,
}: {
    n: number;
    title: string;
    /** What this step answers. The sequence is a traceback, which is not obvious from headings
     *  alone - naming the question makes the direction legible at a glance. */
    question?: string;
    children: ReactNode;
    last?: boolean;
}) {
    return (
        <div className="relative pl-12">
            {!last && <div className="absolute top-10 bottom-0 left-[15px] w-px bg-line" />}
            <div className="absolute top-1 left-0 flex h-8 w-8 items-center justify-center rounded-full border border-bronze-dim bg-surface font-serif text-[14px] font-bold text-bronze">
                {n}
            </div>
            <div className="pb-9">
                <div className="mb-3 pt-1">
                    <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
                    {question && <p className="mt-0.5 text-[12.5px] text-mute">{question}</p>}
                </div>
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
