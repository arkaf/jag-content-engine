/**
 * Jag Content Engine – entrypoint.
 *
 * Flusso: legge il catalogo → sceglie il formato editoriale del giorno →
 * seleziona il prodotto migliore per quel formato → raccoglie le immagini
 * (foglio + link prodotto) → genera i contenuti con OpenAI → pubblica su
 * Instagram tramite Zernio (foto singola o carosello) → aggiorna lo storico.
 */
import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import { readCatalog } from "./google/sheet.js";
import { History } from "./storage/history.js";
import { selectFormat } from "./content/format-selector.js";
import { selectProducts } from "./ai/product-selector.js";
import { generateContent, composeCaption } from "./ai/content-generator.js";
import { resolveProductImages } from "./media/product-images.js";
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

/** Scarica le immagini valide da una lista di URL (mantiene l'ordine, scarta le rotte). */
async function downloadValidImages(urls: string[]): Promise<DownloadedImage[]> {
  const images: DownloadedImage[] = [];
  for (const url of urls) {
    try {
      images.push(await downloadImage(url));
    } catch (err) {
      logger.warn(`Immagine scartata (${url}): ${(err as Error).message}`);
    }
  }
  return images;
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

  // 2. Formato editoriale del giorno (rotazione)
  const format = selectFormat(history, config);

  // 3. Selezione candidati coerenti col formato
  const candidates = selectProducts(products, history, config, format);
  if (candidates.length === 0) {
    logger.warn("Tutti i prodotti del catalogo sono già stati pubblicati. Niente da fare oggi.");
    return;
  }

  // 4. Scelgo il primo candidato con almeno un'immagine scaricabile e valida,
  //    raccogliendo tutte le immagini disponibili per il carosello.
  let chosen: Product | null = null;
  let images: DownloadedImage[] = [];
  for (const candidate of candidates) {
    const urls = await resolveProductImages(candidate.product, config);
    const valid = await downloadValidImages(urls);
    if (valid.length > 0) {
      chosen = candidate.product;
      images = valid;
      logger.info(
        `Prodotto scelto: "${chosen.name}" (${chosen.brand} / ${chosen.category}) ` +
          `— score ${candidate.score.toFixed(1)} — ${images.length} immagine/i`,
      );
      break;
    }
    logger.warn(`Nessuna immagine valida per "${candidate.product.name}", provo il successivo.`);
  }
  if (!chosen || images.length === 0) {
    throw new Error("Nessun candidato aveva immagini scaricabili e valide.");
  }

  // 5. Generazione contenuti
  const content = await generateContent(chosen, format, config);
  const caption = composeCaption(content, format, config);
  logger.info(`Caption generata (${caption.length} caratteri):\n${caption}`);
  logger.debug(`Alt text: ${content.altText}`);

  // 6. Dry run: fermati prima di pubblicare.
  if (dryRun) {
    logger.info("[DRY RUN] Nessuna pubblicazione effettuata e storico NON aggiornato.");
    logger.info("[DRY RUN] Anteprima completata con successo.");
    return;
  }

  // 7. Pubblicazione su Instagram tramite Zernio (carica tutte le immagini).
  const igPlatform = config.settings.zernio.platform;
  const zernio = new ZernioClient(config);
  const accountId = await zernio.resolveAccountId(igPlatform);
  const mediaUrls: string[] = [];
  for (const image of images) {
    mediaUrls.push(await zernio.uploadMedia(image));
  }

  let result;
  let publishedCount = mediaUrls.length;
  try {
    result = await zernio.publishPost({ caption, mediaUrls, platform: igPlatform, accountId, config });
  } catch (err) {
    if (mediaUrls.length > 1) {
      logger.warn(
        `Pubblicazione carosello fallita (${(err as Error).message}). ` +
          `Riprovo con la sola immagine principale.`,
      );
      result = await zernio.publishPost({
        caption,
        mediaUrls: [mediaUrls[0]],
        platform: igPlatform,
        accountId,
        config,
      });
      publishedCount = 1;
    } else {
      throw err;
    }
  }
  const publishedPlatforms = [igPlatform];

  // 7b. Pinterest (best-effort): pin con titolo/descrizione dedicati e link
  //     diretto al prodotto. Un errore qui non blocca la pubblicazione IG.
  const pin = config.settings.pinterest;
  if (pin.enabled) {
    try {
      const pinAccountId = await zernio.resolveAccountId(pin.platform);
      const boardId = pin.boardByCategory[chosen.category] || pin.defaultBoardId;
      await zernio.publishPost({
        caption: content.pinDescription,
        mediaUrls: [mediaUrls[0]],
        platform: pin.platform,
        accountId: pinAccountId,
        platformSpecificData: {
          title: content.pinTitle,
          link: chosen.link,
          ...(boardId ? { boardId } : {}),
        },
        config,
      });
      publishedPlatforms.push(pin.platform);
      logger.info(`Pin pubblicato su Pinterest: "${content.pinTitle}"`);
    } catch (err) {
      logger.warn(`Pubblicazione Pinterest fallita (post Instagram gia' uscito): ${(err as Error).message}`);
    }
  }

  // 8. Aggiornamento storico.
  history.add({
    id: chosen.id,
    name: chosen.name,
    brand: chosen.brand,
    category: chosen.category,
    price: chosen.price,
    platform: publishedPlatforms.join(","),
    format: format.key,
    imagesCount: publishedCount,
    permalink: result.permalink,
    postId: result.postId,
    publishedAt: new Date().toISOString(),
  });
  history.save();

  logger.info(
    `=== Pubblicazione completata: "${chosen.name}" [${format.label}] ` +
      `su ${publishedPlatforms.join(" + ")} (${publishedCount} immagine/i) ===`,
  );
}

main().catch((err) => {
  logger.error(`Esecuzione fallita: ${(err as Error).message}`);
  logger.debug((err as Error).stack ?? "");
  process.exit(1);
});
