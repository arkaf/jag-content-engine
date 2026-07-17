/** Gestione dello storico delle pubblicazioni (data/history.json). */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { logger } from "../utils/logger.js";
import { slug } from "../utils/normalize.js";
import type { HistoryFile, HistoryRecord } from "../types.js";

/** Normalizza un nome prodotto per il confronto (dedup di sicurezza). */
export function normalizeName(name: string): string {
  return slug(name ?? "");
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const HISTORY_PATH = join(DATA_DIR, "history.json");

const EMPTY: HistoryFile = { version: 1, published: [] };

export class History {
  private data: HistoryFile;

  private constructor(data: HistoryFile) {
    this.data = data;
  }

  static load(): History {
    if (!existsSync(HISTORY_PATH)) {
      logger.debug("history.json non trovato, inizializzo storico vuoto.");
      return new History({ ...EMPTY, published: [] });
    }
    try {
      const parsed = JSON.parse(readFileSync(HISTORY_PATH, "utf-8")) as HistoryFile;
      if (!Array.isArray(parsed.published)) throw new Error("campo 'published' mancante");
      return new History(parsed);
    } catch (err) {
      throw new Error(`history.json corrotto: ${(err as Error).message}`);
    }
  }

  isPublished(id: string): boolean {
    return this.data.published.some((r) => r.id === id);
  }

  /** Insieme degli ID già pubblicati. */
  publishedIds(): Set<string> {
    return new Set(this.data.published.map((r) => r.id));
  }

  /** Insieme dei nomi già pubblicati (normalizzati), dedup di sicurezza oltre all'ID. */
  publishedNames(): Set<string> {
    return new Set(this.data.published.map((r) => normalizeName(r.name)));
  }

  /** Ultimi N record pubblicati, dal più recente. */
  recent(n: number): HistoryRecord[] {
    return [...this.data.published]
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, n);
  }

  add(record: HistoryRecord): void {
    this.data.published.push(record);
  }

  save(): void {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(HISTORY_PATH, JSON.stringify(this.data, null, 2) + "\n", "utf-8");
    logger.info(`Storico aggiornato: ${this.data.published.length} pubblicazioni totali.`);
  }
}
