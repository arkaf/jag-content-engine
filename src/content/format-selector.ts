/** Selezione del formato editoriale a rotazione (come un vero social media manager). */
import { logger } from "../utils/logger.js";
import type { AppConfig } from "../utils/config.js";
import type { History } from "../storage/history.js";
import type { EditorialFormat } from "../types.js";

/**
 * Sceglie il prossimo formato ruotando la lista `rotation`: parte dal formato
 * successivo all'ultimo usato nello storico, così il feed alterna i formati.
 * Se `forcedKey` è valorizzato (esecuzione manuale), usa quel formato.
 */
export function selectFormat(history: History, config: AppConfig, forcedKey?: string): EditorialFormat {
  const { rotation, formats } = config.formats;

  if (forcedKey) {
    const def = formats[forcedKey];
    if (!def) {
      throw new Error(
        `Formato "${forcedKey}" inesistente. Disponibili: ${Object.keys(formats).join(", ")}`,
      );
    }
    logger.info(`Formato editoriale forzato manualmente: ${def.emoji} ${def.label}`);
    return { key: forcedKey, emoji: def.emoji, label: def.label, brief: def.brief, select: def.select ?? {} };
  }

  const valid = rotation.filter((k) => formats[k]);
  if (valid.length === 0) throw new Error("Nessun formato editoriale valido in formats.json.");

  const last = history.recent(1)[0]?.format;
  const lastIdx = last ? valid.indexOf(last) : -1;
  const nextKey = valid[(lastIdx + 1) % valid.length];

  const def = formats[nextKey];
  logger.info(`Formato editoriale scelto: ${def.emoji} ${def.label} (dopo "${last ?? "—"}")`);
  return { key: nextKey, emoji: def.emoji, label: def.label, brief: def.brief, select: def.select ?? {} };
}
