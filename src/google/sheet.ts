/** Lettura del catalogo prodotti da Google Sheets. */
import { google } from "googleapis";
import { logger } from "../utils/logger.js";
import { extractProductId, normalizeCategory, parsePrice, slug } from "../utils/normalize.js";
import type { AppConfig } from "../utils/config.js";
import type { Product } from "../types.js";

function loadServiceAccount(): Record<string, unknown> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("Variabile GOOGLE_SERVICE_ACCOUNT mancante.");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT non è un JSON valido: ${(err as Error).message}`);
  }
}

function getAuth() {
  const credentials = loadServiceAccount();
  return new google.auth.GoogleAuth({
    credentials: credentials as never,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
}

/** Risolve il nome della scheda (tab) a partire dal suo GID. */
async function resolveSheetTitle(sheets: ReturnType<typeof google.sheets>, spreadsheetId: string, gid: number): Promise<string> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const match = meta.data.sheets?.find((s) => s.properties?.sheetId === gid);
  if (!match?.properties?.title) {
    throw new Error(`Nessuna scheda trovata con GID ${gid} nel foglio ${spreadsheetId}.`);
  }
  return match.properties.title;
}

/** Costruisce la mappa colonna->indice usando gli header oppure la posizione. */
function buildColumnMap(header: string[], config: AppConfig): Record<string, number> {
  const { columnSynonyms, positionalFallback, headerDetection } = config.settings.sheet;
  const map: Record<string, number> = {};

  if (headerDetection) {
    const normalizedHeader = header.map((h) => slug(h));
    for (const [field, synonyms] of Object.entries(columnSynonyms)) {
      const idx = normalizedHeader.findIndex((h) => synonyms.some((syn) => slug(syn) === h));
      if (idx >= 0) map[field] = idx;
    }
  }

  // Fallback posizionale per i campi non rilevati.
  positionalFallback.forEach((field, idx) => {
    if (!(field in map)) map[field] = idx;
  });

  return map;
}

function cell(row: string[], idx: number | undefined): string {
  if (idx === undefined) return "";
  return (row[idx] ?? "").toString().trim();
}

/** Legge il catalogo e restituisce i prodotti normalizzati. */
export async function readCatalog(config: AppConfig): Promise<Product[]> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("Variabile GOOGLE_SHEET_ID mancante.");
  const gid = Number.parseInt(process.env.GOOGLE_SHEET_GID ?? "0", 10);

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const title = await resolveSheetTitle(sheets, spreadsheetId, gid);
  logger.info(`Leggo la scheda "${title}" (gid=${gid}) dal foglio ${spreadsheetId}`);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${title}'`,
  });

  const rows = res.data.values ?? [];
  if (rows.length < 2) {
    logger.warn("Il foglio non contiene righe dati (serve almeno l'intestazione + 1 riga).");
    return [];
  }

  const header = rows[0].map((c) => (c ?? "").toString());
  const colMap = buildColumnMap(header, config);
  logger.debug("Mappa colonne", colMap);

  const products: Product[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = cell(row, colMap.name);
    const link = cell(row, colMap.link);
    const imageUrl = cell(row, colMap.image);

    // Riga valida solo se ha almeno nome, link e immagine.
    if (!name || !link || !imageUrl) continue;

    const priceRaw = cell(row, colMap.price);
    const rawCategory = cell(row, colMap.category);

    products.push({
      id: extractProductId(link, config.settings),
      name,
      link,
      imageUrl,
      price: parsePrice(priceRaw),
      priceRaw,
      category: normalizeCategory(rawCategory, config.categories),
      brand: cell(row, colMap.brand) || "JAG",
      row: i + 1,
    });
  }

  logger.info(`Catalogo caricato: ${products.length} prodotti validi su ${rows.length - 1} righe.`);
  return products;
}
