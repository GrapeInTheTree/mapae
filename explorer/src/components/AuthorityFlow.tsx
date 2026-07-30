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
 * it off and a valid signature, an unspent limit and an allowed payee are not enough. Nobody has
 * to be told that; they watch it happen in about three seconds.
 *
 * The travelling dot is the point at the centre of the Split Seal - the seal being pressed, and
 * the only part of the mark that has to be earned each time.
 *
 * Motion, not rAF-into-setState. The first version re-rendered React on every frame and moved at
 * a constant speed, which reads as mechanical however pretty the colours are. Here the dot is on
 * a spring, so it gathers speed and settles; a refusal arrives hard and rings; and none of it
 * touches the render cycle.
 */

type GateId = "identity" | "period" | "payee" | "window";

/** Fraction along the track, 0 at the account and 1 at the merchant. */
const GATES: {id: GateId; at: number}[] = [
    {id: "identity", at: 0.28},
    {id: "period", at: 0.43},
    {id: "payee", at: 0.58},
    {id: "window", at: 0.73},
];

/** On a phone-width track the desktop fractions put 80px gates ~50px apart - they overlap into
 *  an unreadable pile. Below the breakpoint the gates shrink and spread nearly edge to edge. */
const GATES_COMPACT: Record<GateId, number> = {
    identity: 0.14,
    period: 0.38,
    payee: 0.62,
    window: 0.86,
};

const HOLD_MS = 2400;

export function AuthorityFlow() {
    const {t} = useLang();
    const reduced = useReducedMotion();

    const [open, setOpen] = useState<Record<GateId, boolean>>({
        identity: true,
        period: true,
        payee: true,
        window: true,
    });
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

    const compact = width > 0 && width < 560;
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

    return (
        <motion.div
            initial={{opacity: 0, y: 12}}
            whileInView={{opacity: 1, y: 0}}
            viewport={{once: true, margin: "-80px"}}
            transition={{duration: 0.5, ease: [0.2, 0.7, 0.3, 1]}}
            className="overflow-hidden rounded-2xl border border-line bg-surface"
        >
            <div className="flex flex-wrap items-end justify-between gap-3 px-6 pt-6 sm:px-8">
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
                            onClick={() =>
                                setOpen({identity: true, period: true, payee: true, window: true})
                            }
                            className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-mute transition-colors hover:border-line-strong hover:text-ink"
                        >
                            {t("home", "flowReset")}
                        </motion.button>
                    )}
                </AnimatePresence>
            </div>

            {/* -------------------------------- the track ------------------------------- */}
            {/* Gates sit ABOVE the rail on short stems, the way stations sit above a line.
                Drawing them on the rail meant the line cut straight through each card and the
                travelling dot came to rest inside one - overlap that reads as broken rather than
                as layered. Nothing crosses anything now. */}
            <div className="px-6 pt-9 pb-5 sm:px-8">
                <div ref={trackRef} className="relative h-[132px]">
                    {GATES.map((g) => {
                        const isOpen = open[g.id];
                        const passed = isOpen && arrived && (!blocker || g.at < blocker.at);
                        // The gate that is refusing stays red for as long as it is off: it is the
                        // reason, not an event. Only the shake is tied to the moment of arrival.
                        const blocking = blocker?.id === g.id;
                        const justBlocked = blocking && arrived;
                        return (
                            <button
                                key={g.id}
                                onClick={() => setOpen((o) => ({...o, [g.id]: !o[g.id]}))}
                                style={{left: `${pos(g) * 100}%`}}
                                aria-pressed={!isOpen}
                                /* z below the sticky header (z-30): at z-20 the gates tied the
                                   old header z and, being later in the DOM, painted on top of
                                   the chrome while scrolling past. */
                                className="group absolute top-0 z-[5] -translate-x-1/2 focus:outline-none"
                            >
                                <motion.span
                                    animate={
                                        justBlocked && !reduced
                                            ? {x: [0, -5, 5, -3, 3, 0], scale: 1.04}
                                            : {x: 0, scale: passed ? 1.02 : 1}
                                    }
                                    transition={
                                        justBlocked
                                            ? {duration: 0.42, ease: "easeOut"}
                                            : {type: "spring", stiffness: 320, damping: 22}
                                    }
                                    className={`flex flex-col items-center justify-center gap-1 rounded-xl border shadow-lg shadow-black/30 transition-colors duration-300 ${
                                        compact ? "h-[56px] w-[64px]" : "h-[64px] w-[80px]"
                                    } ${
                                        blocking
                                            ? "border-reject bg-reject/15 text-reject"
                                            : !isOpen
                                              ? "border-line-strong bg-surface-2 text-mute"
                                              : passed
                                                ? "border-jade-dim bg-jade/10 text-jade"
                                                : "border-line-strong bg-surface-2 text-ink-2 group-hover:border-bronze-dim"
                                    }`}
                                >
                                    <span className={compact ? "text-[11px] font-medium" : "text-[12px] font-medium"}>
                                        {t("home", `flow${cap(g.id)}` as never)}
                                    </span>
                                    <span className={compact ? "text-[10px] opacity-70" : "text-[10.5px] opacity-70"}>
                                        {isOpen ? t("home", "flowLive") : t("home", "flowOff")}
                                    </span>
                                </motion.span>
                                {/* Stem down to the rail. */}
                                <span
                                    className={`mx-auto block w-px transition-colors duration-300 ${
                                        blocking
                                            ? "bg-reject"
                                            : passed
                                              ? "bg-jade-dim"
                                              : "bg-line-strong"
                                    }`}
                                    style={{height: compact ? 30 : 22}}
                                />
                            </button>
                        );
                    })}

                    {/* Rail, with the distance actually travelled drawn over it. */}
                    <div className="absolute top-[86px] right-0 left-0 h-px bg-line-strong" />
                    <motion.div
                        key={`rail-${run}`}
                        initial={{scaleX: 0}}
                        animate={{scaleX: stopAt}}
                        transition={
                            reduced
                                ? {duration: 0}
                                : {type: "spring", stiffness: 26, damping: 14, mass: 1.1}
                        }
                        style={{originX: 0}}
                        className={`absolute top-[86px] right-0 left-0 h-px ${
                            blocker ? "bg-reject/70" : "bg-bronze"
                        }`}
                    />

                    {/* The seal point, travelling on the rail - never inside a card. */}
                    {width > 0 && (
                        <motion.div
                            key={`dot-${run}`}
                            initial={{x: 0, opacity: 0}}
                            animate={{x: target, opacity: 1}}
                            transition={
                                reduced
                                    ? {duration: 0}
                                    : {
                                          x: {type: "spring", stiffness: 26, damping: 14, mass: 1.1},
                                          opacity: {duration: 0.25},
                                      }
                            }
                            onAnimationComplete={() => {
                                setArrived(true);
                                if (reduced) return;
                                window.setTimeout(() => {
                                    setArrived(false);
                                    setRun((r) => r + 1);
                                }, HOLD_MS);
                            }}
                            className="absolute top-[86px] left-0 z-[6] -translate-y-1/2"
                        >
                            <span className="relative block">
                                <motion.span
                                    animate={{
                                        backgroundColor: blocker
                                            ? "var(--color-reject)"
                                            : "var(--color-bronze-bright)",
                                    }}
                                    className="block h-2.5 w-2.5 -translate-x-1/2 rounded-full"
                                    style={{
                                        boxShadow: blocker
                                            ? "0 0 12px 3px color-mix(in srgb, var(--color-reject) 45%, transparent)"
                                            : "0 0 12px 3px color-mix(in srgb, var(--color-bronze) 40%, transparent)",
                                    }}
                                />
                                <AnimatePresence>
                                    {arrived && blocker && !reduced && (
                                        <motion.span
                                            initial={{scale: 0.4, opacity: 0.85}}
                                            animate={{scale: 3.4, opacity: 0}}
                                            exit={{opacity: 0}}
                                            transition={{duration: 0.7, ease: "easeOut"}}
                                            className="absolute top-1/2 left-0 block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-reject"
                                        />
                                    )}
                                </AnimatePresence>
                            </span>
                        </motion.div>
                    )}

                    {/* Endpoints, below the rail so they clear the stems. */}
                    <div className="absolute top-[98px] left-0 text-[13px] font-medium text-ink">
                        {t("home", "chainAccount")}
                    </div>
                    <motion.div
                        animate={{
                            color: arrived && !blocker ? "var(--color-jade)" : "var(--color-mute)",
                        }}
                        className="absolute top-[98px] right-0 text-[13px] font-medium"
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
                className="flex items-start gap-3 border-t border-line px-6 py-4 sm:px-8"
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
                        <span
                            className={`font-medium ${
                                blocker ? "text-reject" : "text-jade"
                            }`}
                        >
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
