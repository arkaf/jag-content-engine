/** Caricamento centralizzato dei file di configurazione JSON esterni. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, "..", "..", "config");

function loadJson<T>(file: string): T {
  const path = join(CONFIG_DIR, file);
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch (err) {
    throw new Error(`Impossibile leggere il file di configurazione "${file}": ${(err as Error).message}`);
  }
}

export interface Settings {
  brand: { name: string; site: string; voice: string[]; language: string };
  sheet: {
    headerDetection: boolean;
    columnSynonyms: Record<string, string[]>;
    positionalFallback: string[];
  };
  productId: { strategy: "last-path-segment" | "query-param"; queryParam: string };
  openai: { model: string; temperature: number; maxTokens: number };
  content: {
    caption: { order: string[]; separator: string; hashtagSeparator: string; linkInBio: string };
    hashtags: { min: number; max: number };
  };
  images: { maxPerPost: number; extractFromProductLink: boolean; cdnHosts: string[] };
  schedule: {
    timezone: string;
    slots: { key: string; startHour: number; endHour: number }[];
  };
  zernio: { baseUrl: string; platform: string; mediaType: string };
  pinterest: {
    enabled: boolean;
    platform: string;
    defaultBoardId: string;
    boardByCategory: Record<string, string>;
  };
  selection: {
    candidatePoolSize: number;
    recentWindow: number;
    weights: Record<string, number>;
  };
}

export interface PromptsConfig {
  system: string;
  user: string;
  variables: string[];
}

export interface HashtagsConfig {
  base: string[];
  /** Hashtag della community (es. mulebuy) aggiunti sempre in coda. */
  trailing: string[];
  byCategory: Record<string, string[]>;
  blocklist: string[];
}

export interface CategoriesConfig {
  aliases: Record<string, string[]>;
  seasonality: Record<string, Record<string, number>>;
  defaultSeasonality: number;
  priceBands: { label: string; max: number | null; score: number }[];
}

export interface FormatDefinition {
  emoji: string;
  label: string;
  brief: string;
  select: {
    categories?: string[];
    requireBrand?: boolean;
    pricePreference?: "low" | "high";
    maxPrice?: number;
    minPrice?: number;
  };
}

export interface FormatsConfig {
  rotation: string[];
  formats: Record<string, FormatDefinition>;
  comingSoon?: string[];
}

export interface AppConfig {
  settings: Settings;
  prompts: PromptsConfig;
  hashtags: HashtagsConfig;
  categories: CategoriesConfig;
  formats: FormatsConfig;
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  cached = {
    settings: loadJson<Settings>("settings.json"),
    prompts: loadJson<PromptsConfig>("prompts.json"),
    hashtags: loadJson<HashtagsConfig>("hashtags.json"),
    categories: loadJson<CategoriesConfig>("categories.json"),
    formats: loadJson<FormatsConfig>("formats.json"),
  };
  return cached;
}
