import type {ReactNode} from "react";
import {Link} from "react-router-dom";
import {BLOCKSCOUT, short} from "../lib/config";

/** The bronze plate. One mark, everywhere. */
export function Mark({size = 34}: {size?: number}) {
    return (
        <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden>
            <circle cx="17" cy="17" r="16" fill="var(--color-bronze)" />
            <circle cx="17" cy="17" r="13.2" fill="none" stroke="var(--color-bg)" strokeWidth="1.4" />
            <text
                x="17"
                y="23.5"
                textAnchor="middle"
                fontSize="16"
                fontFamily="Noto Serif KR, serif"
                fontWeight="700"
                fill="var(--color-bg)"
            >
                馬
            </text>
        </svg>
    );
}

export function Card({children, className = ""}: {children: ReactNode; className?: string}) {
    return (
        <div className={`rounded-xl border border-line bg-surface ${className}`}>{children}</div>
    );
}

export function StatusPill({ok, label}: {ok: boolean; label?: string}) {
    return ok ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-jade-dim bg-jade/10 px-2.5 py-0.5 text-[13px] font-medium text-jade">
            <span className="h-1.5 w-1.5 rounded-full bg-jade" />
            {label ?? "승인"}
        </span>
    ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-reject-dim bg-reject/10 px-2.5 py-0.5 text-[13px] font-medium text-reject">
            <span className="h-1.5 w-1.5 rounded-full bg-reject" />
            {label ?? "거부"}
        </span>
    );
}

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

export function Check({ok, children}: {ok: boolean; children: ReactNode}) {
    return (
        <div className="flex items-center gap-2 text-[13.5px]">
            {ok ? (
                <svg width="15" height="15" viewBox="0 0 15 15" className="shrink-0">
                    <circle cx="7.5" cy="7.5" r="7" fill="var(--color-jade)" opacity="0.15" />
                    <path
                        d="M4.3 7.7l2.1 2.1 4.2-4.5"
                        stroke="var(--color-jade)"
                        strokeWidth="1.6"
                        fill="none"
                        strokeLinecap="round"
                    />
                </svg>
            ) : (
                <svg width="15" height="15" viewBox="0 0 15 15" className="shrink-0">
                    <circle cx="7.5" cy="7.5" r="7" fill="var(--color-reject)" opacity="0.15" />
                    <path
                        d="M5 5l5 5M10 5l-5 5"
                        stroke="var(--color-reject)"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                    />
                </svg>
            )}
            <span className={ok ? "text-ink-2" : "text-reject"}>{children}</span>
        </div>
    );
}

export function Spinner() {
    return (
        <div className="flex items-center justify-center py-24">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-bronze" />
        </div>
    );
}

export function relTime(iso: string | number): string {
    const t = typeof iso === "number" ? iso * 1000 : Date.parse(iso);
    const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return `${s}초 전`;
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86_400) return `${Math.floor(s / 3600)}시간 전`;
    return `${Math.floor(s / 86_400)}일 전`;
}
