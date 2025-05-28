import { text } from '@sveltejs/kit';

const API_URL = 'https://conteb2b.com/api/v1/clients/list';
const TOKEN = process.env.API_KEY_CONTE;

const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`
};

const BODY = {
  page: 1,
  length: 1000,
  filters: {
    dateFrom: '2023-01-01',
    dateTo: '2025-12-31',
    status: null
  },
  sort: {
    field: 'createdAt',
    order: 'desc'
  }
};

export async function GET() {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(BODY)
    });

    const data = await res.json();
    const clients = data?.result?.items || [];

    const emails = clients
      .map((client) => client.email)
      .filter((email) => typeof email === 'string' && email.includes('@'));

    const csv = ['email', ...emails].join('\n');

    return text(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="client_emails.csv"'
      }
    });
  } catch (err) {
    console.error('❌ Error exporting emails:', err);
    return text('Error generating CSV', { status: 500 });
  }
}
