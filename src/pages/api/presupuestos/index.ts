import type { APIRoute } from 'astro';
import { getD1, type D1Presupuesto } from '../../../lib/d1-types';

export const prerender = false;

// Generate presupuesto ID: 5-digit number
function generatePresupuestoId(): string {
  const num = Math.floor(10000 + Math.random() * 90000);
  return String(num);
}

// Transform D1 row to API response format
function transformPresupuesto(row: D1Presupuesto) {
  return {
    id: row.id,
    fecha: row.fecha,
    items: JSON.parse(row.items),
    totalUSD: row.total_usd,
    totalBs: row.total_bs,
    totalUSDDivisa: row.total_usd_divisa,
    hideRate: row.hide_rate === 1,
    delivery: row.delivery || 0,
    modoPrecio: row.modo_precio || 'bcv',
    estado: row.estado,
    customerName: row.customer_name,
    customerAddress: row.customer_address,
    clientIP: row.client_ip,
    source: row.source,
    fechaPago: row.fecha_pago,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// GET: List presupuestos
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const db = getD1(locals);

    if (!db) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Base de datos no configurada',
        presupuestos: []
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search')?.trim();
    const limit = parseInt(url.searchParams.get('limit') || '100');

    // Build query with optional filters
    let conditions: string[] = [];
    let params: (string | number)[] = [];

    if (status && status !== 'all') {
      conditions.push('estado = ?');
      params.push(status);
    }

    if (search) {
      // Search by ID or customer name (case insensitive)
      conditions.push('(id LIKE ? OR customer_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    let query = 'SELECT * FROM presupuestos';
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const results = await db.prepare(query).bind(...params).all<D1Presupuesto>();

    // Get list of presupuesto IDs that are linked to customer transactions
    const linkedResult = await db.prepare(`
      SELECT DISTINCT presupuesto_id FROM customer_transactions WHERE presupuesto_id IS NOT NULL
    `).all<{ presupuesto_id: string }>();
    const linkedIds = new Set(linkedResult.results.map(r => r.presupuesto_id));

    const presupuestos = results.results.map(row => ({
      ...transformPresupuesto(row),
      isLinked: linkedIds.has(row.id)
    }));

    return new Response(JSON.stringify({
      success: true,
      presupuestos
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error listing presupuestos:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al listar presupuestos',
      presupuestos: []
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// POST: Create presupuesto
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const db = getD1(locals);

    if (!db) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Base de datos no configurada'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { items, totalUSD, totalBs, totalUSDDivisa, hideRate, delivery, modoPrecio, customerName, customerAddress, clientIP, status, source, customDate } = body;

    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Items son requeridos'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (typeof totalUSD !== 'number' || typeof totalBs !== 'number') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Totales invalidos'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const id = generatePresupuestoId();
    // Allow custom date for admin-created presupuestos (past purchases)
    const fecha = customDate ? `${customDate}T12:00:00.000Z` : new Date().toISOString();

    await db.prepare(`
      INSERT INTO presupuestos (id, fecha, items, total_usd, total_bs, total_usd_divisa, hide_rate, delivery, modo_precio, estado, customer_name, customer_address, client_ip, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      id,
      fecha,
      JSON.stringify(items),
      totalUSD,
      totalBs,
      totalUSDDivisa || null,
      hideRate ? 1 : 0,
      delivery || 0,
      modoPrecio || 'bcv',
      status || 'pendiente',
      customerName || null,
      customerAddress || null,
      clientIP || null,
      source || 'cliente'
    ).run();

    return new Response(JSON.stringify({
      success: true,
      id
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error creating presupuesto:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al crear presupuesto'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
