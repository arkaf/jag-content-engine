/** Smoke test della logica pura: parsing, selezione, composizione caption. */
import { loadConfig } from "../src/utils/config.js";
import { extractProductId, parsePrice, normalizeCategory, slug } from "../src/utils/normalize.js";
import { imageUrlQuality } from "../src/utils/image.js";
import { selectProducts } from "../src/ai/product-selector.js";
import { composeCaption, buildHashtags } from "../src/ai/content-generator.js";
import { selectFormat } from "../src/content/format-selector.js";
import { History } from "../src/storage/history.js";
import type { Product } from "../src/types.js";

const config = loadConfig();
let failures = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`, extra ?? "");
  if (!cond) failures++;
}

// --- normalize ---
check("parsePrice € 129,00 -> 129", parsePrice("€ 129,00") === 129);
check("parsePrice 1.299,90 -> 1299.9", parsePrice("1.299,90") === 1299.9);
check("parsePrice $2,499.00 -> 2499", parsePrice("$2,499.00") === 2499);
check("extractProductId query-param id", extractProductId("https://mulebuy.com/product?id=936166579915&platform=TAOBAO&ref=200713968", config.settings) === "936166579915");
check("normalizeCategory felpa -> hoodie", normalizeCategory("Felpa", config.categories) === "hoodie");
check("slug accents", slug("Giácca Técnica") === "giacca tecnica");
check("imageUrlQuality https+ext", imageUrlQuality("https://cdn.jag.best/img/large/x.jpg") > 0.7);

// --- selection ---
const products: Product[] = [
  { id: "p1", name: "Air Zoom", link: "l1", imageUrl: "https://cdn/x1.jpg", price: 120, priceRaw: "120", category: "sneakers", brand: "Nike", row: 2 },
  { id: "p2", name: "Tech Hoodie", link: "l2", imageUrl: "https://cdn/x2.jpg", price: 90, priceRaw: "90", category: "hoodie", brand: "Stone Island", row: 3 },
  { id: "p3", name: "Basic Tee", link: "l3", imageUrl: "https://cdn/x3.png", price: 35, priceRaw: "35", category: "tshirt", brand: "Carhartt", row: 4 },
  { id: "p4", name: "Woven Cap", link: "l4", imageUrl: "https://cdn/x4.jpg", price: 45, priceRaw: "45", category: "accessories", brand: "Grailz", row: 5 },
];
const history = History.load();

// --- format rotation ---
const format = selectFormat(history, config);
check("format selected", !!format.label && !!format.emoji);

// --- selection (accessory format should keep only accessories) ---
const accessoryFormat = { key: "accessory_of_the_week", emoji: "🎒", label: "Accessory of the Week", brief: "", select: { categories: ["accessories"] } };
const ranked = selectProducts(products, history, config, accessoryFormat);
check("format filter keeps accessories only", ranked.every((r) => r.product.category === "accessories") && ranked.length === 1);

const allRanked = selectProducts(products, history, config);
check("selection sorted desc", allRanked[0].score >= allRanked[allRanked.length - 1].score);

// --- caption ---
const caption = composeCaption(
  { caption: "A piece that speaks for itself.", hashtags: ["#jag", "#streetwear"], altText: "alt", pinTitle: "Grailz Woven Cap — Streetwear Accessory", pinDescription: "Premium woven cap." },
  format,
  config,
);
check("caption has headline", caption.startsWith(format.emoji));
check("caption has link in bio", caption.includes("🔗 link in bio"));
check("caption has hashtags", caption.includes("#jag"));
console.log("\nCaption preview:\n" + caption);

// --- hashtags: i tag mulebuy chiudono sempre la lista entro il limite max ---
const manyGenerated = Array.from({ length: 30 }, (_, i) => `generatedtag${i}`);
const tags = buildHashtags(manyGenerated, products[0], config);
const maxTags = config.settings.content.hashtags.max;
check("hashtags within max", tags.length <= maxTags, tags.length);
check("hashtags end with mulebuy tags", tags[tags.length - 6] === "#mulebuy" && tags[tags.length - 1] === "#taobao", tags.slice(-6).join(" "));
check("no duplicates", new Set(tags).size === tags.length);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
