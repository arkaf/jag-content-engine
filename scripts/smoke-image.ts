import sharp from "sharp";
import { normalizeForInstagram } from "../src/utils/image.js";

// webp con trasparenza (come le foto removebg del catalogo)
const webp = await sharp({
  create: { width: 800, height: 1000, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 0.5 } },
}).webp().toBuffer();

const out = await normalizeForInstagram(webp, "image/webp", "1763577243640-preview.webp");
const meta = await sharp(out.buffer).metadata();
console.log("format:", meta.format, "| size:", out.buffer.byteLength, "| contentType:", out.contentType, "| filename:", out.filename);
if (meta.format !== "jpeg" || out.contentType !== "image/jpeg" || !out.filename.endsWith(".jpg")) {
  console.log("FAIL"); process.exit(1);
}
// jpg già valido: deve restare intatto
const jpg = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#333" } }).jpeg().toBuffer();
const untouched = await normalizeForInstagram(jpg, "image/jpeg", "x.jpg");
console.log("jpeg passthrough:", untouched.buffer === jpg ? "OK" : "FAIL");
console.log("ALL PASS");
