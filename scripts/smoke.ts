/** Smoke test della logica pura: parsing, selezione, composizione caption. */
import { loadConfig } from "../src/utils/config.js";
import { extractProductId, parsePrice, normalizeCategory, slug } from "../src/utils/normalize.js";
import { imageUrlQuality } from "../src/utils/image.js";
import { selectProducts } from "../src/ai/product-selector.js";
import { composeCaption } from "../src/ai/content-generator.js";
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
check("extractProductId last-segment", extractProductId("https://jag.best/products/nike-air-max?ref=x", config.settings) === "nike-air-max");
check("normalizeCategory felpa -> hoodie", normalizeCategory("Felpa", config.categories) === "hoodie");
check("slug accents", slug("Giácca Técnica") === "giacca tecnica");
check("imageUrlQuality https+ext", imageUrlQuality("https://cdn.jag.best/img/large/x.jpg") > 0.7);

// --- selection ---
const products: Product[] = [
  { id: "p1", name: "Air Zoom", link: "l1", imageUrl: "https://cdn/x1.jpg", price: 120, priceRaw: "120", category: "sneakers", brand: "Nike", row: 2 },
  { id: "p2", name: "Tech Hoodie", link: "l2", imageUrl: "https://cdn/x2.jpg", price: 90, priceRaw: "90", category: "hoodie", brand: "Stone Island", row: 3 },
  { id: "p3", name: "Basic Tee", link: "l3", imageUrl: "https://cdn/x3.png", price: 35, priceRaw: "35", category: "tshirt", brand: "Carhartt", row: 4 },
];
const history = History.load();
const ranked = selectProducts(products, history, config);
check("selection returns all unpublished", ranked.length === 3);
check("selection sorted desc", ranked[0].score >= ranked[ranked.length - 1].score);
check("selection has breakdown", Object.keys(ranked[0].breakdown).length === 6);

// --- caption ---
const caption = composeCaption(
  { caption: "Un capo che parla da solo.", cta: "Scoprilo su jag.best", hashtags: ["#jag", "#streetwear"], altText: "alt" },
  config,
);
check("caption contains parts", caption.includes("capo") && caption.includes("Scoprilo") && caption.includes("#jag"));
console.log("\nCaption preview:\n" + caption);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
