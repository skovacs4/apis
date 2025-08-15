import {
    MERCHANTPRO_API_USER,
    MERCHANTPRO_API_PASS,
    MERCHANTPRO_API_URL
} from '$env/static/private';

export async function uploadToMerchantPro(products = []) {
    const MERCHANTPRO_CATEGORY_ID = 208;

    if (!MERCHANTPRO_API_USER || !MERCHANTPRO_API_PASS) {
        throw new Error('Missing MerchantPro credentials in environment variables');
    }

    const authString = Buffer.from(`${MERCHANTPRO_API_USER}:${MERCHANTPRO_API_PASS}`).toString('base64');

    let successCount = 0;
    let failCount = 0;

    for (const product of products) {
        try {
            const hasVariations = Array.isArray(product.variations) && product.variations.length > 0;

            // --- Build base payload
            const payload = {
                type: hasVariations ? 'multi_variant' : 'basic',
                sku: product.sku || String(product.id),
                name: product.name,
                description: (product.description || '').replace(/<\/?[^>]+(>|$)/g, ''),
                category_id: MERCHANTPRO_CATEGORY_ID,
                images: (product.images ?? [])
                    .map((img) => {
                        const url = (img?.url || img?.src || '').trim();
                        if (!url || !/^https?:\/\//i.test(url)) return null;
                        const caption = (img?.caption || img?.alt || img?.name || '').trim();
                        return { url, caption };
                    })
                    .filter(Boolean),
                variants: []
            };

            // For BASIC products only, keep price/stock at parent level
            if (!hasVariations) {
                payload.stock = toInt(product.stock_quantity, 0);
                payload.price_gross = toPrice(product.price ?? product.regular_price, 0);
            }

            // --- MULTI-VARIANT: build variant_attributes + variants
            if (hasVariations) {
                // 1) Pre-compute variant_attributes (names + allowed values)
                // Use product.attributes (preferred) then fill from actual variations.
                const attrMap = new Map(); // name -> Set(values)

                // From parent product.attributes (if present)
                if (Array.isArray(product.attributes)) {
                    for (const a of product.attributes) {
                        const name = cleanName(a?.name);
                        const options = Array.isArray(a?.options) ? a.options : [];
                        if (!name) continue;
                        const set = attrMap.get(name) || new Set();
                        for (const v of options) {
                            const val = cleanValue(v);
                            if (val) set.add(val);
                        }
                        attrMap.set(name, set);
                    }
                }

                // 2) Build variants
                const usedSkus = new Set();
                for (const variationId of product.variations) {
                    const variationRes = await fetch(
                        `${product._base_url}/wp-json/wc/v3/products/${product.id}/variations/${variationId}`,
                        {
                            headers: {
                                Authorization: 'Basic ' + btoa(`${product._ck}:${product._cs}`)
                            }
                        }
                    );

                    if (!variationRes.ok) {
                        console.warn(`[Woo WARNING] Failed to fetch variation ${variationId} for product ${product.name}`);
                        continue;
                    }

                    const variation = await variationRes.json();

                    // Build clean variant options
                    const variant_options = (variation.attributes || [])
                        .map((attr) => {
                            const name = cleanName(attr?.name);
                            const value = cleanValue(attr?.option);
                            if (!name || !value) return null;
                            // collect into attrMap to keep attributes/options consistent with variants
                            const set = attrMap.get(name) || new Set();
                            set.add(value);
                            attrMap.set(name, set);
                            return { name, value };
                        })
                        .filter(Boolean);

                    // Validate required fields for variant
                    const vSku = (variation.sku || `var-${variation.id}`).trim();
                    const vName = (variation.name || makeVariantName(variant_options)).trim();
                    const vPrice = toPrice(variation.price ?? variation.regular_price, null);
                    const vStock = toInt(variation.stock_quantity, 0);

                    if (!vSku || usedSkus.has(vSku)) {
                        console.warn(`[MerchantPro] Skipping variant with missing/duplicate SKU for product "${product.name}" (got: "${vSku}")`);
                        continue;
                    }
                    if (!Array.isArray(variant_options) || variant_options.length === 0) {
                        console.warn(`[MerchantPro] Skipping variant without options for product "${product.name}" (sku: "${vSku}")`);
                        continue;
                    }
                    if (vPrice === null) {
                        console.warn(`[MerchantPro] Skipping variant without valid price for product "${product.name}" (sku: "${vSku}")`);
                        continue;
                    }

                    payload.variants.push({
                        sku: vSku,
                        name: vName,
                        stock: vStock,
                        price_gross: vPrice,
                        // IMPORTANT: only {name, value} allowed; do NOT include ids or images
                        variant_options
                    });

                    usedSkus.add(vSku);
                }

                // If all variants were invalid, bail early
                if (payload.variants.length === 0) {
                    console.warn(`[MerchantPro] No valid variants built for "${product.name}". Sending as basic product instead.`);
                    // Fallback to basic product with parent price/stock
                    payload.type = 'basic';
                    payload.stock = toInt(product.stock_quantity, 0);
                    payload.price_gross = toPrice(product.price ?? product.regular_price, 0);
                } else {
                    // Declare variant_attributes to match variant_options
                    payload.variant_attributes = [...attrMap.entries()].map(([name, set]) => ({
                        name,
                        options: [...set].map((value) => ({ value }))
                    }));
                }
            }

            console.log(`[MerchantPro DEBUG] Payload for "${product.name}": ${JSON.stringify(payload, null, 2)}`);

            // --- Send to MerchantPro
            const response = await fetch(MERCHANTPRO_API_URL, {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${authString}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const resultText = await response.text();
            if (!response.ok) {
                console.error(`[MerchantPro] ❌ Failed to upload ${product.name} | Status: ${response.status}`);
                console.error(`[MerchantPro] ❌ Response: ${resultText}`);
                failCount++;
            } else {
                console.log(`[MerchantPro] ✅ Uploaded product: ${product.name}`);
                successCount++;
            }
        } catch (err) {
            console.error(`[MerchantPro] ❌ Error processing ${product.name}:`, err);
            failCount++;
        }
    }

    return { uploaded: successCount, failed: failCount };
}

/* ---------------- Utils ---------------- */

function toPrice(input, fallback) {
    if (input === null || input === undefined || input === '') return fallback;
    const n = Number(input);
    if (!Number.isFinite(n) || n < 0) return fallback;
    // MerchantPro expects a numeric gross price; keep decimals if present
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toInt(input, fallback) {
    const n = Number(input);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.trunc(n));
}

function cleanName(s) {
    return (s || '').toString().trim();
}
function cleanValue(s) {
    return (s || '').toString().trim();
}

function makeVariantName(options = []) {
    // Fallback variant name like "Alb, 80B-C-D/L"
    return options.map(o => o?.value).filter(Boolean).join(', ');
}
