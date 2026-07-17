/**
 * Jag Content Engine – entrypoint.
 *
 * Flusso: legge il catalogo → seleziona il prodotto migliore → scarica
 * l'immagine → genera i contenuti con OpenAI → pubblica su Instagram tramite
 * Zernio → aggiorna lo storico.
 */
import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import { readCatalog } from "./google/sheet.js";
import { History } from "./storage/history.js";
import { selectProducts } from "./ai/product-selector.js";
import { generateContent, composeCaption } from "./ai/content-generator.js";
import { downloadImage } from "./utils/image.js";
import { ZernioClient } from "./social/zernio.js";
import type { DownloadedImage, Product } from "./types.js";

const REQUIRED_ENV = [
  "GOOGLE_SERVICE_ACCOUNT",
  "GOOGLE_SHEET_ID",
  "OPENAI_API_KEY",
  "ZERNIO_API_KEY",
];

function assertEnv(dryRun: boolean): void {
  const required = dryRun
    ? REQUIRED_ENV.filter((k) => k !== "ZERNIO_API_KEY")
    : REQUIRED_ENV;
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Variabili d'ambiente mancanti: ${missing.join(", ")}`);
  }
}

async function main(): Promise<void> {
  const dryRun = /^true$/i.test(process.env.DRY_RUN ?? "");
  logger.info(`=== Jag Content Engine avviato${dryRun ? " [DRY RUN]" : ""} ===`);

  assertEnv(dryRun);
  const config = loadConfig();

  // 1. Catalogo + storico
  const [products, history] = await Promise.all([
    readCatalog(config),
    Promise.resolve(History.load()),
  ]);
  if (products.length === 0) throw new Error("Catalogo vuoto: nessun prodotto da pubblicare.");

  // 2. Selezione candidati
  const candidates = selectProducts(products, history, config);
  if (candidates.length === 0) {
    logger.warn("Tutti i prodotti del catalogo sono già stati pubblicati. Niente da fare oggi.");
    return;
  }

  // 3. Scelgo il primo candidato con immagine scaricabile e valida.
  let chosen: Product | null = null;
  let image: DownloadedImage | null = null;
  for (const candidate of candidates) {
    try {
      image = await downloadImage(candidate.product.imageUrl);
      chosen = candidate.product;
      logger.info(
        `Prodotto scelto: "${chosen.name}" (${chosen.brand} / ${chosen.category}) ` +
          `— score ${candidate.score.toFixed(1)}`,
      );
      break;
    } catch (err) {
      logger.warn(`Immagine non valida per "${candidate.product.name}", provo il successivo: ${(err as Error).message}`);
    }
  }
  if (!chosen || !image) {
    throw new Error("Nessun candidato aveva un'immagine scaricabile e valida.");
  }

  // 4. Generazione contenuti
  const content = await generateContent(chosen, config);
  const caption = composeCaption(content, config);
  logger.info(`Caption generata (${caption.length} caratteri):\n${caption}`);
  logger.debug(`Alt text: ${content.altText}`);

  // 5. Dry run: fermati prima di pubblicare.
  if (dryRun) {
    logger.info("[DRY RUN] Nessuna pubblicazione effettuata e storico NON aggiornato.");
    logger.info("[DRY RUN] Anteprima completata con successo.");
    return;
  }

  // 6. Pubblicazione su Instagram tramite Zernio.
  const zernio = new ZernioClient(config);
  const accountId = await zernio.resolveInstagramAccountId(config);
  const mediaUrl = await zernio.uploadMedia(image);
  const result = await zernio.publishPhoto({ caption, mediaUrl, accountId, config });

  // 7. Aggiornamento storico.
  history.add({
    id: chosen.id,
    name: chosen.name,
    brand: chosen.brand,
    category: chosen.category,
    price: chosen.price,
    platform: config.settings.zernio.platform,
    permalink: result.permalink,
    postId: result.postId,
    publishedAt: new Date().toISOString(),
  });
  history.save();

  logger.info(`=== Pubblicazione completata: "${chosen.name}" su ${config.settings.zernio.platform} ===`);
}

main().catch((err) => {
  logger.error(`Esecuzione fallita: ${(err as Error).message}`);
  logger.debug((err as Error).stack ?? "");
  process.exit(1);
});
