import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';
import { transformProveedorInformal, type D1ProveedorInformal } from '../../../../lib/pagos-proveedores-types';

export const prerender = false;

// GET /api/pagos-proveedores/proveedores - List informal suppliers
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const search = url.searchParams.get('search');

    let query = `SELECT * FROM proveedores_informales WHERE is_active = 1`;
    const params: unknown[] = [];

    if (search) {
      query += ` AND nombre LIKE ?`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY nombre ASC`;

    const stmt = params.length > 0
      ? db.prepare(query).bind(...params)
      : db.prepare(query);
    const results = await stmt.all<D1ProveedorInformal>();

    return new Response(JSON.stringify({
      success: true,
      proveedores: results.results.map(transformProveedorInformal),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error listing proveedores informales:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar proveedores' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// POST /api/pagos-proveedores/proveedores - Create informal supplier
export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const body = await request.json();
    const { nombre, notas } = body;

    if (!nombre?.trim()) {
      return new Response(JSON.stringify({ success: false, error: 'El nombre es requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await db.prepare(`
      INSERT INTO proveedores_informales (nombre, notas)
      VALUES (?, ?)
    `).bind(
      nombre.trim(),
      notas?.trim() || null
    ).run();

    return new Response(JSON.stringify({
      success: true,
      id: result.meta.last_row_id,
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error creating proveedor informal:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al crear proveedor' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
