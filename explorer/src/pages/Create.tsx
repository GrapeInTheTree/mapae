import {useMemo, useState} from "react";
import {Link, useNavigate, useSearchParams} from "react-router-dom";
import {getAddress, isAddress, keccak256, toHex, type Address, type Hex} from "viem";
import {
    DELEGATION_TYPES,
    delegationDomain,
    encodePermissionContext,
    type Delegation,
} from "@mapae/sdk";
import {ROOT_AUTHORITY, TESTNET_FAUCET_ID, UPBIT_KOREA_ID} from "@mapae/protocol";

import {
    AddressInput,
    Card,
    AmountInput,
    Button,
    Check,
    Field,
    FormSection,
    Input,
    Mark,
    Paper,
    Select,
    Spinner,
    Steps,
    Toggle,
} from "../components/ui";
import {ConnectButton} from "../components/Connect";
import {useLang, usePreset} from "../i18n";
import {addresses, giwaSepolia, short} from "../lib/config";
import {readableError, useDojangStatus, useIssueDojang, useMapaeAccount, useMintTestKRW, useTokenBalance} from "../lib/account";
import {
    decodeCondition,
    encodeConditions,
    fmtDate,
    fmtDuration,
    fmtToken,
    issuerName,
    renderCondition,
    roundTrips,
    type Condition,
} from "../lib/policy";
import {buildConditions, COMING_NEXT, freshSalt, preset, type PresetForm, type PresetId} from "../lib/presets";
import * as store from "../lib/store";
import {useWallet} from "../lib/wallet";

/**
 * The Composer.
 *
 * This screen is the product's whole argument in one place: a person who has never read ERC-7710
 * grants a scoped, revocable authority, understands what they granted in their own language
 * before they sign it, and pays nothing to do so.
 *
 * Two rules shape it. First, the sentence and the bytes come from one structure, so what a user
 * reads is what a user signs. Second, nothing here can produce a condition the chain will not
 * enforce - the preset catalogue is limited to deployed, verified enforcers, and anything still
 * ahead of us is visible but not selectable.
 */

type Stage = "compose" | "review" | "issued";

const PRESET_IDS: PresetId[] = ["custom", "micro", "burst", "subscription"];

/** A list long enough for a real expense policy, short enough to still be readable when signed. */
const MAX_PAYEES = 10;

/**
 * Reads a payee list out of the query string.
 *
 * Two shapes are accepted because two callers exist: the MCP server (and every link already in the
 * wild) sends `merchant`/`merchantName` for a single payee, while `merchants` carries a
 * comma-separated list. Returns null when neither is present, so the caller keeps its default.
 */
function prefillPayees(params: URLSearchParams): {
    rows: {address: Address | ""; name: string}[] | null;
    dropped: string[];
} {
    const dropped: string[] = [];
    const many = params.get("merchants");
    if (many) {
        // Names ride alongside positionally. A short list is missing names, not misaligned.
        const names = (params.get("merchantNames") ?? "").split(",").map((x) => x.trim());
        const given = many.split(",").map((x) => x.trim()).filter(Boolean);
        const rows = given
            .filter((x) => {
                if (isAddress(x, {strict: false})) return true;
                dropped.push(x);
                return false;
            })
            .slice(0, MAX_PAYEES)
            .map((address, i) => ({
                address: address as Address,
                name: (names[i] ?? "").slice(0, 40),
            }));
        if (rows.length > 0) return {rows, dropped};
        if (dropped.length > 0) return {rows: null, dropped};
    }
    const one = params.get("merchant");
    if (one) {
        if (isAddress(one, {strict: false})) {
            return {
                rows: [{address: one as Address, name: params.get("merchantName")?.slice(0, 40) ?? ""}],
                dropped,
            };
        }
        dropped.push(one);
    }
    return {rows: null, dropped};
}

/**
 * EIP-55 as a warning, not a gate.
 *
 * viem's `isAddress` is strict by default, so a mixed-case address whose checksum does not match
 * is reported invalid - and so is an all-uppercase one. The chain accepts both perfectly well, and
 * rejecting them here would block someone who copied an address correctly from a source that
 * mangled its casing. So validity stays loose and the checksum is surfaced separately. An
 * all-lowercase address carries no checksum information at all and must pass silently.
 */
const badChecksum = (v: string) =>
    v !== "" &&
    isAddress(v, {strict: false}) &&
    /[a-f]/.test(v.slice(2)) &&
    /[A-F]/.test(v.slice(2)) &&
    !isAddress(v, {strict: true});

/*
 * The screens below live at module scope on purpose.
 *
 * Defining a component inside another component gives it a NEW function identity on every render.
 * React compares element types by reference, so it tears the whole subtree down and builds it
 * again - which loses the focus of whatever input the person was typing into, one keystroke at a
 * time. Anything with an input or state of its own must be declared out here.
 */

function Row({k, v}: {k: string; v: string}) {
    return (
        <div className="flex items-baseline justify-between gap-6 py-2.5">
            <dt className="shrink-0 text-[13px] text-paper-mute">{k}</dt>
            <dd className="text-right text-[13.5px] text-paper-ink">{v}</dd>
        </div>
    );
}

function Issued({record, onAnother}: {record: store.StoredMapae; onAnother: () => void}) {
    const {t, lang} = useLang();
    const nav = useNavigate();
    const [copied, setCopied] = useState(false);
    const context = encodePermissionContext([record.delegation]);
    // Decoded from the caveats, never from the form: the receipt describes what was signed,
    // not what was typed. If those two ever disagree, this is where it shows.
    const conds = record.delegation.caveats.map((c) =>
        renderCondition(decodeCondition(c.enforcer, c.terms), t as never, lang),
    );

    return (
        <div className="mx-auto max-w-3xl px-6 py-12">
            <div className="rise">
                <Paper className="p-8">
                    <div className="flex items-center gap-3">
                        <Mark size={30} tone="ink" />
                        <div>
                            <h1 className="text-[20px] font-semibold text-paper-ink">
                                {t("create", "issued")}
                            </h1>
                            <p className="text-[13px] text-paper-mute">
                                {t("create", "delegationHash")} ·{" "}
                                <span className="font-mono">{short(record.hash, 10)}</span>
                            </p>
                        </div>
                    </div>

                    <p className="mt-4 text-[13.5px] leading-relaxed text-paper-ink-2">
                        {t("create", "issuedLede")}
                    </p>

                    <dl className="mt-6 divide-y divide-paper-line border-y border-paper-line">
                        <Row k={t("create", "agent")} v={`${record.agentName} · ${short(record.delegation.delegate, 6)}`} />
                        {conds.map((c, i) => (
                            <Row key={i} k={c.title} v={c.lines[0] ?? ""} />
                        ))}
                    </dl>

                    <div className="mt-6 flex flex-wrap gap-2.5">
                        <Button
                            onClick={() => {
                                void navigator.clipboard.writeText(context);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 1600);
                            }}
                        >
                            {copied ? t("create", "copied") : t("create", "copyContext")}
                        </Button>
                        <Button
                            variant="paper"
                            onClick={() =>
                                store.download(
                                    `mapae-${record.hash.slice(0, 10)}.json`,
                                    JSON.stringify(
                                        {
                                            delegationHash: record.hash,
                                            chainId: record.chainId,
                                            delegationManager: record.manager,
                                            permissionContext: context,
                                            agent: record.delegation.delegate,
                                            agentName: record.agentName,
                                        },
                                        null,
                                        2,
                                    ),
                                )
                            }
                        >
                            {t("create", "downloadJson")}
                        </Button>
                        <Button variant="paper" onClick={() => nav("/permissions")}>
                            {t("create", "viewPermissions")}
                        </Button>
                    </div>
                </Paper>

                <div className="mt-4 text-center">
                    <button
                        onClick={onAnother}
                        className="text-[13px] text-mute underline-offset-4 hover:text-ink-2 hover:underline"
                    >
                        {t("create", "createAnother")}
                    </button>
                </div>
            </div>
        </div>
    );
}

function PolicyForm({
    form: f,
    set: setF,
    fields,
    agentValid,
    agentChecksumWarn,
    composable,
}: {
    form: PresetForm;
    set: <K extends keyof PresetForm>(k: K, v: PresetForm[K]) => void;
    fields: (keyof PresetForm)[];
    agentValid: boolean | null;
    agentChecksumWarn: boolean;
    composable: boolean;
}) {
    const {t, lang} = useLang();
    const periodLabel =
        f.period === 86_400n
            ? lang === "ko" ? "하루" : "day"
            : f.period === 604_800n
              ? lang === "ko" ? "한 주" : "week"
              : lang === "ko" ? "30일" : "30 days";

    return (
        <Card className="p-7">
            <div className="space-y-7">
                <FormSection title={t("create", "groupAgent")}>
                    {fields.includes("agentName") && (
                        <Field label={t("create", "agentName")}>
                            <Input
                                value={f.agentName}
                                onChange={(v) => setF("agentName", v)}
                                placeholder={lang === "ko" ? "예: 데이터 에이전트" : "e.g. Data Agent"}
                            />
                        </Field>
                    )}
                    {fields.includes("agent") && (
                        <Field
                            label={t("create", "agentAddress")}
                            suffix={
                                agentValid === false ? (
                                    <span className="text-[12px] text-reject-paper">
                                        {t("create", "invalidAddress")}
                                    </span>
                                ) : undefined
                            }
                            hint={agentChecksumWarn ? t("create", "checksumWarn") : undefined}
                        >
                            <AddressInput
                                value={f.agent}
                                valid={agentValid}
                                onChange={(v) => setF("agent", v as Address)}
                                pasteLabel={t("create", "paste")}
                            />
                        </Field>
                    )}
                </FormSection>

                <div className="h-px bg-line" />

                <FormSection title={t("create", "groupLimits")}>
                    {composable && (
                        <>
                            {/* The two conditions a person may genuinely drop. Identity and
                                the cap are not offered as switches: the first is the thesis,
                                the second is the difference between a permission and a
                                wallet. */}
                            <div className="grid gap-2.5 sm:grid-cols-2">
                                <Toggle
                                    on={f.usePerTx}
                                    onChange={(v) => setF("usePerTx", v)}
                                    label={t("create", "togglePerTx")}
                                    hint={t("create", "togglePerTxHint")}
                                />
                                <Toggle
                                    on={f.usePayee}
                                    onChange={(v) => setF("usePayee", v)}
                                    label={t("create", "togglePayee")}
                                    hint={t("create", "togglePayeeHint")}
                                />
                                <Toggle
                                    on={f.useWindow}
                                    onChange={(v) => setF("useWindow", v)}
                                    label={t("create", "toggleWindow")}
                                    hint={t("create", "toggleWindowHint")}
                                />
                            </div>
                            <p className="text-[12px] leading-relaxed text-mute">
                                {t("create", "customHint")}
                            </p>
                        </>
                    )}
                    {fields.includes("payees") && f.usePayee && (
                        <Field
                            label={t("create", "merchant")}
                            hint={t("create", "payeesHint")}
                        >
                            <div className="flex flex-col gap-2">
                                {f.payees.map((row, i) => {
                                    const filled = row.address !== "";
                                    const ok = filled && isAddress(row.address, {strict: false});
                                    const isToken =
                                        ok &&
                                        row.address.toLowerCase() ===
                                            addresses.mockKRW.toLowerCase();
                                    const dupe =
                                        ok &&
                                        f.payees.some(
                                            (o, k) =>
                                                k < i &&
                                                o.address.toLowerCase() ===
                                                    row.address.toLowerCase(),
                                        );
                                    const setRow = (patch: Partial<(typeof f.payees)[number]>) =>
                                        setF(
                                            "payees",
                                            f.payees.map((o, k) => (k === i ? {...o, ...patch} : o)),
                                        );
                                    return (
                                        <div key={i} className="flex flex-col gap-1">
                                            <div className="flex items-start gap-2">
                                                <div className="min-w-0 flex-1">
                                                    <AddressInput
                                                        value={row.address}
                                                        valid={filled ? ok && !isToken && !dupe : null}
                                                        onChange={(v) =>
                                                            setRow({address: v as Address})
                                                        }
                                                        pasteLabel={t("create", "paste")}
                                                    />
                                                </div>
                                                <input
                                                    value={row.name}
                                                    onChange={(e) =>
                                                        setRow({name: e.target.value.slice(0, 40)})
                                                    }
                                                    placeholder={t("create", "payeeNamePlaceholder")}
                                                    className="h-[38px] w-[104px] shrink-0 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink outline-none placeholder:text-mute focus:border-line-strong sm:w-[128px]"
                                                />
                                                {/* The first row is the policy; the rest are additions,
                                                    so only they can be taken away. */}
                                                {f.payees.length > 1 && (
                                                    <button
                                                        type="button"
                                                        aria-label={t("create", "payeeRemove")}
                                                        onClick={() =>
                                                            setF(
                                                                "payees",
                                                                f.payees.filter((_, k) => k !== i),
                                                            )
                                                        }
                                                        className="flex h-[38px] w-[30px] shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:text-reject"
                                                    >
                                                        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                                                            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" fill="none"/>
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                            {filled && !ok && (
                                                <p className="text-[12px] text-reject-paper">
                                                    {t("create", "invalidAddress")}
                                                </p>
                                            )}
                                            {dupe && (
                                                <p className="text-[12px] text-reject-paper">
                                                    {t("create", "payeeDuplicate")}
                                                </p>
                                            )}
                                            {badChecksum(row.address) && (
                                                <p className="text-[12px] text-mute">
                                                    {t("create", "checksumWarn")}
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                                <div className="flex items-center justify-between">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setF("payees", [...f.payees, {address: "", name: ""}])
                                        }
                                        disabled={f.payees.length >= MAX_PAYEES}
                                        className="inline-flex items-center gap-1.5 text-[12.5px] text-bronze-bright transition-opacity hover:opacity-80 disabled:opacity-40"
                                    >
                                        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                                            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" fill="none"/>
                                        </svg>
                                        {t("create", "payeeAdd")}
                                    </button>
                                    {/* Width is the thing a person must feel. One address and ten
                                        look identical in a form; the count says otherwise. */}
                                    {f.payees.filter((x) => x.address !== "").length > 1 && (
                                        <span className="text-[12px] text-mute">
                                            {t("create", "payeeCount", {
                                                n: f.payees.filter((x) => x.address !== "").length,
                                            })}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </Field>
                    )}
                    <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
                        {fields.includes("amount") && (
                            <Field label={t("create", "perPeriod")}>
                                <AmountInput
                                    value={f.amount}
                                    onChange={(v) => setF("amount", v)}
                                    prefix="₩"
                                    suffix={t("create", "perPeriodSuffix", {period: periodLabel})}
                                />
                            </Field>
                        )}
                        {f.usePerTx && (
                            <Field
                                label={t("create", "perTx")}
                                hint={t("create", "perTxHint")}
                                suffix={
                                    f.perTx > f.amount && f.amount > 0n ? (
                                        <span className="text-[12px] text-reject-paper">
                                            {t("create", "perTxAboveCap")}
                                        </span>
                                    ) : undefined
                                }
                            >
                                <AmountInput value={f.perTx} onChange={(v) => setF("perTx", v)} prefix="₩" />
                            </Field>
                        )}
                        {fields.includes("period") && (
                            <Field label={t("create", "period")}>
                                <Select
                                    value={f.period.toString()}
                                    onChange={(v) => setF("period", BigInt(v))}
                                    options={[
                                        {value: "86400", label: lang === "ko" ? "하루" : "Day"},
                                        {value: "604800", label: lang === "ko" ? "한 주" : "Week"},
                                        {value: "2592000", label: lang === "ko" ? "30일" : "30 days"},
                                    ]}
                                />
                            </Field>
                        )}
                    </div>
                    {fields.includes("validDays") && f.useWindow && (
                        <Field label={t("create", "duration")}>
                            <Select
                                value={String(f.validDays)}
                                onChange={(v) => setF("validDays", Number(v))}
                                options={[
                                    {value: "7", label: lang === "ko" ? "7일" : "7 days"},
                                    {value: "30", label: lang === "ko" ? "30일" : "30 days"},
                                    {value: "90", label: lang === "ko" ? "90일" : "90 days"},
                                    {value: "365", label: lang === "ko" ? "1년" : "1 year"},
                                ]}
                            />
                        </Field>
                    )}
                </FormSection>

                <div className="h-px bg-line" />

                <FormSection title={t("create", "groupIdentity")}>
                    <Field label={t("create", "issuer")}>
                        <Select
                            value={f.issuer}
                            onChange={(v) => setF("issuer", v as Hex)}
                            options={[
                                {value: TESTNET_FAUCET_ID, label: issuerName(TESTNET_FAUCET_ID, lang)},
                                {value: UPBIT_KOREA_ID, label: issuerName(UPBIT_KOREA_ID, lang)},
                            ]}
                        />
                    </Field>
                    <Field label={t("create", "asset")}>
                        <Select
                            value={f.token}
                            onChange={(v) => setF("token", v as Address)}
                            options={[{value: addresses.mockKRW, label: "mKRW"}]}
                        />
                    </Field>
                </FormSection>
            </div>

            <div className="mt-7 border-t border-line pt-4">
                <p className="caps mb-2 text-[11px] font-semibold text-mute">
                    {t("create", "comingNext")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                    {COMING_NEXT.map((c) => (
                        <span
                            key={c.id}
                            className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-mute"
                        >
                            {lang === "ko" ? c.ko : c.en}
                        </span>
                    ))}
                </div>
            </div>
        </Card>
    );
}

/**
 * The panel is the permission, not a table about it.
 *
 * A grid of dashes teaches nobody what they are about to grant. As the form fills, this
 * writes the authority out as one sentence - the same sentence the review step shows and the
 * same structure the bytes are built from - so the thing being composed is legible the whole
 * way through rather than only at the end.
 */

export default function Create() {
    const {t, lang} = useLang();
    const wallet = useWallet();
    const account = useMapaeAccount();

    const [presetId, setPresetId] = useState<PresetId>("custom");
    const [stage, setStage] = useState<Stage>("compose");
    const [signing, setSigning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [issued, setIssued] = useState<store.StoredMapae | null>(null);

    const p = preset(presetId);
    const presetMeta = usePreset(presetId);
    /**
     * The ERC-7715 request path, over a URL.
     *
     * An agent (the mapae-mcp request_permission tool, or anything else) may COMPOSE a policy,
     * but only a human can grant one - so the agent's ask arrives as query params that do
     * nothing except prefill this form. The human still reads the sentence and still signs in
     * their own wallet; a malicious link can at worst propose terms, never accept them. Values
     * are validated the same way typed input is, and anything malformed falls back silently.
     */
    const [params] = useSearchParams();
    /// Prefill values that arrived and could not be read.
    ///
    /// A request link is long, terminals wrap long lines, and a wrapped line copies broken. When
    /// that happens the truncated field silently becomes a default - which is how a request for
    /// "₩1,000 a day to one merchant" became a signature for "₩50,000 a day to nobody". Dropping
    /// a value the sender clearly meant is not a thing to do quietly.
    const droppedFromLink = useMemo(() => prefillPayees(params).dropped, [params]);

    /// Whether a request link that carries an integrity mark still matches its own policy.
    ///
    /// Truncation does not fail safe on this page: lose `perTx` or `validDays` off the end of a
    /// wrapped link and the form fills in looser defaults, so a request for ₩1,000 for one day
    /// reads as ₩50,000 for thirty and nothing looks wrong. An unreadable address is visible; a
    /// missing ceiling is not. The mark covers every policy field, so either kind shows up here.
    const linkTampered = useMemo(() => {
        const k = params.get("k");
        if (!k) return false;
        const canon = ["agent", "amount", "period", "merchants", "validDays", "perTx"]
            .map((key) => `${key}=${params.get(key) ?? ""}`)
            .join("&");
        return keccak256(toHex(canon)).slice(2, 10) !== k;
    }, [params]);

    const [form, setForm] = useState<PresetForm>(() => {
        const base: PresetForm = {
            agentName: "",
            agent: "",
            payees: [{address: "", name: ""}],
            ...preset("custom").defaults,
        };
        const num = (k: string): bigint | null => {
            const v = params.get(k);
            return v && /^\d{1,12}$/.test(v) ? BigInt(v) : null;
        };
        const addr = (k: string): Address | null => {
            const v = params.get(k);
            return v && isAddress(v, {strict: false}) ? (v as Address) : null;
        };
        const perTx = num("perTx");
        return {
            ...base,
            agentName: params.get("agentName")?.slice(0, 64) ?? base.agentName,
            agent: addr("agent") ?? base.agent,
            // `merchant`/`merchantName` are the single-payee form the MCP server and older links
            // send; `merchants` carries a comma-separated list. Either fills the same list.
            payees: prefillPayees(params).rows ?? base.payees,
            amount: num("amount") ?? base.amount,
            period: num("period") ?? base.period,
            validDays: num("validDays") ? Number(num("validDays")) : base.validDays,
            // A requested per-payment ceiling arrives as `perTx` and pre-arms the toggle; the
            // human still sees it spelled out in the sentence before anything is signed.
            ...(perTx !== null && perTx > 0n ? {usePerTx: true, perTx} : {}),
        };
    });

    // Switching preset resets only the policy defaults; who the agent is survives the change.
    function choosePreset(id: PresetId) {
        setPresetId(id);
        setForm((f) => ({...f, ...preset(id).defaults}));
    }

    const set = <K extends keyof PresetForm>(k: K, v: PresetForm[K]) =>
        setForm((f) => ({...f, [k]: v}));

    const {verified, loading: checkingIdentity, refresh: refreshIdentity} = useDojangStatus(
        wallet.address ?? null,
        form.issuer,
    );
    const dojang = useIssueDojang();
    const {balance, refresh: refreshBalance} = useTokenBalance(addresses.mockKRW, account.address ?? null);
    const krw = useMintTestKRW();

    /**
     * Syntactic validity, not checksum validity.
     *
     * viem's `isAddress` is strict by default: a MIXED-CASE address whose EIP-55 checksum does
     * not match is reported invalid, and so is an all-uppercase one. Those are addresses the
     * chain accepts perfectly well, and rejecting them here would block someone who copied an
     * address correctly from a source that mangled its casing.
     *
     * So validity is loose and the checksum is surfaced as a WARNING instead. That is what
     * EIP-55 is for - catching a transcription error, not gating an address. An all-lowercase
     * address carries no checksum information at all and must pass silently.
     */
    const agentOk = form.agent !== "" && isAddress(form.agent, {strict: false});
    // Payees are only required while the payee condition is part of the policy. Every filled
    // row must be a real address; a blank trailing row is how you add one, not an error.
    const filledPayees = form.payees.filter((x) => x.address !== "");
    const merchantOk =
        !form.usePayee ||
        (filledPayees.length > 0 &&
            filledPayees.every((x) => isAddress(x.address, {strict: false})));
    /** The same address twice is not wrong on-chain, but it is always a mistake in the UI. */
    const duplicatePayee =
        form.usePayee &&
        new Set(filledPayees.map((x) => x.address.toLowerCase())).size < filledPayees.length;

    /**
     * The token address is a plausible thing to paste into a payee field - it is the other
     * address on this screen - and the contract will faithfully enforce it, because it was
     * signed. The tokens then sit in the token contract with nothing able to move them. It
     * has happened here on testnet; with a real stablecoin it burns money, so refuse it.
     */
    const merchantIsToken =
        form.usePayee &&
        filledPayees.some((x) => x.address.toLowerCase() === addresses.mockKRW.toLowerCase());
    const amountOk = form.amount > 0n;
    // An enabled ceiling needs a positive value, and one above the period cap is a contradiction
    // the form catches rather than shipping a policy whose ceiling can never bind.
    const perTxOk = !form.usePerTx || (form.perTx > 0n && form.perTx <= form.amount);
    const formOk =
        agentOk &&
        merchantOk &&
        !merchantIsToken &&
        !duplicatePayee &&
        amountOk &&
        perTxOk &&
        form.agentName.trim().length > 0;

    /**
     * Identity gates the signature, not just the payment.
     *
     * The first design let anyone sign and showed a warning that payments would be refused -
     * technically honest, but it made the product's own thesis optional: a Mapae is authority
     * ROOTED in verified identity, so composing one without the root should not complete. For
     * the self-service issuer the gate is one click (the primary button becomes the issuance);
     * for Upbit it is a hard stop stated plainly, because no button can click that Dojang into
     * existence.
     */
    const needsDojang = Boolean(wallet.address && account.deployed && verified === false);
    const dojangSelfService = form.issuer === TESTNET_FAUCET_ID;

    /** What stands between here and a signature, in order. A disabled control that will not say
     *  why is the commonest way a form loses someone; this is shown on the button itself. */
    const blocked: string | null = !wallet.address
        ? t("create", "blockedWallet")
        : !account.deployed
          ? t("create", "blockedAccount")
          : needsDojang && !dojangSelfService
            ? t("create", "blockedUpbitDojang")
            : form.agentName.trim().length === 0
              ? t("create", "blockedName")
              : !agentOk
                ? t("create", "blockedAgent")
                : !merchantOk
                  ? t("create", "blockedMerchant")
                  : merchantIsToken
                    ? t("create", "blockedMerchantIsToken")
                    : duplicatePayee
                      ? t("create", "blockedDuplicatePayee")
                  : !amountOk
                    ? t("create", "blockedAmount")
                    : !perTxOk
                      ? t("create", "blockedPerTx")
                      : null;

    /**
     * Built as soon as the FORM is complete, not once a wallet is connected.
     *
     * The point of this screen is that a person can see exactly what they would be granting
     * before they are asked to connect anything. Requiring an account first meant the summary sat
     * empty through the whole decision and only appeared after it had been made. The principal is
     * only read back at signing time, so a placeholder here changes nothing that is displayed -
     * `sign()` still refuses without a real account and a real wallet.
     */
    const PREVIEW_PRINCIPAL = "0x0000000000000000000000000000000000000000" as Address;
    /** Address -> display name, so the conditions list shows a label rather than 0x8ACD…a617. */
    const payeeNames = useMemo(
        () =>
            Object.fromEntries(
                filledPayees.map((x) => [x.address.toLowerCase(), x.name.trim() || short(x.address, 6)]),
            ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [JSON.stringify(filledPayees)],
    );
    const conditions: Condition[] | null = useMemo(() => {
        if (!formOk) return null;
        try {
            // Canonicalise before encoding: the signed terms carry the checksummed form no
            // matter how the address was pasted.
            const normalised = {
                ...form,
                agent: getAddress(form.agent as string),
                payees: filledPayees.map((x) => ({
                    ...x,
                    address: getAddress(x.address as string),
                })),
            };
            return buildConditions(normalised, (wallet.address ?? PREVIEW_PRINCIPAL) as Address, Date.now());
        } catch {
            return null;
        }
    }, [form, formOk, wallet.address]);

    const rendered = useMemo(
        () =>
            conditions?.map((c) => renderCondition(c, t as never, lang, payeeNames)) ?? [],
        [conditions, t, lang, payeeNames],
    );

    async function sign() {
        if (!conditions || !account.address || !wallet.walletClient || !wallet.address) return;
        setSigning(true);
        setError(null);
        try {
            // Encode/decode must be inverses before anything is signed. A malformed policy caught
            // here is a form error; caught later it is a signature over terms nobody can read.
            for (const c of conditions) {
                if (!roundTrips(c)) throw new Error(`Condition "${c.kind}" did not round-trip`);
            }

            const unsigned: Delegation = {
                delegate: getAddress(form.agent as string),
                delegator: account.address,
                authority: ROOT_AUTHORITY as Hex,
                caveats: encodeConditions(conditions),
                salt: freshSalt(),
                signature: "0x",
            };

            // The OWNER signs; the manager validates through the account's ERC-1271.
            //
            // Domain and types come from the SDK, never from a copy kept here. The SDK's
            // definitions are the ones pinned byte-for-byte against Solidity by the fixture
            // test; a second hand-written copy in this file would be pinned to nothing, and if
            // the two ever drifted a person would sign a payload that verifies nowhere - with
            // every test still green, because the tests only ever saw the SDK.
            const signature = await wallet.walletClient.signTypedData({
                account: wallet.address,
                domain: delegationDomain(giwaSepolia.id, addresses.manager),
                types: DELEGATION_TYPES,
                primaryType: "Delegation",
                message: {
                    delegate: unsigned.delegate,
                    delegator: unsigned.delegator,
                    authority: unsigned.authority,
                    caveats: unsigned.caveats.map((c) => ({enforcer: c.enforcer, terms: c.terms})),
                    salt: unsigned.salt,
                },
            });

            const signed: Delegation = {...unsigned, signature};
            const record = store.save({
                delegation: signed,
                agentName: form.agentName.trim(),
                merchantName: filledPayees[0]?.name.trim() || undefined,
                payeeNames: Object.fromEntries(
                    filledPayees
                        .filter((x) => x.name.trim())
                        .map((x) => [x.address.toLowerCase(), x.name.trim()]),
                ),
                presetId,
            });
            setIssued(record);
            setStage("issued");
        } catch (e) {
            setError(readableError(e));
        } finally {
            setSigning(false);
        }
    }

    /* ------------------------------- issued ------------------------------- */

    if (stage === "issued" && issued) {
        return <Issued record={issued} onAnother={() => {
            setIssued(null);
            setStage("compose");
        }} />;
    }

    /* ------------------------------- shell -------------------------------- */

    return (
        <div className="mx-auto max-w-6xl px-6 py-10">
            <header className="mb-8 flex flex-wrap items-end justify-between gap-6">
                <div>
                    <h1 className="display text-[38px] text-ink">{t("create", "title")}</h1>
                    {(droppedFromLink.length > 0 || linkTampered) && (
                        <div className="mt-4 rounded-xl border border-warn/50 bg-warn/10 px-4 py-3">
                            <p className="text-[13px] font-medium text-ink">
                                {t("create", linkTampered ? "linkMarkTitle" : "linkBrokenTitle")}
                            </p>
                            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
                                {t("create", linkTampered ? "linkMarkBody" : "linkBrokenBody")}
                            </p>
                            <ul className="mt-2 space-y-0.5">
                                {droppedFromLink.map((d, i) => (
                                    <li key={i} className="mono break-all text-[11.5px] text-mute">
                                        {d}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <p className="mt-2 max-w-xl text-[14.5px] leading-relaxed text-mute">
                        {t("create", "lede")}
                    </p>
                </div>
                <Steps
                    step={stage === "review" ? 3 : 2}
                    labels={[t("create", "step1"), t("create", "step2"), t("create", "step3")]}
                />
            </header>

            {!wallet.address && <ConnectFirst />}

            {wallet.address && !account.deployed && !account.loading && (
                <CreateAccountFirst account={account} />
            )}

            {/* An empty paying account is the third silent wall a newcomer hits (after wallet
                and identity) - so it gets the same treatment: stated, with the fix attached. */}
            {wallet.address && account.deployed && balance === 0n && (
                <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface px-5 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-strong">
                            <Mark size={15} />
                        </span>
                        <p className="min-w-0 text-[12.5px] leading-relaxed text-mute">
                            {t("create", "fundNote")}
                        </p>
                    </div>
                    <div className="shrink-0">
                        <Button
                            onClick={async () => {
                                if (account.address && (await krw.mint(account.address))) refreshBalance();
                            }}
                            disabled={krw.minting || !wallet.onGiwa}
                        >
                            {krw.minting ? <Spinner inline /> : null}
                            {krw.minting ? t("create", "gettingKRW") : t("create", "getKRW")}
                        </Button>
                        {krw.error && (
                            <p className="mt-1.5 text-[12px] text-reject">{krw.error}</p>
                        )}
                    </div>
                </div>
            )}

            {stage === "review" && conditions ? (
                <Review
                    rendered={rendered}
                    onBack={() => setStage("compose")}
                    onSign={sign}
                    signing={signing}
                    error={error}
                    canSign={Boolean(wallet.address && account.deployed && wallet.onGiwa)}
                />
            ) : (
                <>
                    <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {PRESET_IDS.map((id) => (
                            <PresetCard
                                key={id}
                                id={id}
                                selected={presetId === id}
                                onSelect={() => choosePreset(id)}
                            />
                        ))}
                    </div>
                    {/* The selected preset explains itself where the choice was made, so switching
                        cards reads as comparing opinions rather than guessing from titles. */}
                    {/* Two reserved lines: the English copy wraps and the Korean does not, and
                        without the reservation every preset switch nudged the form below. */}
                    <p className="mb-6 min-h-[44px] text-[13px] leading-relaxed text-mute">
                        {presetMeta.long}{" "}
                        <span className="text-mute/70">{t("create", "presetHint")}</span>
                    </p>

                    <div className="grid items-start gap-6 lg:grid-cols-[1fr_420px]">
                        <PolicyForm
                            form={form}
                            set={set}
                            fields={p.fields}
                            composable={p.composable}
                            agentValid={form.agent === "" ? null : agentOk}
                            agentChecksumWarn={badChecksum(form.agent)}
                        />
                        {/* Sticky: the thing being composed should not scroll away from the
                            controls composing it. */}
                        <div className="lg:sticky lg:top-24">
                            <Preview
                                form={form}
                                rendered={rendered}
                                verified={verified}
                                checking={checkingIdentity}
                                blocked={blocked}
                                needsDojang={needsDojang}
                                selfService={dojangSelfService}
                                issuing={dojang.issuing}
                                issueError={dojang.error}
                                onIssue={async () => {
                                    if (await dojang.issue()) refreshIdentity();
                                }}
                                onReview={() => setStage("review")}
                            />
                        </div>
                    </div>
                </>
            )}
        </div>
    );

    /** Not a blocker: the form below stays usable so a person can see what they would be signing
     *  before they are asked to connect anything. */
    function ConnectFirst() {
        return (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface px-5 py-4">
                <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong">
                        <Mark size={15} />
                    </span>
                    <div>
                        <p className="text-[13.5px] font-medium text-ink">{t("create", "needWallet")}</p>
                        <p className="text-[12.5px] text-mute">{t("wallet", "lede")}</p>
                    </div>
                </div>
                <ConnectButton />
            </div>
        );
    }

    function CreateAccountFirst({account: a}: {account: ReturnType<typeof useMapaeAccount>}) {
        return (
            <div className="mb-6 rounded-xl border border-line bg-surface px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-strong">
                            <Mark size={15} />
                        </span>
                        <div className="min-w-0">
                            <p className="text-[13.5px] font-medium text-ink">
                                {t("create", "needAccount")}
                            </p>
                            <p className="truncate text-[12.5px] text-mute">
                                {a.address ? (
                                    <span className="font-mono">{short(a.address, 10)}</span>
                                ) : (
                                    t("create", "accountHint")
                                )}
                            </p>
                        </div>
                    </div>
                    <Button onClick={a.create} disabled={a.creating || !wallet.onGiwa}>
                        {a.creating ? <Spinner inline /> : null}
                        {a.creating ? t("create", "creatingAccount") : t("create", "createAccount")}
                    </Button>
                </div>
                {a.error && <p className="mt-2.5 text-[12.5px] text-reject">{a.error}</p>}
                {/* The identity/funds split is worth explaining once, quietly, not in a slab. */}
                <p className="mt-2.5 border-t border-line pt-2.5 text-[12px] leading-relaxed text-mute">
                    {t("create", "accountHint")}
                </p>
            </div>
        );
    }

    function PresetCard({
        id,
        selected,
        onSelect,
    }: {
        id: PresetId;
        selected: boolean;
        onSelect: () => void;
    }) {
        const meta = usePreset(id);
        const pd = preset(id);
        /** Compact period notation for a chip: "일"/"d", never "30 days" - the long form made one
         *  card's chip row wrap in English while every other stayed on one line. */
        const per = (s: bigint) =>
            s === 86_400n
                ? lang === "ko" ? "일" : "d"
                : s === 604_800n
                  ? lang === "ko" ? "주" : "w"
                  : lang === "ko"
                    ? `${Number(s) / 86_400}일`
                    : `${Number(s) / 86_400}d`;
        /** The conditions this preset composes, with their default values - so the cards answer
         *  "what would I actually be granting" before anything is clicked. */
        const chips: string[] =
            id === "custom"
                ? [t("policy", "identityShort"), t("create", "customChip")]
                : [
                      t("policy", "identityShort"),
                      `${fmtToken(pd.defaults.token, pd.defaults.amount)}/${per(pd.defaults.period)}`,
                      t("policy", "payeeShort"),
                      lang === "ko" ? `${pd.defaults.validDays}일` : `${pd.defaults.validDays}d`,
                  ];
        return (
            <button
                onClick={onSelect}
                className={`flex h-full flex-col rounded-xl border p-4 text-left transition-all ${
                    selected
                        ? "border-bronze bg-bronze/8 ring-1 ring-bronze/40"
                        : id === "custom"
                          ? "border-dashed border-line-strong bg-surface/60 hover:border-bronze-dim"
                          : "border-line bg-surface hover:border-line-strong"
                }`}
            >
                <div className="flex items-start justify-between gap-3">
                    <span className={`text-[14.5px] font-medium ${selected ? "text-ink" : "text-ink-2"}`}>
                        {meta.name}
                    </span>
                    <span
                        className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                            selected ? "border-bronze bg-bronze" : "border-line-strong"
                        }`}
                    />
                </div>
                {/* Reserves two lines in both languages, so a one-line Korean description and a
                    two-line English one produce identical cards - and switching cannot reflow
                    the grid. */}
                <p className="mt-1.5 min-h-[38px] text-[12.5px] leading-relaxed text-mute">
                    {meta.desc}
                </p>
                <div className="mt-auto pt-3">
                    <div className="caps text-[10px] font-semibold text-mute/80">
                        {t("create", "presetIncludes")}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                        {chips.map((c) => (
                            <span
                                key={c}
                                className={`tnum rounded border px-1.5 py-px text-[10.5px] ${
                                    selected
                                        ? "border-bronze-dim/60 text-bronze-bright"
                                        : "border-line text-mute"
                                }`}
                            >
                                {c}
                            </span>
                        ))}
                    </div>
                </div>
            </button>
        );
    }

    function Preview({
        form: f,
        rendered: rs,
        verified: isVerified,
        checking,
        blocked: reason,
        needsDojang: identityMissing,
        selfService,
        issuing,
        issueError,
        onIssue,
        onReview,
    }: {
        form: PresetForm;
        rendered: ReturnType<typeof renderCondition>[];
        verified: boolean | null;
        checking: boolean;
        blocked: string | null;
        needsDojang: boolean;
        selfService: boolean;
        issuing: boolean;
        issueError: string | null;
        onIssue: () => void;
        onReview: () => void;
    }) {
        const filled = f.payees.filter((x) => x.address !== "");
        const merchantLabel =
            filled.length === 0
                ? ""
                : filled.length === 1
                  ? filled[0].name.trim() || short(String(filled[0].address), 6)
                  : t("create", "payeeCount", {n: filled.length});
        const periodLabel = fmtDuration(f.period, lang);
        const until = fmtDate(
            BigInt(Math.floor(Date.now() / 1000) + f.validDays * 86_400),
            lang,
        );
        /** The sentence follows the composition. Four written variants rather than clause
         *  splicing, because Korean does not concatenate the way English does. */
        const sentenceKey =
            f.usePayee && f.useWindow
                ? "sentence"
                : f.usePayee
                  ? "sentenceNoWindow"
                  : f.useWindow
                    ? "sentenceNoPayee"
                    : "sentenceNoPayeeNoWindow";

        /**
         * The sentence with its decisions in ink.
         *
         * Every value in it is something the person chose; setting those in weight (and the two
         * that money actually rides on - the amount and the identity issuer - in bronze) turns a
         * wall of prose into a scannable statement of what is about to be signed. The template
         * still comes from the catalog untouched: `t` without vars leaves the placeholders in
         * place, and they are resolved here into styled spans instead of plain text.
         */
        const sentenceRich = (() => {
            const vars: Record<string, {v: string; cls: string}> = {
                agent: {v: f.agentName, cls: "font-semibold text-paper-ink"},
                merchant: {v: merchantLabel, cls: "font-semibold text-paper-ink"},
                amount: {
                    v:
                        fmtToken(f.token, f.amount) +
                        (f.usePerTx && f.perTx > 0n
                            ? ` · ${t("create", "perTxInline", {v: fmtToken(f.token, f.perTx)})}`
                            : ""),
                    cls: "tnum font-semibold text-bronze-solid",
                },
                period: {v: periodLabel, cls: "font-semibold text-paper-ink"},
                until: {v: until, cls: "font-semibold text-paper-ink"},
                issuer: {v: issuerName(f.issuer, lang), cls: "font-semibold text-bronze-solid"},
            };
            return t("create", sentenceKey)
                .split(/(\{\w+\})/g)
                .map((part, i) => {
                    const key = part.match(/^\{(\w+)\}$/)?.[1];
                    const s = key ? vars[key] : undefined;
                    return s ? (
                        <strong key={i} className={s.cls}>
                            {s.v}
                        </strong>
                    ) : (
                        part
                    );
                });
        })();

        return (
            <Paper className="overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-paper-line px-6 py-4">
                    <h2 className="text-[14px] font-semibold text-paper-ink">
                        {t("create", "yourMapae")}
                    </h2>
                    {checking ? (
                        <span className="text-[12px] text-paper-mute">{t("create", "checking")}</span>
                    ) : isVerified === true ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-jade-paper/12 px-2.5 py-1 text-[11.5px] font-medium text-jade-paper">
                            <span className="h-1.5 w-1.5 rounded-full bg-jade-paper" />
                            {t("create", "verified")}
                        </span>
                    ) : null}
                </div>

                <div className="px-6 py-5">
                    {rs.length === 0 ? (
                        <p className="py-6 text-center text-[13px] leading-relaxed text-paper-mute">
                            {t("create", "summaryEmpty")}
                        </p>
                    ) : (
                        <>
                            <p className="text-[15px] leading-[1.85] text-paper-ink-2">
                                {sentenceRich}
                            </p>
                            <div className="mt-5 space-y-2 border-t border-paper-line pt-4">
                                {rs.map((r, i) => (
                                    <Check key={i} ok paper>
                                        {r.lines[0]}
                                    </Check>
                                ))}
                            </div>
                            {/* Widening the grant is legal; doing it without noticing is not. */}
                            {(!f.usePayee || !f.useWindow) && (
                                <div className="mt-4 space-y-1.5 rounded-lg border border-warn/40 bg-warn/10 p-3">
                                    {!f.usePayee && (
                                        <p className="text-[12.5px] leading-relaxed text-paper-ink-2">
                                            {t("create", "warnNoPayee")}
                                        </p>
                                    )}
                                    {!f.useWindow && (
                                        <p className="text-[12.5px] leading-relaxed text-paper-ink-2">
                                            {t("create", "warnNoWindow")}
                                        </p>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    {/* The identity step, as a step - not a warning to scroll past. The primary
                        button below BECOMES the issuance while identity is missing, so the flow
                        reads: fill the policy, plant the root, then sign what grows from it. */}
                    {identityMissing && (
                        <div className="mt-5 rounded-xl border border-paper-line bg-paper-2/60 p-4">
                            <p className="text-[13px] font-semibold text-paper-ink">
                                {t("create", "identityFirst")}
                            </p>
                            <p className="mt-1.5 text-[12.5px] leading-relaxed text-paper-mute">
                                {selfService
                                    ? t("create", "identityFirstBody")
                                    : t("create", "identityFirstUpbit")}
                            </p>
                            {issueError && (
                                <p className="mt-2 text-[12px] leading-relaxed text-reject-paper">
                                    {issueError}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <div className="border-t border-paper-line bg-paper-2/40 px-6 py-5">
                    {identityMissing && selfService ? (
                        <Button className="w-full" onClick={onIssue} disabled={issuing}>
                            {issuing ? <Spinner inline /> : null}
                            {issuing ? t("create", "gettingDojang") : t("create", "getDojang")}
                        </Button>
                    ) : (
                        <Button className="w-full" onClick={onReview} disabled={Boolean(reason)}>
                            {reason ?? `${t("create", "reviewSign")} →`}
                        </Button>
                    )}
                    <p className="mt-2.5 text-center text-[11.5px] text-paper-mute">
                        {identityMissing && selfService
                            ? t("create", "getDojangHint")
                            : t("create", "gasFree")}
                    </p>
                </div>
            </Paper>
        );
    }

    function Review({
        rendered: rs,
        onBack,
        onSign,
        signing: isSigning,
        error: err,
        canSign,
    }: {
        rendered: ReturnType<typeof renderCondition>[];
        onBack: () => void;
        onSign: () => void;
        signing: boolean;
        error: string | null;
        canSign: boolean;
    }) {
        return (
            <div className="mx-auto max-w-2xl rise">
                <Paper className="p-8">
                    <h2 className="text-[17px] font-semibold text-paper-ink">
                        {t("create", "plainLanguage")}
                    </h2>

                    <div className="mt-6 space-y-5">
                        {rs.map((r, i) => (
                            <div key={i}>
                                <div className="flex items-baseline gap-2">
                                    <span className="caps text-[11px] font-semibold text-bronze-solid">
                                        {r.title}
                                    </span>
                                </div>
                                {r.lines.map((line, j) => (
                                    <p
                                        key={j}
                                        className={
                                            j === 0
                                                ? "mt-1 text-[15px] leading-relaxed text-paper-ink"
                                                : "mt-1 text-[12.5px] leading-relaxed text-paper-mute"
                                        }
                                    >
                                        {line}
                                    </p>
                                ))}
                            </div>
                        ))}
                    </div>

                    <p className="mt-7 rounded-lg bg-paper-2/70 p-3.5 text-[13px] leading-relaxed text-paper-ink-2">
                        {t("create", "andWarning")}
                    </p>

                    {err && (
                        <p className="mt-4 text-[13px] text-reject-paper">{err}</p>
                    )}

                    <div className="mt-7 flex gap-3">
                        <Button variant="paper" onClick={onBack} disabled={isSigning}>
                            ← {t("create", "back")}
                        </Button>
                        <Button className="flex-1" onClick={onSign} disabled={isSigning || !canSign}>
                            {isSigning ? <Spinner inline /> : null}
                            {isSigning ? t("create", "signing") : t("create", "sign")}
                        </Button>
                    </div>
                    {!wallet.onGiwa && wallet.address && (
                        <button
                            onClick={wallet.switchToGiwa}
                            className="mt-3 w-full text-center text-[13px] text-bronze-solid underline-offset-4 hover:underline"
                        >
                            {t("nav", "wrongNetwork")}
                        </button>
                    )}
                </Paper>

                <p className="mt-4 text-center text-[12.5px] text-mute">
                    <Link to="/permissions" className="hover:text-ink-2">
                        {t("permissions", "localOnlyHint")}
                    </Link>
                </p>
            </div>
        );
    }
}

