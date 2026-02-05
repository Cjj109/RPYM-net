import type { APIRoute } from 'astro';
import { getD1 } from '../../../lib/d1-types';
import { validateSession, getSessionFromCookie } from '../../../lib/auth';
import type { D1CustomerWithBalance } from '../../../lib/customer-types';
import { transformCustomer } from '../../../lib/customer-types';

export const prerender = false;

// GET /api/customers/:id - Get single customer with balance
export const GET: APIRoute = async ({ params, request, locals }) => {
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
    const customerId = params.id;

    const row = await db.prepare(`
      SELECT c.*,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='divisas' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='divisas' THEN t.amount_usd ELSE 0 END), 0) AS balance_divisas,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='dolar_bcv' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='dolar_bcv' THEN t.amount_usd ELSE 0 END), 0) AS balance_bcv,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='euro_bcv' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='euro_bcv' THEN t.amount_usd ELSE 0 END), 0) AS balance_euro
      FROM customers c
      LEFT JOIN customer_transactions t ON t.customer_id = c.id
      WHERE c.id = ?
      GROUP BY c.id
    `).bind(customerId).first<D1CustomerWithBalance>();

    if (!row) {
      return new Response(JSON.stringify({ success: false, error: 'Cliente no encontrado' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      customer: transformCustomer(row)
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error getting customer:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar cliente' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};

// PUT /api/customers/:id - Update customer
export const PUT: APIRoute = async ({ params, request, locals }) => {
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
    const customerId = params.id;
    const body = await request.json();
    const { name, phone, notes, rateType, customRate, isActive } = body;

    if (name !== undefined && !name.trim()) {
      return new Response(JSON.stringify({ success: false, error: 'El nombre no puede estar vacio' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Build dynamic update
    const fields: string[] = [];
    const values: unknown[] = [];

    if (name !== undefined) { fields.push('name = ?'); values.push(name.trim()); }
    if (phone !== undefined) { fields.push('phone = ?'); values.push(phone?.trim() || null); }
    if (notes !== undefined) { fields.push('notes = ?'); values.push(notes?.trim() || null); }
    if (rateType !== undefined) { fields.push('rate_type = ?'); values.push(rateType); }
    if (customRate !== undefined) { fields.push('custom_rate = ?'); values.push(customRate); }
    if (isActive !== undefined) { fields.push('is_active = ?'); values.push(isActive ? 1 : 0); }

    if (fields.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No hay campos para actualizar' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    fields.push("updated_at = datetime('now')");
    values.push(customerId);

    await db.prepare(`
      UPDATE customers SET ${fields.join(', ')} WHERE id = ?
    `).bind(...values).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating customer:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al actualizar cliente' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};

// DELETE /api/customers/:id - Soft delete customer
export const DELETE: APIRoute = async ({ params, request, locals }) => {
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
    const customerId = params.id;

    await db.prepare(`
      UPDATE customers SET is_active = 0, updated_at = datetime('now') WHERE id = ?
    `).bind(customerId).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error deleting customer:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al eliminar cliente' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
