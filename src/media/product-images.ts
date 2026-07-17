/**
 * Risoluzione delle immagini di un prodotto.
 *
 * Parte sempre dall'immagine presente nel foglio, poi (se abilitato) prova a
 * estrarre immagini aggiuntive dalla pagina prodotto mulebuy per costruire un
 * carosello. L'estrazione è "best-effort": qualsiasi errore fa semplicemente
 * ricadere sull'immagine singola, senza mai bloccare la pubblicazione.
 */
import { logger } from "../utils/logger.js";
import type { AppConfig } from "../utils/config.js";
import type { Product } from "../types.js";

/** Normalizza un URL immagine (protocollo, rimozione parametri di ridimensionamento). */
function cleanImageUrl(raw: string): string {
  let url = raw.trim();
  if (url.startsWith("//")) url = "https:" + url;
  // alicdn spesso aggiunge suffissi di resize tipo _...jpg_400x400.jpg -> togliamo l'ultimo.
  url = url.replace(/(\.(?:jpg|jpeg|png|webp))_[0-9]+x[0-9]+.*$/i, "$1");
  return url;
}

function isProductImage(url: string, cdnHosts: string[]): boolean {
  const lower = url.toLowerCase();
  if (!/^https?:\/\//.test(lower)) return false;
  if (!/\.(jpe?g|png|webp)(\?|$|_)/i.test(lower)) return false;
  // Escludi icone/loghi/sprite comuni.
  if (/(sprite|icon|logo|avatar|placeholder|loading|blank)\b/i.test(lower)) return false;
  return cdnHosts.some((h) => lower.includes(h));
}

/** Estrae gli URL immagine dalla pagina prodotto mulebuy (HTML + JSON embedded). */
async function extractFromProductPage(link: string, cdnHosts: string[]): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(link, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JagContentEngine/1.0)" },
    });
    if (!res.ok) {
      logger.warn(`Pagina prodotto non raggiungibile (HTTP ${res.status}): ${link}`);
      return [];
    }
    const html = await res.text();

    // Raccoglie tutti gli URL immagine presenti (attributi, JSON __NUXT__, ecc.).
    const found = new Set<string>();
    const regex = /https?:\\?\/\\?\/[^"'\s)\\]+?\.(?:jpe?g|png|webp)(?:[^"'\s)\\]*)?/gi;
    for (const match of html.matchAll(regex)) {
      const url = cleanImageUrl(match[0].replace(/\\\//g, "/"));
      if (isProductImage(url, cdnHosts)) found.add(url);
    }
    return [...found];
  } catch (err) {
    logger.warn(`Estrazione immagini dalla pagina prodotto fallita: ${(err as Error).message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Restituisce la lista ordinata di URL immagine da pubblicare:
 * l'immagine del foglio per prima, poi eventuali immagini extra dal link.
 */
export async function resolveProductImages(product: Product, config: AppConfig): Promise<string[]> {
  const { maxPerPost, extractFromProductLink, cdnHosts } = config.settings.images;
  const ordered: string[] = [];
  const seen = new Set<string>();

  function add(url: string): void {
    const clean = cleanImageUrl(url);
    const key = clean.split("?")[0];
    if (clean && !seen.has(key)) {
      seen.add(key);
      ordered.push(clean);
    }
  }

  if (product.imageUrl) add(product.imageUrl);

  if (extractFromProductLink && product.link) {
    const extra = await extractFromProductPage(product.link, cdnHosts);
    logger.info(`Immagini extra trovate dal link prodotto: ${extra.length}`);
    for (const url of extra) add(url);
  }

  const result = ordered.slice(0, maxPerPost);
  logger.info(`Immagini totali per il post: ${result.length} (max ${maxPerPost})`);
  return result;
}
