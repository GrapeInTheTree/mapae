import {useEffect, useRef} from "react";
import {animate, motion, useInView, useMotionValue, useReducedMotion, useTransform} from "motion/react";
import {useLang} from "../i18n";
import type {Stats as StatsData} from "../lib/data";

/**
 * The four numbers that say whether any of this is real.
 *
 * A row of flat figures reads as a placeholder, so they arrive rather than appear: each counts up
 * once, staggered, when the row first comes into view. The point is not the animation - it is
 * that a number which climbs is a number someone is claiming to have measured, and these were
 * measured. The line underneath says exactly how, because "6 payments" from an unnamed source is
 * worth nothing.
 *
 * "Refused" is deliberately given the same weight as "settled". It is not an error rate; it is
 * the product working. A ledger that only counted successes would be advertising the wrong thing.
 */

interface Figure {
    label: string;
    value?: number;
    tone?: "jade" | "reject";
    note: string;
}

export function Stats({stats}: {stats: StatsData | null}) {
    const {t, lang} = useLang();
    const ref = useRef<HTMLDivElement>(null);
    const inView = useInView(ref, {once: true, margin: "-60px"});

    const figures: Figure[] = [
        {
            label: t("home", "statActive"),
            value: stats?.delegations,
            note: lang === "ko" ? "서명되어 사용된 권한" : "signed, and used at least once",
        },
        {
            label: t("home", "statSettled"),
            value: stats?.redemptions,
            tone: "jade",
            note: lang === "ko" ? "조건을 모두 통과함" : "passed every condition",
        },
        {
            label: t("home", "statBlocked"),
            value: stats?.rejections,
            tone: "reject",
            note: lang === "ko" ? "조건 하나에 막힘" : "stopped by one condition",
        },
        {
            label: t("home", "statPrincipals"),
            value: stats?.principals,
            note: lang === "ko" ? "도장으로 실명 확인됨" : "verified by a Dojang attestation",
        },
    ];

    return (
        <div ref={ref}>
            <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-surface sm:grid-cols-4">
                {figures.map((f, i) => (
                    <motion.div
                        key={f.label}
                        initial={{opacity: 0, y: 8}}
                        animate={inView ? {opacity: 1, y: 0} : {}}
                        transition={{delay: i * 0.07, duration: 0.45, ease: [0.2, 0.7, 0.3, 1]}}
                        className={`relative px-6 py-6 ${
                            i % 2 === 1 ? "border-l border-line" : ""
                        } ${i >= 2 ? "border-t border-line sm:border-t-0" : ""} ${
                            i >= 1 ? "sm:border-l sm:border-line" : ""
                        }`}
                    >
                        <div className="flex items-center gap-2">
                            {f.tone && (
                                <span
                                    className={`h-1.5 w-1.5 rounded-full ${
                                        f.tone === "jade" ? "bg-jade" : "bg-reject"
                                    }`}
                                />
                            )}
                            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-mute">
                                {f.label}
                            </span>
                        </div>

                        <Counter value={f.value} start={inView} tone={f.tone} delay={i * 0.07} />

                        <p className="mt-1.5 text-[11.5px] leading-relaxed text-mute">{f.note}</p>
                    </motion.div>
                ))}
            </div>

            {stats && (
                <motion.p
                    initial={{opacity: 0}}
                    animate={inView ? {opacity: 1} : {}}
                    transition={{delay: 0.35, duration: 0.4}}
                    className="mt-3 flex flex-wrap items-center justify-end gap-x-2 text-[11.5px] text-mute"
                >
                    <span className="inline-flex items-center gap-1.5">
                        <span className="h-1 w-1 rounded-full bg-jade" />
                        {lang === "ko"
                            ? `빌드 시점 체크포인트 + 이후 ${stats.deltaBlocks.toLocaleString()}블록을 방금 직접 스캔`
                            : `Build-time checkpoint plus ${stats.deltaBlocks.toLocaleString()} blocks scanned just now`}
                    </span>
                    <span className="tnum font-mono opacity-70">
                        #{stats.headBlock.toLocaleString()}
                    </span>
                </motion.p>
            )}
        </div>
    );
}

/** Counts up once. A figure that climbs reads as measured; one that is simply printed does not. */
function Counter({
    value,
    start,
    tone,
    delay,
}: {
    value?: number;
    start: boolean;
    tone?: "jade" | "reject";
    delay: number;
}) {
    const reduced = useReducedMotion();
    const mv = useMotionValue(0);
    const text = useTransform(mv, (v) => Math.round(v).toLocaleString());

    useEffect(() => {
        if (value === undefined || !start) return;
        if (reduced) {
            mv.set(value);
            return;
        }
        const controls = animate(mv, value, {
            duration: Math.min(1.1, 0.35 + value * 0.02),
            delay,
            ease: [0.2, 0.7, 0.3, 1],
        });
        return () => controls.stop();
    }, [value, start, reduced, mv, delay]);

    const colour =
        tone === "jade" ? "text-jade" : tone === "reject" ? "text-reject" : "text-ink";

    return (
        <div className={`tnum mt-2 text-[34px] leading-none font-semibold tracking-tight ${colour}`}>
            {value === undefined ? "—" : <motion.span>{text}</motion.span>}
        </div>
    );
}
