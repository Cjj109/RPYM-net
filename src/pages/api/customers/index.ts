import type { APIRoute } from 'astro';
import { getD1 } from '../../../lib/d1-types';
import { validateSession, getSessionFromCookie } from '../../../lib/auth';
import type { D1CustomerWithBalance } from '../../../lib/customer-types';
import { transformCustomer } from '../../../lib/customer-types';

export const prerender = false;

// GET /api/customers - List all active customers with balances
export const GET: APIRoute = async ({ request, locals }) => {
  const db = getD1(locals);
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: 'Database no disponible' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  const sessionId = getSessionFromCookie(request.headers.get('Cookie'));
  if (!sessionId) {
    return new Response(JSON.stringify({ success: false, error: 'No autenticado' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }
  const user = await validateSession(db, sessionId);
  if (!user) {
    return new Response(JSON.stringify({ success: false, error: 'Sesion invalida' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const url = new URL(request.url);
    const search = url.searchParams.get('search');

    // Balance calculation:
    // - balance_divisas: pure divisas transactions only (frontend handles dual view toggle)
    // - balance_bcv: includes all dolar_bcv transactions (dual and non-dual)
    // - balance_euro: euro transactions
    let query = `
      SELECT c.*,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='divisas' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='divisas' THEN t.amount_usd ELSE 0 END), 0) AS balance_divisas,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='dolar_bcv' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='dolar_bcv' THEN t.amount_usd ELSE 0 END), 0) AS balance_bcv,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='euro_bcv' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='euro_bcv' THEN t.amount_usd ELSE 0 END), 0) AS balance_euro
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

    const results = await stmt.all<D1CustomerWithBalance>();

    return new Response(JSON.stringify({
      success: true,
      customers: results.results.map(transformCustomer)
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error listing customers:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar clientes' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};

// POST /api/customers - Create a new customer
export const POST: APIRoute = async ({ request, locals }) => {
  const db = getD1(locals);
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: 'Database no disponible' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  const sessionId = getSessionFromCookie(request.headers.get('Cookie'));
  if (!sessionId) {
    return new Response(JSON.stringify({ success: false, error: 'No autenticado' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }
  const user = await validateSession(db, sessionId);
  if (!user) {
    return new Response(JSON.stringify({ success: false, error: 'Sesion invalida' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    const { name, phone, notes, rateType, customRate } = body;

    if (!name || !name.trim()) {
      return new Response(JSON.stringify({ success: false, error: 'El nombre es requerido' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = await db.prepare(`
      INSERT INTO customers (name, phone, notes, rate_type, custom_rate)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      name.trim(),
      phone?.trim() || null,
      notes?.trim() || null,
      rateType || 'dolar_bcv',
      rateType === 'manual' ? (customRate || null) : null
    ).run();

    return new Response(JSON.stringify({
      success: true,
      id: result.meta.last_row_id
    }), {
      status: 201, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error creating customer:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al crear cliente' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
