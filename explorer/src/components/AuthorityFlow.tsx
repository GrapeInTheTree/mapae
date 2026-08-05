import {useEffect, useRef, useState} from "react";
import {AnimatePresence, motion, useReducedMotion} from "motion/react";
import {useLang} from "../i18n";

/**
 * The product, as something you do rather than something you read.
 *
 * Every explainer diagram for a payment system draws the happy path: money leaves here, arrives
 * there. That is the least interesting thing Mapae does. What it sells is not the ability to
 * spend but the ability to REFUSE - so this diagram lets you refuse.
 *
 * A payment leaves the account and runs at the conditions the principal signed. Switch one off
 * and it stops there, visibly, with the reason. The identity gate is the one that matters: turn
 * it off and a valid signature, an unspent limit and an allowed payee are not enough.
 *
 * The gates are seal nodes ON the ledger line - small diamonds, the stamp of the Split Seal.
 * A node fills with light as the payment passes it, goes hollow when its condition is revoked,
 * and turns red when it is the one refusing. Two earlier versions drew boxes above the line
 * (first captioned "on/off" like a toy, then engraved tablets); both made the line carry
 * furniture. The line is the picture - the gates had to live on it.
 *
 * Motion, not rAF-into-setState: the pulse rides a spring, a refusal lands hard and rings, and
 * none of it touches the render cycle.
 */

type GateId = "identity" | "period" | "perTx" | "payee" | "window";

const RAIL = 84; // y of the ledger line inside the track

/** Fraction along the track, 0 at the account and 1 at the merchant. */
const GATES: {id: GateId; at: number}[] = [
    {id: "identity", at: 0.22},
    {id: "period", at: 0.36},
    {id: "perTx", at: 0.5},
    {id: "payee", at: 0.64},
    {id: "window", at: 0.78},
];

/** Phone widths spread the five tablets nearly edge to edge; labels are dropped there (the
 *  glyphs carry the meaning, aria carries the words) so nothing collides with the endpoints. */
const GATES_COMPACT: Record<GateId, number> = {
    identity: 0.1,
    period: 0.3,
    perTx: 0.5,
    payee: 0.7,
    window: 0.9,
};

const ALL_OPEN: Record<GateId, boolean> = {
    identity: true,
    period: true,
    perTx: true,
    payee: true,
    window: true,
};

const HOLD_MS = 2400;

export function AuthorityFlow() {
    const {t} = useLang();
    const reduced = useReducedMotion();

    const [open, setOpen] = useState<Record<GateId, boolean>>(ALL_OPEN);
    /** Bumped to replay the run - a fresh key restarts the spring from the account. */
    const [run, setRun] = useState(0);
    const [arrived, setArrived] = useState(false);

    const trackRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const el = trackRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
        ro.observe(el);
        setWidth(el.getBoundingClientRect().width);
        return () => ro.disconnect();
    }, []);

    const compact = width > 0 && width < 620;
    const pos = (g: {id: GateId; at: number}) => (compact ? GATES_COMPACT[g.id] : g.at);

    const blocker = GATES.find((g) => !open[g.id]);
    const stopAt = blocker ? pos(blocker) : 1;

    // Restart whenever the policy changes, so a click is answered immediately.
    useEffect(() => {
        setArrived(false);
        setRun((r) => r + 1);
    }, [stopAt]);

    const verdict = blocker
        ? {
              tone: "reject" as const,
              title: t("home", `flow${cap(blocker.id)}` as never),
              body: t("home", `flow${cap(blocker.id)}Stop` as never),
          }
        : {tone: "jade" as const, title: t("home", "flowOkTitle"), body: t("home", "flowOk")};

    const target = width * stopAt;
    const spring = {type: "spring" as const, stiffness: 26, damping: 14, mass: 1.1};

    return (
        <motion.div
            initial={{opacity: 0, y: 12}}
            whileInView={{opacity: 1, y: 0}}
            viewport={{once: true, margin: "-80px"}}
            transition={{duration: 0.5, ease: [0.2, 0.7, 0.3, 1]}}
            className="relative overflow-hidden rounded-2xl border border-line bg-surface"
        >
            {/* A quiet wash from above - the stage lit, not decorated. */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                    background:
                        "radial-gradient(110% 130% at 50% -30%, color-mix(in srgb, var(--color-bronze) 7%, transparent), transparent 62%)",
                }}
            />

            <div className="relative flex flex-wrap items-end justify-between gap-3 px-6 pt-6 sm:px-8">
                <div>
                    <h2 className="text-[17px] font-semibold text-ink">{t("home", "flowTitle")}</h2>
                    <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-mute">
                        {t("home", "flowLede")}
                    </p>
                </div>
                <AnimatePresence>
                    {blocker && (
                        <motion.button
                            initial={{opacity: 0, scale: 0.94}}
                            animate={{opacity: 1, scale: 1}}
                            exit={{opacity: 0, scale: 0.94}}
                            transition={{duration: 0.18}}
                            onClick={() => setOpen(ALL_OPEN)}
                            className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-mute transition-colors hover:border-line-strong hover:text-ink"
                        >
                            {t("home", "flowReset")}
                        </motion.button>
                    )}
                </AnimatePresence>
            </div>

            {/* -------------------------------- the track ------------------------------- */}
            {/* Seal nodes ON the line. Names float above each node; the node itself is the
                switch, with a generous invisible hit area. Nothing hangs, nothing crosses. */}
            <div className="relative px-6 pt-6 pb-4 sm:px-8">
                <div ref={trackRef} className="relative h-[140px]">
                    {GATES.map((g) => {
                        const isOpen = open[g.id];
                        const passed = isOpen && arrived && (!blocker || g.at < blocker.at);
                        // The refusing gate stays red for as long as it is off: it is the reason,
                        // not an event. Only the shake is tied to the moment of arrival.
                        const blocking = blocker?.id === g.id;
                        const justBlocked = blocking && arrived;
                        const dimmedOff = !isOpen && !blocking;
                        return (
                            <button
                                key={g.id}
                                onClick={() => setOpen((o) => ({...o, [g.id]: !o[g.id]}))}
                                style={{left: `${pos(g) * 100}%`, top: RAIL}}
                                aria-pressed={!isOpen}
                                aria-label={t("home", `flow${cap(g.id)}` as never)}
                                title={t("home", `flow${cap(g.id)}` as never)}
                                className="group absolute z-[5] flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center focus:outline-none"
                            >
                                {/* The seal: a diamond stamped on the line. Filled while lit,
                                    hollow when revoked, red when refusing. */}
                                <motion.span
                                    animate={
                                        justBlocked && !reduced
                                            ? {rotate: [45, 38, 52, 42, 48, 45], scale: 1.12}
                                            : {rotate: 45, scale: passed ? 1.15 : blocking ? 1.12 : 1}
                                    }
                                    transition={
                                        justBlocked
                                            ? {duration: 0.42, ease: "easeOut"}
                                            : {type: "spring", stiffness: 320, damping: 20}
                                    }
                                    style={{
                                        boxShadow: blocking
                                            ? "0 0 16px color-mix(in srgb, var(--color-reject) 45%, transparent)"
                                            : passed
                                              ? "0 0 16px color-mix(in srgb, var(--color-bronze) 40%, transparent)"
                                              : "none",
                                    }}
                                    className={`block h-[13px] w-[13px] rounded-[3px] border transition-colors duration-300 ${
                                        blocking
                                            ? "border-reject bg-reject/80"
                                            : dimmedOff
                                              ? "border-line-strong bg-surface"
                                              : passed
                                                ? "border-bronze-bright bg-bronze-bright"
                                                : "border-bronze-dim bg-surface-2 group-hover:border-bronze-bright"
                                    }`}
                                />
                                {/* The name, floating above its node. Hidden on phones - the
                                    verdict line carries the words there. */}
                                {!compact && (
                                    <span
                                        className={`caps pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-semibold whitespace-nowrap transition-colors duration-300 ${
                                            blocking
                                                ? "text-reject"
                                                : dimmedOff
                                                  ? "text-mute/45 line-through"
                                                  : passed
                                                    ? "text-bronze-bright"
                                                    : "text-mute group-hover:text-ink-2"
                                        }`}
                                    >
                                        {t("home", `flow${cap(g.id)}` as never)}
                                    </span>
                                )}
                            </button>
                        );
                    })}

                    {/* The ledger line, and over it the distance actually travelled - drawn as
                        light: a glow layer under a bright core. */}
                    <div className="absolute right-0 left-0 h-px bg-line-strong" style={{top: RAIL}} />
                    <motion.div
                        key={`glow-${run}`}
                        initial={{scaleX: 0}}
                        animate={{scaleX: stopAt}}
                        transition={reduced ? {duration: 0} : spring}
                        style={{
                            originX: 0,
                            top: RAIL - 2,
                            background: blocker
                                ? "linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-reject) 45%, transparent))"
                                : "linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-bronze) 55%, transparent))",
                            filter: "blur(5px)",
                        }}
                        className="absolute right-0 left-0 h-[5px]"
                    />
                    <motion.div
                        key={`rail-${run}`}
                        initial={{scaleX: 0}}
                        animate={{scaleX: stopAt}}
                        transition={reduced ? {duration: 0} : spring}
                        style={{
                            originX: 0,
                            top: RAIL,
                            background: blocker
                                ? "linear-gradient(90deg, color-mix(in srgb, var(--color-reject) 25%, transparent), var(--color-reject))"
                                : "linear-gradient(90deg, color-mix(in srgb, var(--color-bronze) 30%, transparent), var(--color-bronze-bright))",
                        }}
                        className="absolute right-0 left-0 h-px"
                    />

                    {/* The seal point, travelling the line. */}
                    {width > 0 && (
                        <motion.div
                            key={`dot-${run}`}
                            initial={{x: 0, opacity: 0}}
                            animate={{x: target, opacity: 1}}
                            transition={
                                reduced ? {duration: 0} : {x: spring, opacity: {duration: 0.25}}
                            }
                            onAnimationComplete={() => {
                                setArrived(true);
                                if (reduced) return;
                                window.setTimeout(() => {
                                    setArrived(false);
                                    setRun((r) => r + 1);
                                }, HOLD_MS);
                            }}
                            className="absolute left-0 z-[6] -translate-y-1/2"
                            style={{top: RAIL}}
                        >
                            <span className="relative block">
                                <motion.span
                                    animate={{
                                        backgroundColor: blocker
                                            ? "var(--color-reject)"
                                            : "var(--color-bronze-bright)",
                                    }}
                                    className="block h-[9px] w-[9px] -translate-x-1/2 rounded-full"
                                    style={{
                                        boxShadow: blocker
                                            ? "0 0 14px 4px color-mix(in srgb, var(--color-reject) 45%, transparent)"
                                            : "0 0 14px 4px color-mix(in srgb, var(--color-bronze) 45%, transparent), 0 0 34px 10px color-mix(in srgb, var(--color-bronze) 14%, transparent)",
                                    }}
                                />
                                <AnimatePresence>
                                    {arrived && blocker && !reduced && (
                                        <motion.span
                                            initial={{scale: 0.4, opacity: 0.85}}
                                            animate={{scale: 3.6, opacity: 0}}
                                            exit={{opacity: 0}}
                                            transition={{duration: 0.7, ease: "easeOut"}}
                                            className="absolute top-1/2 left-0 block h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-reject"
                                        />
                                    )}
                                    {arrived && !blocker && !reduced && (
                                        <motion.span
                                            initial={{scale: 0.4, opacity: 0.7}}
                                            animate={{scale: 3, opacity: 0}}
                                            exit={{opacity: 0}}
                                            transition={{duration: 0.8, ease: "easeOut"}}
                                            className="absolute top-1/2 left-0 block h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-jade"
                                        />
                                    )}
                                </AnimatePresence>
                            </span>
                        </motion.div>
                    )}

                    {/* Endpoints. */}
                    <div
                        className="absolute left-0 text-[13px] font-medium text-ink"
                        style={{top: RAIL + 26}}
                    >
                        {t("home", "chainAccount")}
                    </div>
                    <motion.div
                        animate={{
                            color: arrived && !blocker ? "var(--color-jade)" : "var(--color-mute)",
                        }}
                        className="absolute right-0 text-[13px] font-medium"
                        style={{top: RAIL + 26}}
                    >
                        {t("home", "chainMerchant")}
                    </motion.div>
                </div>
            </div>

            {/* --------------------------------- verdict -------------------------------- */}
            <motion.div
                animate={{
                    backgroundColor: blocker
                        ? "color-mix(in srgb, var(--color-reject) 5%, transparent)"
                        : "color-mix(in srgb, var(--color-jade) 4%, transparent)",
                }}
                transition={{duration: 0.3}}
                className="relative flex items-start gap-3 border-t border-line px-6 py-4 sm:px-8"
            >
                <motion.span
                    animate={{
                        backgroundColor: blocker ? "var(--color-reject)" : "var(--color-jade)",
                    }}
                    className="mt-[6px] h-2 w-2 shrink-0 rounded-full"
                />
                <AnimatePresence mode="wait">
                    <motion.p
                        key={blocker?.id ?? "ok"}
                        initial={{opacity: 0, y: 4}}
                        animate={{opacity: 1, y: 0}}
                        exit={{opacity: 0, y: -4}}
                        transition={{duration: 0.22}}
                        className="text-[13.5px] leading-relaxed text-ink-2"
                    >
                        <span className={`font-medium ${blocker ? "text-reject" : "text-jade"}`}>
                            {verdict.title}
                        </span>
                        {" — "}
                        {verdict.body}
                        {!blocker && <span className="ml-2 text-mute">{t("home", "flowHint")}</span>}
                    </motion.p>
                </AnimatePresence>
            </motion.div>
        </motion.div>
    );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
