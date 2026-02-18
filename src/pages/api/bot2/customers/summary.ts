import type { APIRoute } from 'astro';
import { requireBot2Auth } from '../../../../lib/require-bot2-auth';

export const prerender = false;

/** Resumen de clientes con balances — read-only para Bot 2 */
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = requireBot2Auth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const search = url.searchParams.get('search');

    let query = `
      SELECT c.*,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='divisas' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='divisas' THEN t.amount_usd ELSE 0 END), 0) AS balance_divisas,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='dolar_bcv' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='dolar_bcv' THEN t.amount_usd ELSE 0 END), 0) AS balance_bcv,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='euro_bcv' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='euro_bcv' THEN t.amount_usd ELSE 0 END), 0) AS balance_euro,
        COUNT(CASE WHEN t.type='purchase' THEN 1 END) AS total_purchases,
        MAX(CASE WHEN t.type='purchase' THEN t.date END) AS last_purchase_date,
        MAX(CASE WHEN t.type='payment' THEN t.date END) AS last_payment_date
      FROM customers c
      LEFT JOIN customer_transactions t ON t.customer_id = c.id
      WHERE c.is_active = 1
    `;

    const params: unknown[] = [];
    if (search) {
      query += ` AND c.name LIKE ?`;
      params.push(`%${search}%`);
    }

    query += ` GROUP BY c.id ORDER BY c.name ASC`;

    const stmt = params.length > 0
      ? db.prepare(query).bind(...params)
      : db.prepare(query);

    const results = await stmt.all();

    return new Response(JSON.stringify({
      success: true,
      customers: results.results
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[Bot2 Customers] Error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar clientes' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
