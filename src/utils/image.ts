/** Download, validazione e normalizzazione delle immagini prodotto per Instagram. */
import { basename } from "node:path";
import sharp from "sharp";
import { logger } from "./logger.js";
import type { DownloadedImage } from "../types.js";

const MAX_BYTES = 8 * 1024 * 1024; // limite Instagram per le immagini via Zernio

/** Instagram accetta solo JPG e PNG: tutto il resto va convertito. */
const INSTAGRAM_FORMATS = new Set(["image/jpeg", "image/png"]);

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function deriveFilename(url: string, contentType: string): string {
  let name = "product";
  try {
    const path = new URL(url).pathname;
    const raw = basename(path);
    if (raw && raw.includes(".")) return raw;
    if (raw) name = raw;
  } catch {
    /* url non parsabile: usa il default */
  }
  const ext = EXT_BY_MIME[contentType.split(";")[0].trim()] || "jpg";
  return `${name}.${ext}`;
}

/**
 * Converte l'immagine in un formato accettato da Instagram (JPEG) quando serve:
 * - formato non supportato (webp, avif, gif, ...) -> JPEG
 * - dimensione oltre il limite -> ridimensiona e ricomprime in JPEG
 * Le trasparenze vengono appiattite su sfondo bianco (JPEG non ha alpha).
 */
export async function normalizeForInstagram(
  buffer: Buffer,
  contentType: string,
  filename: string,
): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const needsConversion = !INSTAGRAM_FORMATS.has(contentType);
  const tooBig = buffer.byteLength > MAX_BYTES;
  if (!needsConversion && !tooBig) return { buffer, contentType, filename };

  logger.info(
    `Normalizzo immagine per Instagram (${contentType}, ${(buffer.byteLength / 1024).toFixed(0)}KB)` +
      `${needsConversion ? " [conversione formato]" : ""}${tooBig ? " [riduzione peso]" : ""}`,
  );

  let pipeline = sharp(buffer).rotate().flatten({ background: "#ffffff" });
  if (tooBig) {
    pipeline = pipeline.resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true });
  }
  const converted = await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer();

  if (converted.byteLength > MAX_BYTES) {
    throw new Error(
      `Immagine ancora troppo grande dopo la conversione (${(converted.byteLength / 1024 / 1024).toFixed(1)}MB).`,
    );
  }

  const newFilename = filename.replace(/\.[a-z0-9]+$/i, "") + ".jpg";
  return { buffer: converted, contentType: "image/jpeg", filename: newFilename };
}

/** Scarica un'immagine, la valida e la normalizza per la pubblicazione. */
export async function downloadImage(url: string): Promise<DownloadedImage> {
  logger.debug(`Scarico immagine: ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Download immagine fallito (HTTP ${res.status}) per ${url}`);
  }

  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim() || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Il contenuto scaricato non è un'immagine (content-type: ${contentType})`);
  }

  const raw = Buffer.from(await res.arrayBuffer());
  if (raw.byteLength === 0) {
    throw new Error(`Immagine vuota: ${url}`);
  }

  const normalized = await normalizeForInstagram(raw, contentType, deriveFilename(url, contentType));

  return {
    buffer: normalized.buffer,
    contentType: normalized.contentType,
    filename: normalized.filename,
    sizeBytes: normalized.buffer.byteLength,
  };
}

/**
 * Punteggio di qualità dell'immagine [0..1] basato solo sull'URL,
 * senza scaricarla (usato in fase di scoring su tutto il catalogo).
 */
export function imageUrlQuality(url: string): number {
  if (!url) return 0;
  let score = 0.4;
  try {
    const u = new URL(url);
    if (u.protocol === "https:") score += 0.2;
    if (/\.(jpe?g|png|webp)(\?|$)/i.test(u.pathname)) score += 0.2;
    if (/(large|original|full|hi|hd|1080|2048|w=\d{3,})/i.test(url)) score += 0.2;
    return Math.min(1, score);
  } catch {
    return 0;
  }
}
