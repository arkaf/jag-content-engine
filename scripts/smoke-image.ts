import sharp from "sharp";
import { normalizeForInstagram } from "../src/utils/image.js";

let fail = 0;
async function ratioOf(buf: Buffer): Promise<number> {
  const m = await sharp(buf).metadata();
  return (m.width ?? 0) / (m.height ?? 1);
}
function check(label: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`, extra ?? "");
  if (!cond) fail++;
}

// Caso reale fallito: 432x577 webp trasparente -> 0.749 (sotto il minimo IG)
const tall = await sharp({ create: { width: 432, height: 577, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.4 } } }).webp().toBuffer();
const outTall = await normalizeForInstagram(tall, "image/webp", "x.webp");
const rTall = await ratioOf(outTall.buffer);
check("tall image padded into IG range", rTall >= 0.75 && rTall <= 1.91, rTall.toFixed(3));
check("tall output is jpeg", outTall.contentType === "image/jpeg");

// Caso troppo largo: 2000x600 -> 3.33 (sopra il massimo IG)
const wide = await sharp({ create: { width: 2000, height: 600, channels: 3, background: "#222" } }).png().toBuffer();
const outWide = await normalizeForInstagram(wide, "image/png", "w.png");
const rWide = await ratioOf(outWide.buffer);
check("wide image padded into IG range", rWide >= 0.75 && rWide <= 1.91, rWide.toFixed(3));

// Caso già valido (1080x1080 jpeg): resta intatto
const square = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: "#eee" } }).jpeg().toBuffer();
const outSquare = await normalizeForInstagram(square, "image/jpeg", "s.jpg");
check("valid square passes through untouched", outSquare.buffer === square);

// --- story image 9:16 ---
{
  const { loadConfig } = await import("../src/utils/config.js");
  const { buildStoryImage } = await import("../src/media/story.js");
  const cfg = loadConfig();
  const prod = await sharp({ create: { width: 900, height: 1000, channels: 3, background: "#ccc" } }).jpeg().toBuffer();
  const story = await buildStoryImage(prod, { id: "x1", name: "Grailz Project G/R Very Long Product Name That Should Truncate Nicely", link: "l", imageUrl: "i", price: 100, priceRaw: "100", category: "hoodie", brand: "Grailz", row: 2 } as any, cfg);
  const m = await sharp(story.buffer).metadata();
  check(`story is 1080x1920 jpeg`, m.width === 1080 && m.height === 1920 && story.contentType === "image/jpeg", `${m.width}x${m.height}`);
}

console.log(`\n${fail === 0 ? "ALL PASS" : fail + " FAILURES"}`);
process.exit(fail === 0 ? 0 : 1);
