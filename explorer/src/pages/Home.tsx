import {useEffect, useState} from "react";
import {Link, useNavigate} from "react-router-dom";
import {fetchFeed, fetchStats, type FeedItem, type Stats} from "../lib/data";
import {Card, Mono, StatusPill, TxLink, relTime} from "../components/ui";
import {useLang} from "../i18n";
import {short} from "../lib/config";

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
    const [stats, setStats] = useState<Stats | null>(null);
    const [feed, setFeed] = useState<FeedItem[] | null>(null);
    const [feedError, setFeedError] = useState(false);

    useEffect(() => {
        fetchStats().then(setStats).catch(() => {});
        fetchFeed()
            .then(setFeed)
            .catch(() => setFeedError(true));
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
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-bronze">
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
                <Card className="divide-y divide-line sm:grid sm:grid-cols-4 sm:divide-x sm:divide-y-0">
                    <Stat label={t("home", "statActive")} value={stats?.delegations} />
                    <Stat label={t("home", "statSettled")} value={stats?.redemptions} tone="jade" />
                    <Stat label={t("home", "statBlocked")} value={stats?.rejections} tone="reject" />
                    <Stat label={t("home", "statPrincipals")} value={stats?.principals} />
                </Card>
                {stats && (
                    <p className="mt-2.5 text-right text-[11.5px] text-mute">
                        {lang === "ko"
                            ? `빌드 시점 체크포인트 + 이후 ${stats.deltaBlocks.toLocaleString()}블록을 방금 직접 스캔했습니다 · 현재 #${stats.headBlock.toLocaleString()}`
                            : `Build-time checkpoint plus ${stats.deltaBlocks.toLocaleString()} blocks scanned just now · head #${stats.headBlock.toLocaleString()}`}
                    </p>
                )}
            </section>

            {/* ---------------------------- the authority chain ------------------------ */}
            <section className="mx-auto mt-10 max-w-6xl px-6">
                <Card className="px-6 py-7">
                    <div className="flex flex-wrap items-center justify-between gap-y-6">
                        <ChainNode label={t("home", "chainPrincipal")} sub={lang === "ko" ? "실명 검증" : "Dojang verified"} />
                        <Arrow label={lang === "ko" ? "위임" : "delegates"} />
                        <ChainNode label={t("home", "chainAccount")} sub={lang === "ko" ? "자금 보관" : "holds funds"} />
                        <Arrow label={lang === "ko" ? "범위 강제" : "bounded by"} />
                        <ChainNode label={t("home", "chainAgent")} sub={lang === "ko" ? "소프트웨어" : "software"} />
                        <Arrow label={lang === "ko" ? "결제" : "pays"} />
                        <ChainNode label={t("home", "chainMerchant")} sub={lang === "ko" ? "정산" : "settles"} />
                    </div>
                </Card>
            </section>

            {/* --------------------------------- ledger -------------------------------- */}
            <section className="mx-auto max-w-6xl px-6 py-12">
                <div className="mb-3 flex items-baseline justify-between gap-4">
                    <h2 className="text-[17px] font-semibold text-ink">{t("home", "ledger")}</h2>
                    <span className="text-[12.5px] text-mute">
                        {lang === "ko"
                            ? "거부된 시도도 기록입니다 — 무엇이 막혔는지가 이 원장의 절반입니다"
                            : "Refusals are records too - what was stopped is half of this ledger"}
                    </span>
                </div>
                <Card>
                    {feedError ? (
                        <div className="px-5 py-10 text-center">
                            <p className="text-[13.5px] text-ink-2">{t("common", "error")}</p>
                            <p className="mt-1 text-[12.5px] text-mute">{t("common", "errorHint")}</p>
                        </div>
                    ) : feed === null ? (
                        <div className="px-5 py-10 text-center text-[13.5px] text-mute">
                            {t("common", "loading")}
                        </div>
                    ) : feed.length === 0 ? (
                        <div className="px-5 py-10 text-center text-[13.5px] text-mute">
                            {t("home", "empty")}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[520px]">
                                <thead>
                                    <tr className="border-b border-line text-left text-[12px] uppercase tracking-wider text-mute">
                                        <th className="px-5 py-2.5 font-medium">{t("common", "status")}</th>
                                        <th className="px-5 py-2.5 font-medium">{t("common", "hash")}</th>
                                        <th className="hidden px-5 py-2.5 font-medium sm:table-cell">
                                            {t("tx", "redeemer")}
                                        </th>
                                        <th className="px-5 py-2.5 text-right font-medium">
                                            {t("common", "time")}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {feed.map((f) => (
                                        <tr
                                            key={f.hash}
                                            className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2/60"
                                        >
                                            <td className="px-5 py-3">
                                                <StatusPill
                                                    ok={f.ok}
                                                    label={f.ok ? t("tx", "allowed") : t("tx", "rejected")}
                                                />
                                            </td>
                                            <td className="px-5 py-3">
                                                <TxLink hash={f.hash} />
                                            </td>
                                            <td className="hidden px-5 py-3 sm:table-cell">
                                                <Mono className="text-mute">{short(f.from, 6)}</Mono>
                                            </td>
                                            <td className="px-5 py-3 text-right text-[13px] text-mute">
                                                {relTime(f.timestamp, lang)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>

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

function Stat({label, value, tone}: {label: string; value?: number; tone?: "jade" | "reject"}) {
    return (
        <div className="px-6 py-5">
            <div className="text-[12.5px] text-mute">{label}</div>
            <div
                className={`tnum mt-1 text-[28px] font-semibold tracking-tight ${
                    tone === "jade" ? "text-jade" : tone === "reject" ? "text-reject" : "text-ink"
                }`}
            >
                {value === undefined ? "—" : value.toLocaleString()}
            </div>
        </div>
    );
}

function ChainNode({label, sub}: {label: string; sub: string}) {
    return (
        <div className="min-w-[92px]">
            <div className="text-[13.5px] font-medium text-ink">{label}</div>
            <div className="mt-0.5 text-[12px] text-mute">{sub}</div>
        </div>
    );
}

function Arrow({label}: {label: string}) {
    return (
        <div className="flex min-w-[70px] flex-1 flex-col items-center gap-1 px-2">
            <span className="text-[11px] text-mute">{label}</span>
            <svg viewBox="0 0 100 6" className="h-1.5 w-full" preserveAspectRatio="none">
                <line
                    x1="0"
                    y1="3"
                    x2="94"
                    y2="3"
                    stroke="var(--color-line-strong)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                />
                <path d="M94 0.5L99 3L94 5.5Z" fill="var(--color-bronze-dim)" />
            </svg>
        </div>
    );
}
