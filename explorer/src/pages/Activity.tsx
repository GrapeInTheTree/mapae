import {useEffect, useState} from "react";
import {Link} from "react-router-dom";
import {fetchActivity, type ActivityItem} from "../lib/data";
import {Card, Mono, Pagination, Spinner, StatusPill, relTime} from "../components/ui";
import {useLang} from "../i18n";
import {addresses, BLOCKSCOUT, short} from "../lib/config";
import {fmtToken} from "../lib/policy";

/**
 * The event ledger, whole.
 *
 * The home page shows the last handful; this is all of it, with each attempt's meaning decoded
 * from its calldata - amount, payee, and which authority it invoked. A refused attempt carries
 * every one of those fields too, which is the point: the manager never saw a difference between
 * an attempt that would settle and one it would refuse, only between conditions that held and
 * one that did not.
 */

const PER_PAGE = 15;

export default function Activity() {
    const {t, lang} = useLang();
    const [items, setItems] = useState<ActivityItem[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [page, setPage] = useState(1);

    useEffect(() => {
        fetchActivity()
            .then(setItems)
            .catch(() => setFailed(true));
    }, []);

    return (
        <div className="mx-auto max-w-4xl px-6 py-10">
            <header className="mb-6">
                <h1 className="display text-[38px] text-ink">{t("dlist", "activityTitle")}</h1>
                <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-mute">
                    {t("dlist", "activityLede")}
                </p>
            </header>

            {failed ? (
                <div className="rounded-2xl border border-line px-8 py-14 text-center">
                    <p className="text-[14px] text-ink-2">{t("common", "error")}</p>
                    <p className="mt-1.5 text-[12.5px] text-mute">{t("common", "errorHint")}</p>
                </div>
            ) : items === null ? (
                <Spinner />
            ) : items.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line-strong px-8 py-14 text-center text-[14px] text-mute">
                    {t("home", "empty")}
                </div>
            ) : (
                <Card className="overflow-hidden">
                    {/* Column heads only where columns exist; on small screens the rows carry
                        their own labels implicitly through colour and position. */}
                    <div className="caps hidden grid-cols-[92px_1fr_130px_110px_90px] gap-4 border-b border-line px-5 py-2.5 text-[11px] font-medium text-mute sm:grid">
                        <span>{t("common", "status")}</span>
                        <span>{t("common", "amount")}</span>
                        <span>{t("tx", "redeemer")}</span>
                        <span>{t("dlist", "mapae")}</span>
                        <span className="text-right">{t("common", "time")}</span>
                    </div>
                    <div className="divide-y divide-line/60">
                        {items.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((a) => (
                            <Link
                                key={a.hash}
                                to={`/tx/${a.hash}`}
                                className="group grid grid-cols-2 items-center gap-x-4 gap-y-1.5 px-5 py-3 transition-colors hover:bg-surface-2/60 sm:grid-cols-[92px_1fr_130px_110px_90px]"
                            >
                                <StatusPill
                                    ok={a.ok}
                                    label={a.ok ? t("tx", "allowed") : t("tx", "rejected")}
                                />
                                <span className="min-w-0 text-right sm:text-left">
                                    {a.payment ? (
                                        <span className="tnum text-[13.5px] text-ink">
                                            {fmtToken(a.payment.token, a.payment.amount)}
                                            <span className="mx-1.5 text-mute">→</span>
                                            <Mono className="!text-[12px] text-ink-2">
                                                {short(a.payment.to, 4)}
                                            </Mono>
                                        </span>
                                    ) : (
                                        <Mono className="!text-[12px] text-mute">{short(a.hash, 6)}</Mono>
                                    )}
                                </span>
                                <Mono className="hidden !text-[12px] text-mute sm:block">
                                    {short(a.from, 4)}
                                </Mono>
                                <span className="hidden sm:block">
                                    {a.delegationHash && (
                                        <Mono className="!text-[12px] text-bronze-bright">
                                            {short(a.delegationHash, 4)}
                                        </Mono>
                                    )}
                                </span>
                                <span className="col-span-2 flex items-center justify-end gap-2 text-[12px] text-mute sm:col-span-1">
                                    {relTime(a.timestamp, lang)}
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
            )}
            {items && (
                <Pagination
                    page={page}
                    pages={Math.ceil(items.length / PER_PAGE)}
                    onPage={(p) => {
                        setPage(p);
                        window.scrollTo({top: 0});
                    }}
                />
            )}
        </div>
    );
}
