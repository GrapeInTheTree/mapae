import {useCallback, useEffect, useMemo, useState} from "react";
import {Link} from "react-router-dom";
import {encodeFunctionData, type Hex} from "viem";
import {accountAbi, managerAbi, periodEnforcerAbi} from "@mapae/abi";
import {encodeExecutionSingle, encodePermissionContext} from "@mapae/sdk";
import {MODE_SIMPLE_SINGLE} from "@mapae/protocol";

import {Button, Card, Mark, Mono, Spinner, StatusPill, Tag} from "../components/ui";
import {ConnectButton} from "../components/Connect";
import {useLang} from "../i18n";
import {addresses, BLOCKSCOUT, short} from "../lib/config";
import {client} from "../lib/data";
import {readableError, useDojangStatus, useIssueDojang, useMapaeAccount, useTokenBalance} from "../lib/account";
import {decodeConditions, fmtDate, fmtToken, renderCondition, type Condition} from "../lib/policy";
import * as store from "../lib/store";
import {useWallet} from "../lib/wallet";
import {TESTNET_FAUCET_ID} from "@mapae/protocol";

/**
 * My Permissions - the control centre, as distinct from the Explorer.
 *
 * The Explorer is an audit surface: it explains what happened, to anyone, after the fact. This is
 * the opposite view of the same system - what I have granted, what it has spent, and the switch
 * that stops it. Someone nervous about handing an agent money needs one place that answers "what
 * did I authorise, and how do I take it back" in under a minute.
 *
 * Two truths are joined here. What was ISSUED is off-chain and comes from this browser; what has
 * HAPPENED - disabled or not, spent or not - is read live from the chain on every mount. Where
 * they disagree the chain wins, and the UI says which is which.
 */

interface Live {
    disabled: boolean;
    available: bigint | null;
    periodCap: bigint | null;
}

export default function Permissions() {
    const {t, lang} = useLang();
    const wallet = useWallet();
    const account = useMapaeAccount();
    const [items, setItems] = useState<store.StoredMapae[]>([]);
    const [live, setLive] = useState<Record<string, Live>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const balance = useTokenBalance(addresses.mockKRW, account.address);
    const {verified, refresh: refreshIdentity} = useDojangStatus(wallet.address ?? null, TESTNET_FAUCET_ID);
    const dojang = useIssueDojang();

    const reload = useCallback(() => {
        setItems(store.list(account.address ?? undefined));
    }, [account.address]);

    useEffect(reload, [reload]);

    // Live state per delegation, re-read on every mount and after every toggle. A kill switch
    // that shows stale state is worse than one that shows none.
    useEffect(() => {
        if (items.length === 0) return;
        let cancelled = false;
        (async () => {
            const next: Record<string, Live> = {};
            await Promise.all(
                items.map(async (m) => {
                    const conditions = decodeConditions(m.delegation.caveats);
                    const period = conditions.find((c) => c.kind === "period");
                    const periodCaveat = m.delegation.caveats.find(
                        (c) => c.enforcer.toLowerCase() === addresses.periodEnforcer.toLowerCase(),
                    );
                    try {
                        const disabled = (await client.readContract({
                            address: addresses.manager,
                            abi: managerAbi,
                            functionName: "disabledDelegations",
                            args: [m.hash],
                        })) as boolean;

                        let available: bigint | null = null;
                        if (periodCaveat) {
                            const res = (await client.readContract({
                                address: addresses.periodEnforcer,
                                abi: periodEnforcerAbi,
                                functionName: "getAvailableAmount",
                                args: [m.hash, addresses.manager, periodCaveat.terms],
                            })) as readonly [bigint, boolean, bigint];
                            available = res[0];
                        }
                        next[m.hash] = {
                            disabled,
                            available,
                            periodCap: period?.kind === "period" ? period.amount : null,
                        };
                    } catch {
                        // GIWA's public RPC sheds load. A row with unknown live state still shows
                        // what was signed; it just cannot offer the switch.
                    }
                }),
            );
            if (!cancelled) setLive(next);
        })();
        return () => {
            cancelled = true;
        };
    }, [items, busy]);

    async function toggle(m: store.StoredMapae, disable: boolean) {
        if (!wallet.walletClient || !wallet.address || !account.address) return;
        setBusy(m.hash);
        setError(null);
        try {
            // The delegator is the ACCOUNT, not its owner, so the call is routed through it.
            // Calling the manager directly from the owner's address reverts with NotDelegator.
            const inner = encodeFunctionData({
                abi: managerAbi,
                functionName: disable ? "disableDelegation" : "enableDelegation",
                args: [m.delegation],
            });
            const hash = await wallet.walletClient.writeContract({
                address: account.address,
                abi: accountAbi,
                functionName: "execute",
                args: [MODE_SIMPLE_SINGLE as Hex, encodeExecutionSingle(addresses.manager, 0n, inner)],
                account: wallet.address,
                chain: null,
            });
            await client.waitForTransactionReceipt({hash});
        } catch (e) {
            setError(readableError(e));
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="mx-auto max-w-4xl px-6 py-10">
            <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="display text-[38px] text-ink">{t("permissions", "title")}</h1>
                    <p className="mt-2 text-[14.5px] text-mute">{t("permissions", "lede")}</p>
                </div>
                {items.length > 0 && (
                    <Button
                        variant="ghost"
                        onClick={() => store.download("mapae-permissions.json", store.exportAll())}
                    >
                        {t("permissions", "export")}
                    </Button>
                )}
            </header>

            {wallet.address && <AccountBar />}

            {error && (
                <p className="mb-4 rounded-lg border border-reject-dim bg-reject/10 p-3 text-[13px] text-reject">
                    {error}
                </p>
            )}

            {!wallet.address ? (
                <Explainer />
            ) : items.length === 0 ? (
                <EmptyState />
            ) : (
                <>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                        <Tag>{t("permissions", "localOnly")}</Tag>
                        <p className="text-[12.5px] text-mute">{t("permissions", "localOnlyHint")}</p>
                    </div>
                    <div className="space-y-3">
                        {items.map((m) => (
                            <MapaeRow key={m.hash} m={m} live={live[m.hash]} busy={busy === m.hash} />
                        ))}
                    </div>
                </>
            )}
        </div>
    );

    /* ------------------------------ sub-views ------------------------------ */

    /** Visible before anything is connected, so the page is never a lone button on a black field. */
    function Explainer() {
        return (
            <div className="rise overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="border-b border-line px-7 py-6">
                    <div className="flex items-center gap-3">
                        <Mark size={20} />
                        <h2 className="text-[15px] font-semibold text-ink">
                            {t("permissions", "howItWorks")}
                        </h2>
                    </div>
                    <ol className="mt-5 space-y-3.5">
                        {[
                            t("permissions", "howLine1"),
                            t("permissions", "howLine2"),
                            t("permissions", "howLine3"),
                        ].map((line, i) => (
                            <li key={i} className="flex gap-3.5">
                                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-bronze-dim text-[11px] font-semibold text-bronze">
                                    {i + 1}
                                </span>
                                <p className="text-[13.5px] leading-relaxed text-ink-2">{line}</p>
                            </li>
                        ))}
                    </ol>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 px-7 py-5">
                    <p className="text-[13.5px] text-mute">{t("permissions", "connectToSee")}</p>
                    <ConnectButton />
                </div>
            </div>
        );
    }

    function EmptyState() {
        return (
            <div className="rise rounded-2xl border border-dashed border-line-strong px-8 py-14 text-center">
                <Mark size={26} className="mx-auto opacity-25" />
                <p className="mt-4 text-[15px] text-ink-2">{t("permissions", "empty")}</p>
                <Link
                    to="/create"
                    className="mt-5 inline-flex rounded-lg bg-bronze-solid px-4 py-2.5 text-[14px] font-medium text-paper transition-colors hover:bg-bronze-solid-2"
                >
                    {t("permissions", "emptyCta")} →
                </Link>
            </div>
        );
    }

    /** Everything the control centre needs at a glance: who pays, what it holds, who you are. */
    function AccountBar() {
        return (
            <div className="mb-6 grid gap-3 sm:grid-cols-3">
                <Card className="px-5 py-4">
                    <div className="text-[12px] text-mute">{t("permissions", "account")}</div>
                    {account.address && account.deployed ? (
                        <a
                            href={`${BLOCKSCOUT}/address/${account.address}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 block font-mono text-[13.5px] text-ink transition-colors hover:text-bronze-bright"
                        >
                            {short(account.address, 6)} ↗
                        </a>
                    ) : (
                        <div className="mt-1 text-[13.5px] text-mute">
                            {t("permissions", "accountNone")}
                        </div>
                    )}
                </Card>
                <Card className="px-5 py-4">
                    <div className="text-[12px] text-mute">{t("permissions", "balance")}</div>
                    <div className="tnum mt-1 text-[15px] text-ink">
                        {balance === null ? "—" : fmtToken(addresses.mockKRW, balance)}
                    </div>
                </Card>
                <Card className="px-5 py-4">
                    <div className="text-[12px] text-mute">{t("permissions", "identity")}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-[13.5px]">
                        {verified === null ? (
                            <span className="text-mute">—</span>
                        ) : verified ? (
                            <>
                                <span className="h-1.5 w-1.5 rounded-full bg-jade" />
                                <span className="text-jade">{t("permissions", "identityLive")}</span>
                            </>
                        ) : (
                            <>
                                <span className="h-1.5 w-1.5 rounded-full bg-reject" />
                                <span className="text-reject">{t("permissions", "identityNone")}</span>
                            </>
                        )}
                    </div>
                    {verified === false && (
                        <>
                            <button
                                onClick={async () => {
                                    if (await dojang.issue()) refreshIdentity();
                                }}
                                disabled={dojang.issuing || !wallet.onGiwa}
                                className="mt-2.5 w-full rounded-lg border border-bronze-dim px-3 py-1.5 text-[12px] font-medium text-bronze-bright transition-colors hover:bg-bronze/10 disabled:opacity-50"
                            >
                                {dojang.issuing
                                    ? t("create", "gettingDojang")
                                    : t("create", "getDojang")}
                            </button>
                            {dojang.error && (
                                <p className="mt-1.5 text-[11.5px] leading-relaxed text-reject">
                                    {dojang.error}
                                </p>
                            )}
                        </>
                    )}
                </Card>
            </div>
        );
    }

    function MapaeRow({m, live: l, busy: isBusy}: {m: store.StoredMapae; live?: Live; busy: boolean}) {
        const conditions = useMemo(() => decodeConditions(m.delegation.caveats), [m]);
        const window = conditions.find((c) => c.kind === "window");
        const period = conditions.find((c) => c.kind === "period");
        const expired =
            window?.kind === "window" &&
            window.until > 0n &&
            window.until < BigInt(Math.floor(Date.now() / 1000));

        const status = l?.disabled
            ? {ok: false, label: t("permissions", "disabled")}
            : expired
              ? {ok: false, label: t("permissions", "expired")}
              : {ok: true, label: t("permissions", "active")};

        const spent = l?.available != null && l.periodCap != null ? l.periodCap - l.available : null;
        const pct =
            spent != null && l?.periodCap && l.periodCap > 0n
                ? Number((spent * 100n) / l.periodCap)
                : 0;

        const names: Record<string, string> = {};
        if (m.merchantName) {
            const payee = conditions.find((c) => c.kind === "payee");
            if (payee?.kind === "payee") names[payee.payees[0].toLowerCase()] = m.merchantName;
        }

        return (
            <Card className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                            <h2 className="text-[15.5px] font-medium text-ink">{m.agentName}</h2>
                            <StatusPill ok={status.ok} label={status.label} />
                        </div>
                        <Mono className="mt-1 block text-mute">{short(m.delegation.delegate, 8)}</Mono>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            onClick={() =>
                                void navigator.clipboard.writeText(
                                    encodePermissionContext([m.delegation]),
                                )
                            }
                        >
                            {t("permissions", "copyContext")}
                        </Button>
                        {l && (
                            <Button
                                variant={l.disabled ? "bronze" : "danger"}
                                disabled={isBusy || !wallet.onGiwa}
                                onClick={() => {
                                    if (!l.disabled && !confirm(t("permissions", "confirmDisable")))
                                        return;
                                    void toggle(m, !l.disabled);
                                }}
                            >
                                {isBusy && <Spinner inline />}
                                {isBusy
                                    ? l.disabled
                                        ? t("permissions", "enabling")
                                        : t("permissions", "disabling")
                                    : l.disabled
                                      ? t("permissions", "enable")
                                      : t("permissions", "disable")}
                            </Button>
                        )}
                    </div>
                </div>

                {/* The spend meter. A number tells you the state; a bar tells you how close you
                    are to the edge, which is the thing a person actually wants to know. */}
                {period?.kind === "period" && (
                    <div className="mt-5 px-5">
                        <div className="flex items-baseline justify-between text-[12.5px]">
                            <span className="text-mute">
                                {t("permissions", "spent")}{" "}
                                <span className="tnum text-ink-2">
                                    {spent != null ? fmtToken(period.token, spent) : "—"}
                                </span>
                            </span>
                            <span className="tnum text-mute">
                                {fmtToken(period.token, period.amount)}
                            </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                            <div
                                className="h-full rounded-full bg-bronze transition-[width] duration-500"
                                style={{width: `${Math.min(100, Math.max(0, pct))}%`}}
                            />
                        </div>
                    </div>
                )}

                <ul className="mt-5 divide-y divide-line/70 border-t border-line">
                    {conditions.map((c: Condition, i) => {
                        const r = renderCondition(c, t as never, lang, names);
                        return (
                            <li key={i} className="flex gap-4 px-5 py-2.5 text-[13px]">
                                <span className="w-24 shrink-0 text-mute">{r.title}</span>
                                <span className="text-ink-2">{r.lines[0]}</span>
                            </li>
                        );
                    })}
                </ul>

                <div className="flex flex-wrap items-center gap-3 border-t border-line bg-surface-2/40 px-5 py-2.5 text-[12px] text-mute">
                    <span className="font-mono">{short(m.hash, 10)}</span>
                    {window?.kind === "window" && window.until > 0n && (
                        <span>
                            {t("permissions", "validUntil")} {fmtDate(window.until, lang)}
                        </span>
                    )}
                    <a
                        href={`${BLOCKSCOUT}/address/${m.delegation.delegator}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto transition-colors hover:text-ink-2"
                    >
                        {t("permissions", "onChain")} ↗
                    </a>
                </div>
            </Card>
        );
    }
}
