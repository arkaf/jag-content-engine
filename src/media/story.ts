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

function buildOverlaySvg(product: Product, config: AppConfig): Buffer {
  const name = escapeXml(truncate(`${product.name}`, 42));
  const cta = escapeXml(config.settings.story.text);
  const sub = escapeXml(config.settings.story.subtext);
  const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .name { font-family: 'DejaVu Sans', Arial, sans-serif; font-weight: 700; fill: #111111; }
    .cta  { font-family: 'DejaVu Sans', Arial, sans-serif; font-weight: 700; fill: #ffffff; letter-spacing: 4px; }
    .sub  { font-family: 'DejaVu Sans', Arial, sans-serif; font-weight: 400; fill: #777777; letter-spacing: 1px; }
  </style>
  <text x="540" y="150" text-anchor="middle" class="name" font-size="40">${name}</text>
  <polygon points="540,1548 496,1592 584,1592" fill="#111111"/>
  <rect x="315" y="1612" width="450" height="100" rx="50" fill="#111111"/>
  <text x="540" y="1676" text-anchor="middle" class="cta" font-size="40">${cta}</text>
  <text x="540" y="1770" text-anchor="middle" class="sub" font-size="30">${sub}</text>
</svg>`;
  return Buffer.from(svg);
}

/** Costruisce l'immagine 9:16 della Story con il prodotto e il richiamo alla bio. */
export async function buildStoryImage(
  source: Buffer,
  product: Product,
  config: AppConfig,
): Promise<DownloadedImage> {
  // Prodotto ridimensionato per lasciare spazio a titolo (alto) e CTA (basso).
  const productImg = await sharp(source)
    .rotate()
    .resize(940, 1180, { fit: "inside", withoutEnlargement: true })
    .toBuffer();
  const meta = await sharp(productImg).metadata();
  const pw = meta.width ?? 0;
  const ph = meta.height ?? 0;
  const left = Math.round((WIDTH - pw) / 2);
  const top = Math.max(220, Math.round((HEIGHT - ph) / 2) - 90);

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
