import {useMemo, useState} from "react";
import {Link, useNavigate} from "react-router-dom";
import {getAddress, isAddress, type Address, type Hex} from "viem";
import {encodePermissionContext, type Delegation} from "@mapae/sdk";
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
} from "../components/ui";
import {ConnectButton} from "../components/Connect";
import {useLang, usePreset} from "../i18n";
import {addresses, short} from "../lib/config";
import {readableError, useDojangStatus, useMapaeAccount} from "../lib/account";
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

const PRESET_IDS: PresetId[] = ["api", "shopping", "subscription"];

export default function Create() {
    const {t, lang} = useLang();
    const nav = useNavigate();
    const wallet = useWallet();
    const account = useMapaeAccount();

    const [presetId, setPresetId] = useState<PresetId>("api");
    const [stage, setStage] = useState<Stage>("compose");
    const [signing, setSigning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [issued, setIssued] = useState<store.StoredMapae | null>(null);

    const p = preset(presetId);
    const [form, setForm] = useState<PresetForm>(() => ({
        agentName: "",
        agent: "",
        merchantName: "",
        merchant: "",
        ...preset("api").defaults,
    }));

    // Switching preset resets only the policy defaults; who the agent is survives the change.
    function choosePreset(id: PresetId) {
        setPresetId(id);
        setForm((f) => ({...f, ...preset(id).defaults}));
    }

    const set = <K extends keyof PresetForm>(k: K, v: PresetForm[K]) =>
        setForm((f) => ({...f, [k]: v}));

    const {verified, loading: checkingIdentity} = useDojangStatus(
        wallet.address ?? null,
        form.issuer,
    );

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
    const merchantOk = form.merchant !== "" && isAddress(form.merchant, {strict: false});
    const badChecksum = (v: string) =>
        v !== "" &&
        isAddress(v, {strict: false}) &&
        /[a-f]/.test(v.slice(2)) &&
        /[A-F]/.test(v.slice(2)) &&
        !isAddress(v, {strict: true});
    const amountOk = form.amount > 0n;
    const formOk = agentOk && merchantOk && amountOk && form.agentName.trim().length > 0;

    /** What stands between here and a signature, in order. A disabled control that will not say
     *  why is the commonest way a form loses someone; this is shown on the button itself. */
    const blocked: string | null = !wallet.address
        ? t("create", "blockedWallet")
        : !account.deployed
          ? t("create", "blockedAccount")
          : form.agentName.trim().length === 0
            ? t("create", "blockedName")
            : !agentOk
              ? t("create", "blockedAgent")
              : !merchantOk
                ? t("create", "blockedMerchant")
                : !amountOk
                  ? t("create", "blockedAmount")
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
    const conditions: Condition[] | null = useMemo(() => {
        if (!formOk) return null;
        try {
            // Canonicalise before encoding: the signed terms carry the checksummed form no
            // matter how the address was pasted.
            const normalised = {
                ...form,
                agent: getAddress(form.agent as string),
                merchant: getAddress(form.merchant as string),
            };
            return buildConditions(normalised, (wallet.address ?? PREVIEW_PRINCIPAL) as Address, Date.now());
        } catch {
            return null;
        }
    }, [form, formOk, wallet.address]);

    const rendered = useMemo(
        () =>
            conditions?.map((c) =>
                renderCondition(c, t as never, lang, {
                    [String(form.merchant).toLowerCase()]: form.merchantName || short(String(form.merchant)),
                }),
            ) ?? [],
        [conditions, t, lang, form.merchant, form.merchantName],
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

            // The OWNER signs; the manager validates through the account's ERC-1271. Same digest
            // the demo script and the Go facilitator compute, from the same SDK module.
            const signature = await wallet.walletClient.signTypedData({
                account: wallet.address,
                domain: {
                    name: "Mapae",
                    version: "1",
                    chainId: 91_342,
                    verifyingContract: addresses.manager,
                },
                types: {
                    Caveat: [
                        {name: "enforcer", type: "address"},
                        {name: "terms", type: "bytes"},
                    ],
                    Delegation: [
                        {name: "delegate", type: "address"},
                        {name: "delegator", type: "address"},
                        {name: "authority", type: "bytes32"},
                        {name: "caveats", type: "Caveat[]"},
                        {name: "salt", type: "uint256"},
                    ],
                },
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
                merchantName: form.merchantName.trim() || undefined,
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
                    <div className="mb-6 grid gap-3 sm:grid-cols-3">
                        {PRESET_IDS.map((id) => (
                            <PresetCard
                                key={id}
                                id={id}
                                selected={presetId === id}
                                onSelect={() => choosePreset(id)}
                            />
                        ))}
                    </div>
                    <p className="mb-6 text-[13px] text-mute">{t("create", "presetHint")}</p>

                    <div className="grid items-start gap-6 lg:grid-cols-[1fr_420px]">
                        <PolicyForm
                            form={form}
                            set={set}
                            fields={p.fields}
                            agentValid={form.agent === "" ? null : agentOk}
                            merchantValid={form.merchant === "" ? null : merchantOk}
                            agentChecksumWarn={badChecksum(form.agent)}
                            merchantChecksumWarn={badChecksum(form.merchant)}
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

    function Issued({record, onAnother}: {record: store.StoredMapae; onAnother: () => void}) {
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

    function Row({k, v}: {k: string; v: string}) {
        return (
            <div className="flex items-baseline justify-between gap-6 py-2.5">
                <dt className="shrink-0 text-[13px] text-paper-mute">{k}</dt>
                <dd className="text-right text-[13.5px] text-paper-ink">{v}</dd>
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
        return (
            <button
                onClick={onSelect}
                className={`rounded-xl border p-4 text-left transition-all ${
                    selected
                        ? "border-bronze bg-bronze/8 ring-1 ring-bronze/40"
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
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-mute">{meta.desc}</p>
            </button>
        );
    }

    function PolicyForm({
        form: f,
        set: setF,
        fields,
        agentValid,
        merchantValid,
        agentChecksumWarn,
        merchantChecksumWarn,
    }: {
        form: PresetForm;
        set: <K extends keyof PresetForm>(k: K, v: PresetForm[K]) => void;
        fields: (keyof PresetForm)[];
        agentValid: boolean | null;
        merchantValid: boolean | null;
        agentChecksumWarn: boolean;
        merchantChecksumWarn: boolean;
    }) {
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
                        {fields.includes("merchant") && (
                            <Field
                                label={t("create", "merchant")}
                                hint={
                                    merchantChecksumWarn
                                        ? t("create", "checksumWarn")
                                        : t("create", "merchantHint")
                                }
                                suffix={
                                    merchantValid === false ? (
                                        <span className="text-[12px] text-reject-paper">
                                            {t("create", "invalidAddress")}
                                        </span>
                                    ) : undefined
                                }
                            >
                                <AddressInput
                                    value={f.merchant}
                                    valid={merchantValid}
                                    onChange={(v) => setF("merchant", v as Address)}
                                    pasteLabel={t("create", "paste")}
                                />
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
                        {fields.includes("validDays") && (
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
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">
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
    function Preview({
        form: f,
        rendered: rs,
        verified: isVerified,
        checking,
        blocked: reason,
        onReview,
    }: {
        form: PresetForm;
        rendered: ReturnType<typeof renderCondition>[];
        verified: boolean | null;
        checking: boolean;
        blocked: string | null;
        onReview: () => void;
    }) {
        const merchantLabel = f.merchantName || (f.merchant ? short(String(f.merchant), 6) : "");
        const periodLabel = fmtDuration(f.period, lang);
        const until = fmtDate(
            BigInt(Math.floor(Date.now() / 1000) + f.validDays * 86_400),
            lang,
        );

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
                            <p className="text-[14.5px] leading-relaxed text-paper-ink">
                                {t("create", "sentence", {
                                    agent: f.agentName,
                                    merchant: merchantLabel,
                                    amount: fmtToken(f.token, f.amount),
                                    period: periodLabel,
                                    until,
                                    issuer: issuerName(f.issuer, lang),
                                })}
                            </p>
                            <div className="mt-5 space-y-2 border-t border-paper-line pt-4">
                                {rs.map((r, i) => (
                                    <Check key={i} ok paper>
                                        {r.lines[0]}
                                    </Check>
                                ))}
                            </div>
                        </>
                    )}

                    {isVerified === false && (
                        <p className="mt-5 rounded-lg border border-warn/40 bg-warn/10 p-3 text-[12.5px] leading-relaxed text-paper-ink-2">
                            {t("create", "notVerified")}
                        </p>
                    )}
                </div>

                <div className="border-t border-paper-line bg-paper-2/40 px-6 py-5">
                    <Button className="w-full" onClick={onReview} disabled={Boolean(reason)}>
                        {reason ?? `${t("create", "reviewSign")} →`}
                    </Button>
                    <p className="mt-2.5 text-center text-[11.5px] text-paper-mute">
                        {t("create", "gasFree")}
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
                                    <span className="text-[11px] font-semibold uppercase tracking-wider text-bronze-solid">
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

