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
import { extractProductId, slug } from "./utils/normalize.js";
import { readCatalog } from "./google/sheet.js";
import { History } from "./storage/history.js";
import { selectFormat } from "./content/format-selector.js";
import { currentSlot, alreadyPostedInSlot } from "./content/schedule.js";
import { selectProducts } from "./ai/product-selector.js";
import { generateContent, composeCaption } from "./ai/content-generator.js";
import { resolveProductImages } from "./media/product-images.js";
import { buildStoryImage } from "./media/story.js";
import { downloadImage } from "./utils/image.js";
import { ZernioClient } from "./social/zernio.js";
import type { DownloadedImage, Product, ScoredProduct } from "./types.js";

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
  const history = History.load();

  // 0. Gating per slot (solo sui run schedulati): robusto ai ritardi dei cron
  //    di GitHub. Un post per slot al giorno; i run manuali ignorano il gating.
  //    Si decide PRIMA di leggere il catalogo/chiamare OpenAI, per non sprecare
  //    risorse sui run da saltare.
  const runMode = (process.env.RUN_MODE ?? "manual").toLowerCase();
  let slotKey = "manual";
  if (runMode === "scheduled") {
    const { date, hour, slot } = currentSlot(config);
    if (!slot) {
      logger.info(`Ora NY ${hour}:00 fuori dalle finestre di pubblicazione: salto.`);
      return;
    }
    if (alreadyPostedInSlot(history, date, slot, config)) {
      logger.info(`Slot "${slot}" del ${date} già pubblicato: salto (evito il doppione).`);
      return;
    }
    slotKey = slot;
    logger.info(`Slot di pubblicazione: "${slot}" (${date}, ora NY ${hour}:00).`);
  }

  // 1. Catalogo
  const products = await readCatalog(config);
  if (products.length === 0) throw new Error("Catalogo vuoto: nessun prodotto da pubblicare.");

  // 2. Formato editoriale del giorno (rotazione, o forzato da input manuale)
  const forceFormat = (process.env.FORCE_FORMAT ?? "").trim().toLowerCase();
  const format = selectFormat(history, config, forceFormat === "auto" ? "" : forceFormat);

  // 3. Selezione candidati: prodotto forzato manualmente oppure scoring.
  const forceProduct = (process.env.FORCE_PRODUCT ?? "").trim();
  let candidates: ScoredProduct[];
  if (forceProduct) {
    const wanted = slug(forceProduct);
    const forcedId = extractProductId(forceProduct, config.settings);
    const found = products.find(
      (p) =>
        p.id === forceProduct ||
        p.link === forceProduct ||
        p.id === forcedId ||
        (wanted.length >= 3 && slug(p.name).includes(wanted)),
    );
    if (!found) {
      throw new Error(
        `Prodotto "${forceProduct}" non trovato nel catalogo. ` +
          `Puoi indicare il link completo, l'ID oppure una parte del nome.`,
      );
    }
    if (history.publishedIds().has(found.id)) {
      logger.warn(`"${found.name}" risulta gia' pubblicato: lo ripubblico su richiesta esplicita.`);
    }
    logger.info(`Prodotto scelto manualmente: "${found.name}" (${found.brand} / ${found.category})`);
    candidates = [{ product: found, score: 0, breakdown: {} }];
  } else {
    candidates = selectProducts(products, history, config, format);
    if (candidates.length === 0) {
      logger.warn("Tutti i prodotti del catalogo sono già stati pubblicati. Niente da fare oggi.");
      return;
    }
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

  // 7a. Instagram Story: ogni post feed genera anche una Story con la stessa
  //     immagine e il richiamo "LINK IN BIO" stampato (best-effort).
  if (config.settings.story.enabled) {
    try {
      const storyImage = await buildStoryImage(images[0].buffer, chosen, config);
      const storyUrl = await zernio.uploadMedia(storyImage);
      await zernio.publishPost({
        caption: "",
        mediaUrls: [storyUrl],
        platform: igPlatform,
        accountId,
        platformSpecificData: { contentType: "story" },
        config,
      });
      publishedPlatforms.push("instagram_story");
      logger.info("Story Instagram pubblicata (richiamo 'link in bio').");
    } catch (err) {
      logger.warn(`Pubblicazione Story Instagram fallita (post feed gia' uscito): ${(err as Error).message}`);
    }
  }

  // 7b. Pinterest (best-effort): pin con titolo/descrizione dedicati e link
  //     diretto al prodotto. Un errore qui non blocca la pubblicazione IG.
  const pin = config.settings.pinterest;
  if (pin.enabled) {
    try {
      const pinAccountId = await zernio.resolveAccountId(pin.platform);

      // Il boardId e' OBBLIGATORIO per Pinterest: prima la config, poi le
      // board reali dell'account (match per nome di categoria, altrimenti
      // la prima disponibile).
      let boardId = pin.boardByCategory[chosen.category] || pin.defaultBoardId;
      if (!boardId) {
        const boards = await zernio.listPinterestBoards(pinAccountId);
        if (boards.length === 0) {
          throw new Error(
            "Il profilo Pinterest non ha nessuna board: creane una (es. \"JAG Finds\") " +
              "e i pin partiranno automaticamente dal prossimo run.",
          );
        }
        const catSlug = slug(chosen.category);
        const match = boards.find((b) => slug(b.name).includes(catSlug));
        const board = match ?? boards[0];
        boardId = board.id;
        logger.info(
          `Board Pinterest scelta: "${board.name}" (${board.id})` +
            `${match ? " [match categoria]" : " [prima disponibile]"}`,
        );
      }

      await zernio.publishPost({
        caption: content.pinDescription,
        mediaUrls: [mediaUrls[0]],
        platform: pin.platform,
        accountId: pinAccountId,
        platformSpecificData: {
          title: content.pinTitle,
          link: chosen.link,
          boardId,
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
    slot: slotKey,
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
