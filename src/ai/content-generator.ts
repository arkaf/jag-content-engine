/** Generazione di caption, hashtag, CTA e alt text tramite OpenAI. */
import OpenAI from "openai";
import { logger } from "../utils/logger.js";
import { slug } from "../utils/normalize.js";
import type { AppConfig } from "../utils/config.js";
import type { GeneratedContent, Product } from "../types.js";

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

/** Pulisce, deduplica e limita gli hashtag combinando quelli generati con quelli di config. */
function buildHashtags(generated: string[], product: Product, config: AppConfig): string[] {
  const { base, byCategory, blocklist } = config.hashtags;
  const { min, max } = config.settings.content.hashtags;
  const blocked = new Set(blocklist.map((t) => slug(t)));

  const categoryTags = byCategory[product.category] ?? byCategory.default ?? [];
  const brandTag = slug(product.brand).replace(/[^a-z0-9]/g, "");

  const ordered = [
    ...base,
    brandTag,
    ...categoryTags,
    ...generated,
  ];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of ordered) {
    const tag = slug(raw).replace(/^#/, "").replace(/[^a-z0-9]/g, "");
    if (!tag || tag.length < 2 || blocked.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    result.push(`#${tag}`);
    if (result.length >= max) break;
  }

  if (result.length < min) {
    logger.warn(`Solo ${result.length} hashtag generati (minimo consigliato ${min}).`);
  }
  return result;
}

export async function generateContent(product: Product, config: AppConfig): Promise<GeneratedContent> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Variabile OPENAI_API_KEY mancante.");

  const client = new OpenAI({ apiKey });
  const { model, temperature, maxTokens } = config.settings.openai;
  const { min, max } = config.settings.content.hashtags;

  const userPrompt = fillTemplate(config.prompts.user, {
    name: product.name,
    brand: product.brand,
    category: product.category,
    price: product.price !== null ? `${product.price} €` : product.priceRaw || "n/d",
    link: product.link,
    hashtagMin: String(min),
    hashtagMax: String(max),
  });

  logger.info(`Genero i contenuti con OpenAI (${model}) per "${product.name}"`);

  const completion = await client.chat.completions.create({
    model,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: config.prompts.system },
      { role: "user", content: userPrompt },
    ],
  });

  const rawContent = completion.choices[0]?.message?.content;
  if (!rawContent) throw new Error("OpenAI ha restituito una risposta vuota.");

  let parsed: Partial<GeneratedContent> & { hashtags?: unknown };
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    throw new Error(`Risposta OpenAI non è JSON valido: ${(err as Error).message}\n${rawContent}`);
  }

  const caption = (parsed.caption ?? "").toString().trim();
  const cta = (parsed.cta ?? "").toString().trim();
  const altText = (parsed.altText ?? "").toString().trim() || `${product.name} - ${product.brand}`;
  const generatedTags = Array.isArray(parsed.hashtags)
    ? (parsed.hashtags as unknown[]).map((t) => String(t))
    : [];

  if (!caption) throw new Error("OpenAI non ha prodotto una caption utilizzabile.");

  return {
    caption,
    cta,
    altText,
    hashtags: buildHashtags(generatedTags, product, config),
  };
}

/** Compone la caption finale (testo + CTA + hashtag) secondo la configurazione. */
export function composeCaption(content: GeneratedContent, config: AppConfig): string {
  const { order, separator, hashtagSeparator } = config.settings.content.caption;
  const parts: string[] = [];
  for (const key of order) {
    if (key === "caption" && content.caption) parts.push(content.caption);
    else if (key === "cta" && content.cta) parts.push(content.cta);
    else if (key === "hashtags" && content.hashtags.length) {
      parts.push(content.hashtags.join(hashtagSeparator));
    }
  }
  return parts.join(separator);
}
