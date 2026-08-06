/**
 * Generazione dell'immagine per la Instagram Story a partire dal prodotto.
 *
 * Instagram non consente di aggiungere un link sticker cliccabile via API, per
 * questo "stampiamo" nella grafica un richiamo "LINK IN BIO" che rimanda alla
 * bio. Formato 9:16 (1080x1920), prodotto centrato su tela pulita.
 */
import sharp from "sharp";
import { logger } from "../utils/logger.js";
import type { AppConfig } from "../utils/config.js";
import type { DownloadedImage, Product } from "../types.js";

const WIDTH = 1080;
const HEIGHT = 1920;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(value: string, max: number): string {
  const v = value.trim();
  return v.length <= max ? v : v.slice(0, max - 1).trimEnd() + "…";
}

// Ancore verticali fisse (px) per un layout coerente su tutte le Story.
const IMAGE_TOP = 210; // sotto l'header IG (username/tempo)
const IMAGE_BOTTOM = 1370; // l'immagine occupa questa fascia superiore
const IMAGE_REGION_W = 1010; // larghezza utile per il prodotto
const MAX_UPSCALE = 4; // ingrandimento massimo dalle foto piccole del catalogo
const TITLE_Y = 1460; // titolo TRA immagine e CTA
const PILL_Y = 1540; // riquadro "LINK IN BIO"
const PILL_H = 104;
const SUBTEXT_Y = 1740;

function buildOverlaySvg(product: Product, config: AppConfig): Buffer {
  const name = escapeXml(truncate(`${product.name}`, 40));
  const cta = escapeXml(config.settings.story.text);
  const sub = escapeXml(config.settings.story.subtext);
  const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .name { font-family: 'DejaVu Sans', Arial, sans-serif; font-weight: 700; fill: #111111; }
    .cta  { font-family: 'DejaVu Sans', Arial, sans-serif; font-weight: 700; fill: #ffffff; letter-spacing: 4px; }
    .sub  { font-family: 'DejaVu Sans', Arial, sans-serif; font-weight: 400; fill: #777777; letter-spacing: 1px; }
  </style>
  <text x="540" y="${TITLE_Y}" text-anchor="middle" class="name" font-size="42">${name}</text>
  <rect x="315" y="${PILL_Y}" width="450" height="${PILL_H}" rx="${PILL_H / 2}" fill="#111111"/>
  <text x="540" y="${PILL_Y + PILL_H / 2 + 15}" text-anchor="middle" class="cta" font-size="40">${cta}</text>
  <text x="540" y="${SUBTEXT_Y}" text-anchor="middle" class="sub" font-size="30">${sub}</text>
</svg>`;
  return Buffer.from(svg);
}

/** Costruisce l'immagine 9:16 della Story con il prodotto e il richiamo alla bio. */
export async function buildStoryImage(
  source: Buffer,
  product: Product,
  config: AppConfig,
): Promise<DownloadedImage> {
  // Prodotto grande, centrato nella fascia superiore [IMAGE_TOP, IMAGE_BOTTOM].
  // Le foto del catalogo sono spesso piccole (400-800px): vanno INGRANDITE per
  // riempire la fascia, altrimenti restano minuscole al centro della Story.
  // Il fattore di ingrandimento è limitato per non degradare troppo la qualità.
  const regionH = IMAGE_BOTTOM - IMAGE_TOP;
  const src = await sharp(source).rotate().toBuffer();
  const srcMeta = await sharp(src).metadata();
  const sw = srcMeta.width ?? IMAGE_REGION_W;
  const sh = srcMeta.height ?? regionH;
  const fitScale = Math.min(IMAGE_REGION_W / sw, regionH / sh);
  const scale = Math.min(fitScale, MAX_UPSCALE);

  const productImg = await sharp(src)
    .resize(Math.round(sw * scale), Math.round(sh * scale), {
      fit: "inside",
      kernel: "lanczos3",
    })
    .toBuffer();
  const meta = await sharp(productImg).metadata();
  const pw = meta.width ?? 0;
  const ph = meta.height ?? 0;
  const left = Math.round((WIDTH - pw) / 2);
  const top = IMAGE_TOP + Math.round((regionH - ph) / 2);

  const buffer = await sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 4, background: config.settings.story.background },
  })
    .composite([
      { input: productImg, left, top },
      { input: buildOverlaySvg(product, config), top: 0, left: 0 },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  logger.info(`Story generata (${WIDTH}x${HEIGHT}, ${(buffer.byteLength / 1024).toFixed(0)}KB)`);
  return {
    buffer,
    contentType: "image/jpeg",
    filename: `story-${product.id}.jpg`,
    sizeBytes: buffer.byteLength,
  };
}
