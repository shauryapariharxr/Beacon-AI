// Rasterizes public/logo.svg into the PNG icons Beacon's web app manifest
// needs (192, 512, plus maskable and apple-touch variants).
//
//   node scripts/make-icons.mjs   (run once after changing the logo)
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const svg = readFileSync("public/logo.svg");

// The beacon mark is glow-light on transparent, so every icon variant sits on
// the app's near-black page tone — same as the favicon in the browser.
const BG = "#0a0a0b";

// The source SVG is declared in "pt" units, which librsvg rasterizes at 96dpi
// (~1672px). Normalize ONCE to a plain 1024px base image and build every
// variant from that buffer, so no variant ever sees the oversized original.
const base = await sharp(svg).resize(1024, 1024).png().toBuffer();

async function centeredMark(canvas, inner) {
  const mark = await sharp(base).resize(inner, inner).png().toBuffer();
  const top = Math.round((canvas - inner) / 2);
  return sharp({
    create: { width: canvas, height: canvas, channels: 4, background: BG },
  })
    .composite([{ input: mark, top, left: top }])
    .png()
    .toBuffer();
}

// Regular icons keep a small transparent margin (launcher-icon look).
const any1024 = await centeredMark(1024, 860);
const icon192 = await sharp(any1024).resize(192, 192).png().toBuffer();
const icon512 = await sharp(any1024).resize(512, 512).png().toBuffer();

// Maskable icons are cropped to a circle/squircle by the OS, so the mark must
// stay inside the middle ~80% safe zone — pad more, solid background.
const maskable512 = await centeredMark(1024, 700);
const maskableView = await sharp(maskable512).resize(512, 512).png().toBuffer();

// iOS/apple-touch icons must be opaque.
const apple180 = await centeredMark(1024, 820);
const appleView = await sharp(apple180).resize(180, 180).png().toBuffer();

writeFileSync("public/pwa-icon-192.png", icon192);
writeFileSync("public/pwa-icon-512.png", icon512);
writeFileSync("public/pwa-icon-maskable-512.png", maskableView);
writeFileSync("public/apple-touch-icon.png", appleView);

console.log("icons written:");
for (const f of [
  "pwa-icon-192.png",
  "pwa-icon-512.png",
  "pwa-icon-maskable-512.png",
  "apple-touch-icon.png",
]) {
  console.log(`  public/${f}`);
}
