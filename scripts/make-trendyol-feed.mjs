#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

/* ---------------- CLI ---------------- */
const argv = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.split("=");
    return [k.replace(/^--/, ""), v ?? true];
  })
);

const DIR          = path.resolve(argv.dir || "static/products");
const OUT          = path.resolve(argv.out || "static/trendyol/trendyol_products.csv");
const LIMIT        = Number(argv.limit || 0); // 0 = all, 1 = only first product
const BRAND_FALLBK = argv.brand || "CONTE";
const CURRENCY     = (argv.currency || "RON").toUpperCase(); // e.g. RON / EUR / AED
const VAT_RATE     = Number(argv.vat || 19);
const IGNORE_UNMAP = Boolean(argv.ignoreUnmapped || false);
const MAP_PATH     = argv["category-map"] || "scripts/trendyol-category-map.json";

/**
 * trendyol-category-map.json format (you maintain this):
 * {
 *   "Chiloți Damă": 600123,          // Trendyol leaf categoryId
 *   "Body Damă": 600456,
 *   "Ciorapi și Dresuri": 600789,
 *   "Prosoape": 700111,
 *   "Femei": 600999,                 // try to keep these leaf-level
 *   "Bărbați": 601234
 * }
 */
let CAT_MAP = {};
try {
  CAT_MAP = JSON.parse(fs.readFileSync(path.resolve(MAP_PATH), "utf8"));
  console.log(`Loaded category map: ${MAP_PATH}`);
} catch (e) {
  console.warn(`⚠ Could not load category map at ${MAP_PATH}. Unmapped products will ${IGNORE_UNMAP ? "be skipped" : "keep original label"}.`);
}

/* ------------- helpers ------------- */
const isBlank = v => v == null || (typeof v === "string" && v.trim() === "");
const norm = s => (s ?? "").toString().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function safeInt(n, d = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : d;
}
function safeFloat(n, d = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : d;
}
function stripHtml(html = "") {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// “Color/Size” normalization → Trendyol prefers standard names/values.
// Extend these as you see values in your data.
const colorMap = new Map([
  ["nero", "Black"],
  ["negru", "Black"],
  ["black", "Black"],
  ["alb", "White"],
  ["white", "White"],
  ["nude", "Beige"],
  ["bej", "Beige"],
  ["bleumarin", "Navy"],
  ["navy", "Navy"],
  ["albastru", "Blue"],
  ["rosu", "Red"],
  ["roșu", "Red"],
]);
const normColor = v => {
  const key = norm(v);
  return colorMap.get(key) || (v || "").toString().trim();
};

function hasNameWithoutValue(row) {
  for (let i = 1; i <= 3; i++) {
    const n = row[`Option${i} Name`];
    const v = row[`Option${i} Value`];
    if (!!(n && String(n).trim()) && !(v && String(v).trim())) return true;
  }
  return false;
}

/** Map RO category label → Trendyol leaf `categoryId` (number) */
function toTrendyolCategoryId(val) {
  if (isBlank(val)) return null;
  const s = val.toString().trim();
  // If the value already looks like a number (id), accept it
  if (/^\d+$/.test(s)) return Number(s);
  // Try exact, then normalized
  if (s in CAT_MAP) return Number(CAT_MAP[s]);
  const sNorm = norm(s);
  for (const [k,v] of Object.entries(CAT_MAP)) {
    if (norm(k) === sNorm) return Number(v);
  }
  return null;
}

/** Build a Trendyol-style title with variant context (Color / Size) */
function variantTitle(baseTitle, vRow) {
  const parts = [];
  for (let i = 1; i <= 3; i++) {
    const n = (vRow[`Option${i} Name`] || "").toString().trim();
    const v = (vRow[`Option${i} Value`] || "").toString().trim();
    if (!n || !v) continue;
    parts.push(`${n}: ${v}`);
  }
  return parts.length ? `${baseTitle} — ${parts.join(", ")}` : baseTitle;
}

/** Build ordered image list: variant image, then parent, then gallery (deduped) */
function imageListForVariant(group, vRow) {
  const seen = new Set();
  const list = [];

  const push = (url) => {
    const u = (url || "").toString().trim();
    if (!u || seen.has(u)) return;
    seen.add(u);
    list.push(u);
  };

  // Variant image (preferred)
  push(vRow["Variant Image"]);

  // Parent image
  push(group.parent?.["Image Src"]);

  // Gallery extras from “image-only” rows
  for (const g of group.gallery) {
    push(g["Image Src"]);
  }

  return list;
}

/* ------------- Input aggregation ------------- */
if (!fs.existsSync(DIR)) {
  console.error(`Folder not found: ${DIR}`);
  process.exit(1);
}

const files = fs.readdirSync(DIR).filter(f => f.toLowerCase().endsWith(".csv"));
if (!files.length) {
  console.log("No CSV files found in", DIR);
  process.exit(0);
}

// Group rows by Handle: { parent, variants[], gallery[] }
const byHandle = new Map();
for (const file of files) {
  const full = path.join(DIR, file);
  const raw = fs.readFileSync(full, "utf8");
  const rows = parse(raw, { columns: true, skip_empty_lines: false });

  for (const r of rows) {
    const handle = r.Handle || r.handle || "";
    if (!handle) continue;

    if (!byHandle.has(handle)) {
      byHandle.set(handle, { parent: null, variants: [], gallery: [] });
    }
    const group = byHandle.get(handle);

    const isImageOnlyRow =
      isBlank(r.Title) &&
      isBlank(r["Variant SKU"]) &&
      !isBlank(r["Image Src"]) &&
      isBlank(r["Option1 Name"]) &&
      isBlank(r["Option2 Name"]) &&
      isBlank(r["Option3 Name"]);

    if (isImageOnlyRow) {
      group.gallery.push(r);
      continue;
    }

    const isVariantRow = !isBlank(r["Variant SKU"]) || !isBlank(r["Variant Image"]);
    if (isVariantRow) {
      group.variants.push(r);
    } else {
      // parent (only first one kept)
      if (!group.parent) group.parent = r;
    }
  }
}

/* ------------- Transform → Trendyol CSV rows ------------- */
// Minimal, common columns compatible with Product v2 concept
// (Trendyol’s panel often accepts these in Excel; this CSV mirrors that)
const trendyolColumns = [
  "barcode",            // EAN/GTIN; required by Trendyol
  "title",
  "brand",              // brand name (must exist/approved in your account)
  "categoryId",         // Trendyol LEAF category id
  "description",
  "productMainId",      // your product (model) code; we use Handle
  "stockCode",          // your SKU for the variant
  "quantity",
  "vatRate",
  "listPrice",
  "salePrice",
  "currencyType",
  "images",             // comma-separated URLs (variant-first)
  // simple attribute samples:
  "attributeColor",
  "attributeSize"
];

const outRows = [];
let taken = 0;

for (const [handle, group] of byHandle.entries()) {
  if (!group.parent) continue; // safety

  // Category mapping: take from parent’s “Product Category”
  const inputCat = group.parent["Product Category"] || "";
  const categoryId = toTrendyolCategoryId(inputCat);

  if (categoryId == null) {
    const msg = `⚠ Unmapped category "${inputCat}" for handle=${handle}`;
    if (IGNORE_UNMAP) { console.log(`${msg} — skipped.`); continue; }
    console.log(`${msg} — keeping label in CSV (not recommended).`);
  }

  // Common values from parent
  const baseTitle = (group.parent.Title || "").toString().trim();
  const baseDesc  = stripHtml(group.parent["Body (HTML)"] || "");
  const brandName = (group.parent.Vendor || BRAND_FALLBK).toString().trim() || BRAND_FALLBK;

  // If no variants, treat parent like a single variant
  const variants = group.variants.length ? group.variants : [group.parent];

  for (const v of variants) {
    // Skip nonsense rows (option label without value)
    if (hasNameWithoutValue(v)) continue;

    // Prices
    const price = safeFloat(v["Variant Price"] || v["Price"] || group.parent["Variant Price"]);
    const compare = safeFloat(v["Variant Compare At Price"] || group.parent["Variant Compare At Price"]);
    const listPrice = compare > 0 && compare >= price ? compare : price;
    const salePrice = price;

    // Stock, codes, barcode
    const qty = safeInt(v["Variant Inventory Qty"], 0);
    const sku = (v["Variant SKU"] || v["SKU"] || "").toString().trim() || handle;
    const barcode = (v["Variant Barcode"] || "").toString().trim(); // required by Trendyol

    // Attributes (keep it simple: Color/Size if present)
    let color = "", size = "";
    for (let i = 1; i <= 3; i++) {
      const n = (v[`Option${i} Name`] || "").toString().toLowerCase();
      const val = (v[`Option${i} Value`] || "").toString();
      if (!val) continue;
      if (n.includes("color") || n.includes("culoare")) color = normColor(val);
      if (n.includes("size") || n.includes("marime") || n.includes("mărime")) size = val;
    }

    // Title with variant context
    const title = variantTitle(baseTitle, v);

    // Images
    const imgs = imageListForVariant(group, v);

    // Build one Trendyol row per variant
    const row = {
      barcode: barcode,                                  // strongly recommended/required
      title,
      brand: brandName,
      categoryId: categoryId ?? inputCat,                // prefer numeric id; fallback label if not mapped
      description: baseDesc,
      productMainId: handle,
      stockCode: sku,
      quantity: qty,
      vatRate: VAT_RATE,
      listPrice: listPrice,
      salePrice: salePrice,
      currencyType: CURRENCY,
      images: imgs.join(","),
      attributeColor: color,
      attributeSize: size
    };

    outRows.push(row);
  }

  taken++;
  if (LIMIT > 0 && taken >= LIMIT) break;
}

/* ------------- Write CSV ------------- */
const outDir = path.dirname(OUT);
fs.mkdirSync(outDir, { recursive: true });
const csv = stringify(outRows, { header: true, columns: trendyolColumns });
fs.writeFileSync(OUT, "\uFEFF" + csv, "utf8");

console.log(`\n✔ Wrote ${outRows.length} Trendyol rows → ${OUT}`);
if (LIMIT > 0) console.log(`(test mode: limited to ${LIMIT} product${LIMIT>1?"s":""})`);
