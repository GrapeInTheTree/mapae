import {useEffect, useRef, useState, type ReactNode} from "react";
import {Link} from "react-router-dom";
import {BLOCKSCOUT, short} from "../lib/config";
import type {Lang} from "../i18n";

export {Mark, Wordmark, Logo} from "./brand";

/* ------------------------------- surfaces --------------------------------- */

/** The ledger surface: a record of something that already happened. */
export function Card({children, className = ""}: {children: ReactNode; className?: string}) {
    return <div className={`rounded-xl border border-line bg-surface ${className}`}>{children}</div>;
}

/** The acting surface. Anything that takes a decision from the user lives on bone, never on the
 *  dark canvas - the contrast IS the affordance. */
export function Paper({children, className = ""}: {children: ReactNode; className?: string}) {
    return (
        <div className={`rounded-2xl bg-paper text-paper-ink shadow-2xl shadow-black/40 ${className}`}>
            {children}
        </div>
    );
}

/* -------------------------------- controls -------------------------------- */

type ButtonProps = {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: "button" | "submit";
    variant?: "bronze" | "paper" | "ghost" | "danger";
    className?: string;
    title?: string;
};

export function Button({
    children,
    onClick,
    disabled,
    type = "button",
    variant = "bronze",
    className = "",
    title,
}: ButtonProps) {
    const base =
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[14px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-45";
    const styles = {
        bronze: "bg-bronze-solid text-paper hover:bg-bronze-solid-2 active:translate-y-px",
        paper: "border border-paper-line bg-paper-2/60 text-paper-ink hover:bg-paper-2 active:translate-y-px",
        ghost: "border border-line text-ink-2 hover:border-line-strong hover:text-ink",
        danger: "border border-reject-dim bg-reject/10 text-reject hover:bg-reject/20",
    }[variant];
    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            title={title}
            className={`${base} ${styles} ${className}`}
        >
            {children}
        </button>
    );
}

export function Field({
    label,
    hint,
    children,
    suffix,
}: {
    label: string;
    hint?: string;
    children: ReactNode;
    suffix?: ReactNode;
}) {
    return (
        <label className="block">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium text-paper-ink-2">{label}</span>
                {suffix}
            </div>
            {children}
            {hint && <p className="mt-1.5 text-[12px] leading-relaxed text-paper-mute">{hint}</p>}
        </label>
    );
}

const inputBase =
    "w-full rounded-lg border border-paper-line bg-paper-2/40 px-3 py-2.5 text-[14px] text-paper-ink outline-none transition-colors placeholder:text-paper-mute focus:border-bronze-solid focus:bg-paper-2/70";

export function Input({
    value,
    onChange,
    placeholder,
    mono,
    invalid,
    inputMode,
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    mono?: boolean;
    invalid?: boolean;
    inputMode?: "numeric" | "text";
}) {
    return (
        <input
            value={value}
            inputMode={inputMode}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={`${inputBase} ${mono ? "font-mono text-[13px]" : ""} ${
                invalid ? "border-reject-paper focus:border-reject-paper" : ""
            }`}
        />
    );
}

/**
 * A listbox rather than a native `<select>`.
 *
 * The OS dropdown is drawn by the platform, so on the bone surface it opens as a dark slab with
 * its own typography and no relationship to anything around it. Since these controls sit on the
 * one panel where a person decides what authority to grant, the popup has to belong to that
 * panel. Keyboard behaviour follows the native control: Enter or Space opens, arrows move,
 * Enter commits, Escape cancels.
 */
export function Select<T extends string>({
    value,
    onChange,
    options,
}: {
    value: T;
    onChange: (v: T) => void;
    options: {value: T; label: string}[];
}) {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const box = useRef<HTMLDivElement>(null);
    const current = options.find((o) => o.value === value);

    useEffect(() => {
        if (!open) return;
        setActive(Math.max(0, options.findIndex((o) => o.value === value)));
        const onDown = (e: MouseEvent) => {
            if (!box.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [open, options, value]);

    function onKey(e: React.KeyboardEvent) {
        if (!open) {
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
            }
            return;
        }
        if (e.key === "Escape") return setOpen(false);
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(options.length - 1, i + 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
        } else if (e.key === "Enter") {
            e.preventDefault();
            onChange(options[active].value);
            setOpen(false);
        }
    }

    return (
        <div ref={box} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                onKeyDown={onKey}
                aria-haspopup="listbox"
                aria-expanded={open}
                className={`${inputBase} flex items-center justify-between text-left ${
                    open ? "border-bronze-solid bg-paper-2/70" : ""
                }`}
            >
                <span>{current?.label ?? value}</span>
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    className={`shrink-0 text-paper-mute transition-transform ${open ? "rotate-180" : ""}`}
                >
                    <path
                        d="M4 6l4 4 4-4"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </button>

            {open && (
                <ul
                    role="listbox"
                    className="rise absolute z-30 mt-1.5 max-h-64 w-full overflow-auto rounded-xl border border-paper-line bg-paper p-1 shadow-2xl shadow-black/30"
                >
                    {options.map((o, i) => {
                        const selected = o.value === value;
                        return (
                            <li key={o.value} role="option" aria-selected={selected}>
                                <button
                                    type="button"
                                    onMouseEnter={() => setActive(i)}
                                    onClick={() => {
                                        onChange(o.value);
                                        setOpen(false);
                                    }}
                                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[14px] transition-colors ${
                                        i === active ? "bg-paper-2" : ""
                                    } ${selected ? "font-medium text-paper-ink" : "text-paper-ink-2"}`}
                                >
                                    {o.label}
                                    {selected && (
                                        <svg width="14" height="14" viewBox="0 0 16 16" className="text-bronze-solid">
                                            <path
                                                d="M3.5 8.5l3 3 6-7"
                                                stroke="currentColor"
                                                strokeWidth="1.8"
                                                fill="none"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                        </svg>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

/* --------------------------------- status --------------------------------- */

export function StatusPill({ok, label}: {ok: boolean; label: string}) {
    return ok ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-jade-dim bg-jade/10 px-2.5 py-0.5 text-[12.5px] font-medium text-jade">
            <span className="h-1.5 w-1.5 rounded-full bg-jade" />
            {label}
        </span>
    ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-reject-dim bg-reject/10 px-2.5 py-0.5 text-[12.5px] font-medium text-reject">
            <span className="h-1.5 w-1.5 rounded-full bg-reject" />
            {label}
        </span>
    );
}

export function Tag({children, tone = "mute"}: {children: ReactNode; tone?: "mute" | "bronze"}) {
    const s =
        tone === "bronze"
            ? "border-bronze-dim bg-bronze/10 text-bronze-bright"
            : "border-line bg-surface-2 text-mute";
    return (
        <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11.5px] font-medium ${s}`}>
            {children}
        </span>
    );
}

export function Check({ok, children, paper}: {ok: boolean; children: ReactNode; paper?: boolean}) {
    const good = paper ? "var(--color-jade-paper)" : "var(--color-jade)";
    const bad = paper ? "var(--color-reject-paper)" : "var(--color-reject)";
    return (
        <div className="flex items-start gap-2 text-[13.5px]">
            <svg width="15" height="15" viewBox="0 0 15 15" className="mt-0.5 shrink-0">
                <circle cx="7.5" cy="7.5" r="7" fill={ok ? good : bad} opacity="0.16" />
                {ok ? (
                    <path
                        d="M4.3 7.7l2.1 2.1 4.2-4.5"
                        stroke={good}
                        strokeWidth="1.7"
                        fill="none"
                        strokeLinecap="round"
                    />
                ) : (
                    <path d="M5 5l5 5M10 5l-5 5" stroke={bad} strokeWidth="1.7" strokeLinecap="round" />
                )}
            </svg>
            <span
                className={
                    ok
                        ? paper
                            ? "text-paper-ink-2"
                            : "text-ink-2"
                        : paper
                          ? "text-reject-paper"
                          : "text-reject"
                }
            >
                {children}
            </span>
        </div>
    );
}

export function Steps({
    step,
    labels,
    paper,
}: {
    step: number;
    labels: string[];
    paper?: boolean;
}) {
    return (
        <ol className="flex items-center gap-2">
            {labels.map((label, i) => {
                const n = i + 1;
                const done = n < step;
                const now = n === step;
                const ring = now
                    ? "bg-bronze-solid text-paper"
                    : done
                      ? paper
                          ? "bg-paper-ink/85 text-paper"
                          : "bg-line-strong text-ink"
                      : paper
                        ? "border border-paper-line text-paper-mute"
                        : "border border-line text-mute";
                return (
                    <li key={label} className="flex items-center gap-2">
                        <span
                            className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold ${ring}`}
                        >
                            {n}
                        </span>
                        <span
                            className={`text-[13px] ${
                                now
                                    ? paper
                                        ? "font-medium text-paper-ink"
                                        : "font-medium text-ink"
                                    : paper
                                      ? "text-paper-mute"
                                      : "text-mute"
                            }`}
                        >
                            {label}
                        </span>
                        {n < labels.length && (
                            <span
                                className={`mx-1.5 h-px w-8 ${paper ? "bg-paper-line" : "bg-line"}`}
                            />
                        )}
                    </li>
                );
            })}
        </ol>
    );
}

/* --------------------------------- atoms ---------------------------------- */

export function Mono({children, className = ""}: {children: ReactNode; className?: string}) {
    return <span className={`font-mono text-[13px] ${className}`}>{children}</span>;
}

export function TxLink({hash, len = 10}: {hash: string; len?: number}) {
    return (
        <Link to={`/tx/${hash}`} className="font-mono text-[13px] text-bronze-bright hover:underline">
            {short(hash, len)}
        </Link>
    );
}

export function ExtLink({path, children}: {path: string; children: ReactNode}) {
    return (
        <a
            href={`${BLOCKSCOUT}${path}`}
            target="_blank"
            rel="noreferrer"
            className="text-mute transition-colors hover:text-ink-2"
        >
            {children}
        </a>
    );
}

export function AddrText({addr, label}: {addr: string; label?: string}) {
    return (
        <span className="inline-flex items-baseline gap-2">
            {label && <span className="text-[13px] text-mute">{label}</span>}
            <Mono className="text-ink-2">{short(addr, 8)}</Mono>
        </span>
    );
}

export function Spinner({inline}: {inline?: boolean}) {
    const dot = (
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-bronze" />
    );
    return inline ? dot : <div className="flex items-center justify-center py-24">{dot}</div>;
}

export function relTime(at: string | number, lang: Lang): string {
    const t = typeof at === "number" ? at * 1000 : Date.parse(at);
    const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
    if (lang === "ko") {
        if (s < 60) return `${s}초 전`;
        if (s < 3600) return `${Math.floor(s / 60)}분 전`;
        if (s < 86_400) return `${Math.floor(s / 3600)}시간 전`;
        return `${Math.floor(s / 86_400)}일 전`;
    }
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86_400)}d ago`;
}
