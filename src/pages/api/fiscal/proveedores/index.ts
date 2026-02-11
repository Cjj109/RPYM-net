import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';
import { transformProveedor, type D1FiscalProveedor } from '../../../../lib/fiscal-types';

export const prerender = false;

// GET /api/fiscal/proveedores - List all suppliers
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const search = url.searchParams.get('search');
    const includeInactive = url.searchParams.get('all') === 'true';

    let query = `SELECT * FROM fiscal_proveedores WHERE 1=1`;
    const params: unknown[] = [];

    if (!includeInactive) {
      query += ` AND is_active = 1`;
    }

    if (search) {
      query += ` AND (nombre LIKE ? OR rif LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY nombre ASC`;

    const stmt = params.length > 0
      ? db.prepare(query).bind(...params)
      : db.prepare(query);
    const results = await stmt.all<D1FiscalProveedor>();

    return new Response(JSON.stringify({
      success: true,
      proveedores: results.results.map(transformProveedor),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error listing proveedores:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar proveedores' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// POST /api/fiscal/proveedores - Create new supplier
export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const body = await request.json();
    const { rif, nombre, direccion, telefono, email, retencionIvaPct, islrPct } = body;

    if (!rif || !nombre) {
      return new Response(JSON.stringify({ success: false, error: 'RIF y nombre son requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for duplicate RIF
    const existing = await db.prepare(
      'SELECT id FROM fiscal_proveedores WHERE rif = ?'
    ).bind(rif).first();

    if (existing) {
      return new Response(JSON.stringify({ success: false, error: 'Ya existe un proveedor con ese RIF' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await db.prepare(`
      INSERT INTO fiscal_proveedores (rif, nombre, direccion, telefono, email, retencion_iva_pct, islr_pct)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      rif.trim(),
      nombre.trim(),
      direccion?.trim() || null,
      telefono?.trim() || null,
      email?.trim() || null,
      retencionIvaPct || 75,
      islrPct || 1.0
    ).run();

    return new Response(JSON.stringify({
      success: true,
      id: result.meta.last_row_id,
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error creating proveedor:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al crear proveedor' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
