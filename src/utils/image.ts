/** Download e validazione delle immagini prodotto. */
import { basename } from "node:path";
import { logger } from "./logger.js";
import type { DownloadedImage } from "../types.js";

const MAX_BYTES = 8 * 1024 * 1024; // limite Instagram per le immagini via Zernio

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

/** Scarica un'immagine e la valida per la pubblicazione. Lancia un errore se non valida. */
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

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new Error(`Immagine vuota: ${url}`);
  }
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(
      `Immagine troppo grande (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB, max 8MB): ${url}`,
    );
  }

  return {
    buffer,
    contentType,
    filename: deriveFilename(url, contentType),
    sizeBytes: buffer.byteLength,
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
