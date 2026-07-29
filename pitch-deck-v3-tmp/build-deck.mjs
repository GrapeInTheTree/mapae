import fs from "node:fs/promises";
import path from "node:path";
import {FileBlob, PresentationFile} from "@oai/artifact-tool";

const TMP = "/Users/ahn_euijin/mapae/pitch-deck-v3-tmp";
const STARTER = path.join(TMP, "template-starter.pptx");
const OUT = "/Users/ahn_euijin/mapae/mapae_gasok_phase2_pitch_ko.pptx";
const QA_DIR = path.join(TMP, "qa-render");

const ORANGE = "#FF4709";
const WHITE = "#FFFFFF";
const MUTED = "#A6A6A6";
const KOREAN = "Apple SD Gothic Neo";
const LATIN = "Roboto";
const SERIF = "Lora";

const presentation = await PresentationFile.importPptx(await FileBlob.load(STARTER));
console.log("IMPORTED", presentation.slides.count);
if (process.env.INSPECT_AIDS === "1") {
  for (let i = 0; i < presentation.slides.count; i += 1) {
    const slide = presentation.slides.getItem(i);
    console.log(`SLIDE ${i + 1}`, slide.aid);
    for (const item of slide.elements.items) {
      const preview = item.type === "shape" ? item.text.toString().replace(/\s+/g, " ").slice(0, 80) : "";
      console.log(item.type, item.aid, item.name ?? "", preview);
    }
  }
  process.exit(0);
}
const targetMap = new Map();
for (let i = 0; i < presentation.slides.count; i += 1) {
  const n = String(i + 1).padStart(2, "0");
  const layoutPath = path.join(TMP, "template-starter-layout", `starter-slide-${n}.layout.json`);
  const layout = JSON.parse(await fs.readFile(layoutPath, "utf8"));
  for (const element of layout.elements) {
    targetMap.set(element.aid, {slideIndex: i, elementIndex: element.order - 1});
  }
}

function shape(id) {
  const target = targetMap.get(id);
  if (!target) {
    console.error("RESOLVE_FAIL", id, "No frame-map target");
    process.exit(2);
  }
  return presentation.slides.getItem(target.slideIndex).elements.items[target.elementIndex];
}

function setPlain(id, text, style = {}) {
  const target = shape(id);
  target.text = text;
  target.text.style = {
    ...style,
  };
  return target;
}

function setParagraphs(id, paragraphs, style = {}) {
  const target = shape(id);
  target.text.style = {
    ...style,
  };
  target.text.set(paragraphs);
  return target;
}

function run(text, options = {}) {
  return {
    run: text,
    textStyle: {
      typeface: options.typeface ?? KOREAN,
      fontSize: options.fontSize ?? "24px",
      color: options.color ?? WHITE,
      bold: options.bold ?? false,
      italic: options.italic ?? false,
    },
  };
}

function paragraph(runs, options = {}) {
  return {
    runs,
    bulletCharacter: options.bulletCharacter ?? "",
    marginLeft: options.marginLeft ?? 0,
    indent: options.indent ?? 0,
    spaceBefore: options.spaceBefore ?? 0,
    spaceAfter: options.spaceAfter ?? 0,
    paragraphStyle: {
      alignment: options.alignment ?? "left",
      lineSpacing: options.lineSpacing ?? 1.08,
    },
  };
}

function footer(footerId, numberId, number) {
  setPlain(footerId, "MAPAE · GASOK PHASE 2", {
    typeface: LATIN,
    fontSize: 13.33,
    color: MUTED,
    alignment: "left",
    verticalAlignment: "bottom",
    autoFit: "none",
  });
  setPlain(numberId, String(number), {
    typeface: LATIN,
    fontSize: 13.33,
    color: MUTED,
    alignment: "right",
    verticalAlignment: "bottom",
    autoFit: "none",
  });
}

function title(id, text) {
  return setPlain(id, text, {
    typeface: KOREAN,
    fontSize: 38.67,
    color: WHITE,
    bold: true,
    alignment: "left",
    verticalAlignment: "top",
    autoFit: "none",
    wrap: "square",
    insets: {top: 0, right: 0, bottom: 0, left: 0},
  });
}

function body(id, text, size = 24, color = MUTED) {
  return setPlain(id, text, {
    typeface: KOREAN,
    fontSize: size,
    color,
    alignment: "left",
    verticalAlignment: "top",
    autoFit: "none",
    wrap: "square",
    insets: {top: 0, right: 0, bottom: 0, left: 0},
  });
}

function metric(id, text) {
  return setPlain(id, text, {
    typeface: KOREAN,
    fontSize: 72,
    color: ORANGE,
    bold: true,
    alignment: "left",
    verticalAlignment: "bottom",
    autoFit: "shrinkText",
    insets: {top: 0, right: 0, bottom: 0, left: 0},
  });
}

function metricCaption(id, text) {
  return setPlain(id, text, {
    typeface: KOREAN,
    fontSize: 21.33,
    color: WHITE,
    alignment: "left",
    verticalAlignment: "top",
    autoFit: "none",
    wrap: "square",
    insets: {top: 0, right: 0, bottom: 0, left: 0},
  });
}

function checklistText(id, text) {
  return setPlain(id, text, {
    typeface: KOREAN,
    fontSize: 21.33,
    color: WHITE,
    bold: true,
    alignment: "left",
    verticalAlignment: "middle",
    autoFit: "none",
    insets: {top: 0, right: 0, bottom: 0, left: 0},
  });
}

function threeColumn(id, heading, copy) {
  return setParagraphs(id, [
    paragraph([run(heading, {fontSize: "24px", color: ORANGE, bold: true})], {spaceAfter: 14}),
    paragraph([run(copy, {fontSize: "22px", color: WHITE})], {lineSpacing: 1.14}),
  ], {
    typeface: KOREAN,
    fontSize: 24,
    color: WHITE,
    alignment: "left",
    verticalAlignment: "top",
    autoFit: "none",
    wrap: "square",
    insets: {top: 0, right: 0, bottom: 0, left: 0},
  });
}

function notes(slideIndex, presenterLines, sources) {
  const slide = presentation.slides.getItem(slideIndex - 1);
  const noteText = [
    ...presenterLines,
    "",
    "[Sources]",
    ...sources.map((source) => `- ${source}`),
    "[/Sources]",
  ].join("\n");
  slide.speakerNotes.textFrame.setText(noteText);
  slide.speakerNotes.setVisible(true);
}

// 1 — Cover
setParagraphs("sh/ja5g3al8", [
  paragraph([run("MAPAE", {typeface: SERIF, fontSize: "96px", color: WHITE})], {alignment: "center"}),
  paragraph([run("제한된 권한을.", {fontSize: "78px", color: WHITE, bold: true})], {alignment: "center"}),
], {
  typeface: KOREAN,
  fontSize: 78,
  color: WHITE,
  alignment: "center",
  verticalAlignment: "middle",
  autoFit: "none",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
setPlain("sh/v2xgr214", "AI에게 지갑을 건네지 않고, 결제 권한만 발급하는 GIWA-native delegation layer", {
  typeface: KOREAN,
  fontSize: 24,
  color: MUTED,
  alignment: "center",
  verticalAlignment: "middle",
  autoFit: "none",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
setPlain("sh/5c7y5k3e", "GASOK PHASE 2 · AI / WEB3", {
  typeface: LATIN,
  fontSize: 26.67,
  color: ORANGE,
  alignment: "center",
  verticalAlignment: "middle",
  autoFit: "none",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
notes(1, [
  "오프닝: Mapae는 AI 지갑이 아니라 AI에게 발급하는 제한된 권한입니다.",
  "첫 20초에는 기능 목록보다 ‘지갑을 주지 않는다’는 차이를 분명히 말합니다.",
], [
  "/Users/ahn_euijin/mapae/README.md",
  "https://giwa.io/gasok",
]);

// 2 — Problem thesis
footer("sh/exczmlkf", "sh/mt8fqp47", 2);
setPlain("sh/n250jqlw", "THE PROBLEM", {
  typeface: LATIN,
  fontSize: 26.67,
  color: MUTED,
  alignment: "center",
  verticalAlignment: "middle",
  autoFit: "none",
});
setParagraphs("sh/nuhgjuls", [
  paragraph([
    run("AI 결제의 문제는 개인키가 아니라", {fontSize: "48px", color: WHITE, bold: true}),
    run("\n권한의 모양이다", {fontSize: "48px", color: ORANGE, bold: true}),
  ], {alignment: "center", lineSpacing: 0.9}),
], {
  typeface: KOREAN,
  fontSize: 48,
  color: WHITE,
  alignment: "center",
  verticalAlignment: "bottom",
  autoFit: "none",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
setParagraphs("sh/wzaxwzm9", [
  paragraph([run("모델에게 개인키를 건네면 모든 자산과 모든 행동을 허용합니다.", {fontSize: "24px"})], {
    bulletCharacter: "•", marginLeft: 24, indent: -16, alignment: "center", lineSpacing: 1.14, spaceAfter: 18,
  }),
  paragraph([run("매 결제마다 사람이 승인하면 에이전트의 자율성이 사라집니다.", {fontSize: "24px"})], {
    bulletCharacter: "•", marginLeft: 24, indent: -16, alignment: "center", lineSpacing: 1.14,
  }),
], {
  typeface: KOREAN,
  fontSize: 24,
  color: WHITE,
  alignment: "center",
  verticalAlignment: "top",
  autoFit: "none",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
notes(2, [
  "핵심 대비: ‘완전한 키 위임’과 ‘매번 승인’ 사이에 제품화된 중간층이 비어 있습니다.",
  "Mapae는 그 중간층을 권한으로 정의합니다.",
], [
  "https://eips.ethereum.org/EIPS/eip-7710",
  "https://eips.ethereum.org/EIPS/eip-7715",
  "/Users/ahn_euijin/mapae/README.md",
]);

// 3 — Status quo
footer("sh/dcr21wni", "sh/snq5kf6d", 3);
title("sh/doz6tkny", "오늘의 선택은 둘뿐이다");
body("sh/por2xwnm", "키를 통째로 넘기거나, 결제마다 사람을 부른다. 둘 다 AI 에이전트의 운영 모델이 될 수 없습니다.");
metric("sh/6xg3q9wf", "전부");
metricCaption("sh/t0rm1ov6", "개인키를 넘기면\n권한의 경계가 없다");
metric("sh/e103utwb", "매번");
metricCaption("sh/14rm5ov2", "사람이 승인하면\n자율성이 사라진다");
metric("sh/zmdoz2xg", "공백");
metricCaption("sh/0nmps7y1", "사고 뒤 책임과\n감사 경로가 없다");
notes(3, [
  "세 단어만 읽히게 합니다: 전부 / 매번 / 공백.",
  "Mapae가 채우는 곳은 ‘전부’와 ‘매번’ 사이의 권한 레이어입니다.",
], [
  "https://eips.ethereum.org/EIPS/eip-7715",
  "/Users/ahn_euijin/mapae/README.md",
]);

// 4 — Composer
footer("sh/3m1k7e54", "sh/cjatgvix", 4);
title("sh/dkju90zi", "한 문장으로 발급하는\n제한된 권한");
setPlain("sh/gja1wzmt", "프리셋 → 정책 → 검토 → EIP-712 서명", {
  typeface: KOREAN,
  fontSize: 28,
  color: ORANGE,
  bold: true,
  alignment: "left",
  verticalAlignment: "top",
  autoFit: "none",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
setParagraphs("sh/hkj254ne", [
  paragraph([run("“API Agent가 지정 가맹점에 mKRW로 하루 5만 원까지, 7일 동안 결제할 수 있다.”", {fontSize: "24px", color: WHITE, bold: true})], {spaceAfter: 24, lineSpacing: 1.16}),
  paragraph([run("사람이 읽는 문장과 에이전트가 받는 bytes는 같은 구조에서 생성됩니다. 서명은 무료이고, 자금과 개인키는 어디에도 맡기지 않습니다.", {fontSize: "22px", color: MUTED})], {lineSpacing: 1.18}),
], {
  typeface: KOREAN,
  fontSize: 24,
  color: WHITE,
  alignment: "left",
  verticalAlignment: "top",
  autoFit: "none",
  wrap: "square",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
{
  const image = shape("im/ripwv25o");
  const imageBytes = await fs.readFile(path.join(TMP, "mapae-composer-ko.png"));
  image.replace({blob: imageBytes, contentType: "image/png", alt: "Mapae Korean Composer screen", fit: "contain"});
  image.fit = "contain";
  image.crop = {left: 0, top: 0, right: 0, bottom: 0};
}
notes(4, [
  "실제 한국어 Composer 화면입니다. 목업이 아닙니다.",
  "프리셋은 쉬운 시작점이고, 사용자는 에이전트·가맹점·한도·기간·신원을 직접 조합합니다.",
], [
  "/Users/ahn_euijin/mapae/pitch-deck-v3-tmp/mapae-composer-ko.png",
  "/Users/ahn_euijin/mapae/README.md",
  "/Users/ahn_euijin/mapae/docs/ERC7715.md",
]);

// 5 — Caveats
footer("sh/rat4nu50", "sh/t03qtczi", 5);
title("sh/szu907ix", "서명은 한 번.\n검증은 결제마다.");
setPlain("sh/ju18n2h0", "Permission = identity ∧ payee ∧ amount ∧ time", {
  typeface: LATIN,
  fontSize: 26,
  color: ORANGE,
  bold: true,
  alignment: "left",
  verticalAlignment: "top",
  autoFit: "none",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
setParagraphs("sh/ipofmtw7", [
  paragraph([run("서명된 Mapae는 자산이 아니라 제한된 권한 증서입니다.", {fontSize: "24px", color: WHITE, bold: true})], {spaceAfter: 22, lineSpacing: 1.14}),
  paragraph([run("에이전트가 사용할 때 ERC-7710 manager가 모든 caveat enforcer를 호출합니다. 조건 하나라도 실패하면 실행 자체가 멈춥니다.", {fontSize: "22px", color: MUTED})], {spaceAfter: 22, lineSpacing: 1.18}),
  paragraph([run("새 조건은 manager를 다시 만들지 않고 enforcer를 더하는 방식으로 확장됩니다.", {fontSize: "22px", color: MUTED})], {lineSpacing: 1.18}),
], {
  typeface: KOREAN,
  fontSize: 24,
  color: WHITE,
  alignment: "left",
  verticalAlignment: "top",
  autoFit: "none",
  wrap: "square",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
checklistText("sh/1gv6t4n2", "Dojang 신원이 유효한가");
checklistText("sh/a14fi9wb", "허용된 수취인인가");
checklistText("sh/8zmxgze5", "기간 한도가 남았는가");
checklistText("sh/pgned07e", "유효 시간 안인가");
checklistText("sh/2twvilo3", "전부 통과할 때만 실행");
notes(5, [
  "Caveat는 권한을 제한하는 조건입니다.",
  "Mapae는 Identity, Payee, Amount/Period, Time을 조합하고, 모두 통과할 때만 결제합니다.",
], [
  "https://eips.ethereum.org/EIPS/eip-7710",
  "/Users/ahn_euijin/mapae/docs/SPEC.md",
  "/Users/ahn_euijin/mapae/README.md",
]);

// 6 — Identity / funds split
footer("sh/s3ap47mh", "sh/gbmxcnat", 6);
setPlain("sh/hsjqhc3y", "THE GIWA-NATIVE INSIGHT", {
  typeface: LATIN,
  fontSize: 26.67,
  color: MUTED,
  alignment: "center",
  verticalAlignment: "middle",
  autoFit: "none",
});
setParagraphs("sh/1cvelsby", [
  paragraph([
    run("신원은 사람에게.", {fontSize: "48px", color: WHITE, bold: true}),
    run("\n돈은 계정에.", {fontSize: "48px", color: ORANGE, bold: true}),
  ], {alignment: "center", lineSpacing: 0.9}),
], {
  typeface: KOREAN,
  fontSize: 48,
  color: WHITE,
  alignment: "center",
  verticalAlignment: "bottom",
  autoFit: "none",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
setParagraphs("sh/65kv6dsb", [
  paragraph([run("EOA는 Dojang Verified Address를 보유하고, MapaeAccount는 자금과 실행 권한을 보유합니다.", {fontSize: "24px"})], {
    bulletCharacter: "•", marginLeft: 24, indent: -16, alignment: "center", lineSpacing: 1.14, spaceAfter: 16,
  }),
  paragraph([run("Factory가 소유자의 EIP-712 동의로 두 주소를 결박하므로, 계정이 Dojang을 빌리거나 위조할 수 없습니다.", {fontSize: "24px"})], {
    bulletCharacter: "•", marginLeft: 24, indent: -16, alignment: "center", lineSpacing: 1.14,
  }),
], {
  typeface: KOREAN,
  fontSize: 24,
  color: WHITE,
  alignment: "center",
  verticalAlignment: "top",
  autoFit: "none",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
notes(6, [
  "이 분리가 Mapae의 핵심 보안 설계입니다.",
  "사람의 신원과 돈을 담는 계정을 분리하되, 소유자 동의로만 연결합니다.",
], [
  "https://docs.giwa.io/giwa-chain/en/giwa-ecosystem/dojang",
  "https://docs.giwa.io/giwa-chain/en/giwa-ecosystem/dojang/verified-address",
  "/Users/ahn_euijin/mapae/README.md",
  "/Users/ahn_euijin/mapae/docs/SPEC.md",
]);

// 7 — Built stack
footer("sh/xk3adoz6", "sh/v290b29c", 7);
title("sh/u10j2xsr", "MVP가 아니라,\n이미 하나의 제품 흐름이다");
body("sh/wju94jil", "발급 → 실행 → 감사 → 중단을 같은 권한 모델로 연결했습니다.");
threeColumn("sh/58bihcre", "01 · WALLET", "프리셋 Composer\n자연어 검토\nEIP-712 서명\nPermissions kill switch");
threeColumn("sh/ilcr690r", "02 · PROTOCOL", "ERC-7710 manager\n7개 검증 컨트랙트\n재위임 체인\ncustom caveat SDK");
threeColumn("sh/jm5sfehc", "03 · SETTLEMENT", "x402 facilitator\n온체인 한도 차감\nExplorer 책임 추적\n거절 이유 해석");
notes(7, [
  "발급 화면만 만든 것이 아니라, 권한의 전체 생애주기를 구현했습니다.",
  "같은 서명 구조를 Wallet UI, Solidity, TypeScript SDK, Go facilitator가 함께 이해합니다.",
], [
  "/Users/ahn_euijin/mapae/README.md",
  "/Users/ahn_euijin/mapae/docs/SPEC.md",
  "/Users/ahn_euijin/mapae/docs/DEMO.md",
]);

// 8 — Proof
footer("sh/r6lk72hk", "sh/id8jql8r", 8);
title("sh/3eh0j6pc", "실행력은 이미 코드로 증명했다");
body("sh/za5kbmhg", "성공만 보여주지 않았습니다. 한도 초과, 허용되지 않은 수취인, 신원 취소, delegation disable까지 public testnet에서 실패시켰습니다.");
metric("sh/cry1s7e1", "16");
metricCaption("sh/rqp0j2dw", "GIWA Sepolia\n라이브 트랜잭션");
metric("sh/0fi1wred", "153");
metricCaption("sh/zepknmds", "fork · invariant ·\n통합 테스트 통과");
metric("sh/t4r2ts3a", "0");
metricCaption("sh/610jyd4z", "Slither\nHigh · Medium");
notes(8, [
  "숫자를 짧게 읽습니다: 16 live, 153 passing, 0 high/medium.",
  "거절 트랜잭션도 증거입니다. 권한 시스템은 실패할 때 더 많이 설명해야 합니다.",
], [
  "/Users/ahn_euijin/mapae/README.md",
  "/Users/ahn_euijin/mapae/docs/DEMO.md",
  "https://sepolia-explorer.giwa.io/tx/0xd3843e1f73178b78942fe5ebaeb1ac30611f7734786b7e4640098e5e1749ed65",
  "https://sepolia-explorer.giwa.io/tx/0x131e97448767531427849ff9d716702481a6a7de3cc5d5e2026182028daee1cd",
]);

// 9 — x402
footer("sh/ova5c7y9", "sh/nmtszm1s", 9);
title("sh/mlkr6hk7", "x402는 결제 경로.\nMapae는 권한의 경계.");
setPlain("sh/by1on2h0", "같은 서명 payload · ₩20,000 × 2 · 세 번째 거절", {
  typeface: KOREAN,
  fontSize: 28,
  color: ORANGE,
  bold: true,
  alignment: "left",
  verticalAlignment: "top",
  autoFit: "none",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
setParagraphs("sh/axsnexgf", [
  paragraph([run("에이전트는 HTTP 402 응답을 받고, 이미 받은 Mapae 권한으로 결제를 요청합니다.", {fontSize: "23px", color: WHITE, bold: true})], {spaceAfter: 20, lineSpacing: 1.16}),
  paragraph([run("facilitator는 가스를 대신 내지만 자금도, 정책도 보관하지 않습니다. 두 번째 결제까지 정산되고, 세 번째는 일일 ₩50,000 한도를 넘어 컨트랙트가 거절했습니다.", {fontSize: "22px", color: MUTED})], {spaceAfter: 20, lineSpacing: 1.18}),
  paragraph([run("재위임은 받은 권한을 좁힐 수만 있고 넓힐 수 없습니다.", {fontSize: "22px", color: MUTED})], {lineSpacing: 1.18}),
], {
  typeface: KOREAN,
  fontSize: 23,
  color: WHITE,
  alignment: "left",
  verticalAlignment: "top",
  autoFit: "none",
  wrap: "square",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
{
  const image = shape("im/8z2dgne5");
  const imageBytes = await fs.readFile(path.join(TMP, "mapae-x402-ko.png"));
  image.replace({blob: imageBytes, contentType: "image/png", alt: "Mapae x402 live transaction trace", fit: "contain"});
  image.fit = "contain";
  image.crop = {left: 0, top: 0, right: 0, bottom: 0};
}
notes(9, [
  "여기서 x402는 핵심 유통 경로이고, 권한의 진실은 Mapae 컨트랙트에 있습니다.",
  "facilitator가 신뢰 주체가 아니라 가스 스폰서/정산자라는 점을 강조합니다.",
], [
  "/Users/ahn_euijin/mapae/pitch-deck-v3-tmp/mapae-x402-ko.png",
  "/Users/ahn_euijin/mapae/README.md",
  "/Users/ahn_euijin/mapae/docs/DEMO.md",
  "https://docs.x402.org/core-concepts/network-and-token-support",
  "https://sepolia-explorer.giwa.io/tx/0x9fbe7b2be9350e554688b13abc9b9ecb02d49ac0ea0ae893b51ad43637dc2422",
  "https://sepolia-explorer.giwa.io/tx/0x8a1fba254777efe388617d6be2d4f5d6798352bda443642957d62666e52c2db6",
]);

// 10 — Why GIWA
footer("sh/j2lwvixo", "sh/x47q98n2", 10);
title("sh/c3y9g36x", "GIWA이기 때문에 가능한 제품");
body("sh/i1cv2dw3", "신뢰 가능한 신원, 저비용 실행, Wallet 배포면이 한 체인에서 만납니다.");
threeColumn("sh/jq98bi58", "01 · DOJANG", "PII를 드러내지 않고\nVerified Address를\n결제 순간마다 검증");
threeColumn("sh/wzad03ex", "02 · CHAIN", "1초 블록과\n약 1원 수수료로\n매 결제 정책 검증");
threeColumn("sh/h0jet8fi", "03 · WALLET", "ERC-7715 권한 요청을\nGIWA Wallet의 자연스러운\n발급·관리 UX로");
notes(10, [
  "이 장이 GASOK 적합성 답변입니다.",
  "Mapae는 아무 체인에나 붙인 결제 앱이 아니라 Dojang·GIWA Chain·GIWA Wallet의 교차점입니다.",
], [
  "https://giwa.io/home",
  "https://giwa.io/gasok",
  "https://docs.giwa.io/giwa-chain/en/giwa-ecosystem/dojang",
  "https://eips.ethereum.org/EIPS/eip-7715",
]);

// 11 — Expansion
footer("sh/76pcjilc", "sh/hg3eh4nu", 11);
title("sh/wfuxozm9", "법인카드 앱이 아니라,\n권한 발급 레이어");
setPlain("sh/nalwbu5s", "Caveats compose. The protocol stays.", {
  typeface: LATIN,
  fontSize: 28,
  color: ORANGE,
  bold: true,
  alignment: "left",
  verticalAlignment: "top",
  autoFit: "none",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
setParagraphs("sh/itsbadk3", [
  paragraph([run("Permission =", {typeface: LATIN, fontSize: "24px", color: WHITE, bold: true})], {spaceAfter: 12}),
  paragraph([run("Identity", {typeface: LATIN, fontSize: "25px", color: ORANGE, bold: true})], {spaceAfter: 8}),
  paragraph([run("∧ Role  ∧ Amount", {typeface: LATIN, fontSize: "23px", color: WHITE})], {spaceAfter: 8}),
  paragraph([run("∧ Time  ∧ Payee", {typeface: LATIN, fontSize: "23px", color: WHITE})], {spaceAfter: 8}),
  paragraph([run("∧ Purpose", {typeface: LATIN, fontSize: "23px", color: WHITE})], {spaceAfter: 8}),
  paragraph([run("∧ Human confirmation", {typeface: LATIN, fontSize: "23px", color: WHITE})]),
], {
  typeface: LATIN,
  fontSize: 24,
  color: WHITE,
  alignment: "left",
  verticalAlignment: "top",
  autoFit: "none",
  wrap: "square",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
checklistText("sh/hw7ups3u", "AI API · 데이터 · 컴퓨트 결제");
checklistText("sh/upsb6dk7", "법인 구매·정산 에이전트");
checklistText("sh/8nat4321", "구독·서비스 계정");
checklistText("sh/9kbahkva", "프로젝트·Cost center 정책");
checklistText("sh/mh0r6pwz", "고액 결제 Human confirmation");
notes(11, [
  "확장성은 새로운 앱을 계속 만드는 데 있지 않고, caveat를 조합하는 데 있습니다.",
  "Dojang이 향후 조직/역할 attestation을 늘리면 같은 manager 위에 바로 붙일 수 있습니다.",
], [
  "https://eips.ethereum.org/EIPS/eip-7710",
  "https://eips.ethereum.org/EIPS/eip-7715",
  "https://docs.giwa.io/giwa-chain/en/giwa-ecosystem/dojang",
  "/Users/ahn_euijin/mapae/README.md",
]);

// 12 — Close
setParagraphs("sh/jux4ny1s", [
  paragraph([run("GIWA Wallet 안에서,", {fontSize: "72px", color: WHITE, bold: true})], {alignment: "center"}),
  paragraph([run("AI에게 마패를.", {fontSize: "78px", color: ORANGE, bold: true})], {alignment: "center"}),
], {
  typeface: KOREAN,
  fontSize: 76,
  color: WHITE,
  alignment: "center",
  verticalAlignment: "middle",
  autoFit: "none",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
setPlain("sh/rmpc7axw", "ERC-7715 권한 요청 · Dojang issuer 연동 · Phase 2에서 실제 Wallet 흐름 완성", {
  typeface: KOREAN,
  fontSize: 24,
  color: MUTED,
  alignment: "center",
  verticalAlignment: "middle",
  autoFit: "none",
  insets: {top: 0, right: 0, bottom: 0, left: 0},
});
setPlain("sh/5wfmp8ji", "THE ASK", {
  typeface: LATIN,
  fontSize: 26.67,
  color: ORANGE,
  alignment: "center",
  verticalAlignment: "middle",
  autoFit: "none",
});
notes(12, [
  "요청은 세 가지입니다: Wallet permission UX 연동, Dojang issuer/Verified Code 협업, Phase 2에서 실사용 흐름 완성.",
  "마지막 문장: AI에게 돈을 맡기는 가장 안전한 방법은, 돈이 아니라 제한된 권한만 맡기는 것입니다.",
], [
  "https://giwa.io/gasok",
  "https://eips.ethereum.org/EIPS/eip-7715",
  "https://docs.giwa.io/giwa-chain/en/giwa-ecosystem/dojang",
  "/Users/ahn_euijin/mapae/README.md",
]);

await fs.mkdir(QA_DIR, {recursive: true});
for (let i = 0; i < presentation.slides.count; i += 1) {
  const slide = presentation.slides.getItem(i);
  const n = String(i + 1).padStart(2, "0");
  const png = await presentation.export({slide, format: "png", scale: 1});
  await fs.writeFile(path.join(QA_DIR, `slide-${n}.png`), Buffer.from(await png.arrayBuffer()));
  const layout = await presentation.export({slide, format: "layout"});
  await fs.writeFile(path.join(QA_DIR, `slide-${n}.layout.json`), Buffer.from(await layout.arrayBuffer()));
}

const pptx = await PresentationFile.exportPptx(presentation);
await pptx.save(OUT);
console.log(JSON.stringify({output: OUT, slides: presentation.slides.count, qaDir: QA_DIR}, null, 2));
