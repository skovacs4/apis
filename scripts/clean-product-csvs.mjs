import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const DIR = path.resolve("static/products");

/* ------- Shopify Category IDs we already use (for readability) ------- */
const ID_WOMENS_CLOTHING   = "gid://shopify/TaxonomyCategory/aa-1-6";
const ID_MENS_CLOTHING     = "gid://shopify/TaxonomyCategory/aa-1-5";
const ID_BODYSUITS         = "gid://shopify/TaxonomyCategory/aa-1-6-5";
const ID_WOMENS_UNDERPANTS = "gid://shopify/TaxonomyCategory/aa-1-6-11";
const ID_HOSIERY           = "gid://shopify/TaxonomyCategory/aa-1-6-18";
const ID_SHAPEWEAR         = "gid://shopify/TaxonomyCategory/aa-1-6-19";
const ID_SWIMWEAR          = "gid://shopify/TaxonomyCategory/aa-1-6-31";
const ID_TOWELS            = "gid://shopify/TaxonomyCategory/aa-9-7-2";

/* -------- Romanian -> Shopify Category ID (extend as needed) -------- */
const categoryMapROtoID = new Map([
  ["Chiloți Damă",        ID_WOMENS_UNDERPANTS],
  ["Femei",               ID_WOMENS_CLOTHING],
  ["Body Damă",           ID_BODYSUITS],
  ["Costume baie",        ID_SWIMWEAR],
  ["Bărbați",             ID_MENS_CLOTHING],
  ["Ciorapi Modelatori",  ID_SHAPEWEAR],
  ["Prosoape",            ID_TOWELS],
  ["Ciorapi și Dresuri",  ID_HOSIERY],

  // NEW from your logs:
  ["Ciorapi Groși",       ID_HOSIERY],
  ["Ciorapi Subțiri",     ID_HOSIERY],
  ["Ciorapi Bumbac",      ID_HOSIERY],
  ["Ciorapi Flaușați",    ID_HOSIERY],
  ["Ciorapi Poliamidă",   ID_HOSIERY],
  ["Șosete Copii",        ID_HOSIERY],     // safe umbrella (kids socks)
  ["Colanți Damă",        ID_WOMENS_CLOTHING], // broad valid fallback
  ["Colanți Copii",       ID_WOMENS_CLOTHING], // broad valid fallback
  ["Blugi Damă",          ID_WOMENS_CLOTHING],
  ["Textile Damă",        ID_WOMENS_CLOTHING],
  ["Accesorii",           ID_WOMENS_CLOTHING], // if you want Clothing Accessories later, we can swap
  ["Copii",               ID_WOMENS_CLOTHING], // broad valid fallback
  ["Diverse Eco",         ID_WOMENS_CLOTHING], // broad valid fallback
]);

/* If a file still has English breadcrumbs, convert to IDs too */
const breadcrumbToID = new Map([
  ["Apparel & Accessories > Clothing > Lingerie > Women's Underpants", ID_WOMENS_UNDERPANTS],
  ["Apparel & Accessories > Clothing > Women’s Clothing",              ID_WOMENS_CLOTHING],
  ["Apparel & Accessories > Clothing > Lingerie > Bodysuits",          ID_BODYSUITS],
  ["Apparel & Accessories > Clothing > Swimwear",                      ID_SWIMWEAR],
  ["Apparel & Accessories > Clothing > Men’s Clothing",                ID_MENS_CLOTHING],
  ["Apparel & Accessories > Clothing > Hosiery > Shapewear",           ID_SHAPEWEAR],
  ["Home & Garden > Linens & Bedding > Towels",                        ID_TOWELS],
  ["Apparel & Accessories > Clothing > Hosiery",                       ID_HOSIERY],
]);

/* -------- Inverse map: ID -> breadcrumb (for breadcrumbs mode) -------- */
const idToBreadcrumb = new Map(
  Array.from(breadcrumbToID.entries()).map(([crumb, id]) => [id, crumb])
);

/* ------------------ CLI mode ------------------ */
const argMode = (process.argv.find(a => a.startsWith("--mode=")) || "").split("=")[1];
const MODE = (argMode || "taxonomy").toLowerCase();
if (!["taxonomy", "breadcrumbs"].includes(MODE)) {
  console.error(`Unknown --mode value: "${MODE}". Use "taxonomy" or "breadcrumbs".`);
  process.exit(1);
}
console.log(`Running clean-product-csvs in MODE=${MODE}`);

/* ------------------ helpers ------------------ */
const isBlank = (v) =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

const hasNameWithoutValue = (row) => {
  for (let i = 1; i <= 3; i++) {
    const nameKey = `Option${i} Name`;
    const valueKey = `Option${i} Value`;
    const nameSet    = (nameKey in row) && !isBlank(row[nameKey]);
    const valueBlank = !(valueKey in row) || isBlank(row[valueKey]);
    if (nameSet && valueBlank) return true;
  }
  return false;
};

const norm = (s) =>
  (s ?? "")
    .toString()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const getIDFromRO = (raw) => {
  if (isBlank(raw)) return null;
  const s = raw.toString().trim();
  if (categoryMapROtoID.has(s)) return categoryMapROtoID.get(s);
  const sNorm = norm(s);
  for (const [ro, id] of categoryMapROtoID.entries()) {
    if (norm(ro) === sNorm) return id;
  }
  return null;
};

const isBreadcrumbString = (raw) => {
  if (isBlank(raw)) return false;
  const s = raw.toString().trim();
  if (breadcrumbToID.has(s)) return true;
  const sNorm = norm(s);
  for (const [crumb] of breadcrumbToID.entries()) {
    if (norm(crumb) === sNorm) return true;
  }
  return false;
};

/* Map Product Category -> Shopify Category ID */
const toShopifyCategoryID = (raw) => {
  if (isBlank(raw)) return { value: raw, wasID: false, mapped: false };

  const s = raw.toString().trim();

  // Already an ID?
  if (s.startsWith("gid://shopify/TaxonomyCategory/")) {
    return { value: s, wasID: true, mapped: false };
  }

  // RO label -> ID
  const idFromRO = getIDFromRO(s);
  if (idFromRO) return { value: idFromRO, wasID: false, mapped: true };

  // Breadcrumb -> ID
  if (breadcrumbToID.has(s)) return { value: breadcrumbToID.get(s), wasID: false, mapped: true };
  const sNorm = norm(s);
  for (const [crumb, id] of breadcrumbToID.entries()) {
    if (norm(crumb) === sNorm) return { value: id, wasID: false, mapped: true };
  }

  // Not mapped (and not an ID)
  return { value: raw, wasID: false, mapped: false };
};

/* Map Product Category -> breadcrumb string */
const toShopifyBreadcrumb = (raw) => {
  if (isBlank(raw)) return { value: raw, from: "blank", mapped: false };

  const s = raw.toString().trim();

  // Already breadcrumb?
  if (isBreadcrumbString(s)) {
    return { value: s, from: "breadcrumb", mapped: false };
  }

  // If it's already an ID: map ID -> breadcrumb (when known)
  if (s.startsWith("gid://shopify/TaxonomyCategory/")) {
    const crumb = idToBreadcrumb.get(s);
    return { value: crumb || s, from: "id", mapped: !!crumb };
  }

  // If it's a RO label: RO -> ID -> breadcrumb
  const idFromRO = getIDFromRO(s);
  if (idFromRO) {
    const crumb = idToBreadcrumb.get(idFromRO);
    return { value: crumb || s, from: "ro", mapped: !!crumb };
  }

  // If it's a breadcrumb variant (normalized) → find exact entry
  const sNorm = norm(s);
  for (const [crumb, id] of breadcrumbToID.entries()) {
    if (norm(crumb) === sNorm) return { value: crumb, from: "breadcrumb", mapped: true };
  }

  // Not mapped
  return { value: raw, from: "unknown", mapped: false };
};

/* ------------------ main ------------------ */
(async () => {
  if (!fs.existsSync(DIR)) {
    console.error(`Folder not found: ${DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".csv"));
  if (files.length === 0) {
    console.log("No CSV files found in", DIR);
    process.exit(0);
  }

  for (const file of files) {
    const full = path.join(DIR, file);
    const raw = fs.readFileSync(full, "utf8");

    const headerRow = parse(raw, { to_line: 1 })[0];
    const headerOrder = headerRow.map((h) => String(h));

    const rows = parse(raw, { columns: true, skip_empty_lines: false });

    let removedRows = 0;
    let mappedCount = 0;
    const unmapped = new Map(); // only track values that couldn't be mapped in chosen mode

    const cleaned = [];
    for (const r of rows) {
      if (hasNameWithoutValue(r)) {
        removedRows++;
        continue;
      }

      if ("Product Category" in r && !isBlank(r["Product Category"])) {
        if (MODE === "taxonomy") {
          const { value, wasID, mapped } = toShopifyCategoryID(r["Product Category"]);
          r["Product Category"] = value;
          if (mapped) mappedCount++;
          else if (!wasID) {
            const key = value?.toString() ?? "";
            unmapped.set(key, (unmapped.get(key) || 0) + 1);
          }
        } else { // MODE === "breadcrumbs"
          const { value, mapped } = toShopifyBreadcrumb(r["Product Category"]);
          r["Product Category"] = value;
          if (mapped) mappedCount++;
          else {
            const key = value?.toString() ?? "";
            unmapped.set(key, (unmapped.get(key) || 0) + 1);
          }
        }
      }

      cleaned.push(r);
    }

    const allKeys = Array.from(new Set([...headerOrder, ...cleaned.flatMap((r) => Object.keys(r))]));
    const csvOut = stringify(cleaned, { header: true, columns: allKeys });

    const suffix = MODE === "taxonomy" ? "_cleaned.csv" : "_crumbs.csv";
    const outPath = path.join(DIR, file.replace(/\.csv$/i, suffix));
    fs.writeFileSync(outPath, "\uFEFF" + csvOut, "utf8");

    console.log(
      `✔ ${file} → ${path.basename(outPath)} | removed rows (name w/o value): ${removedRows} | mapped (${MODE}): ${mappedCount}`
    );
    if (unmapped.size) {
      console.log(`  Unmapped values encountered in ${MODE} mode:`);
      for (const [val, cnt] of unmapped.entries()) {
        console.log(`   - "${val}" (${cnt} rows)`);
      }
    }
  }
})();
