/**
 * The Split Seal.
 *
 * Two halves of one seal, faced toward each other but never touching: the left is the PRINCIPAL,
 * the right is the AGENT, and the space between them is the DELEGATION. Their facing edges are
 * cut at 30 degrees, so the gap reads as an X - authority crossing from one party to the other.
 * The dot at the crossing is where the seal is actually pressed: signature, verification, policy
 * enforcement. That point is the entire product, so it is the one mark that never disappears,
 * even at 16px.
 *
 * A real mapae could be forged because it was only an object. This one is a geometry with a
 * centre that has to be earned every time it is used.
 */

const GEOM = {
    /** Viewbox is square; every coordinate below is derived from these. */
    size: 64,
    /**
     * The mark is deliberately tall and narrow. The first vector export used a 6px margin and
     * filled too much of the square, which made the seal look heavy. A 13px margin restores the
     * original enterprise concept's architectural proportion.
     */
    margin: 13,
    /** Width of one monolithic half. */
    halfWidth: 12,
    /** Vertical inset of the facing (short) edge - 17 * tan(30 degrees). */
    inset: 9.8,
    /** Height of the outer (tall) edge. */
    top: 5,
} as const;

const {size, margin, halfWidth, inset, top} = GEOM;
const bottom = size - top;
const centre = size / 2;
const innerLeft = margin + halfWidth;
const innerRight = size - margin - halfWidth;

/** Left half: tall outer edge, short inner edge, cut at 30 degrees top and bottom. */
const LEFT = `M${margin} ${top} L${innerLeft} ${top + inset} L${innerLeft} ${bottom - inset} L${margin} ${bottom} Z`;
/** Right half: the same shape mirrored about the vertical axis. */
const RIGHT = `M${size - margin} ${top} L${innerRight} ${top + inset} L${innerRight} ${bottom - inset} L${size - margin} ${bottom} Z`;

export function Mark({
    size: px = 28,
    tone = "bone",
    className = "",
}: {
    size?: number;
    /** `bone` on dark, `ink` on paper, `bronze` where authority is the subject. */
    tone?: "bone" | "ink" | "bronze";
    className?: string;
}) {
    const fill =
        tone === "ink"
            ? "var(--color-paper-ink)"
            : tone === "bronze"
              ? "var(--color-bronze-solid)"
              : "var(--color-ink)";
    return (
        <svg
            width={px}
            height={px}
            viewBox={`0 0 ${size} ${size}`}
            className={className}
            role="img"
            aria-label="Mapae"
        >
            <path d={LEFT} fill={fill} />
            <path d={RIGHT} fill={fill} />
            {/* Optical seal point: present at 16px without dominating the delegation gap. */}
            <circle cx={centre} cy={centre} r={2.2} fill={fill} />
        </svg>
    );
}

/** Restrained uppercase, wide tracking. Never set in the display serif - the wordmark is a label,
 *  not a voice. */
export function Wordmark({
    className = "",
    tone = "bone",
}: {
    className?: string;
    tone?: "bone" | "ink";
}) {
    return (
        <span
            className={`font-medium uppercase ${
                tone === "ink" ? "text-paper-ink" : "text-ink"
            } ${className}`}
            style={{letterSpacing: "0.22em"}}
        >
            Mapae
        </span>
    );
}

export function Logo({
    px = 24,
    tone = "bone",
    className = "",
}: {
    px?: number;
    tone?: "bone" | "ink";
    className?: string;
}) {
    return (
        /* Optically ~1px high of geometric centre: the seal's visual weight hangs low and the
           wordmark is all caps (no descenders), so exact centring reads as sitting slightly
           below the nav. Tuned against the header by eye, not by box math. */
        <span className={`inline-flex -translate-y-[0.5px] items-center gap-2.5 ${className}`}>
            <Mark size={px} tone={tone} />
            <Wordmark tone={tone} className="text-[14px] leading-none" />
        </span>
    );
}
