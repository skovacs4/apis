// src/routes/api/woocommerce/customers/+server.js
import { json } from '@sveltejs/kit';
import { Parser } from '@json2csv/plainjs';
import {
    WOO_BASE_URL_CONTE,
    WOO_CONSUMER_KEY_CONTE,
    WOO_CONSUMER_SECRET_CONTE
} from '$env/static/private';

const AUTH_HEADER = {
    Authorization: 'Basic ' + btoa(`${WOO_CONSUMER_KEY_CONTE}:${WOO_CONSUMER_SECRET_CONTE}`)
};

/* ---------- Helper: map Woo customer → Shopify Customer CSV row ---------- */
function mapWooToShopifyCustomerRow(c) {
    const billing = c.billing || {};
    const shipping = c.shipping || {};

    const address = {
        company: billing.company || shipping.company || '',
        address1: billing.address_1 || shipping.address_1 || '',
        address2: billing.address_2 || shipping.address_2 || '',
        city: billing.city || shipping.city || '',
        state: billing.state || shipping.state || '',
        country: billing.country || shipping.country || '',
        postcode: billing.postcode || shipping.postcode || '',
        phone: billing.phone || shipping.phone || ''
    };

    const acceptsEmailMarketing = 'no';
    const acceptsSMSMarketing = 'no';
    const taxExempt = 'no';

    return {
        'First Name': c.first_name || billing.first_name || shipping.first_name || '',
        'Last Name': c.last_name || billing.last_name || shipping.last_name || '',
        'Email': (c.email || '').toLowerCase(),
        'Accepts Email Marketing': acceptsEmailMarketing,
        'Default Address Company': address.company,
        'Default Address Address1': address.address1,
        'Default Address Address2': address.address2,
        'Default Address City': address.city,
        'Default Address Province Code': address.state,
        'Default Address Country Code': address.country,
        'Default Address Zip': address.postcode,
        'Default Address Phone': address.phone,
        'Phone': c.billing?.phone || '',
        'Accepts SMS Marketing': acceptsSMSMarketing,
        'Tags': '',
        'Note': '',
        'Tax Exempt': taxExempt
    };
}

/* ---------- GET: fetch Woo customers and export CSV ---------- */
export async function GET({ url }) {
    try {
        const exportCSV = url.searchParams.get('csv') === '1';
        const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('per_page') || 100)));
        const activeOnly = (url.searchParams.get('active') ?? '1') === '1';
        let page = Number(url.searchParams.get('page') || 1);

        console.log(`[Woo Customers Export] Start | per_page=${perPage} | activeOnly=${activeOnly} | startPage=${page}`);

        const fields = [
            'First Name', 'Last Name', 'Email', 'Accepts Email Marketing',
            'Default Address Company', 'Default Address Address1', 'Default Address Address2',
            'Default Address City', 'Default Address Province Code', 'Default Address Country Code',
            'Default Address Zip', 'Default Address Phone', 'Phone', 'Accepts SMS Marketing',
            'Tags', 'Note', 'Tax Exempt'
        ];
        const parser = new Parser({ fields });

        let hasMore = true;
        const rows = [];
        let totalCustomers = 0;
        let included = 0;

        while (hasMore) {
            console.log(`[Woo Customers Export] Fetching customers page ${page}...`);
            const api = `${WOO_BASE_URL_CONTE}/wp-json/wc/v3/customers?per_page=${perPage}&page=${page}&role=customer&orderby=id&order=asc`;
            const res = await fetch(api, { headers: AUTH_HEADER });
            if (!res.ok) throw new Error(`Failed to fetch customers page ${page}`);
            const customers = await res.json();

            console.log(`[Woo Customers Export] Page ${page}: ${customers.length} customers`);
            totalCustomers += customers.length;

            for (const c of customers) {
                const isActive = (Number(c.orders_count) || 0) > 0 || Boolean(c.is_paying_customer);
                if (activeOnly && !isActive) {
                    console.log(`[Woo Customers Export] Skipping inactive customer id=${c.id} email=${c.email}`);
                    continue;
                }

                if (!c.email) {
                    console.log(`[Woo Customers Export] Skipping customer id=${c.id} (no email)`);
                    continue;
                }

                rows.push(mapWooToShopifyCustomerRow(c));
                included++;
            }

            hasMore = customers.length === perPage;
            page += 1;
        }

        console.log(`[Woo Customers Export] Done. Total scanned: ${totalCustomers}, Exported: ${included}`);

        const csv = parser.parse(rows);

        if (exportCSV) {
            console.log(`[Woo Customers Export] Returning CSV file with ${included} rows`);
            return new Response(csv, {
                status: 200,
                headers: {
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename=woocommerce_customers_${activeOnly ? 'active_' : ''}export.csv`
                }
            });
        }

        return json({
            success: true,
            message: `Prepared ${included} customer rows${activeOnly ? ' (active only)' : ''}.`,
            total_customers_scanned: totalCustomers,
            exported_rows: included,
            per_page: perPage,
            active_only: activeOnly
        });
    } catch (err) {
        console.error('[Woo Customers Export] ERROR:', err);
        return json({ success: false, error: err.message }, { status: 500 });
    }
}
