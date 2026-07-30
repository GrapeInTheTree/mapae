/**
 * The GASOK pitch deck, generated.
 *
 * Design system = the product's own: Ink Black canvas, Warm Bone type, Oxidized Bronze only
 * where authority is at stake, jade/red reserved for settled/refused. One recurring motif - the
 * mono bronze kicker ("// SECTION") and the seal-point page dot - and deliberately nothing else:
 * no accent bars, no underlines, no decoration that reads as filler. Every number on these
 * slides is a measured fact with a hash or a command behind it.
 *
 * Fonts are real files on this machine (Noto Sans KR system-installed, Menlo), so the LibreOffice
 * QA render is the truth, and the shipped PDF embeds them.
 */
const pptxgen = require("pptxgenjs");
const path = require("path");

/* ---------------------------------- system --------------------------------- */

const C = {
    ink: "11100E",
    surface: "191815",
    surface2: "211F1C",
    line: "2B2925",
    lineStrong: "3A3731",
    bone: "E9E4DA",
    ink2: "B3AEA3",
    mute: "817C73",
    bronze: "B98450",
    bronzeBright: "D9AB77",
    bronzeDim: "6B452A",
    bronzeSolid: "8A5A35",
    jade: "4CBD9A",
    reject: "E5484D",
    paperInk: "11100E",
    paperMute: "78736A",
};
const KR = "Noto Sans KR";
const MONO = "Menlo";
const W = 13.33, H = 7.5, M = 0.9, CW = W - 2 * M;
const A = (p) => path.join(__dirname, "assets", p);

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.theme = {bodyFontFace: KR, headFontFace: KR};

let pageNo = 0;
function slide(kicker, opts = {}) {
    pageNo += 1;
    const s = pres.addSlide();
    s.background = {color: C.ink};
    if (kicker) {
        s.addText(kicker, {
            x: M, y: 0.42, w: 8, h: 0.3, margin: 0,
            fontFace: MONO, fontSize: 11, color: C.bronze, charSpacing: 2,
        });
    }
    if (!opts.noPage) {
        s.addShape(pres.ShapeType.ellipse, {x: W - 1.06, y: 7.06, w: 0.07, h: 0.07, fill: {color: C.bronzeSolid}});
        s.addText(String(pageNo).padStart(2, "0"), {
            x: W - 0.95, y: 6.93, w: 0.5, h: 0.3, margin: 0,
            fontFace: MONO, fontSize: 9, color: C.mute,
        });
    }
    return s;
}

function title(s, text, opts = {}) {
    s.addText(text, {
        x: M, y: opts.y ?? 0.92, w: opts.w ?? CW, h: opts.h ?? 0.75, margin: 0,
        fontFace: KR, bold: true, fontSize: opts.fontSize ?? 30, color: C.bone,
        charSpacing: 0,
    });
}
function sub(s, text, opts = {}) {
    s.addText(text, {
        x: M, y: opts.y ?? 1.62, w: opts.w ?? CW, h: opts.h ?? 0.4, margin: 0,
        fontFace: KR, fontSize: opts.fontSize ?? 15, color: opts.color ?? C.ink2,
    });
}
function card(s, x, y, w, h, opts = {}) {
    s.addShape(pres.ShapeType.roundRect, {
        x, y, w, h, rectRadius: 0.09,
        fill: {color: opts.fill ?? C.surface, transparency: opts.transparency ?? 0},
        line: {color: opts.line ?? C.line, width: opts.lineWidth ?? 0.75},
    });
}

/* =============================== 1 · COVER ================================= */
{
    const s = slide(null, {noPage: true});
    s.addText("GASOK 2026 · TRACK 3 — GIWA-NATIVE IDEAS", {
        x: 0, y: 0.62, w: W, h: 0.3, align: "center",
        fontFace: MONO, fontSize: 11, color: C.bronze, charSpacing: 3,
    });
    s.addImage({path: A("mark-bone.png"), x: (W - 1.5) / 2, y: 1.42, w: 1.5, h: 1.5});
    s.addText("마패", {
        x: 0, y: 3.05, w: W, h: 1.05, align: "center",
        fontFace: KR, bold: true, fontSize: 56, color: C.bone,
    });
    s.addText("M A P A E", {
        x: 0, y: 4.12, w: W, h: 0.35, align: "center",
        fontFace: KR, fontSize: 14, color: C.bronzeBright, charSpacing: 6,
    });
    s.addText("AI에게 지갑을 주지 마세요.  범위를 정한 권한만 주세요.", {
        x: 0, y: 4.78, w: W, h: 0.45, align: "center",
        fontFace: KR, fontSize: 18, color: C.ink2,
    });
    s.addText("에이전트 결제의 권한 레이어 — 실명 신원에 뿌리내린 위임", {
        x: 0, y: 5.28, w: W, h: 0.35, align: "center",
        fontFace: KR, fontSize: 13, color: C.mute,
    });
    s.addText([
        {text: "mapae.pages.dev", options: {color: C.bone}},
        {text: "      npx mapae-mcp", options: {color: C.bone}},
        {text: "      GIWA Sepolia 91342", options: {color: C.mute}},
    ], {
        x: 0, y: 6.5, w: W, h: 0.35, align: "center", fontFace: MONO, fontSize: 12.5,
    });
}

/* ============================== 2 · PROBLEM ================================ */
{
    const s = slide("// PROBLEM");
    title(s, "AI에게 돈을 맡길 방법이 없다");
    sub(s, "온체인 지갑에는 부분 권한이라는 개념이 없다. 오늘의 선택지는 둘뿐이다.");

    const cw = (CW - 0.45) / 2;
    const specs = [
        {x: M, head: "개인키를 통째로 준다", body: "지갑 열쇠를 넘기는 것 외에 방법이 없다.\n한도도, 대상도, 기한도 걸 수 없다."},
        {x: M + cw + 0.45, head: "남에게 맡긴다", body: "수탁형 에이전트 지갑.\n그 회사를 믿어야 하고, 제3자는 검증할 수 없다."},
    ];
    for (const p of specs) {
        card(s, p.x, 2.35, cw, 2.55);
        s.addText("✕", {x: p.x + 0.42, y: 2.72, w: 0.6, h: 0.55, margin: 0, fontFace: KR, bold: true, fontSize: 26, color: C.reject});
        s.addText(p.head, {x: p.x + 0.42, y: 3.35, w: cw - 0.84, h: 0.45, margin: 0, fontFace: KR, bold: true, fontSize: 19, color: C.bone});
        s.addText(p.body, {x: p.x + 0.42, y: 3.88, w: cw - 0.84, h: 0.85, margin: 0, fontFace: KR, fontSize: 13, color: C.ink2, lineSpacingMultiple: 1.25});
    }
    s.addText([
        {text: "그래서 아무도 안 준다", options: {bold: true, color: C.bone}},
        {text: " — 병목은 수요가 아니라 신뢰다.", options: {color: C.bronzeBright}},
    ], {x: M, y: 5.45, w: CW, h: 0.45, margin: 0, fontFace: KR, fontSize: 17});
}

/* =========================== 3 · ACCOUNTABILITY ============================ */
{
    const s = slide("// ACCOUNTABILITY");
    title(s, "한도를 걸어도 남는 질문 — 사고가 나면 누구 책임인가");

    card(s, M, 1.95, CW, 1.72);
    s.addText("다른 체인", {x: M + 0.42, y: 2.18, w: 2.2, h: 0.3, margin: 0, fontFace: MONO, fontSize: 11, color: C.mute, charSpacing: 1});
    s.addText("결제  →  0x7a3f…  →  ?", {x: M + 0.42, y: 2.5, w: 7.5, h: 0.5, margin: 0, fontFace: MONO, fontSize: 19, color: C.ink2});
    s.addText("책임 주체를 특정할 수 없다. 특정할 수 없으면, 보험 인수도 불가능하다.", {
        x: M + 0.42, y: 3.06, w: CW - 0.84, h: 0.35, margin: 0, fontFace: KR, fontSize: 12.5, color: C.mute,
    });

    card(s, M, 3.95, CW, 1.78, {line: C.bronzeDim});
    s.addText("기와 + 마패", {x: M + 0.42, y: 4.18, w: 2.4, h: 0.3, margin: 0, fontFace: MONO, fontSize: 11, color: C.bronzeBright, charSpacing: 1});
    s.addText([
        {text: "결제  →  ", options: {color: C.ink2}},
        {text: "마패", options: {color: C.bone, bold: true}},
        {text: "  →  ", options: {color: C.ink2}},
        {text: "도장", options: {color: C.bronzeBright, bold: true}},
        {text: "  →  ", options: {color: C.ink2}},
        {text: "실명", options: {color: C.bone, bold: true}},
    ], {x: M + 0.42, y: 4.5, w: 8.5, h: 0.5, margin: 0, fontFace: MONO, fontSize: 19});
    s.addText("모든 결제가 실존하는 사람에게 귀속된다. 그때 비로소, 인수 가능한 위험이 된다.", {
        x: M + 0.42, y: 5.08, w: CW - 0.84, h: 0.35, margin: 0, fontFace: KR, fontSize: 12.5, color: C.ink2,
    });

    s.addText("역추적은 저장된 기록이 아니라 체인을 다시 읽어 증명한다 — pnpm trace 한 번이면 결제에서 실명까지.", {
        x: M, y: 6.28, w: CW, h: 0.35, margin: 0, fontFace: KR, fontSize: 12, color: C.mute,
    });
}

/* ============================= 4 · THE SURVEY ============================== */
{
    const s = slide("// THE SURVEY");
    title(s, "가장 감사된 위임 조건 38개를 전수 조사했다");
    sub(s, "MetaMask delegation-framework — ERC-7710 표준의 최대 구현체 — 의 caveat enforcer 실측.", {fontSize: 13, color: C.mute});

    s.addText("38", {x: M - 0.05, y: 2.0, w: 4.6, h: 2.2, margin: 0, fontFace: KR, bold: true, fontSize: 130, color: C.bone});
    s.addText("금액 · 기간 · 스트리밍 · 허용 타겟\n허용 메서드 · 시간 범위 · 호출 횟수 — 전부 있다", {
        x: M, y: 4.28, w: 4.9, h: 0.75, margin: 0, fontFace: KR, fontSize: 13.5, color: C.ink2, lineSpacingMultiple: 1.3,
    });

    s.addText("0", {x: 7.1, y: 2.0, w: 3.2, h: 2.2, margin: 0, fontFace: KR, bold: true, fontSize: 130, color: C.bronzeBright});
    s.addText("그중, 신원을 조건으로 거는 것", {
        x: 7.15, y: 4.28, w: 5.2, h: 0.4, margin: 0, fontFace: KR, bold: true, fontSize: 15, color: C.bone,
    });
    s.addText("다른 체인에는 게이트할 신원이 없기 때문이다.", {
        x: 7.15, y: 4.72, w: 5.2, h: 0.35, margin: 0, fontFace: KR, fontSize: 12.5, color: C.mute,
    });

    s.addText([
        {text: "37개는 감사본 그대로 우리 매니저에서 돈다 — 우리는 표준을 발명하지 않는다.\n", options: {color: C.ink2}},
        {text: "이 표준은 지갑 중립이다. 기와 월렛이 채택하는 날, 같은 조건들이 그 안에서 돈다.", options: {color: C.bronzeBright}},
    ], {x: M, y: 5.62, w: CW, h: 0.85, margin: 0, fontFace: KR, fontSize: 14.5, lineSpacingMultiple: 1.35});
}

/* ============================== 5 · WHY GIWA =============================== */
{
    const s = slide("// WHY GIWA");
    title(s, "기와에는 게이트할 신원이 있다");
    sub(s, "라이선스 거래소가 발행자인 온체인 신원 — 도장. 이런 레이어를 가진 체인은 드물다.");

    const cw = (CW - 3 * 0.3) / 4;
    const prims = [
        {name: "도장", sub: "신원", q: "누구인가"},
        {name: "UP.ID", sub: "이름", q: "누구인가"},
        {name: "보자기", sub: "프라이버시", q: "누구인가"},
    ];
    prims.forEach((p, i) => {
        const x = M + i * (cw + 0.3);
        card(s, x, 2.5, cw, 2.3);
        s.addText(p.name, {x: x + 0.3, y: 2.85, w: cw - 0.6, h: 0.45, margin: 0, fontFace: KR, bold: true, fontSize: 20, color: C.ink2});
        s.addText(p.sub, {x: x + 0.3, y: 3.38, w: cw - 0.6, h: 0.3, margin: 0, fontFace: KR, fontSize: 12, color: C.mute});
        s.addText("“" + p.q + "”에 답한다", {x: x + 0.3, y: 4.1, w: cw - 0.6, h: 0.35, margin: 0, fontFace: KR, fontSize: 11.5, color: C.mute});
    });
    const x4 = M + 3 * (cw + 0.3);
    card(s, x4, 2.5, cw, 2.3, {line: C.bronze, lineWidth: 1.2, fill: C.surface2});
    s.addText("마패", {x: x4 + 0.3, y: 2.85, w: cw - 0.6, h: 0.45, margin: 0, fontFace: KR, bold: true, fontSize: 20, color: C.bronzeBright});
    s.addText("권한", {x: x4 + 0.3, y: 3.38, w: cw - 0.6, h: 0.3, margin: 0, fontFace: KR, fontSize: 12, color: C.bronze});
    s.addText("“누가 나 대신\n움직일 수 있는가”", {x: x4 + 0.3, y: 3.82, w: cw - 0.6, h: 0.7, margin: 0, fontFace: KR, bold: true, fontSize: 12.5, color: C.bone, lineSpacingMultiple: 1.25});

    s.addText("셋은 정적 사실이다. 권한은 발급되고, 소진되고, 만료되고, 취소되는 동적 상태다 — 비어 있던 네 번째 칸.", {
        x: M, y: 5.35, w: CW, h: 0.4, margin: 0, fontFace: KR, fontSize: 14, color: C.ink2,
    });
}

/* =============================== 6 · THE NAME ============================== */
{
    const s = slide("// THE NAME");
    title(s, "한도가 청동에 새겨져 있었다");
    sub(s, "이름을 빌린 게 아니라, 설계를 빌렸다.", {color: C.bronzeBright, fontSize: 15});

    s.addText(
        "마패는 상서원이 발급한 구리 패다. 뒷면에 새겨진 말의 수가 곧 역참에서 징발할 수 있는 말의 수 — 품계에 따라 차등 지급됐다. 왕은 십마패, 영의정은 칠마패를 썼다는 기록이 남아 있고, 현존 유물은 일마패에서 오마패까지다.\n\n관원의 신분 증명을 겸했고, 암행어사의 상징이 되었다.",
        {x: M, y: 2.35, w: 4.35, h: 3.2, margin: 0, fontFace: KR, fontSize: 13, color: C.ink2, lineSpacingMultiple: 1.4},
    );
    s.addImage({path: A("mark-bronze.png"), x: M + 0.02, y: 5.55, w: 0.85, h: 0.85, transparency: 35});

    const rows = [
        [{text: "조선의 마패", options: {bold: true, color: C.bronzeBright}}, {text: "오늘의 마패", options: {bold: true, color: C.bone}}],
        ["신원이 검증된 관원에게만 발급", "도장 보유자의 서명으로만 발급"],
        ["말의 수 = 권한의 크기, 품계별 차등", "서명된 한도 = 권한의 크기, 정책별 차등"],
        ["역참이 사용 시점에 패를 확인", "enforcer가 결제 시점에 조건을 확인"],
        ["삼마패로 네 필은 못 끈다", "캡을 넘는 1원도 거부된다 (실제 tx)"],
        ["임무와 기한이 정해져 있다", "수취인과 만료가 서명에 박혀 있다"],
    ];
    s.addTable(
        rows.map((r) => r.map((c) => (typeof c === "string" ? {text: c} : c))),
        {
            x: 5.75, y: 2.35, w: 6.65, colW: [3.2, 3.45],
            fontFace: KR, fontSize: 11.5, color: C.ink2,
            border: {type: "solid", pt: 0.5, color: C.line},
            fill: {color: C.surface},
            rowH: 0.52, valign: "middle", margin: [0.06, 0.12, 0.06, 0.12],
        },
    );
}

/* ============================ 7 · HOW IT WORKS ============================= */
{
    const s = slide("// HOW IT WORKS");
    title(s, "범위 강제는 프롬프트가 아니라 컨트랙트가 한다");

    const steps = [
        {head: "실명 이용자", sub: "도장 보유"},
        {head: "마패", sub: "범위 서명 · 무료 · 무흔적"},
        {head: "에이전트", sub: "위임 실행"},
        {head: "결제", sub: "온체인 정산"},
    ];
    const bw = 2.5, gap = (CW - 4 * bw) / 3;
    steps.forEach((p, i) => {
        const x = M + i * (bw + gap);
        card(s, x, 2.05, bw, 1.3, {fill: i === 1 ? C.surface2 : C.surface, line: i === 1 ? C.bronzeDim : C.line});
        s.addText(p.head, {x: x + 0.25, y: 2.28, w: bw - 0.5, h: 0.4, margin: 0, fontFace: KR, bold: true, fontSize: 16, color: i === 1 ? C.bronzeBright : C.bone});
        s.addText(p.sub, {x: x + 0.25, y: 2.74, w: bw - 0.5, h: 0.35, margin: 0, fontFace: KR, fontSize: 11, color: C.mute});
        if (i < 3) {
            s.addText("→", {x: x + bw + gap / 2 - 0.22, y: 2.5, w: 0.45, h: 0.4, margin: 0, fontFace: KR, fontSize: 18, color: C.bronze, align: "center"});
        }
    });

    const notes = [
        ["사고가 나면", "결제 기록에서 거꾸로 타고 올라가 실명까지 닿는다."],
        ["재위임하면", "좁히기만 가능하고, 루트의 킬스위치가 사슬 전체를 관통한다."],
        ["신원이 취소되면", "다음 결제부터 전부 거부된다 — 트랜잭션 없이, 즉시."],
    ];
    notes.forEach(([h, b], i) => {
        const y = 3.9 + i * 0.56;
        s.addText([
            {text: h + "   ", options: {bold: true, color: C.bone}},
            {text: b, options: {color: C.ink2}},
        ], {x: M, y, w: CW, h: 0.45, margin: 0, fontFace: KR, fontSize: 14});
    });

    s.addText("클라우드 자원에 IAM이 있듯, 에이전트 지출에 IAM — 단, 역할표도 관리자도 없이, 서명으로.", {
        x: M, y: 5.75, w: CW, h: 0.4, margin: 0, fontFace: KR, italic: true, fontSize: 13, color: C.mute,
    });
    s.addText("ERC-7710 · ERC-7715 · x402 v2 erc7710", {
        x: M, y: 6.35, w: CW, h: 0.3, margin: 0, fontFace: MONO, fontSize: 11, color: C.bronze, charSpacing: 1,
    });
}

/* ============================ 8 · KILL SWITCHES ============================ */
{
    const s = slide("// KILL SWITCHES");
    title(s, "두 개의 스위치 — 서로 독립, 각각 가역");
    sub(s, "네 장면 전부 GIWA Sepolia 라이브 트랜잭션이다. 익스플로러에서 각 해시가 조건 단위로 추적된다.", {fontSize: 12.5, color: C.mute});

    const cw = (CW - 0.4) / 2, ch = 1.78;
    const cells = [
        {t: "T5 · 위임 스위치 OFF", r: "거부", ok: false, err: "CannotUseADisabledDelegation", hash: "0x0dbdc013…3325e", note: "도장은 살아 있는데도"},
        {t: "T6 · 위임 스위치 ON", r: "재개", ok: true, err: "리셋이 아니라 재개 — 남은 한도부터", hash: "0xd0b461f6…db389", note: ""},
        {t: "T7 · 도장 취소", r: "거부", ok: false, err: "NotDojangVerified", hash: "0xd3843e1f…9ed65", note: "위임은 활성인데도"},
        {t: "T8 · 도장 재발급", r: "재개", ok: true, err: "신원 취소도 가역이다", hash: "0x250b424e…04217", note: ""},
    ];
    cells.forEach((p, i) => {
        const x = M + (i % 2) * (cw + 0.4);
        const y = 2.28 + Math.floor(i / 2) * (ch + 0.32);
        card(s, x, y, cw, ch, {line: p.ok ? C.line : C.lineStrong});
        s.addText(p.t, {x: x + 0.35, y: y + 0.2, w: cw - 1.6, h: 0.35, margin: 0, fontFace: KR, bold: true, fontSize: 14.5, color: C.bone});
        s.addText(p.r, {
            x: x + cw - 1.25, y: y + 0.2, w: 0.95, h: 0.35, margin: 0, align: "right",
            fontFace: KR, bold: true, fontSize: 14.5, color: p.ok ? C.jade : C.reject,
        });
        s.addText(p.err + (p.note ? "  ·  " + p.note : ""), {
            x: x + 0.35, y: y + 0.68, w: cw - 0.7, h: 0.38, margin: 0,
            fontFace: p.ok ? KR : MONO, fontSize: p.ok ? 12 : 11, color: p.ok ? C.ink2 : C.reject,
        });
        s.addText(p.hash, {x: x + 0.35, y: y + 1.18, w: cw - 0.7, h: 0.3, margin: 0, fontFace: MONO, fontSize: 10, color: C.mute});
    });

    s.addText("신원 스위치는 트랜잭션 없이, 그 사람의 모든 마패를 한 번에 멈춘다.", {
        x: M, y: 6.55, w: CW, h: 0.35, margin: 0, fontFace: KR, bold: true, fontSize: 13.5, color: C.bronzeBright,
    });
}

/* ============================== 9 · THE POINT ============================== */
{
    const s = slide("// THE POINT");
    title(s, "모든 조건이 멀쩡한데, 실패한다");

    const checks = ["서명은 유효하다", "한도는 아직 남았다", "기한도 지나지 않았다", "수취인도 허용 목록에 있다"];
    checks.forEach((t, i) => {
        const y = 2.15 + i * 0.62;
        s.addText("✓", {x: M, y, w: 0.45, h: 0.45, margin: 0, fontFace: KR, bold: true, fontSize: 19, color: C.jade});
        s.addText(t, {x: M + 0.55, y: y + 0.02, w: 5.4, h: 0.45, margin: 0, fontFace: KR, fontSize: 17, color: C.ink2});
    });

    card(s, 7.15, 2.1, 5.28, 2.55, {fill: C.surface2, line: C.lineStrong});
    s.addText("✕  거부", {x: 7.55, y: 2.42, w: 4.5, h: 0.6, margin: 0, fontFace: KR, bold: true, fontSize: 30, color: C.reject});
    s.addText("NotDojangVerified", {x: 7.55, y: 3.12, w: 4.5, h: 0.35, margin: 0, fontFace: MONO, fontSize: 14, color: C.reject});
    s.addText("실명 증명이 취소되었다는 이유,\n그 하나로 결제가 막힌다.", {
        x: 7.55, y: 3.58, w: 4.5, h: 0.75, margin: 0, fontFace: KR, fontSize: 13.5, color: C.bone, lineSpacingMultiple: 1.3,
    });

    s.addText([
        {text: "이것이 우리가 파는 것이다 — ", options: {color: C.ink2}},
        {text: "결제가 되는 것이 아니라, 안 되는 것.", options: {bold: true, color: C.bronzeBright}},
    ], {x: M, y: 5.35, w: CW, h: 0.45, margin: 0, fontFace: KR, fontSize: 17});
    s.addText("T7  0xd3843e1f…9ed65   ·   mapae.pages.dev/tx/0xd3843e1f… 에서 조건 단위로 추적된다", {
        x: M, y: 6.05, w: CW, h: 0.3, margin: 0, fontFace: MONO, fontSize: 10.5, color: C.mute,
    });
}

/* ============================ 10 · LIVE PRODUCT ============================ */
{
    const s = slide("// LIVE PRODUCT");
    title(s, "접속 가능한 제품 — 백엔드 0");
    sub(s, "mapae.pages.dev — 페이지의 모든 값은 저장된 데이터가 아니라, 방문자의 브라우저가 방금 체인에서 읽은 것이다.", {fontSize: 12.5, color: C.mute});

    const cw = (CW - 0.6) / 3, ch = 3.0, y0 = 2.3;
    // Composer: the one bone surface - the thing being signed.
    card(s, M, y0, cw, ch, {fill: C.bone, line: C.bone});
    s.addText("발급", {x: M + 0.3, y: y0 + 0.2, w: cw - 0.6, h: 0.3, margin: 0, fontFace: MONO, fontSize: 10, color: C.paperMute, charSpacing: 1});
    s.addText([
        {text: "데이터 에이전트", options: {bold: true}},
        {text: "는 지정한 사용처에 "},
        {text: "하루 최대 ₩30,000", options: {bold: true, color: C.bronzeSolid}},
        {text: "까지, "},
        {text: "8월 29일", options: {bold: true}},
        {text: "까지 결제할 수 있습니다 — 당신의 "},
        {text: "도장이 유효한 동안", options: {bold: true, color: C.bronzeSolid}},
        {text: "에만."},
    ], {x: M + 0.3, y: y0 + 0.62, w: cw - 0.6, h: 1.55, margin: 0, fontFace: KR, fontSize: 12, color: C.paperInk, lineSpacingMultiple: 1.35});
    s.addText("서명은 무료 · 트랜잭션도 가스도 없음", {x: M + 0.3, y: y0 + 2.45, w: cw - 0.6, h: 0.3, margin: 0, fontFace: KR, fontSize: 10.5, color: C.paperMute});

    // Permissions
    const x2 = M + cw + 0.3;
    card(s, x2, y0, cw, ch);
    s.addText("내 권한", {x: x2 + 0.3, y: y0 + 0.2, w: cw - 0.6, h: 0.3, margin: 0, fontFace: MONO, fontSize: 10, color: C.mute, charSpacing: 1});
    s.addText([
        {text: "사용 ₩3,750", options: {color: C.ink2}},
        {text: "  /  ₩5,000", options: {color: C.mute}},
    ], {x: x2 + 0.3, y: y0 + 0.66, w: cw - 0.6, h: 0.3, margin: 0, fontFace: MONO, fontSize: 11.5});
    s.addShape(pres.ShapeType.roundRect, {x: x2 + 0.3, y: y0 + 1.06, w: cw - 0.6, h: 0.09, rectRadius: 0.04, fill: {color: C.surface2}, line: {type: "none"}});
    s.addShape(pres.ShapeType.roundRect, {x: x2 + 0.3, y: y0 + 1.06, w: (cw - 0.6) * 0.75, h: 0.09, rectRadius: 0.04, fill: {color: C.bronze}, line: {type: "none"}});
    s.addShape(pres.ShapeType.roundRect, {x: x2 + 0.3, y: y0 + 1.5, w: 1.35, h: 0.42, rectRadius: 0.06, fill: {color: C.surface}, line: {color: C.reject, width: 0.75}});
    s.addText("비활성화", {x: x2 + 0.3, y: y0 + 1.5, w: 1.35, h: 0.42, margin: 0, align: "center", fontFace: KR, fontSize: 11, color: C.reject});
    s.addText("스위치는 실제 트랜잭션 —\n다음 결제부터 즉시 거부된다.", {x: x2 + 0.3, y: y0 + 2.12, w: cw - 0.6, h: 0.65, margin: 0, fontFace: KR, fontSize: 10.5, color: C.mute, lineSpacingMultiple: 1.3});

    // Trace
    const x3 = M + 2 * (cw + 0.3);
    card(s, x3, y0, cw, ch);
    s.addText("권한 추적", {x: x3 + 0.3, y: y0 + 0.2, w: cw - 0.6, h: 0.3, margin: 0, fontFace: MONO, fontSize: 10, color: C.mute, charSpacing: 1});
    s.addShape(pres.ShapeType.roundRect, {x: x3 + 0.3, y: y0 + 0.62, w: cw - 0.6, h: 1.05, rectRadius: 0.06, fill: {color: C.surface2}, line: {color: C.reject, width: 1}});
    s.addText([
        {text: "지출 한도      ", options: {bold: true, color: C.reject}},
        {text: "이 조건이 거부", options: {color: C.reject, fontSize: 9}},
    ], {x: x3 + 0.48, y: y0 + 0.74, w: cw - 0.96, h: 0.3, margin: 0, fontFace: KR, fontSize: 11.5});
    s.addText("transfer-amount-exceeded", {x: x3 + 0.48, y: y0 + 1.12, w: cw - 0.96, h: 0.28, margin: 0, fontFace: MONO, fontSize: 9.5, color: C.reject});
    s.addText("거부한 조건을 위임 사슬 안에서\n직접 지목한다 — 사유까지 사람의 말로.", {
        x: x3 + 0.3, y: y0 + 1.92, w: cw - 0.6, h: 0.7, margin: 0, fontFace: KR, fontSize: 10.5, color: C.mute, lineSpacingMultiple: 1.3,
    });

    s.addText([
        {text: "왕복 4건(P1–P4)은 사람이 MetaMask로 서명했다", options: {bold: true, color: C.bone}},
        {text: " — 스크립트의 자작극이 아니라 제품 경로의 증명.  ", options: {color: C.ink2}},
        {text: "발급만 되고 안 쓰인 마패는 체인에 없다 — 발급은 흔적 없는 무료 서명이다.", options: {color: C.mute}},
    ], {x: M, y: 5.72, w: CW, h: 0.75, margin: 0, fontFace: KR, fontSize: 12.5, lineSpacingMultiple: 1.35});
}

/* ============================= 11 · AGENT / MCP ============================ */
{
    const s = slide("// AGENT-NATIVE");
    title(s, "MCP를 말하는 모든 에이전트가, 이미 클라이언트다");

    s.addShape(pres.ShapeType.roundRect, {x: M, y: 1.85, w: 5.2, h: 0.62, rectRadius: 0.08, fill: {color: C.surface2}, line: {color: C.lineStrong, width: 0.75}});
    s.addText("$  npx mapae-mcp", {x: M + 0.25, y: 1.85, w: 4.8, h: 0.62, margin: 0, fontFace: MONO, fontSize: 17, color: C.bone, valign: "middle"});
    s.addText("npm 공개 발행 · Claude / Cursor / GPT 공통", {x: M + 5.45, y: 1.98, w: 4.5, h: 0.35, margin: 0, fontFace: KR, fontSize: 11.5, color: C.mute});

    const tools = [
        ["request_permission", "정책을 구성해 사람에게 서명 링크를 건넨다"],
        ["load_context", "사람이 서명한 권한을 대화 안에서 인계받는다"],
        ["pay", "서명된 정책 안에서만 결제한다"],
        ["check_budget", "남은 한도를 enforcer에서 읽는다"],
        ["redelegate", "더 좁은 권한을 하위 에이전트에 서명한다"],
    ];
    tools.forEach(([n, d], i) => {
        const y = 2.85 + i * 0.5;
        s.addText(n, {x: M, y, w: 2.6, h: 0.4, margin: 0, fontFace: MONO, fontSize: 12, color: C.bronzeBright});
        s.addText(d, {x: M + 2.7, y: y + 0.01, w: 3.9, h: 0.4, margin: 0, fontFace: KR, fontSize: 12, color: C.ink2});
    });
    s.addText([
        {text: "issue", options: {fontFace: MONO, strike: true, color: C.mute}},
        {text: "   — 없다. 발급은 사람의 서명이다. 그 키를 쥐는 순간, AI가 지갑을 쥔다.", options: {bold: true, color: C.bone}},
    ], {x: M, y: 5.42, w: 6.6, h: 0.6, margin: 0, fontFace: KR, fontSize: 12.5, lineSpacingMultiple: 1.25});

    card(s, 7.6, 2.85, 4.83, 2.9, {fill: C.surface2, line: C.line});
    s.addText(
        [
            {text: '{ "status": ', options: {color: C.mute}},
            {text: '"PAID"', options: {color: C.jade, bold: true}},
            {text: ',\n  "remainingThisPeriod": "₩1,300" }\n\n', options: {color: C.mute}},
            {text: '{ "status": ', options: {color: C.mute}},
            {text: '"REFUSED"', options: {color: C.reject, bold: true}},
            {text: ',\n  "reason": "transfer-amount-\n   exceeded" }', options: {color: C.mute}},
        ],
        {x: 7.85, y: 3.05, w: 4.35, h: 2.5, margin: 0, fontFace: MONO, fontSize: 12, lineSpacingMultiple: 1.3},
    );
    s.addText("거부는 에러가 아니라 사유를 실은 결과다 — 에이전트가 읽고, 사람에게 설명한다.", {
        x: 7.6, y: 5.85, w: 4.85, h: 0.6, margin: 0, fontFace: KR, fontSize: 11, color: C.mute, lineSpacingMultiple: 1.3,
    });

    s.addText("pay의 수취인은 인자가 아니라 서명된 정책에서 나온다 — 프롬프트 인젝션으로도, 다른 주소로는 못 보낸다.", {
        x: M, y: 6.5, w: CW, h: 0.35, margin: 0, fontFace: KR, bold: true, fontSize: 13, color: C.bronzeBright,
    });
}

/* ============================== 12 · x402 ================================= */
{
    const s = slide("// SETTLEMENT");
    title(s, "GIWA에서 실제로 동작하는 x402 결제 경로");
    sub(s, "에이전트가 유료 API를 만나면 — 사람 개입 없이 결제하고, 응답을 받는다.");

    const steps = ["402 응답", "서명 payload", "/verify", "/settle", "다시 /settle"];
    const bw = 1.98, gap = (CW - 5 * bw) / 4;
    steps.forEach((t, i) => {
        const x = M + i * (bw + gap);
        card(s, x, 2.3, bw, 0.78, {fill: i >= 3 ? C.surface2 : C.surface, line: i >= 3 ? C.bronzeDim : C.line});
        s.addText(t, {x, y: 2.3, w: bw, h: 0.78, margin: 0, align: "center", valign: "middle", fontFace: i === 0 || i > 1 ? MONO : KR, fontSize: 12.5, color: i >= 3 ? C.bronzeBright : C.ink2});
        if (i < 4) s.addText("→", {x: x + bw - 0.06, y: 2.48, w: gap + 0.12, h: 0.4, margin: 0, align: "center", fontFace: KR, fontSize: 14, color: C.mute});
    });

    s.addText([
        {text: "한 payload, 정산 두 번.", options: {bold: true, color: C.bone, fontSize: 20}},
        {text: "   exact 스킴 세 방식 중 유일한 multi-use — 구독·미터링이 가능한 이유.", options: {color: C.bronzeBright, fontSize: 14}},
    ], {x: M, y: 3.65, w: CW, h: 0.55, margin: 0, fontFace: KR});
    s.addText("F3  0x9fbe7b2b…c2422      F4  0x8a1fba25…c2db6      가스는 정산자가 낸다 — 에이전트는 payload만 건넨다", {
        x: M, y: 4.3, w: CW, h: 0.32, margin: 0, fontFace: MONO, fontSize: 10.5, color: C.mute,
    });

    const notes2 = [
        "정산자는 조건도 도장도 모른다 — 정책 엔진 전체가 온체인이므로, 알 필요도 속일 방법도 없다.",
        "GIWA에는 EIP-3009 토큰이 없어 다른 두 방식은 애초에 불가하다 — 우리가 실측해 문서화한 격차다.",
        "재위임 2홉 체인으로 정산된다 — 루트 위임자의 킬스위치가 정산 경로까지 관통한다.",
    ];
    notes2.forEach((t, i) => {
        s.addText(t, {x: M, y: 4.95 + i * 0.52, w: CW, h: 0.42, margin: 0, fontFace: KR, fontSize: 13, color: C.ink2});
    });
}

/* ========================= 13 · SHIPPED NOT PROMISED ======================= */
{
    const s = slide("// SHIPPED, NOT PROMISED");
    title(s, "약속이 아니라, 배포된 것");

    const stats = [
        ["8", "배포·전수 소스 검증 컨트랙트"],
        ["153", "테스트 · invariant 포함"],
        ["0 / 0", "Slither 고 · 중 심각도"],
        ["25+", "라이브 트랜잭션 · 거부 포함"],
        ["3", "언어 바이트 패리티 (Sol·TS·Go)"],
        ["1", "npm 패키지 — mapae-mcp"],
        ["1", "공개 URL — mapae.pages.dev"],
        ["0", "백엔드 · 죽을 서버가 없다"],
    ];
    const cw = CW / 4;
    stats.forEach(([v, l], i) => {
        const x = M + (i % 4) * cw;
        const y = 2.05 + Math.floor(i / 4) * 1.75;
        s.addText(v, {x, y, w: cw - 0.3, h: 0.85, margin: 0, fontFace: KR, bold: true, fontSize: 44, color: i === 3 ? C.bronzeBright : C.bone});
        s.addText(l, {x, y: y + 0.92, w: cw - 0.35, h: 0.55, margin: 0, fontFace: KR, fontSize: 11.5, color: C.mute, lineSpacingMultiple: 1.2});
    });

    s.addText([
        {text: "검증이 실제로 잡은 결함 — ", options: {bold: true, color: C.bone}},
        {text: "ModeLib 시프트 오류 4종(전부 통과하던 공허한 테스트 뒤에 숨어 있었다), 서명 페이로드 사본 드리프트, RPC 경쟁 조건. ", options: {color: C.ink2}},
        {text: "테스트의 수가 아니라, 테스트가 잡은 것을 센다.", options: {color: C.bronzeBright}},
    ], {x: M, y: 5.85, w: CW, h: 0.8, margin: 0, fontFace: KR, fontSize: 12.5, lineSpacingMultiple: 1.35});
}

/* ========================== 14 · SCOPE DISCIPLINE ========================== */
{
    const s = slide("// SCOPE DISCIPLINE");
    title(s, "만들지 않은 것");
    sub(s, "프리미티브는 작아야 꽂힌다 — 뺀 것 하나하나가 결정이다.");

    const rows = [
        ["지갑", "기와 월렛을 쓴다 — 대체가 아니라 탑재 대상이다"],
        ["스테이블코인", "원화 스테이블을 기다린다 — 자산 불가지론으로 설계, 맨몸 ERC-20으로 실증"],
        ["번들러 · 페이마스터", "기와 인프라를 소비한다 — 실측으로 격차만 문서화했다"],
        ["위임 표준", "ERC-7710 · 7715를 채택한다 — 발명하지 않는다"],
        ["ERC-8004 레지스트리", "퍼미션리스 자가 등록은 책임 사슬에 아무것도 보태지 않는다"],
        ["자체 백엔드", "권한의 존재는 체인만이 답한다 — 두 번째 진실 소스를 만들지 않는다"],
    ];
    rows.forEach(([t, d], i) => {
        const y = 2.42 + i * 0.66;
        s.addText(t, {x: M, y, w: 3.0, h: 0.5, margin: 0, fontFace: KR, bold: true, fontSize: 14.5, color: C.bone});
        s.addText(d, {x: M + 3.2, y: y + 0.02, w: CW - 3.2, h: 0.5, margin: 0, fontFace: KR, fontSize: 13, color: C.ink2});
    });
}

/* ================================ 15 · MARKET ============================== */
{
    const s = slide("// MARKET");
    title(s, "신원은 나를 위한 것이 아니다 — 상대방을 위한 것이다");
    sub(s, "나는 내가 누군지 안다. 모르는 것은, 내 에이전트의 결제를 받아주는 쪽이다.");

    const blocks = [
        ["가맹점 수용성", "환불과 분쟁의 상대가 될 실명이 사슬 끝에 있어야, 에이전트 결제를 받아준다."],
        ["규제 결제", "트래블룰 · AML. 실명 규제가 도장을 만들었고, 같은 규제가 마패를 요구한다."],
        ["자격 연동 지출", "법인 경비 · 복지 바우처. 자격 상실 = 발급기관의 취소 한 번 = 모든 지출 즉시 정지."],
        ["연령 · 적격 게이트", "검증된 성인 · 적격투자자의 권한에서 온 결제만 수령하는 서비스."],
    ];
    const cw = (CW - 0.4) / 2;
    blocks.forEach(([t, d], i) => {
        const x = M + (i % 2) * (cw + 0.4);
        const y = 2.5 + Math.floor(i / 2) * 1.62;
        card(s, x, y, cw, 1.38);
        s.addText(t, {x: x + 0.32, y: y + 0.18, w: cw - 0.64, h: 0.35, margin: 0, fontFace: KR, bold: true, fontSize: 15, color: C.bone});
        s.addText(d, {x: x + 0.32, y: y + 0.58, w: cw - 0.64, h: 0.68, margin: 0, fontFace: KR, fontSize: 11.5, color: C.ink2, lineSpacingMultiple: 1.25});
    });

    s.addText([
        {text: "실사용자 0 — 숨기지 않는다.  ", options: {bold: true, color: C.bone}},
        {text: "대신, 심사위원이 오늘 직접 심사할 수 있다: 접속 1분 · 발급 3분 · 설치 한 줄.", options: {color: C.bronzeBright}},
    ], {x: M, y: 6.1, w: CW, h: 0.4, margin: 0, fontFace: KR, fontSize: 13.5});
}

/* ========================== 16 · ROADMAP + CLOSING ========================= */
{
    const s = slide("// ROADMAP");
    title(s, "선발부터 데모데이까지, 그리고 그 뒤");

    const phases = [
        ["W1–2", "기와 월렛팀과 ERC-7715 스위치 협의\nx402 결제를 MCP pay에 통합"],
        ["W3–4", "도장 조회 API 공개 — GIWA 최초\nPonder 인덱서 가동"],
        ["W5–6", "코호트 팀 연동 · SDK 마찰 제거\nKBW 데모데이"],
    ];
    const bw = 3.55, gap = (CW - 3 * bw) / 2;
    phases.forEach(([w, b], i) => {
        const x = M + i * (bw + gap);
        card(s, x, 1.95, bw, 1.42);
        s.addText(w, {x: x + 0.3, y: 2.12, w: bw - 0.6, h: 0.3, margin: 0, fontFace: MONO, fontSize: 11.5, color: C.bronzeBright});
        s.addText(b, {x: x + 0.3, y: 2.46, w: bw - 0.6, h: 0.8, margin: 0, fontFace: KR, fontSize: 11.5, color: C.ink2, lineSpacingMultiple: 1.3});
    });
    s.addText("이후 — EIP-7702 경로(활성, 실측 완료) · 가스 대납(번들러 격차 해소 시) · localhost 콜백으로 복붙 없는 인계", {
        x: M, y: 3.62, w: CW, h: 0.35, margin: 0, fontFace: KR, fontSize: 12, color: C.mute,
    });

    const lines = [
        "지갑이 생기기 전에, 지갑의 언어를 먼저 구현했다 — 탑재는 통합이 아니라 스위치다.",
        "신원 발급자는 배포 상수가 아니라 서명되는 선택이다 — 도장 생태계가 자랄수록, 마패는 코드 변경 없이 넓어진다.",
    ];
    lines.forEach((t, i) => {
        s.addText(t, {x: M, y: 4.25 + i * 0.5, w: CW, h: 0.42, margin: 0, fontFace: KR, bold: true, fontSize: 14, color: C.bone});
    });

    s.addText([
        {text: "기와는 신원과 이름과 프라이버시를 갖췄다. 권한은 아직 비어 있다.\n", options: {color: C.ink2}},
        {text: "마패는 그 칸을 채우는 위임 프리미티브다.", options: {bold: true, color: C.bronzeBright}},
    ], {x: M, y: 5.55, w: 9.6, h: 0.95, margin: 0, fontFace: KR, fontSize: 17, lineSpacingMultiple: 1.4});
    s.addImage({path: A("mark-bone.png"), x: W - 1.85, y: 5.6, w: 0.85, h: 0.85});
    s.addText("mapae.pages.dev   ·   npx mapae-mcp   ·   github.com/GrapeInTheTree/mapae", {
        x: M, y: 6.75, w: CW, h: 0.3, margin: 0, fontFace: MONO, fontSize: 11, color: C.mute,
    });
}

/* ============================ A · CONTRACTS ================================ */
{
    const s = slide("// APPENDIX A — CONTRACTS");
    title(s, "컨트랙트 전표 — 8개 전수 소스 검증", {fontSize: 24});
    const rows = [
        ["MapaeDelegationManager", "0xfd0fCCCcF8071852783b5133b3CC47461f33e6Cd"],
        ["MapaeAccountFactory", "0x157aF4D7b3f52685c817d5558b3468caD9b61299"],
        ["DojangVerifiedEnforcer  ★기여물", "0xb2906a5079702B82C2973423d8cf91e8B41e6371"],
        ["AllowedPayeeEnforcer  ★오리지널", "0x7eF0f193B721B1749d890F1e231C8074670f1bD1"],
        ["ERC20PeriodTransferEnforcer  (MetaMask 감사본 vendored)", "0xE33ba891fa502A075D3E422258723eF4cB6AC892"],
        ["TimestampEnforcer  (MetaMask 감사본 vendored)", "0x2911cB5D4aeBCa3e42FAaa5488b6e04df3C9cc02"],
        ["VerifiedCodeEnforcer  ★오리지널", "0x1C640E0A70b1E18B120bB20952e81Df8F6b8650e"],
        ["MockKRW  (자산 불가지론의 placeholder)", "0x8bd74916E3427B4eF8Bed3D2F49241056E5e4F2B"],
    ];
    rows.forEach(([n, a], i) => {
        const y = 2.0 + i * 0.56;
        s.addText(n, {x: M, y, w: 6.0, h: 0.45, margin: 0, fontFace: KR, fontSize: 12.5, color: C.bone});
        s.addText(a, {x: 7.0, y: y + 0.03, w: 5.4, h: 0.4, margin: 0, fontFace: MONO, fontSize: 11, color: C.ink2});
    });
    s.addText("검증 상태는 pnpm check-verified 가 Blockscout API에서 매번 다시 확인한다 — 화면이 아니라 API의 is_verified 를 읽는다.", {
        x: M, y: 6.6, w: CW, h: 0.35, margin: 0, fontFace: KR, fontSize: 11.5, color: C.mute,
    });
}

/* ============================ B · TRANSACTIONS ============================= */
{
    const s = slide("// APPENDIX B — LIVE TRANSACTIONS");
    title(s, "트랜잭션 전표 — 거부가 절반이다", {fontSize: 24});

    const mk = (rows) => rows.map(([id, d, ok, h]) => [
        {text: id, options: {fontFace: MONO, color: C.mute}},
        {text: d, options: {color: C.ink2}},
        {text: ok, options: {fontFace: KR, bold: true, color: ok === "성공" || ok === "PAID" ? C.jade : C.reject}},
        {text: h, options: {fontFace: MONO, color: C.mute}},
    ]);
    const rows = mk([
        ["T1", "허용 수취인에 30,000 결제", "성공", "0xa01e6e86…"],
        ["T2", "한도 초과 +30,000", "거부", "0xe7563dfa…"],
        ["T3", "허용 외 수취인", "거부", "0x131e9744…"],
        ["T4", "업비트 도장 요구 (미보유)", "거부", "0xfaf9880c…"],
        ["T5", "위임 비활성 중 결제", "거부", "0x0dbdc013…"],
        ["T6", "재활성 후 결제 — 재개", "성공", "0xd0b461f6…"],
        ["T7", "도장 취소 후 결제", "거부", "0xd3843e1f…"],
        ["T8", "도장 재발급 후 결제", "성공", "0x250b424e…"],
        ["P1–P4", "사람이 MetaMask로 서명한 왕복 (2 성공 · 2 거부)", "왕복", "0xf320b785… 외 3"],
        ["F3–F4", "x402 정산 2회 — 같은 payload", "성공", "0x9fbe7b2b… · 0x8a1fba25…"],
        ["MCP", "npx mapae-mcp 의 pay — 결제와 한도 초과 거부", "PAID/REFUSED", "0x0d7ded4b… · 0x3d64f498…"],
    ]);
    s.addTable(rows, {
        x: M, y: 1.95, w: CW, colW: [1.0, 6.1, 1.35, 3.08],
        fontFace: KR, fontSize: 10.5,
        border: {type: "solid", pt: 0.5, color: C.line},
        fill: {color: C.surface}, rowH: 0.4, valign: "middle", margin: [0.03, 0.1, 0.03, 0.1],
    });
    s.addText("전체 해시와 익스플로러 링크: github.com/GrapeInTheTree/mapae → docs/DEMO.md", {
        x: M, y: 6.85, w: CW, h: 0.3, margin: 0, fontFace: MONO, fontSize: 10, color: C.mute,
    });
}

/* ============================ C · ARCHITECTURE ============================= */
{
    const s = slide("// APPENDIX C — ARCHITECTURE");
    title(s, "아키텍처 — 정책 엔진 전체가 온체인이다", {fontSize: 24});

    const box = (x, y, w, h, head, subT, opts = {}) => {
        card(s, x, y, w, h, opts);
        s.addText(head, {x: x + 0.2, y: y + 0.12, w: w - 0.4, h: 0.34, margin: 0, fontFace: KR, bold: true, fontSize: 13, color: opts.headColor ?? C.bone});
        if (subT) s.addText(subT, {x: x + 0.2, y: y + 0.47, w: w - 0.4, h: 0.5, margin: 0, fontFace: KR, fontSize: 10, color: C.mute, lineSpacingMultiple: 1.2});
    };
    // Off-chain row
    box(M, 2.1, 2.6, 1.0, "사람 (principal)", "도장 보유 · EIP-712 서명");
    box(M, 3.4, 2.6, 1.0, "에이전트 / MCP", "자기 키 · 컨텍스트만 보유");
    box(M, 4.7, 2.6, 1.0, "x402 정산자", "무지 · 무권한 · 가스 지불");
    // Chain boundary
    s.addText("─ 체인 경계 — 이 오른쪽이 전부다 ─", {x: 3.9, y: 1.72, w: 8.3, h: 0.3, margin: 0, align: "center", fontFace: KR, fontSize: 10.5, color: C.bronze});
    // On-chain
    box(4.6, 2.9, 3.1, 1.35, "DelegationManager", "체인 검증 · 킬스위치 ·\nredeemDelegations", {line: C.bronzeDim, fill: C.surface2, headColor: C.bronzeBright});
    box(8.4, 2.0, 4.0, 1.0, "enforcer 6종", "신원 ★ · 한도 · 수취인 ★ · 기한 · 코드 ★");
    box(8.4, 3.25, 4.0, 1.0, "DojangScroll · EAS", "결제 순간마다 isVerified 라이브 읽기");
    box(8.4, 4.5, 4.0, 1.0, "MapaeAccount + Factory", "자금 보관 · owner = 사람 · ERC-1271");
    // arrows
    const arrow = (x1, y1, x2, y2) =>
        s.addShape(pres.ShapeType.line, {x: x1, y: y1, w: x2 - x1, h: y2 - y1, line: {color: C.mute, width: 1, endArrowType: "arrow"}});
    arrow(3.5, 2.6, 4.6, 3.3);
    arrow(3.5, 3.9, 4.6, 3.6);
    arrow(3.5, 5.2, 4.6, 3.9);
    arrow(7.7, 3.2, 8.4, 2.6);
    arrow(7.7, 3.55, 8.4, 3.7);
    arrow(7.7, 3.95, 8.4, 4.9);

    s.addText("발급은 서명(무료·무흔적) → 사용 시점에 매니저가 모든 조건을 검증 → 거부 사유까지 온체인에 남는다.\n프론트도 MCP도 정산자도 신뢰 지점이 아니다 — 전부 사라져도 권한은 동작하고, 취소는 여전히 즉시다.", {
        x: M, y: 6.0, w: CW, h: 0.8, margin: 0, fontFace: KR, fontSize: 12, color: C.ink2, lineSpacingMultiple: 1.35,
    });
}

/* ============================ D · HONEST LIMITS ============================ */
{
    const s = slide("// APPENDIX D — HONEST LIMITS");
    title(s, "정직한 한계 — 심사자가 찾기 전에 먼저 말한다", {fontSize: 24});

    const rows = [
        ["실사용자 0", "이틀 만에 만들 수 없는 것. 대신 심사자가 오늘 직접 전 구간을 재현할 수 있게 만들었다 — 접속·발급·설치·결제·취소."],
        ["1인 빌더", "숨기지 않는다. 반증은 실행의 폭이다 — Solidity 컨트랙트 8개 + TS SDK + Go 정산자 + React 제품 + MCP, 그리고 의도적으로 만들지 않은 것들의 목록."],
        ["VerifiedCode는 목 검증", "실코드 발급자가 업비트뿐이라 라이브 실증이 불가하다. 배포·테스트 완료 상태로, 사실대로 표기한다."],
        ["mKRW는 placeholder", "자산 불가지론의 증명이기도 하다 — EIP-3009도 2612도 일부러 구현하지 않은 맨몸 ERC-20 위에서 전부 동작했다. 원화 스테이블 출시 시 주소 교체 외에 변경이 없다."],
    ];
    rows.forEach(([t, d], i) => {
        const y = 2.1 + i * 1.13;
        s.addText(t, {x: M, y, w: 3.1, h: 0.9, margin: 0, fontFace: KR, bold: true, fontSize: 14.5, color: C.bone, lineSpacingMultiple: 1.2});
        s.addText(d, {x: M + 3.3, y: y + 0.02, w: CW - 3.3, h: 1.0, margin: 0, fontFace: KR, fontSize: 12.5, color: C.ink2, lineSpacingMultiple: 1.3});
    });
}

/* --------------------------------- write ---------------------------------- */

pres.writeFile({fileName: path.join(__dirname, "mapae_pitch_v3.pptx")}).then(() => {
    console.log("written: mapae_pitch_v3.pptx —", pageNo, "slides");
});
