// src/lib/server/trendyol.js

const TRENDYOL_USERNAME = process.env.TRENDYOL_USERNAME;
const TRENDYOL_PASSWORD = process.env.TRENDYOL_PASSWORD;
const TRENDYOL_SUPPLIER_ID = process.env.TRENDYOL_SUPPLIER_ID;
const TRENDYOL_API_BASE = 'https://api.trendyol.com/sapigw/suppliers';

export async function uploadToTrendyol(products = []) {
	const url = `${TRENDYOL_API_BASE}/${TRENDYOL_SUPPLIER_ID}/v2/products?username=${TRENDYOL_USERNAME}&password=${TRENDYOL_PASSWORD}`;

	const items = products.map((p) => ({
		barcode: p.sku || `WOO-${p.id}`,
		title: p.name,
		productMainId: p.sku || `WOO-${p.id}`,
		brandId: 123, // Replace with YOUR Trendyol brand ID
		categoryId: 9876, // Replace with your actual Trendyol category ID
		quantity: p.stock_quantity ?? 0,
		stockCode: p.sku || `WOO-${p.id}`,
		dimensionalWeight: 0.5,
		description: p.description?.replace(/<\/?[^>]+(>|$)/g, '') ?? '',
		currencyType: 'TRY',
		listPrice: parseFloat(p.regular_price ?? p.price ?? 0),
		salePrice: parseFloat(p.sale_price ?? p.price ?? 0),
		vatRate: 8,
		images: p.images?.map((img) => img.src) ?? [],
		attributes: [] // Optional: add if needed
	}));

	const payload = {
		items
	};

	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(payload)
	});

	const result = await res.json();

	if (!res.ok) {
		console.error('[Trendyol] Upload failed:', result);
		throw new Error('Trendyol upload error');
	}

	console.log(`[Trendyol] Uploaded ${items.length} products successfully`);
	return result;
}
