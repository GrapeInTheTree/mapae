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

    const attempts = (stats?.redemptions ?? 0) + (stats?.rejections ?? 0);

    return (
        <div ref={ref}>
            <div className="overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="grid grid-cols-2 sm:grid-cols-4">
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
                                <span className="caps text-[11px] font-semibold text-mute">
                                    {f.label}
                                </span>
                            </div>

                            <Counter value={f.value} start={inView} tone={f.tone} delay={i * 0.07} />

                            <p className="mt-1.5 text-[11.5px] leading-relaxed text-mute">{f.note}</p>
                        </motion.div>
                    ))}
                </div>

                {/* The verdict bar. Settled and refused are not two independent counts - they are
                    one population of attempts, split by the contract. Drawing the split makes the
                    thesis visible at a glance: roughly half of everything this ledger records is
                    a refusal, and that is the product working, not failing. */}
                {stats && attempts > 0 && (
                    <motion.div
                        initial={{opacity: 0}}
                        animate={inView ? {opacity: 1} : {}}
                        transition={{delay: 0.3, duration: 0.45}}
                        className="border-t border-line px-6 py-4"
                    >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[11.5px]">
                            <span className="text-mute">
                                {lang === "ko"
                                    ? `결제 시도 ${attempts}건 — 전부 이 원장에 있습니다`
                                    : `${attempts} payment attempts - every one of them on this ledger`}
                            </span>
                            <span className="tnum flex items-center gap-2">
                                <span className="text-jade">
                                    {lang === "ko" ? `승인 ${stats.redemptions}` : `${stats.redemptions} settled`}
                                </span>
                                <span className="text-mute">·</span>
                                <span className="text-reject">
                                    {lang === "ko" ? `거부 ${stats.rejections}` : `${stats.rejections} refused`}
                                </span>
                            </span>
                        </div>
                        <div className="mt-2.5 flex h-[3px] gap-px overflow-hidden rounded-full">
                            <motion.div
                                className="rounded-full bg-jade/80"
                                initial={{flexGrow: 0}}
                                animate={inView ? {flexGrow: stats.redemptions} : {}}
                                transition={{delay: 0.45, duration: 0.8, ease: [0.2, 0.7, 0.3, 1]}}
                            />
                            <motion.div
                                className="rounded-full bg-reject/70"
                                initial={{flexGrow: 0}}
                                animate={inView ? {flexGrow: stats.rejections} : {}}
                                transition={{delay: 0.45, duration: 0.8, ease: [0.2, 0.7, 0.3, 1]}}
                            />
                        </div>
                    </motion.div>
                )}
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
        /* The display serif, same voice as the page headline. Sans-bold figures read as a
           dashboard; these are entries in a ledger, and the editorial face says so. One figure
           per cell, so proportional oldstyle numerals cost nothing in alignment. */
        <div className={`display mt-2.5 text-[40px] leading-none ${colour}`}>
            {value === undefined ? "—" : <motion.span>{text}</motion.span>}
        </div>
    );
}
