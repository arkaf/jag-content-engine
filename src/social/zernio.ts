/** Client per l'API Zernio: upload media e pubblicazione su Instagram. */
import { logger } from "../utils/logger.js";
import type { AppConfig } from "../utils/config.js";
import type { DownloadedImage } from "../types.js";

export interface ZernioAccount {
  id: string;
  platform: string;
  name?: string;
  username?: string;
  status?: string;
}

export interface PublishResult {
  postId: string | null;
  permalink: string;
  accountId: string;
  raw: unknown;
}

export class ZernioClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: AppConfig) {
    this.apiKey = process.env.ZERNIO_API_KEY ?? "";
    if (!this.apiKey) throw new Error("Variabile ZERNIO_API_KEY mancante.");
    this.baseUrl = config.settings.zernio.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, init);
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* risposta non JSON: teniamo il testo grezzo */
    }
    if (!res.ok) {
      throw new Error(`Zernio ${path} ha risposto HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    return body;
  }

  /** Estrae l'array dalla risposta gestendo forme diverse ({data}, {accounts}, array). */
  private static asArray(body: unknown): unknown[] {
    if (Array.isArray(body)) return body;
    if (body && typeof body === "object") {
      for (const key of ["data", "accounts", "items", "results"]) {
        const value = (body as Record<string, unknown>)[key];
        if (Array.isArray(value)) return value;
      }
    }
    return [];
  }

  private static pickId(obj: unknown): string | null {
    if (obj && typeof obj === "object") {
      const rec = obj as Record<string, unknown>;
      for (const key of ["id", "_id", "postId"]) {
        if (typeof rec[key] === "string") return rec[key] as string;
      }
      const data = rec.data;
      if (data && typeof data === "object") return ZernioClient.pickId(data);
    }
    return null;
  }

  /** Elenca gli account social collegati. */
  async listAccounts(): Promise<ZernioAccount[]> {
    const body = await this.request("/accounts", { method: "GET", headers: this.authHeaders() });
    return ZernioClient.asArray(body).map((a) => {
      const rec = a as Record<string, unknown>;
      return {
        id: String(rec.id ?? rec._id ?? ""),
        platform: String(rec.platform ?? "").toLowerCase(),
        name: rec.name ? String(rec.name) : undefined,
        username: rec.username ? String(rec.username) : undefined,
        status: rec.status ? String(rec.status) : undefined,
      };
    });
  }

  /** Determina l'account Instagram da usare (da env o rilevato automaticamente). */
  async resolveInstagramAccountId(config: AppConfig): Promise<string> {
    const fromEnv = process.env.ZERNIO_INSTAGRAM_ACCOUNT_ID;
    if (fromEnv) {
      logger.info(`Account Instagram da ZERNIO_INSTAGRAM_ACCOUNT_ID: ${fromEnv}`);
      return fromEnv;
    }
    const accounts = await this.listAccounts();
    const platform = config.settings.zernio.platform.toLowerCase();
    const ig = accounts.filter((a) => a.platform === platform && a.id);
    if (ig.length === 0) {
      throw new Error(
        `Nessun account "${platform}" collegato su Zernio. ` +
          `Account trovati: ${accounts.map((a) => `${a.platform}:${a.id}`).join(", ") || "nessuno"}. ` +
          `Collega l'account su Zernio oppure imposta ZERNIO_INSTAGRAM_ACCOUNT_ID.`,
      );
    }
    if (ig.length > 1) {
      logger.warn(
        `Trovati ${ig.length} account Instagram, uso il primo (${ig[0].username ?? ig[0].id}). ` +
          `Imposta ZERNIO_INSTAGRAM_ACCOUNT_ID per sceglierne uno specifico.`,
      );
    }
    logger.info(`Account Instagram rilevato: ${ig[0].username ?? ig[0].id} (${ig[0].id})`);
    return ig[0].id;
  }

  /** Carica un'immagine e restituisce l'URL pubblico da usare nel post. */
  async uploadMedia(image: DownloadedImage): Promise<string> {
    const form = new FormData();
    const blob = new Blob([image.buffer], { type: image.contentType });
    form.append("file", blob, image.filename);

    const body = await this.request("/media/upload-direct", {
      method: "POST",
      headers: this.authHeaders(),
      body: form,
    });

    const url = (body as Record<string, unknown>)?.url;
    if (typeof url !== "string" || !url) {
      throw new Error(`Upload media Zernio senza URL nella risposta: ${JSON.stringify(body).slice(0, 300)}`);
    }
    logger.info(`Media caricato su Zernio: ${url}`);
    return url;
  }

  /**
   * Crea e pubblica immediatamente un post su Instagram.
   * Con una sola immagine è un post foto; con più immagini Zernio genera
   * automaticamente un carosello.
   */
  async publishPost(params: {
    caption: string;
    mediaUrls: string[];
    accountId: string;
    config: AppConfig;
  }): Promise<PublishResult> {
    const { caption, mediaUrls, accountId, config } = params;
    if (mediaUrls.length === 0) throw new Error("Nessuna immagine da pubblicare.");
    const payload = {
      content: caption,
      mediaItems: mediaUrls.map((url) => ({ type: config.settings.zernio.mediaType, url })),
      platforms: [{ platform: config.settings.zernio.platform, accountId }],
      publishNow: true,
    };

    logger.info(
      `Pubblico su Instagram tramite Zernio (account ${accountId}, ${mediaUrls.length} immagine/i)`,
    );
    const body = await this.request("/posts", {
      method: "POST",
      headers: { ...this.authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const postId = ZernioClient.pickId(body);
    const rec = (body ?? {}) as Record<string, unknown>;
    const permalink = String(rec.permalink ?? rec.url ?? "");
    logger.info(`Post creato su Zernio${postId ? ` (id ${postId})` : ""}.`);
    return { postId, permalink, accountId, raw: body };
  }
}
