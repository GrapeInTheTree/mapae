import {useEffect, useState} from "react";
import {Link, useNavigate} from "react-router-dom";
import {
    fetchDelegationList,
    fetchFeed,
    fetchStats,
    type DelegationSummary,
    type FeedItem,
    type Stats as StatsData,
} from "../lib/data";
import {Card, Mono, StatusPill, relTime} from "../components/ui";
import {AuthorityFlow} from "../components/AuthorityFlow";
import {Stats} from "../components/Stats";
import {useLang} from "../i18n";
import {addresses, BLOCKSCOUT, short} from "../lib/config";
import {fmtDuration, fmtToken} from "../lib/policy";
import * as store from "../lib/store";

/** Real transactions from the live demo. Each one opens the page that explains the system, and
 *  two of the three are refusals - what got stopped is half the point of the ledger. */
const EXAMPLES = [
    {
        hash: "0xa01e6e8696d4fe4d505c8636ed1f09a0a0da3d4dcf01bd045f0046d99757e568",
        en: "Allowed payment",
        ko: "승인된 결제",
    },
    {
        hash: "0xd3843e1f73178b78942fe5ebaeb1ac30611f7734786b7e4640098e5e1749ed65",
        en: "Refused: identity revoked",
        ko: "신원 취소로 거부",
    },
    {
        hash: "0x131e97448767531427849ff9d716702481a6a7de3cc5d5e2026182028daee1cd",
        en: "Refused: payee not allowed",
        ko: "허용 외 수취인 거부",
    },
];

export default function Home() {
    const {t, lang} = useLang();
    const nav = useNavigate();
    const [q, setQ] = useState("");
    const [stats, setStats] = useState<StatsData | null>(null);
    const [feed, setFeed] = useState<FeedItem[] | null>(null);
    const [feedError, setFeedError] = useState(false);
    const [dlist, setDlist] = useState<DelegationSummary[] | null>(null);

    useEffect(() => {
        fetchStats().then(setStats).catch(() => {});
        fetchFeed()
            .then(setFeed)
            .catch(() => setFeedError(true));
        fetchDelegationList().then(setDlist).catch(() => {});
    }, []);

    const go = () => {
        const h = q.trim();
        if (/^0x[0-9a-fA-F]{64}$/.test(h)) nav(`/tx/${h}`);
    };

    return (
        <div>
            {/* --------------------------------- hero --------------------------------- */}
            {/* Centred, with the search running the full width of the column.
                A ledger is a place you arrive at with something to look up, so the field is the
                widest element on the page rather than a control tucked into a corner. */}
            <section className="mx-auto max-w-4xl px-6 pt-20 pb-12 text-center">
                <p className="caps text-[11.5px] font-semibold text-bronze">
                    {t("home", "eyebrow")}
                </p>
                <h1 className="display mt-4 text-[46px] text-ink sm:text-[58px]">
                    {t("home", "title")}
                    <span className="text-bronze">.</span>
                </h1>
                <p className="mx-auto mt-5 max-w-2xl text-[15.5px] leading-relaxed text-ink-2">
                    {t("home", "lede")}
                </p>

                <div className="mt-9 flex items-center rounded-xl border border-line-strong bg-surface p-1.5 transition-colors focus-within:border-bronze-dim">
                    <svg width="18" height="18" viewBox="0 0 18 18" className="ml-3.5 shrink-0">
                        <circle cx="8" cy="8" r="5.5" fill="none" stroke="var(--color-mute)" strokeWidth="1.6" />
                        <path d="M12.2 12.2L16 16" stroke="var(--color-mute)" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && go()}
                        placeholder={t("home", "search")}
                        spellCheck={false}
                        className="w-full bg-transparent px-3.5 py-3 text-left font-mono text-[13.5px] text-ink placeholder:font-sans placeholder:text-mute focus:outline-none"
                    />
                    <button
                        onClick={go}
                        className="shrink-0 rounded-lg bg-bronze-solid px-5 py-3 text-[14px] font-medium text-paper transition-colors hover:bg-bronze-solid-2"
                    >
                        {lang === "ko" ? "추적" : "Trace"}
                    </button>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <span className="text-[12.5px] text-mute">
                        {lang === "ko" ? "라이브 예시" : "Live examples"}
                    </span>
                    {EXAMPLES.map((e) => (
                        <button
                            key={e.hash}
                            onClick={() => nav(`/tx/${e.hash}`)}
                            className="rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-ink-2 transition-colors hover:border-bronze-dim hover:text-bronze-bright"
                        >
                            {lang === "ko" ? e.ko : e.en}
                        </button>
                    ))}
                </div>
            </section>

            {/* --------------------------------- stats --------------------------------- */}
            <section className="mx-auto max-w-6xl px-6">
                <Stats stats={stats} />
            </section>

            {/* ---------------------------- the authority chain ------------------------ */}
            <section className="mx-auto mt-12 max-w-6xl px-6">
                <AuthorityFlow />
            </section>

            {/* ------------------------- the ledger, two columns ------------------------ */}
            {/* Beryx-style: the two core objects side by side. The left column is the AUTHORITY
                view (what exists, in what state, how much of it is spent); the right is the EVENT
                view (what just happened to it). The old layout led with events, which is the less
                interesting half - an event only means something in terms of the authority it hit. */}
            <section className="mx-auto max-w-6xl px-6 py-12">
                {/* items-stretch + flex columns: the two cards are always exactly the same
                    height, whatever their row counts. Inside the left card the rows share the
                    surplus (each is flex-1), so two Mapae get generous rows instead of a card
                    with a hole in it; both cards pin an informative footer to the bottom edge. */}
                <div className="grid items-stretch gap-6 lg:grid-cols-2">
                    <div className="flex flex-col">
                        <div className="mb-3 flex items-baseline justify-between gap-4">
                            <h2 className="text-[17px] font-semibold text-ink">
                                {t("dlist", "title")}
                            </h2>
                            <Link
                                to="/delegations"
                                className="text-[12.5px] text-mute transition-colors hover:text-bronze-bright"
                            >
                                {t("home", "viewAll")} →
                            </Link>
                        </div>
                        <Card className="flex flex-1 flex-col overflow-hidden">
                            {dlist === null ? (
                                <div className="flex flex-1 items-center justify-center px-5 py-10 text-[13.5px] text-mute">
                                    {t("common", "loading")}
                                </div>
                            ) : dlist.length === 0 ? (
                                <div className="flex flex-1 items-center justify-center px-5 py-10 text-[13.5px] text-mute">
                                    {t("dlist", "empty")}
                                </div>
                            ) : (
                                <div className="flex flex-1 flex-col divide-y divide-line/60">
                                    {dlist.slice(0, 5).map((d) => (
                                        <DelegationMini key={d.hash} d={d} />
                                    ))}
                                </div>
                            )}
                            <div className="border-t border-line bg-surface-2/40 px-5 py-2.5">
                                <p className="text-[11.5px] leading-relaxed text-mute">
                                    {t("dlist", "boundaryShort")}
                                </p>
                            </div>
                        </Card>
                    </div>

                    <div className="flex flex-col">
                        <div className="mb-3 flex items-baseline justify-between gap-4">
                            <h2 className="text-[17px] font-semibold text-ink">
                                {t("home", "ledger")}
                            </h2>
                            <span className="hidden text-[12.5px] text-mute sm:inline">
                                {lang === "ko"
                                    ? "거부도 기록입니다 — 그게 이 원장의 절반입니다"
                                    : "Refusals are records too - half of this ledger"}
                            </span>
                        </div>
                        <Card className="flex flex-1 flex-col overflow-hidden">
                            {feedError ? (
                                <div className="flex flex-1 flex-col items-center justify-center px-5 py-10 text-center">
                                    <p className="text-[13.5px] text-ink-2">{t("common", "error")}</p>
                                    <p className="mt-1 text-[12.5px] text-mute">
                                        {t("common", "errorHint")}
                                    </p>
                                </div>
                            ) : feed === null ? (
                                <div className="flex flex-1 items-center justify-center px-5 py-10 text-[13.5px] text-mute">
                                    {t("common", "loading")}
                                </div>
                            ) : feed.length === 0 ? (
                                <div className="flex flex-1 items-center justify-center px-5 py-10 text-[13.5px] text-mute">
                                    {t("home", "empty")}
                                </div>
                            ) : (
                                <div className="flex flex-1 flex-col divide-y divide-line/60">
                                    {/* The whole row is the target - a 120px hash on a full-width
                                        row is a miss waiting to happen. */}
                                    {feed.slice(0, 8).map((f) => (
                                        <Link
                                            key={f.hash}
                                            to={`/tx/${f.hash}`}
                                            className="group flex flex-1 items-center gap-4 px-5 py-2.5 transition-colors hover:bg-surface-2/60"
                                        >
                                            <StatusPill
                                                ok={f.ok}
                                                label={f.ok ? t("tx", "allowed") : t("tx", "rejected")}
                                            />
                                            <Mono className="text-bronze-bright group-hover:underline">
                                                {short(f.hash, 8)}
                                            </Mono>
                                            <span className="ml-auto inline-flex items-center gap-2 text-[12.5px] text-mute">
                                                {relTime(f.timestamp, lang)}
                                                <svg
                                                    width="12"
                                                    height="12"
                                                    viewBox="0 0 16 16"
                                                    className="opacity-0 transition-opacity group-hover:opacity-60"
                                                >
                                                    <path
                                                        d="M6 4l4 4-4 4"
                                                        stroke="currentColor"
                                                        strokeWidth="1.7"
                                                        fill="none"
                                                        strokeLinecap="round"
                                                    />
                                                </svg>
                                            </span>
                                        </Link>
                                    ))}
                                </div>
                            )}
                            <div className="border-t border-line bg-surface-2/40 px-5 py-2.5 text-right">
                                <a
                                    href={`${BLOCKSCOUT}/address/${addresses.manager}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[11.5px] text-mute transition-colors hover:text-bronze-bright"
                                >
                                    {t("dlist", "feedSource")} ↗
                                </a>
                            </div>
                        </Card>
                    </div>
                </div>

                <div className="mt-8 text-center">
                    <Link
                        to="/create"
                        className="inline-flex items-center gap-2 rounded-lg bg-bronze-solid px-5 py-3 text-[14.5px] font-medium text-paper transition-colors hover:bg-bronze-solid-2"
                    >
                        {t("nav", "create")} →
                    </Link>
                    <p className="mt-3 text-[13px] text-mute">{t("brand", "pitch")}</p>
                </div>
            </section>
        </div>
    );
}

/**
 * One authority, one row: state, cap, how much of it is gone, when it last moved. Clicking lands
 * on the full catalogue - the row is a summary, not a page of its own.
 *
 * Everything right of the address sits in fixed-width, right-aligned columns, so 승인/거부/시각
 * line up down the card instead of drifting with each row's digit count. The row itself is
 * flex-1: when there are only two Mapae the rows share the card's height and breathe, rather
 * than huddling at the top of a half-empty box.
 */
function DelegationMini({d}: {d: DelegationSummary}) {
    const {t, lang} = useLang();
    const mine = store.get(d.hash);
    const window = d.conditions.find((c) => c.kind === "window");
    const period = d.conditions.find((c) => c.kind === "period");
    const expired =
        window?.kind === "window" &&
        window.until > 0n &&
        window.until < BigInt(Math.floor(Date.now() / 1000));
    const dead = d.disabled || d.identityLive === false || expired;

    const spent = d.available != null && d.periodCap != null ? d.periodCap - d.available : null;
    const pct =
        spent != null && d.periodCap && d.periodCap > 0n
            ? Number((spent * 100n) / d.periodCap)
            : 0;

    return (
        <Link
            to="/delegations"
            className="group flex flex-1 flex-col justify-center px-5 py-3 transition-colors hover:bg-surface-2/60"
        >
            <div className="flex items-center gap-2.5">
                <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${dead ? "bg-reject" : "bg-jade"}`}
                />
                {mine ? (
                    <span className="min-w-0 truncate text-[13px] font-medium text-ink">
                        {mine.agentName}
                    </span>
                ) : (
                    <Mono className="min-w-0 truncate !text-[12px] text-ink-2">
                        {short(d.delegator, 4)} → {short(d.delegate, 4)}
                    </Mono>
                )}
                <span className="ml-auto flex shrink-0 items-center text-[12px]">
                    <span className="tnum hidden w-[6.8rem] text-right text-mute md:inline-block">
                        {period?.kind === "period"
                            ? `${fmtToken(period.token, period.amount)}/${fmtDuration(period.duration, lang)}`
                            : ""}
                    </span>
                    <span className="tnum w-[4.4rem] text-right text-jade">
                        {t("dlist", "settledN", {n: d.settled})}
                    </span>
                    <span className="tnum w-[4.4rem] text-right text-reject">
                        {t("dlist", "refusedN", {n: d.refused})}
                    </span>
                    {/* xl-only: below that, this column's 5rem is worth more to the address on
                        the left, which was truncating to nothing. */}
                    <span className="tnum hidden w-[5.2rem] text-right text-mute xl:inline-block">
                        {relTime(d.lastUsed, lang)}
                    </span>
                    <svg
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        className="ml-1.5 opacity-0 transition-opacity group-hover:opacity-60"
                    >
                        <path
                            d="M6 4l4 4-4 4"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            fill="none"
                            strokeLinecap="round"
                        />
                    </svg>
                </span>
            </div>
            {spent != null && (
                <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-surface-2">
                    <div
                        className={`h-full rounded-full ${dead ? "bg-reject/50" : "bg-bronze"}`}
                        style={{width: `${Math.min(100, Math.max(0, pct))}%`}}
                    />
                </div>
            )}
        </Link>
    );
}


