import {useCallback, useEffect, useMemo, useState} from "react";
import {Link} from "react-router-dom";
import {encodeFunctionData, type Address, type Hex} from "viem";
import {accountAbi, managerAbi, periodEnforcerAbi} from "@mapae/abi";
import {encodeExecutionSingle, encodePermissionContext} from "@mapae/sdk";
import {MODE_SIMPLE_SINGLE} from "@mapae/protocol";

import {Button, Card, Mono, Paper, Spinner, StatusPill, Tag} from "../components/ui";
import {useLang} from "../i18n";
import {addresses, BLOCKSCOUT, short} from "../lib/config";
import {client} from "../lib/data";
import {readableError, useMapaeAccount} from "../lib/account";
import {decodeConditions, fmtDate, fmtToken, renderCondition, type Condition} from "../lib/policy";
import * as store from "../lib/store";
import {useWallet} from "../lib/wallet";

/**
 * My Permissions - the control centre, as distinct from the Explorer.
 *
 * The Explorer is an audit surface: it explains what happened, to anyone, after the fact. This is
 * the opposite view of the same system - what I have granted, what it has spent, and the switch
 * that stops it. A person who is nervous about handing an agent money needs somewhere to look
 * that answers "what did I authorise, and how do I take it back", and that place has to be
 * legible in under a minute.
 *
 * Two truths are joined here. What was ISSUED is off-chain and comes from this browser; what has
 * HAPPENED - disabled or not, spent or not - is read live from the chain every time. Where they
 * disagree, the chain wins, and the UI says which is which.
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

    const reload = useCallback(() => {
        setItems(store.list(account.address ?? undefined));
    }, [account.address]);

    useEffect(reload, [reload]);

    // Live state, per delegation. Read on every mount rather than cached: a kill switch that
    // shows stale state is worse than one that shows none.
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
            // The delegator is the ACCOUNT, not the owner - so the call is routed through it.
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

    const empty = items.length === 0;

    return (
        <div className="mx-auto max-w-4xl px-6 py-10">
            <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="display text-[36px] text-ink">{t("permissions", "title")}</h1>
                    <p className="mt-2 text-[14.5px] text-mute">{t("permissions", "lede")}</p>
                </div>
                {!empty && (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            store.download(`mapae-permissions.json`, store.exportAll())
                        }
                    >
                        {t("permissions", "export")}
                    </Button>
                )}
            </header>

            {!wallet.address ? (
                <Paper className="flex flex-wrap items-center justify-between gap-4 p-5">
                    <p className="text-[14px] text-paper-ink-2">{t("create", "needWallet")}</p>
                    <Button onClick={wallet.connect} disabled={!wallet.available}>
                        {t("nav", "connect")}
                    </Button>
                </Paper>
            ) : empty ? (
                <Card className="p-10 text-center">
                    <p className="text-[14.5px] text-mute">{t("permissions", "empty")}</p>
                    <Link
                        to="/create"
                        className="mt-3 inline-block text-[14px] text-bronze-bright hover:underline"
                    >
                        {t("permissions", "emptyCta")} →
                    </Link>
                </Card>
            ) : (
                <>
                    <div className="mb-4 flex items-center gap-2">
                        <Tag>{t("permissions", "localOnly")}</Tag>
                        <p className="text-[12.5px] text-mute">{t("permissions", "localOnlyHint")}</p>
                    </div>

                    {error && (
                        <p className="mb-4 rounded-lg border border-reject-dim bg-reject/10 p-3 text-[13px] text-reject">
                            {error}
                        </p>
                    )}

                    <div className="space-y-3">
                        {items.map((m) => (
                            <MapaeRow
                                key={m.hash}
                                m={m}
                                live={live[m.hash]}
                                busy={busy === m.hash}
                                onToggle={toggle}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );

    function MapaeRow({
        m,
        live: l,
        busy: isBusy,
        onToggle,
    }: {
        m: store.StoredMapae;
        live?: Live;
        busy: boolean;
        onToggle: (m: store.StoredMapae, disable: boolean) => void;
    }) {
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

        const spent =
            l?.available != null && l.periodCap != null ? l.periodCap - l.available : null;

        return (
            <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                            <h2 className="text-[15.5px] font-medium text-ink">{m.agentName}</h2>
                            <StatusPill ok={status.ok} label={status.label} />
                        </div>
                        <Mono className="mt-1 block text-mute">
                            {short(m.delegation.delegate, 8)}
                        </Mono>
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
                                    onToggle(m, !l.disabled);
                                }}
                            >
                                {isBusy ? <Spinner inline /> : null}
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

                <div className="mt-4 grid gap-x-8 gap-y-2 border-t border-line pt-4 text-[13px] sm:grid-cols-3">
                    {period?.kind === "period" && (
                        <>
                            <Stat
                                k={t("permissions", "spentThisPeriod")}
                                v={spent != null ? fmtToken(period.token, spent) : "—"}
                            />
                            <Stat
                                k={t("permissions", "remaining")}
                                v={
                                    l?.available != null
                                        ? fmtToken(period.token, l.available)
                                        : "—"
                                }
                            />
                        </>
                    )}
                    {window?.kind === "window" && window.until > 0n && (
                        <Stat
                            k={t("permissions", "validUntil")}
                            v={fmtDate(window.until, lang)}
                        />
                    )}
                </div>

                <ul className="mt-4 space-y-1.5 border-t border-line pt-4">
                    {conditions.map((c: Condition, i) => {
                        const r = renderCondition(c, t as never, lang, {
                            [String(m.delegation.delegate).toLowerCase()]: m.agentName,
                            ...(m.merchantName
                                ? {[merchantOf(conditions)?.toLowerCase() ?? ""]: m.merchantName}
                                : {}),
                        });
                        return (
                            <li key={i} className="flex gap-3 text-[13px]">
                                <span className="w-24 shrink-0 text-mute">{r.title}</span>
                                <span className="text-ink-2">{r.lines[0]}</span>
                            </li>
                        );
                    })}
                </ul>

                <div className="mt-3 flex items-center gap-3 text-[12px] text-mute">
                    <span className="font-mono">{short(m.hash, 10)}</span>
                    <a
                        href={`${BLOCKSCOUT}/address/${m.delegation.delegator}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-ink-2"
                    >
                        {t("permissions", "onChain")} ↗
                    </a>
                </div>
            </Card>
        );
    }

    function Stat({k, v}: {k: string; v: string}) {
        return (
            <div>
                <div className="text-[12px] text-mute">{k}</div>
                <div className="mt-0.5 text-[14px] text-ink tnum">{v}</div>
            </div>
        );
    }
}

function merchantOf(conditions: Condition[]): Address | undefined {
    const payee = conditions.find((c) => c.kind === "payee");
    return payee?.kind === "payee" ? payee.payees[0] : undefined;
}
