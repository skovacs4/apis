// src/routes/api/woocommerce/products/+server.js
import { json } from '@sveltejs/kit';
import { Parser } from '@json2csv/plainjs';
import JSZip from 'jszip';
import {
  WOO_BASE_URL_CONTE,
  WOO_CONSUMER_KEY_CONTE,
  WOO_CONSUMER_SECRET_CONTE
} from '$env/static/private';

const AUTH_HEADER = {
  Authorization: 'Basic ' + btoa(`${WOO_CONSUMER_KEY_CONTE}:${WOO_CONSUMER_SECRET_CONTE}`)
};

/* ---------- Option helpers ---------- */

// Keep original Woo attribute label; normalize only common aliases if you want
const normalizeOptName = (n = '') => {
  // If you want to preserve Woo labels exactly, just: return n || '';
  // If you prefer canonical names, uncomment below:
  const lower = (n || '').toLowerCase();
  if (lower.includes('color') || lower.includes('culoare')) return 'Color';
  if (lower.includes('size') || lower.includes('marime') || lower.includes('mărime')) return 'Size';
  return n || '';
};

/**
 * Build option names **from variations**:
 *  - Look through all variations’ attributes
 *  - Keep attributes that have ANY non-empty value across variants
 *  - Preserve first-seen order, max 3
 */
function buildOptionNamesFromVariations(variations) {
  const order = [];
  const hasValue = new Map(); // normalizedName -> boolean

  for (const v of variations) {
    for (const a of (v.attributes || [])) {
      const rawName = a?.name || '';
      const n = normalizeOptName(rawName);
      if (!n) continue;
      if (!order.includes(n)) order.push(n);
      const val = (a?.option ?? '').toString().trim();
      if (val) hasValue.set(n, true);
    }
  }

  const names = [];
  for (const n of order) {
    if (hasValue.get(n)) names.push(n);
    if (names.length === 3) break;
  }

  // pad to 3
  while (names.length < 3) names.push('');
  return names; // [opt1, opt2, opt3]
}

/** Values for a variation in the same order as optionNames */
function getVariationOptionValues(variation, optionNames) {
  const attrs = variation?.attributes || [];
  const map = new Map(
    attrs.map(a => [normalizeOptName(a?.name || ''), (a?.option ?? '').toString()])
  );
  return optionNames.map(n => (n ? (map.get(n) || '') : ''));
}

/* ---------- Map Woo → Shopify CSV row ---------- */
function mapToShopifyRow(product, variation = null, optionNames = ['', '', '']) {
  const base = variation ?? product;

  // Basics
  const handle = product.slug || String(product.id);
  const title = product.name || '';
  const bodyHTML = product.description || '';
  const firstCat = product.categories?.[0]?.name || '';
  const type = product.type || '';
  const tags = (product.tags || []).map(t => t.name).join(', ');
  const published = product.status === 'publish' ? 'TRUE' : 'FALSE';

  // Parent image (used only on the parent row)
  const parentImage = product.images?.[0] || {};
  const parentImageSrc = parentImage?.src || '';
  const parentImageAlt = parentImage?.alt || parentImage?.name || '';

  // Weight (g)
  const weightNumber = Number(base.weight);
  const grams = Number.isFinite(weightNumber) ? Math.round(weightNumber * 1000) : 0;

  // Prices
  const price = (base.price ?? base.sale_price ?? base.regular_price ?? '').toString();
  const compareAt = (base.regular_price ?? '').toString();

  // Inventory & flags
  const stockQty = Number.isFinite(Number(base.stock_quantity)) ? Number(base.stock_quantity) : 0;
  const invPolicy = base.backorders && base.backorders !== 'no' ? 'continue' : 'deny';
  const requiresShipping = base.virtual === true ? 'FALSE' : 'TRUE';
  const taxable = (base.tax_status || 'taxable') === 'taxable' ? 'TRUE' : 'FALSE';

  // Barcode from meta_data if present
  const metaBarcode =
    base.meta_data?.find(m => ['_ean', '_gtin', '_barcode'].includes(m?.key))?.value || '';

  // Options
  let [opt1, opt2, opt3] = optionNames;
  let [val1, val2, val3] = ['', '', ''];

  if (variation) {
    [val1, val2, val3] = getVariationOptionValues(variation, optionNames);
  } else {
    if (product.type === 'simple' || optionNames.every(n => !n)) {
      opt1 = 'Title';
      val1 = 'Default Title';
      opt2 = '';
      opt3 = '';
    }
  }

  // Variant image (Woo → Shopify)
  const variantImageSrc = variation?.image?.src || '';

  // IMPORTANT:
  // - Parent row: set Image Src/Image Position/Alt; Variant Image empty
  // - Variant rows: DO NOT set Image Src/Position/Alt; set Variant Image
  const isVariant = !!variation;

  return {
    Handle: handle,
    Title: title,
    'Body (HTML)': bodyHTML,
    Vendor: '',
    'Product Category': firstCat,
    Type: type,
    Tags: tags,
    Published: published,

    'Option1 Name': opt1, 'Option1 Value': val1,
    'Option2 Name': opt2, 'Option2 Value': val2,
    'Option3 Name': opt3, 'Option3 Value': val3,

    'Variant SKU': (base.sku || '').toString(),
    'Variant Grams': grams,
    'Variant Inventory Tracker': '',
    'Variant Inventory Qty': stockQty,
    'Variant Inventory Policy': invPolicy,
    'Variant Fulfillment Service': 'manual',
    'Variant Price': price,
    'Variant Compare At Price': compareAt,
    'Variant Requires Shipping': requiresShipping,
    'Variant Taxable': taxable,
    'Variant Barcode': metaBarcode,

    // Parent image only:
    'Image Src': isVariant ? '' : parentImageSrc,
    'Image Position': isVariant ? '' : (parentImageSrc ? 1 : ''),
    'Image Alt Text': isVariant ? '' : parentImageAlt,

    'Gift Card': 'FALSE',
    'SEO Title': '',
    'SEO Description': '',

    'Google Shopping / Google Product Category': '',
    'Google Shopping / Gender': '',
    'Google Shopping / Age Group': '',
    'Google Shopping / MPN': '',
    'Google Shopping / Condition': 'new',
    'Google Shopping / Custom Product': 'TRUE',

    // Variant image only:
    'Variant Image': isVariant ? (variantImageSrc || '') : '',

    'Variant Weight Unit': 'g',
    'Variant Tax Code': '',
    'Cost per item': '',

    'Included / United States': 'TRUE',
    'Price / United States': '',
    'Compare At Price / United States': '',
    'Included / International': 'TRUE',
    'Price / International': '',
    'Compare At Price / International': '',

    Status: product.status === 'publish' ? 'active' : 'draft'
  };
}

// Add this helper above GET()
function hasNameWithoutValue(row) {
  for (let i = 1; i <= 3; i++) {
    const nameKey = `Option${i} Name`;
    const valueKey = `Option${i} Value`;
    const nameSet = !!(row[nameKey] && String(row[nameKey]).trim());
    const valueBlank = !(row[valueKey] && String(row[valueKey]).trim());
    if (nameSet && valueBlank) return true;
  }
  return false;
}

/* ---------- GET handler: fetch all products, batch into CSVs, ZIP ---------- */
export async function GET({ url }) {
  try {
    const exportCSV = url.searchParams.get('csv') === '1';
    const batchSize = Math.max(1, Number(url.searchParams.get('batch') || 2000)); // rows/CSV
    const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('per_page') || 100))); // Woo max 100
    const categorySlug = url.searchParams.get('category') || '';
    const status = (url.searchParams.get('status') || 'publish').toLowerCase(); // 'publish' | 'any' | 'draft'...
    const onlyOneVariable = url.searchParams.get('only_one') === '1';            // NEW

    console.log(`[Woo Export] Start | per_page=${perPage} | batch=${batchSize} | status=${status} | category=${categorySlug || '(all)'} | only_one=${onlyOneVariable}`);

    // Resolve category → ID (optional)
    let categoryId = '';
    if (categorySlug) {
      console.log(`[Woo Export] Resolving category slug: ${categorySlug}`);
      const cr = await fetch(
        `${WOO_BASE_URL_CONTE}/wp-json/wc/v3/products/categories?slug=${encodeURIComponent(categorySlug)}`,
        { headers: AUTH_HEADER }
      );
      if (cr.ok) {
        const cats = await cr.json();
        if (cats?.[0]?.id) {
          categoryId = String(cats[0].id);
          console.log(`[Woo Export] Category ID: ${categoryId}`);
        } else {
          console.log('[Woo Export] No category found for slug.');
        }
      } else {
        console.log('[Woo Export] Category resolve request failed.');
      }
    }

    // CSV fields (stable order)
    const fields = [
      'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Product Category', 'Type', 'Tags', 'Published',
      'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
      'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker', 'Variant Inventory Qty', 'Variant Inventory Policy',
      'Variant Fulfillment Service', 'Variant Price', 'Variant Compare At Price', 'Variant Requires Shipping',
      'Variant Taxable', 'Variant Barcode', 'Image Src', 'Image Position', 'Image Alt Text', 'Gift Card',
      'SEO Title', 'SEO Description', 'Google Shopping / Google Product Category', 'Google Shopping / Gender',
      'Google Shopping / Age Group', 'Google Shopping / MPN', 'Google Shopping / Condition',
      'Google Shopping / Custom Product', 'Variant Image', 'Variant Weight Unit', 'Variant Tax Code',
      'Cost per item', 'Included / United States', 'Price / United States', 'Compare At Price / United States',
      'Included / International', 'Price / International', 'Compare At Price / International', 'Status'
    ];
    const parser = new Parser({ fields });
    const zip = new JSZip();

    let page = Number(url.searchParams.get('page') || 1); // optional start page
    let hasMore = true;
    let rows = [];
    let csvCount = 0;
    let totalRows = 0;
    let exportedOne = false; // NEW

    while (hasMore && !exportedOne) {
      console.log(`[Woo Export] Fetching products page ${page}...`);
      let api = `${WOO_BASE_URL_CONTE}/wp-json/wc/v3/products?per_page=${perPage}&page=${page}&status=${encodeURIComponent(status)}`;
      if (categoryId) api += `&category=${categoryId}`;

      const res = await fetch(api, { headers: AUTH_HEADER });
      if (!res.ok) throw new Error(`Failed to fetch products page ${page}`);
      const products = await res.json();

      console.log(`[Woo Export] Page ${page}: ${products.length} products`);
      if (!products.length) break;

      for (const p of products) {
        // If we only want one variable product, skip non-variable items
        if (onlyOneVariable && p.type !== 'variable') continue;

        // VARIABLE products: fetch variations first to compute **real** option names
        let variations = [];
        let optionNames = ['', '', ''];

        if (p.type === 'variable') {
          const vres = await fetch(
            `${WOO_BASE_URL_CONTE}/wp-json/wc/v3/products/${p.id}/variations?per_page=100`,
            { headers: AUTH_HEADER }
          );
          if (vres.ok) {
            variations = await vres.json();
            optionNames = buildOptionNamesFromVariations(variations);
            console.log(`[Woo Export] Product ${p.id}: variations=${variations.length} | optionNames=${JSON.stringify(optionNames)}`);
          } else {
            console.log(`[Woo Export] Variations fetch failed for product ${p.id}`);
          }
        }

        // PARENT row (with option names)
        rows.push(mapToShopifyRow(p, null, optionNames));
        totalRows++;

        // VARIANT rows
        for (const v of variations) {
          // console.log('[VARIANT IMG]', {
          //   product_id: p.id,
          //   sku: v?.sku,
          //   image: v?.image?.src || '(none)'
          // });
          const variantRow = mapToShopifyRow(p, v, optionNames);

          // Skip variants that have an option label but no value
          if (hasNameWithoutValue(variantRow)) {
            console.log(`[Woo Export] Skipping variant (name without value) | product=${p.id} sku=${v?.sku || '(no-sku)'}`);
            continue;
          }

          rows.push(mapToShopifyRow(p, v, optionNames));
          totalRows++;

          if (rows.length >= batchSize) {
            const csv = parser.parse(rows);
            csvCount++;
            const filename = `woocommerce_products_${csvCount}.csv`;
            zip.file(filename, csv);
            console.log(`[Woo Export] Saved ${filename} with ${rows.length} rows`);
            rows = [];
          }
        }

        // If we only wanted one variable product, stop after the first we processed
        if (onlyOneVariable) {
          exportedOne = true;
          break;
        }

        // Flush batch in case of simple products
        if (rows.length >= batchSize) {
          const csv = parser.parse(rows);
          csvCount++;
          const filename = `woocommerce_products_${csvCount}.csv`;
          zip.file(filename, csv);
          console.log(`[Woo Export] Saved ${filename} with ${rows.length} rows`);
          rows = [];
        }
      }

      hasMore = products.length === perPage && !exportedOne;
      page += 1;
    }

    // Save the remaining rows (last partial batch)
    if (rows.length > 0) {
      const csv = parser.parse(rows);
      csvCount++;
      const filename = `woocommerce_products_${csvCount}.csv`;
      zip.file(filename, csv);
      console.log(`[Woo Export] Saved ${filename} with ${rows.length} rows`);
    }

    console.log(`[Woo Export] Done. Total rows: ${totalRows}. CSV files: ${csvCount}`);

    if (exportCSV) {
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      return new Response(zipBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename=woocommerce_products_batches.zip'
        }
      });
    }

    return json({
      success: true,
      message: exportedOne
        ? 'Exported the first variable product only'
        : 'Batches prepared in ZIP',
      total_rows: totalRows,
      csv_files: csvCount,
      per_page: perPage,
      batch: batchSize,
      status,
      category: categorySlug || null,
      only_one: onlyOneVariable
    });
  } catch (err) {
    console.error('[Woo Export] ERROR:', err);
    return json({ success: false, error: err.message }, { status: 500 });
  }
}
