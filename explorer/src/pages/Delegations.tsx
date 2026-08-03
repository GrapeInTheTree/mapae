import {useEffect, useState} from "react";
import {Link, useSearchParams} from "react-router-dom";
import type {Hex} from "viem";
import {fetchDelegationList, type DelegationSummary} from "../lib/data";
import {Card, CopyButton, Mono, Pagination, Spinner, StatusPill, Tag, relTime} from "../components/ui";
import {useLang} from "../i18n";
import {short} from "../lib/config";
import {fmtDuration, fmtToken, issuerName, type Condition} from "../lib/policy";
import * as store from "../lib/store";

/**
 * The delegation catalogue.
 *
 * The boundary this page sits on IS the product's design: issuing a Mapae is a free, traceless
 * signature, so an unused one exists only in its issuer's browser - and the moment one is used,
 * every attempt against it becomes permanent, refusals included. The page states that boundary
 * out loud rather than papering over it, because "your unused grants are invisible" is a feature
 * a judge should notice, not a gap they should discover.
 *
 * Everything here is reconstructed from redemption calldata plus live reads. No registry, no
 * server, no stored copy - which is the claim the whole system makes about itself.
 */

const PER_PAGE = 8;

export default function Delegations() {
    const {t, lang} = useLang();
    const [list, setList] = useState<DelegationSummary[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [page, setPage] = useState(1);
    const [params, setParams] = useSearchParams();

    useEffect(() => {
        fetchDelegationList()
            .then(setList)
            .catch(() => setFailed(true));
    }, []);

    /** The home search hands addresses here as ?q=. An authority "touches" an address as its
     *  payer, its agent, or an allowed payee - all three are worth finding by, plus the
     *  delegation hash itself. */
    const q = (params.get("q") ?? "").trim().toLowerCase();
    const shown =
        list === null || q === ""
            ? list
            : list.filter(
                  (d) =>
                      d.delegator.toLowerCase().includes(q) ||
                      d.delegate.toLowerCase().includes(q) ||
                      d.hash.toLowerCase().includes(q) ||
                      d.conditions.some(
                          (c) =>
                              c.kind === "payee" &&
                              c.payees.some((p) => p.toLowerCase().includes(q)),
                      ),
              );

    return (
        <div className="mx-auto max-w-4xl px-6 py-10">
            <header className="mb-6">
                <h1 className="display text-[38px] text-ink">{t("dlist", "title")}</h1>
                <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-mute">
                    {t("dlist", "lede")}
                </p>
            </header>

            {/* The off-chain/on-chain boundary, stated where the list begins. */}
            <div className="mb-6 rounded-xl border border-line bg-surface px-5 py-3.5">
                <p className="text-[12.5px] leading-relaxed text-mute">{t("dlist", "boundary")}</p>
            </div>

            {q !== "" && (
                <div className="mb-4 flex flex-wrap items-center gap-2.5">
                    <span className="inline-flex items-center gap-2 rounded-lg border border-bronze-dim bg-bronze/8 px-3 py-1.5">
                        <span className="text-[11px] text-mute">
                            {lang === "ko" ? "이 주소가 닿는 마패" : "Authorities touching"}
                        </span>
                        <span className="font-mono text-[12px] text-bronze-bright">
                            {q.slice(0, 10)}…{q.slice(-4)}
                        </span>
                    </span>
                    {shown && (
                        <span className="text-[12px] text-mute">
                            {lang === "ko" ? `${shown.length}건` : `${shown.length} found`}
                        </span>
                    )}
                    <button
                        onClick={() => setParams({})}
                        className="text-[12px] text-mute underline-offset-4 transition-colors hover:text-ink-2 hover:underline"
                    >
                        {lang === "ko" ? "필터 지우기" : "Clear"}
                    </button>
                </div>
            )}

            {failed ? (
                <div className="rounded-2xl border border-line px-8 py-14 text-center">
                    <p className="text-[14px] text-ink-2">{t("dlist", "loadFail")}</p>
                    <p className="mt-1.5 text-[12.5px] text-mute">{t("common", "errorHint")}</p>
                </div>
            ) : shown === null ? (
                <Spinner />
            ) : shown.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line-strong px-8 py-14 text-center text-[14px] text-mute">
                    {q === ""
                        ? t("dlist", "empty")
                        : lang === "ko"
                          ? "이 주소가 닿는 마패가 아직 체인에 없습니다."
                          : "No on-chain authority touches this address yet."}
                </div>
            ) : (
                <>
                    <div className="space-y-3">
                        {shown.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((d) => (
                            <Row key={d.hash} d={d} />
                        ))}
                    </div>
                    <Pagination
                        page={page}
                        pages={Math.ceil(shown.length / PER_PAGE)}
                        onPage={(p) => {
                            setPage(p);
                            window.scrollTo({top: 0});
                        }}
                    />
                </>
            )}
        </div>
    );

    function Row({d}: {d: DelegationSummary}) {
        const mine = store.get(d.hash);
        const window = d.conditions.find((c) => c.kind === "window");
        const expired =
            window?.kind === "window" &&
            window.until > 0n &&
            window.until < BigInt(Math.floor(Date.now() / 1000));

        // Disabled and expired are states of the delegation; a dead Dojang is a state of the
        // PERSON that happens to kill the delegation too - it gets its own wording.
        const status = d.disabled
            ? {ok: false, label: t("permissions", "disabled")}
            : d.identityLive === false
              ? {ok: false, label: t("dlist", "identityDead")}
              : expired
                ? {ok: false, label: t("permissions", "expired")}
                : {ok: true, label: t("permissions", "active")};

        const spent =
            d.available != null && d.periodCap != null ? d.periodCap - d.available : null;
        const pct =
            spent != null && d.periodCap && d.periodCap > 0n
                ? Number((spent * 100n) / d.periodCap)
                : 0;
        const period = d.conditions.find((c) => c.kind === "period");

        return (
            <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4">
                    <StatusPill ok={status.ok} label={status.label} />
                    {mine && (
                        <span className="flex items-center gap-2">
                            <span className="text-[13.5px] font-medium text-ink">
                                {mine.agentName}
                            </span>
                            <Tag tone="bronze">{t("dlist", "mine")}</Tag>
                        </span>
                    )}
                    {d.chainLength > 1 && (
                        <Tag>{t("dlist", "chainOf", {n: d.chainLength})}</Tag>
                    )}
                    {/* Wraps between the two label+address pairs, never inside an address - a hash
                        broken mid-glyph reads as two different values. */}
                    <span className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-mute">
                        <span className="inline-flex items-center gap-2 whitespace-nowrap">
                            <span>{t("tx", "delegator")}</span>
                            <Mono className="!text-[11.5px] text-ink-2">{short(d.delegator, 4)}</Mono>
                            <CopyButton
                                value={d.delegator}
                                label={t("tx", "copy")}
                                copiedLabel={t("tx", "copied")}
                            />
                        </span>
                        <span>→</span>
                        <span className="inline-flex items-center gap-2 whitespace-nowrap">
                            <span>{t("tx", "delegate")}</span>
                            <Mono className="!text-[11.5px] text-ink-2">{short(d.delegate, 4)}</Mono>
                            <CopyButton
                                value={d.delegate}
                                label={t("tx", "copy")}
                                copiedLabel={t("tx", "copied")}
                            />
                        </span>
                    </span>
                </div>

                {/* What was signed, as compact terms - the full sentences live one click away in
                    any of its transactions. */}
                <div className="mt-3 flex flex-wrap gap-1.5 px-5">
                    {d.conditions.map((c, i) => (
                        <span
                            key={i}
                            className={`tnum rounded-md border px-2 py-0.5 text-[11.5px] ${
                                c.kind === "identity"
                                    ? "border-bronze-dim/70 text-bronze-bright"
                                    : "border-line text-ink-2"
                            }`}
                        >
                            {chip(c)}
                        </span>
                    ))}
                </div>

                {period?.kind === "period" && spent != null && (
                    <div className="mt-3.5 px-5">
                        <div className="flex items-baseline justify-between text-[12px]">
                            <span className="text-mute">
                                {t("permissions", "spent")}{" "}
                                <span className="tnum text-ink-2">
                                    {fmtToken(period.token, spent)}
                                </span>
                            </span>
                            <span className="tnum text-mute">
                                {fmtToken(period.token, period.amount)}
                            </span>
                        </div>
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
                            <div
                                className="h-full rounded-full bg-bronze"
                                style={{width: `${Math.min(100, Math.max(0, pct))}%`}}
                            />
                        </div>
                    </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-surface-2/40 px-5 py-2.5">
                    <span className="text-[12px] text-mute">
                        <span className="tnum text-ink-2">{d.txs.length}</span>
                        {lang === "ko" ? t("dlist", "uses") : ` ${t("dlist", "uses")}`}
                        {" · "}
                        <span className="text-jade">{t("dlist", "settledN", {n: d.settled})}</span>
                        {" · "}
                        <span className="text-reject">{t("dlist", "refusedN", {n: d.refused})}</span>
                    </span>
                    <span className="text-[12px] text-mute">
                        {t("dlist", "lastUsed")} {relTime(d.lastUsed, lang)}
                    </span>
                    <span className="flex items-center gap-1.5">
                        {/* Named, so the pills read as destinations rather than as more tags. */}
                        <span className="text-[11px] text-mute">{t("dlist", "recent")}</span>
                        {d.txs.slice(0, 3).map((x) => (
                            <TxPill key={x.hash} hash={x.hash} ok={x.ok} />
                        ))}
                        {d.txs.length > 3 && (
                            <span className="text-[11px] text-mute">+{d.txs.length - 3}</span>
                        )}
                    </span>
                    {/* The hash IS the Mapae, so it is also the way into it. Kept as a link
                        rather than making the whole card clickable: the card already holds copy
                        buttons and transaction links, and nesting those inside a link breaks
                        both. */}
                    <span className="ml-auto flex items-center gap-0.5">
                        <Link
                            to={`/delegation/${d.hash}`}
                            className="group inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-surface-2"
                        >
                            <Mono className="!text-[11px] text-mute transition-colors group-hover:text-ink-2">
                                {short(d.hash, 6)}
                            </Mono>
                            <svg width="10" height="10" viewBox="0 0 16 16" className="text-mute transition-colors group-hover:text-bronze-bright" aria-hidden="true">
                                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                            </svg>
                        </Link>
                        <CopyButton
                            value={d.hash}
                            label={t("tx", "copy")}
                            copiedLabel={t("tx", "copied")}
                        />
                    </span>
                </div>
            </Card>
        );
    }

    /** One signed condition as a scannable term. */
    function chip(c: Condition): string {
        switch (c.kind) {
            case "identity":
                return issuerName(c.attesterId, lang);
            case "period":
                return `${fmtToken(c.token, c.amount)}/${fmtDuration(c.duration, lang)}`;
            case "payee":
                return `→ ${c.payees.map((p) => short(p, 4)).join(", ")}`;
            case "window":
                return c.until > 0n
                    ? `~ ${compactDate(c.until)}`
                    : t("common", "never");
            case "humanloop":
                return t("policy", "humanloop");
            case "unknown":
                return short(c.enforcer, 4);
        }
    }
}

/** Same numeric form in both languages, like the Tx overview strip. */
function compactDate(unix: bigint): string {
    const d = new Date(Number(unix) * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** A destination, and dressed as one: the chevron is what separates "this goes somewhere" from
 *  the condition chips above, which are the same size and also bordered. */
function TxPill({hash, ok}: {hash: Hex; ok: boolean}) {
    return (
        <Link
            to={`/tx/${hash}`}
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] transition-colors ${
                ok
                    ? "border-jade-dim/60 text-jade hover:bg-jade/10"
                    : "border-reject-dim/60 text-reject hover:bg-reject/10"
            }`}
        >
            {short(hash, 4)}
            <svg width="9" height="9" viewBox="0 0 16 16" className="opacity-60">
                <path
                    d="M6 4l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                    strokeLinecap="round"
                />
            </svg>
        </Link>
    );
}
