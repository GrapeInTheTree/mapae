import {useEffect, useState} from "react";
import {useLang} from "../i18n";
import {useWallet} from "../lib/wallet";
import {short} from "../lib/config";
import {Mark} from "./brand";

/**
 * Connecting, as one honest screen.
 *
 * The states a person can actually be in are: no wallet installed, one or more wallets found,
 * waiting on the wallet, connected but on the wrong chain. Each gets a real answer rather than a
 * greyed-out button - a disabled control that never says why is the single most common way a
 * crypto app loses someone in the first ten seconds.
 */

/** Rendered exactly once, by the app shell. Its open state lives in the wallet context so that
 *  any number of connect affordances can raise the same dialog. */
export function ConnectDialog() {
    const {t} = useLang();
    const w = useWallet();
    const open = w.connectPromptOpen;
    const onClose = w.dismissConnect;

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        document.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = "";
        };
    }, [open, onClose]);

    // Close as soon as a connection lands, so the dialog never lingers over a connected app.
    useEffect(() => {
        if (open && w.address) onClose();
    }, [open, w.address, onClose]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 backdrop-blur-sm sm:items-center"
            onClick={onClose}
            role="presentation"
        >
            <div
                className="rise w-full max-w-[400px] rounded-2xl bg-paper p-6 shadow-2xl shadow-black/50"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={t("wallet", "title")}
            >
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-[17px] font-semibold text-paper-ink">
                            {t("wallet", "title")}
                        </h2>
                        <p className="mt-1.5 text-[12.5px] leading-relaxed text-paper-mute">
                            {t("wallet", "lede")}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label={t("common", "close")}
                        className="-mt-1 -mr-1 rounded-lg p-1.5 text-paper-mute transition-colors hover:bg-paper-2 hover:text-paper-ink"
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16">
                            <path
                                d="M4 4l8 8M12 4l-8 8"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                            />
                        </svg>
                    </button>
                </div>

                {w.wallets.length === 0 ? (
                    <div className="mt-6 rounded-xl border border-paper-line bg-paper-2/50 p-5 text-center">
                        <Mark size={26} tone="ink" className="mx-auto opacity-30" />
                        <p className="mt-3 text-[14px] font-medium text-paper-ink">
                            {t("wallet", "none")}
                        </p>
                        <p className="mt-1.5 text-[12.5px] leading-relaxed text-paper-mute">
                            {t("wallet", "noneHint")}
                        </p>
                        <a
                            href="https://metamask.io/download/"
                            target="_blank"
                            rel="noreferrer"
                            className="mt-4 inline-flex rounded-lg bg-bronze-solid px-4 py-2 text-[13.5px] font-medium text-paper transition-colors hover:bg-bronze-solid-2"
                        >
                            {t("wallet", "getMetamask")} ↗
                        </a>
                    </div>
                ) : (
                    <ul className="mt-5 space-y-2">
                        {w.wallets.map((wallet) => (
                            <li key={wallet.id}>
                                <button
                                    onClick={() => void w.connect(wallet.id)}
                                    disabled={w.connecting}
                                    className="flex w-full items-center gap-3 rounded-xl border border-paper-line bg-paper-2/40 px-3.5 py-3 text-left transition-all hover:border-bronze-solid/50 hover:bg-paper-2 disabled:opacity-50 active:translate-y-px"
                                >
                                    {wallet.icon ? (
                                        <img
                                            src={wallet.icon}
                                            alt=""
                                            className="h-8 w-8 shrink-0 rounded-lg"
                                        />
                                    ) : (
                                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-ink/8">
                                            <Mark size={16} tone="ink" />
                                        </span>
                                    )}
                                    <span className="flex-1 text-[14px] font-medium text-paper-ink">
                                        {wallet.name}
                                    </span>
                                    {w.connecting ? (
                                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-paper-line border-t-bronze-solid" />
                                    ) : (
                                        <svg width="16" height="16" viewBox="0 0 16 16" className="text-paper-mute">
                                            <path
                                                d="M6 4l4 4-4 4"
                                                stroke="currentColor"
                                                strokeWidth="1.6"
                                                fill="none"
                                                strokeLinecap="round"
                                            />
                                        </svg>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                {w.connecting && (
                    <p className="mt-4 text-center text-[12.5px] text-paper-mute">
                        {t("wallet", "connecting")}
                    </p>
                )}
                {w.error && (
                    <p className="mt-4 rounded-lg bg-reject-paper/8 p-2.5 text-center text-[12.5px] text-reject-paper">
                        {w.error}
                    </p>
                )}
            </div>
        </div>
    );
}

/** An affordance that raises the shared dialog. Renders the connected state inline once there
 *  is one, so the same component serves both states. */
export function ConnectButton({compact}: {compact?: boolean}) {
    const {t} = useLang();
    const w = useWallet();
    const [copied, setCopied] = useState(false);

    if (w.address && !w.onGiwa) {
        return (
            <button
                onClick={w.switchToGiwa}
                className="inline-flex items-center gap-2 rounded-lg border border-warn/50 bg-warn/12 px-3 py-1.5 text-[12.5px] font-medium text-warn transition-colors hover:bg-warn/20"
            >
                <span className="h-1.5 w-1.5 rounded-full bg-warn" />
                {t("wallet", "switch")}
            </button>
        );
    }

    if (w.address) {
        return (
            <div className="group relative">
                <button
                    onClick={() => {
                        void navigator.clipboard.writeText(w.address!);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1400);
                    }}
                    title={t("wallet", "copyAddress")}
                    className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 font-mono text-[12.5px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
                >
                    <span className="h-1.5 w-1.5 rounded-full bg-jade" />
                    {copied ? t("create", "copied") : short(w.address, 4)}
                </button>
                <button
                    onClick={w.disconnect}
                    className="absolute top-full right-0 mt-1 hidden w-max rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-mute shadow-xl transition-colors group-hover:block hover:text-ink"
                >
                    {t("wallet", "disconnect")}
                </button>
            </div>
        );
    }

    return (
        <button
            onClick={w.promptConnect}
            className={
                    compact
                        ? "rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
                    : "rounded-lg bg-bronze-solid px-4 py-2.5 text-[14px] font-medium text-paper transition-colors hover:bg-bronze-solid-2 active:translate-y-px"
            }
        >
            {t("nav", "connect")}
        </button>
    );
}
