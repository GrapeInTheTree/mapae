import {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";
import {fetchFeed, fetchStats, type FeedItem, type Stats} from "../lib/data";
import {Card, StatusPill, TxLink, relTime, Mono} from "../components/ui";
import {short} from "../lib/config";

/** Real transactions from the live demo - each one opens the page that explains the system. */
const EXAMPLES = [
    {hash: "0xa01e6e8696d4fe4d505c8636ed1f09a0a0da3d4dcf01bd045f0046d99757e568", label: "승인된 결제"},
    {
        hash: "0xd3843e1f73178b78942fe5ebaeb1ac30611f7734786b7e4640098e5e1749ed65",
        label: "신원 취소로 거부",
    },
    {
        hash: "0x131e97448767531427849ff9d716702481a6a7de3cc5d5e2026182028daee1cd",
        label: "허용 외 수취인 거부",
    },
];

function Stat({label, value, tone}: {label: string; value: string; tone?: "jade" | "reject"}) {
    return (
        <Card className="px-5 py-4">
            <div className="text-[13px] text-mute">{label}</div>
            <div
                className={`mt-1 text-[26px] font-semibold tabular-nums tracking-tight ${
                    tone === "jade" ? "text-jade" : tone === "reject" ? "text-reject" : "text-ink"
                }`}
            >
                {value}
            </div>
        </Card>
    );
}

export default function Home() {
    const nav = useNavigate();
    const [q, setQ] = useState("");
    const [stats, setStats] = useState<Stats | null>(null);
    const [feed, setFeed] = useState<FeedItem[] | null>(null);

    useEffect(() => {
        fetchStats().then(setStats).catch(console.error);
        fetchFeed().then(setFeed).catch(console.error);
    }, []);

    const go = () => {
        const h = q.trim();
        if (/^0x[0-9a-fA-F]{64}$/.test(h)) nav(`/tx/${h}`);
    };

    return (
        <div>
            {/* ------------------------------- hero ------------------------------- */}
            <section className="mx-auto max-w-3xl px-6 pt-20 pb-14 text-center">
                <h1
                    className="text-[40px] leading-[1.25] font-bold tracking-tight text-ink sm:text-[46px]"
                    style={{fontFamily: "var(--font-serif)"}}
                >
                    모든 결제에는
                    <br />
                    <span className="text-bronze-bright">허락한 사람</span>이 있다
                </h1>
                <p className="mx-auto mt-5 max-w-xl text-[15.5px] leading-relaxed text-ink-2">
                    마패 원장은 GIWA 위임 결제의 책임을 보여줍니다. 결제 해시 하나로 — 어떤 조건의
                    위임이었는지, 누가 서명했는지, 그 사람의 신원이 지금도 유효한지까지.
                </p>

                <div className="mx-auto mt-9 flex max-w-xl items-center gap-0 rounded-xl border border-line-strong bg-surface p-1.5 focus-within:border-bronze-dim">
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && go()}
                        placeholder="결제 트랜잭션 해시 (0x…)"
                        spellCheck={false}
                        className="w-full bg-transparent px-3.5 py-2.5 font-mono text-[13.5px] text-ink placeholder:text-mute focus:outline-none"
                    />
                    <button
                        onClick={go}
                        className="shrink-0 rounded-lg bg-bronze px-4 py-2.5 text-[14px] font-semibold text-bg transition-colors hover:bg-bronze-bright"
                    >
                        역추적
                    </button>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <span className="text-[12.5px] text-mute">라이브 예시</span>
                    {EXAMPLES.map((e) => (
                        <button
                            key={e.hash}
                            onClick={() => nav(`/tx/${e.hash}`)}
                            className="rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-ink-2 transition-colors hover:border-bronze-dim hover:text-bronze-bright"
                        >
                            {e.label}
                        </button>
                    ))}
                </div>
            </section>

            {/* ------------------------------- stats ------------------------------ */}
            <section className="mx-auto max-w-5xl px-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="위임" value={stats ? String(stats.delegations) : "—"} />
                    <Stat label="승인된 결제" value={stats ? String(stats.redemptions) : "—"} tone="jade" />
                    <Stat label="거부된 시도" value={stats ? String(stats.rejections) : "—"} tone="reject" />
                    <Stat label="검증된 위임자" value={stats ? String(stats.principals) : "—"} />
                </div>
                {stats && (
                    <p className="mt-2.5 text-right text-[11.5px] text-mute">
                        빌드 시점 체크포인트 + 이후 {stats.deltaBlocks.toLocaleString()}블록을 방금
                        직접 스캔했습니다 · 현재 #{stats.headBlock.toLocaleString()}
                    </p>
                )}
            </section>

            {/* ------------------------------- feed ------------------------------- */}
            <section className="mx-auto max-w-5xl px-6 py-12">
                <div className="mb-3 flex items-baseline justify-between">
                    <h2 className="text-[17px] font-semibold text-ink">최근 결제 시도</h2>
                    <span className="text-[12.5px] text-mute">
                        거부된 시도도 기록입니다 — 무엇이 막혔는지가 이 원장의 절반입니다
                    </span>
                </div>
                <Card>
                    {feed === null ? (
                        <div className="px-5 py-10 text-center text-[13.5px] text-mute">불러오는 중…</div>
                    ) : (
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-line text-left text-[12.5px] text-mute">
                                    <th className="px-5 py-2.5 font-medium">결과</th>
                                    <th className="px-5 py-2.5 font-medium">트랜잭션</th>
                                    <th className="hidden px-5 py-2.5 font-medium sm:table-cell">실행 주체</th>
                                    <th className="px-5 py-2.5 text-right font-medium">시각</th>
                                </tr>
                            </thead>
                            <tbody>
                                {feed.map((f) => (
                                    <tr
                                        key={f.hash}
                                        className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2/60"
                                    >
                                        <td className="px-5 py-3">
                                            <StatusPill ok={f.ok} />
                                        </td>
                                        <td className="px-5 py-3">
                                            <TxLink hash={f.hash} />
                                        </td>
                                        <td className="hidden px-5 py-3 sm:table-cell">
                                            <Mono className="text-mute">{short(f.from, 6)}</Mono>
                                        </td>
                                        <td className="px-5 py-3 text-right text-[13px] text-mute">
                                            {relTime(f.timestamp)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </Card>
            </section>
        </div>
    );
}
