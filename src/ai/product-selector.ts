/** Selezione intelligente del prodotto tramite scoring multi-fattore. */
import { logger } from "../utils/logger.js";
import { imageUrlQuality } from "../utils/image.js";
import { slug } from "../utils/normalize.js";
import type { AppConfig } from "../utils/config.js";
import type { History } from "../storage/history.js";
import type { Product, ScoredProduct } from "../types.js";

/** Penalità [0..1] in base a quanto di recente un valore è stato usato. 1 = mai usato. */
function varietyScore(value: string, recentValues: string[]): number {
  const idx = recentValues.findIndex((v) => v === value);
  if (idx === -1) return 1; // mai usato di recente -> massima varietà
  // più è recente (idx basso), più penalizziamo.
  const decay = idx / Math.max(1, recentValues.length);
  return Math.min(1, 0.15 + decay * 0.85);
}

function seasonalityScore(category: string, config: AppConfig): number {
  const month = String(new Date().getMonth() + 1);
  const table = config.categories.seasonality[month];
  if (!table) return config.categories.defaultSeasonality;
  return table[category] ?? config.categories.defaultSeasonality;
}

function priceBandScore(price: number | null, config: AppConfig): number {
  if (price === null) return 0.5;
  for (const band of config.categories.priceBands) {
    if (band.max === null || price <= band.max) return band.score;
  }
  return 0.5;
}

/**
 * Ordina i prodotti non ancora pubblicati per punteggio decrescente.
 * Restituisce una rosa di candidati (candidatePoolSize) tra cui scegliere.
 */
export function selectProducts(
  products: Product[],
  history: History,
  config: AppConfig,
): ScoredProduct[] {
  const { weights, recentWindow, candidatePoolSize } = config.settings.selection;
  const publishedIds = history.publishedIds();

  // 1. Filtra i prodotti già pubblicati.
  const available = products.filter((p) => !publishedIds.has(p.id));
  logger.info(`Prodotti disponibili (mai pubblicati): ${available.length} / ${products.length}`);
  if (available.length === 0) return [];

  const recent = history.recent(recentWindow);
  const recentBrands = recent.map((r) => slug(r.brand));
  const recentCategories = recent.map((r) => slug(r.category));

  // Distribuzione delle categorie tra i prodotti disponibili (per il feed balance).
  const categoryCounts = new Map<string, number>();
  for (const p of available) {
    categoryCounts.set(p.category, (categoryCounts.get(p.category) ?? 0) + 1);
  }
  const maxCount = Math.max(...categoryCounts.values());

  const scored: ScoredProduct[] = available.map((product) => {
    const brandVariety = varietyScore(slug(product.brand), recentBrands);
    const categoryVariety = varietyScore(slug(product.category), recentCategories);
    const seasonality = seasonalityScore(product.category, config);
    const priceBand = priceBandScore(product.price, config);
    const imageQuality = imageUrlQuality(product.imageUrl);
    // Feed balance: favorisce le categorie meno rappresentate nel catalogo residuo.
    const feedBalance = 1 - (categoryCounts.get(product.category) ?? 0) / (maxCount || 1) * 0.5;

    const breakdown = {
      brandVariety: brandVariety * weights.brandVariety,
      categoryVariety: categoryVariety * weights.categoryVariety,
      seasonality: seasonality * weights.seasonality,
      priceBand: priceBand * weights.priceBand,
      imageQuality: imageQuality * weights.imageQuality,
      feedBalance: feedBalance * weights.feedBalance,
    };
    const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return { product, score, breakdown };
  });

  scored.sort((a, b) => b.score - a.score);

  const pool = scored.slice(0, candidatePoolSize);
  logger.info(
    `Top candidati: ${pool
      .slice(0, 5)
      .map((s) => `${s.product.name} (${s.score.toFixed(1)})`)
      .join(", ")}`,
  );
  return pool;
}
