/**
 * Renders the Split Seal mark to PNG at print resolution, from the exact geometry the web app
 * uses (explorer/src/components/brand.tsx). One source of truth for the mark's shape; the deck
 * consumes rasters because pptxgenjs has no custom vector paths.
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const size = 64, margin = 13, halfWidth = 12, inset = 9.8, top = 5;
const bottom = size - top, centre = size / 2;
const innerLeft = margin + halfWidth, innerRight = size - margin - halfWidth;

const LEFT = `M${margin} ${top} L${innerLeft} ${top + inset} L${innerLeft} ${bottom - inset} L${margin} ${bottom} Z`;
const RIGHT = `M${size - margin} ${top} L${innerRight} ${top + inset} L${innerRight} ${bottom - inset} L${size - margin} ${bottom} Z`;

function svg(fill) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <path d="${LEFT}" fill="${fill}"/><path d="${RIGHT}" fill="${fill}"/>
  <circle cx="${centre}" cy="${centre}" r="2.2" fill="${fill}"/></svg>`;
}

async function main() {
    const out = path.join(__dirname, "assets");
    fs.mkdirSync(out, {recursive: true});
    const variants = {
        "mark-bone": "#E9E4DA",
        "mark-bronze": "#8A5A35",
        "mark-bronze-bright": "#D9AB77",
        "mark-ink": "#11100E",
    };
    for (const [name, fill] of Object.entries(variants)) {
        await sharp(Buffer.from(svg(fill))).resize(1024, 1024).png().toFile(path.join(out, `${name}.png`));
    }
    console.log("assets written:", Object.keys(variants).join(", "));
}
main();
