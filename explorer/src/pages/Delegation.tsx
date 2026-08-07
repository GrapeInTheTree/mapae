import {useEffect, useMemo, useState} from "react";
import {Link, useParams} from "react-router-dom";
import {encodeFunctionData, getAddress, type Hex} from "viem";
import {accountAbi, managerAbi} from "@mapae/abi";
import {MODE_SIMPLE_SINGLE} from "@mapae/protocol";
import {encodeExecutionSingle} from "@mapae/sdk";
import {
    Button,
    Card,
    CopyButton,
    ExtLink,
    Mono,
    Spinner,
    StatusPill,
    Tag,
    relTime,
} from "../components/ui";
import {useLang} from "../i18n";
import {addresses, short} from "../lib/config";
import {readableError, useMapaeAccount} from "../lib/account";
import {client, enrichDelegations, fetchDelegationList, type DelegationSummary} from "../lib/data";
import {fmtToken, renderCondition} from "../lib/policy";
import * as store from "../lib/store";
import {useWallet} from "../lib/wallet";

/**
 * One Mapae, in full.
 *
 * The catalogue can only ever show a delegation compressed - its payees crushed into a chip, its
 * attempts trailing off into "+1". That compression is fine for scanning and wrong for deciding.
 * This page is where an authority is examined: every condition as a sentence with the contract
 * that enforces it, every attempt including the refused ones, the spend against the cap, and -
 * for the person who granted it - the switch that stops it.
 *
 * It is also the URL a Mapae did not have. A payment could be linked to; the authority behind it
 * could not, which made "what may this agent do?" a question with no answer to send someone.
 */
export default function Delegation() {
    const {hash} = useParams<{hash: Hex}>();
    const {t, lang} = useLang();
    const wallet = useWallet();
    const account = useMapaeAccount();

    const [list, setList] = useState<DelegationSummary[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setList(null);
        setFailed(false);
        // The listing is cheap; the live state is not. A detail page needs it for exactly one
        // authority, so it enriches that one rather than all seventy-three.
        fetchDelegationList()
            .then(async (l) => {
                if (cancelled) return;
                const one = l.find((x) => x.hash.toLowerCase() === (hash ?? "").toLowerCase());
                if (one) await enrichDelegations([one]);
                if (!cancelled) setList([...l]);
            })
            .catch(() => !cancelled && setFailed(true));
        return () => {
            cancelled = true;
        };
    }, [reloadKey]);

    const d = useMemo(
        () => list?.find((x) => x.hash.toLowerCase() === (hash ?? "").toLowerCase()) ?? null,
        [list, hash],
    );

    /* The switch belongs to the delegator. On-chain the call must come FROM the account, so the
       connected wallet has to be the owner of the account that granted this - not merely any
       wallet, and not the agent. */
    const isDelegator =
        account.address != null &&
        d != null &&
        account.address.toLowerCase() === d.delegator.toLowerCase();

    async function toggle(disable: boolean) {
        if (!d || !wallet.walletClient || !wallet.address || !account.address) return;
        setBusy(true);
        setError(null);
        try {
            const inner = encodeFunctionData({
                abi: managerAbi,
                functionName: disable ? "disableDelegation" : "enableDelegation",
                args: [d.delegation],
            });
            const tx = await wallet.walletClient.writeContract({
                address: account.address,
                abi: accountAbi,
                functionName: "execute",
                args: [MODE_SIMPLE_SINGLE as Hex, encodeExecutionSingle(addresses.manager, 0n, inner)],
                account: wallet.address,
                chain: null,
            });
            await client.waitForTransactionReceipt({hash: tx});
            setReloadKey((k) => k + 1);
        } catch (e) {
            setError(readableError(e));
        } finally {
            setBusy(false);
        }
    }

    if (failed || (list !== null && d === null))
        return (
            <div className="mx-auto max-w-2xl px-6 py-24 text-center">
                <p className="text-[15px] text-ink-2">{t("dpage", "notFound")}</p>
                <p className="mt-2 font-mono text-[12px] break-all text-mute">{hash}</p>
                <Link to="/delegations" className="mt-6 inline-block text-[13.5px] text-bronze-bright">
                    {t("dpage", "backToList")} →
                </Link>
            </div>
        );

    if (!d)
        return (
            <div className="flex min-h-[50vh] items-center justify-center">
                <Spinner />
            </div>
        );

    const mine = store.get(d.hash);
    const period = d.conditions.find((c) => c.kind === "period");
    const win = d.conditions.find((c) => c.kind === "window");
    const expired =
        win?.kind === "window" && win.until > 0n && win.until < BigInt(Math.floor(Date.now() / 1000));

    const status = d.disabled
        ? {ok: false, label: t("permissions", "disabled")}
        : d.identityLive === false
          ? {ok: false, label: t("dlist", "identityDead")}
          : expired
            ? {ok: false, label: t("permissions", "expired")}
            : {ok: true, label: t("permissions", "active")};

    const spent = d.available != null && d.periodCap != null ? d.periodCap - d.available : null;
    const pct =
        spent != null && d.periodCap && d.periodCap > 0n
            ? Math.min(100, Math.max(0, Number((spent * 100n) / d.periodCap)))
            : 0;

    const rendered = d.conditions.map((c, i) => ({
        ...renderCondition(c, t as never, lang),
        condition: c,
        enforcer: d.raw[i]?.enforcer,
    }));

    return (
        <div className="mx-auto max-w-3xl px-6 py-12">
            <Link
                to="/delegations"
                className="text-[12.5px] text-mute transition-colors hover:text-ink-2"
            >
                ← {t("dpage", "backToList")}
            </Link>

            <header className="mt-5 mb-9">
                <div className="flex flex-wrap items-center gap-3">
                    <StatusPill ok={status.ok} label={status.label} />
                    {mine && <Tag tone="bronze">{t("dlist", "mine")}</Tag>}
                    {d.chainLength > 1 && <Tag>{t("dlist", "chainOf", {n: d.chainLength})}</Tag>}
                </div>

                <h1 className="display mt-4 text-[34px] leading-tight text-ink">
                    {mine?.agentName || t("dpage", "untitled")}
                </h1>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-mute">
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        {t("tx", "delegator")}
                        <Mono className="!text-[12px] text-ink-2">{short(d.delegator, 5)}</Mono>
                        <CopyButton value={d.delegator} label={t("tx", "copy")} copiedLabel={t("tx", "copied")} />
                    </span>
                    <span>→</span>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        {t("tx", "delegate")}
                        <Mono className="!text-[12px] text-ink-2">{short(d.delegate, 5)}</Mono>
                        <CopyButton value={d.delegate} label={t("tx", "copy")} copiedLabel={t("tx", "copied")} />
                    </span>
                </div>

                <div className="mt-2.5 flex items-center gap-2">
                    <Mono className="!text-[11.5px] break-all text-mute">{d.hash}</Mono>
                    <CopyButton value={d.hash} label={t("tx", "copy")} copiedLabel={t("tx", "copied")} />
                </div>
            </header>

            {/* ── the four numbers that describe an authority's life ── */}
            <Card className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
                <Fact k={t("dpage", "attempts")} v={String(d.txs.length)} />
                <Fact k={t("dpage", "settled")} v={String(d.settled)} tone="jade" />
                <Fact k={t("dpage", "refused")} v={String(d.refused)} tone="reject" />
                <Fact k={t("dpage", "lastUsed")} v={relTime(d.lastUsed, lang)} />
            </Card>

            {period?.kind === "period" && (
                <Card className="mt-4 px-5 py-4">
                    <div className="flex items-baseline justify-between text-[13px]">
                        <span className="text-mute">
                            {t("permissions", "spent")}{" "}
                            <span className="tnum text-ink">
                                {spent != null ? fmtToken(period.token, spent) : "—"}
                            </span>
                        </span>
                        <span className="tnum text-[12.5px] text-mute">
                            {fmtToken(period.token, period.amount)} / {t("dpage", "perPeriod")}
                        </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-bronze" style={{width: `${pct}%`}} />
                    </div>
                    <p className="mt-2.5 text-[11.5px] leading-relaxed text-mute">
                        {t("dpage", "periodNote")}
                    </p>
                </Card>
            )}

            {/* ── the kill switch, offered only to the person it belongs to ── */}
            {isDelegator && d.disabled !== null && (
                <Card className="mt-4 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div>
                        <p className="text-[13.5px] text-ink">
                            {d.disabled ? t("dpage", "switchOffTitle") : t("dpage", "switchOnTitle")}
                        </p>
                        <p className="mt-1 text-[12px] leading-relaxed text-mute">
                            {d.disabled ? t("dpage", "switchOffNote") : t("dpage", "switchOnNote")}
                        </p>
                    </div>
                    <Button
                        variant={d.disabled ? "bronze" : "ghost"}
                        disabled={busy}
                        onClick={() => toggle(!d.disabled)}
                    >
                        {busy
                            ? t("permissions", d.disabled ? "enabling" : "disabling")
                            : d.disabled
                              ? t("permissions", "enable")
                              : t("permissions", "disable")}
                    </Button>
                </Card>
            )}
            {error && <p className="mt-3 text-[12.5px] text-reject-paper">{error}</p>}

            {/* ── what was signed ── */}
            <h2 className="caps mt-10 mb-3 text-[11px] font-semibold text-mute">
                {t("dpage", "conditions")}
            </h2>
            <div className="flex flex-col gap-2.5">
                {rendered.map((r, i) => (
                    <Card key={i} className="px-5 py-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span
                                className={`text-[13.5px] font-medium ${
                                    r.kind === "identity" ? "text-bronze-bright" : "text-ink"
                                }`}
                            >
                                {r.title}
                            </span>
                            {r.enforcer && (
                                <span className="inline-flex items-center gap-1.5 text-[11px] text-mute">
                                    {t("tx", "enforcedBy")}
                                    <ExtLink path={`/address/${r.enforcer}`}>
                                        <Mono className="!text-[11px]">{short(r.enforcer, 4)}</Mono>
                                    </ExtLink>
                                </span>
                            )}
                        </div>
                        {r.condition.kind === "payee" ? (
                            <>
                                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
                                    {t("dpage", "payeeHeading", {n: r.condition.payees.length})}
                                </p>
                                <ol className="mt-3 flex flex-col gap-1.5">
                                    {r.condition.payees.map((raw, k) => {
                                        // Terms carry the raw 20 bytes, so they decode lowercase.
                                        // Shown checksummed: EIP-55 exists so that a transcription
                                        // error is visible, and this row is here to be compared.
                                        const addr = getAddress(raw);
                                        const name = mine?.payeeNames?.[raw.toLowerCase()];
                                        return (
                                            <li
                                                key={addr}
                                                className="flex items-center gap-3 rounded-lg border border-line bg-surface-2/40 px-3 py-2"
                                            >
                                                <span className="tnum w-4 shrink-0 text-[11px] text-mute">
                                                    {k + 1}
                                                </span>
                                                {name && (
                                                    <span className="shrink-0 text-[12.5px] font-medium text-ink">
                                                        {name}
                                                    </span>
                                                )}
                                                {/* The full address, not an ellipsis: this row exists
                                                    so someone can check it against what they meant. */}
                                                <ExtLink path={`/address/${addr}`}>
                                                    <Mono className="!text-[11.5px] break-all">{addr}</Mono>
                                                </ExtLink>
                                                <span className="ml-auto shrink-0">
                                                    <CopyButton
                                                        value={addr}
                                                        label={t("tx", "copy")}
                                                        copiedLabel={t("tx", "copied")}
                                                    />
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ol>
                                {r.lines.slice(1).map((line, k) => (
                                    <p key={k} className="mt-2.5 text-[12px] leading-relaxed text-mute">
                                        {line}
                                    </p>
                                ))}
                            </>
                        ) : (
                            r.lines.map((line, k) => (
                                <p
                                    key={k}
                                    className={`mt-1.5 leading-relaxed ${
                                        k === 0 ? "text-[13.5px] text-ink-2" : "text-[12px] text-mute"
                                    }`}
                                >
                                    {line}
                                </p>
                            ))
                        )}
                    </Card>
                ))}
            </div>

            {/* ── every attempt, refusals included ── */}
            <h2 className="caps mt-10 mb-3 text-[11px] font-semibold text-mute">
                {t("dpage", "history")}
            </h2>
            <Card className="divide-y divide-line">
                {d.txs.map((tx) => (
                    <Link
                        key={tx.hash}
                        to={`/tx/${tx.hash}`}
                        className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2/50"
                    >
                        <StatusPill
                            ok={tx.ok}
                            label={tx.ok ? t("tx", "allowed") : t("tx", "rejected")}
                        />
                        <Mono className="!text-[12px] truncate text-ink-2">{short(tx.hash, 6)}</Mono>
                        <span className="ml-auto shrink-0 text-[11.5px] text-mute">
                            {relTime(tx.timestamp, lang)}
                        </span>
                    </Link>
                ))}
            </Card>
            <p className="mt-3 text-[11.5px] leading-relaxed text-mute">{t("dpage", "historyNote")}</p>

            <div className="mt-8 flex justify-end">
                <ExtLink path={`/address/${addresses.manager}`}>
                    <span className="text-[12px]">{t("dpage", "rawCalls")} ↗</span>
                </ExtLink>
            </div>
        </div>
    );
}

function Fact({k, v, tone}: {k: string; v: string; tone?: "jade" | "reject"}) {
    return (
        <div className="px-5 py-4">
            <div className="caps text-[10.5px] font-semibold text-mute">{k}</div>
            <div
                className={`tnum mt-1.5 text-[22px] ${
                    tone === "jade" ? "text-jade" : tone === "reject" ? "text-reject" : "text-ink"
                }`}
            >
                {v}
            </div>
        </div>
    );
}
