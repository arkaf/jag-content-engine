/** Tipi condivisi del Jag Content Engine. */

export interface Product {
  /** ID stabile estratto dal link del prodotto. */
  id: string;
  name: string;
  link: string;
  imageUrl: string;
  price: number | null;
  priceRaw: string;
  category: string;
  brand: string;
  /** Numero di riga nel foglio (1-based, utile per il debug). */
  row: number;
}

export interface GeneratedContent {
  caption: string;
  hashtags: string[];
  altText: string;
}

export interface FormatSelect {
  categories?: string[];
  requireBrand?: boolean;
  pricePreference?: "low" | "high";
  maxPrice?: number;
  minPrice?: number;
}

export interface EditorialFormat {
  key: string;
  emoji: string;
  label: string;
  brief: string;
  select: FormatSelect;
}

export interface DownloadedImage {
  buffer: Buffer;
  contentType: string;
  filename: string;
  sizeBytes: number;
}

export interface HistoryRecord {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: number | null;
  platform: string;
  format: string;
  imagesCount: number;
  permalink: string;
  postId: string | null;
  publishedAt: string;
}

export interface HistoryFile {
  version: number;
  published: HistoryRecord[];
}

export interface ScoredProduct {
  product: Product;
  score: number;
  breakdown: Record<string, number>;
}
