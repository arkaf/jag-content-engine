/**
 * Gestione degli slot di pubblicazione robusta ai ritardi di GitHub Actions.
 *
 * I cron di GitHub partono spesso in ritardo (30 min – 2h+): una guardia
 * "ora esatta" perde le finestre. Qui usiamo finestre orarie larghe (in fuso
 * locale del brand) + idempotenza: al massimo un post per slot al giorno,
 * verificando lo storico. Così i ritardi vengono assorbiti senza doppioni.
 */
import type { AppConfig } from "../utils/config.js";
import type { History } from "../storage/history.js";

export interface SlotInfo {
  /** Data locale (YYYY-MM-DD) nel fuso del brand. */
  date: string;
  /** Ora locale (0-23) nel fuso del brand. */
  hour: number;
  /** Chiave dello slot corrente, o null se fuori da ogni finestra. */
  slot: string | null;
}

/** Data (YYYY-MM-DD) e ora locale nel fuso indicato per un dato istante. */
export function localDateHour(when: Date, timezone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(when);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  // "24" può comparire a mezzanotte con hour12:false: normalizziamo a 0.
  const hour = Number(get("hour")) % 24;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour };
}

/** Trova lo slot il cui intervallo [startHour, endHour] contiene l'ora data. */
function slotForHour(hour: number, config: AppConfig): string | null {
  for (const s of config.settings.schedule.slots) {
    if (hour >= s.startHour && hour <= s.endHour) return s.key;
  }
  return null;
}

/** Calcola lo slot corrente (ora locale del brand) per l'istante `now`. */
export function currentSlot(config: AppConfig, now: Date = new Date()): SlotInfo {
  const tz = config.settings.schedule.timezone;
  const { date, hour } = localDateHour(now, tz);
  return { date, hour, slot: slotForHour(hour, config) };
}

/**
 * Verifica se in questo slot, oggi (data locale), è già stato pubblicato.
 * Contano solo i post schedulati con lo stesso `slot`: i post manuali di test
 * non bloccano la cadenza automatica.
 */
export function alreadyPostedInSlot(
  history: History,
  date: string,
  slot: string,
  config: AppConfig,
): boolean {
  const tz = config.settings.schedule.timezone;
  return history.all().some((r) => {
    if (r.slot !== slot) return false;
    const local = localDateHour(new Date(r.publishedAt), tz);
    return local.date === date;
  });
}
