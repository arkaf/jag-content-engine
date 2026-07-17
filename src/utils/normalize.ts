/** Funzioni di normalizzazione dei dati grezzi del catalogo. */
import type { CategoriesConfig, Settings } from "./config.js";

/** Rimuove accenti, spazi doppi e porta in minuscolo. */
export function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Estrae un numero da un prezzo scritto in vari formati ("€ 129,00", "129.00", "129"). */
export function parsePrice(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,]/g, "").trim();
  if (!cleaned) return null;
  // Se ci sono sia . che , l'ultimo separatore è il decimale.
  let normalized = cleaned;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",")) {
    normalized = cleaned.replace(",", ".");
  }
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Riconduce una categoria libera a una categoria canonica definita in config. */
export function normalizeCategory(raw: string, categories: CategoriesConfig): string {
  const s = slug(raw);
  if (!s) return "default";
  for (const [canonical, aliases] of Object.entries(categories.aliases)) {
    if (canonical === s) return canonical;
    if (aliases.some((a) => slug(a) === s || s.includes(slug(a)))) return canonical;
  }
  return s;
}

/** Estrae un ID stabile dal link del prodotto secondo la strategia configurata. */
export function extractProductId(link: string, settings: Settings): string {
  const { strategy, queryParam } = settings.productId;
  try {
    const u = new URL(link);
    if (strategy === "query-param") {
      const q = u.searchParams.get(queryParam);
      if (q) return slug(q);
    }
    // last-path-segment (default) o fallback
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length > 0) return slug(decodeURIComponent(segments[segments.length - 1]));
    return slug(u.hostname);
  } catch {
    // Link non è un URL valido: usa una versione normalizzata della stringa.
    return slug(link).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
  }
}
