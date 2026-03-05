import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';
import { transformPagoProveedor, type D1PagoProveedorWithNombre } from '../../../lib/pagos-proveedores-types';

export const prerender = false;

// GET /api/pagos-proveedores - List payments with filters
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const mes = url.searchParams.get('mes'); // YYYY-MM
    const proveedorId = url.searchParams.get('proveedor_id');
    const cuenta = url.searchParams.get('cuenta');
    const search = url.searchParams.get('search');

    let query = `
      SELECT p.*, pi.nombre as proveedor_nombre
      FROM pagos_proveedores p
      JOIN proveedores_informales pi ON p.proveedor_id = pi.id
      WHERE p.is_active = 1
    `;
    const params: unknown[] = [];

    if (mes) {
      query += ` AND p.fecha LIKE ?`;
      params.push(`${mes}%`);
    }

    if (proveedorId) {
      query += ` AND p.proveedor_id = ?`;
      params.push(Number(proveedorId));
    }

    if (cuenta) {
      query += ` AND p.cuenta = ?`;
      params.push(cuenta);
    }

    if (search) {
      query += ` AND p.producto LIKE ?`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY p.fecha DESC, p.created_at DESC`;

    const stmt = params.length > 0
      ? db.prepare(query).bind(...params)
      : db.prepare(query);
    const results = await stmt.all<D1PagoProveedorWithNombre>();

    return new Response(JSON.stringify({
      success: true,
      pagos: results.results.map(transformPagoProveedor),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error listing pagos proveedores:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar pagos' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// POST /api/pagos-proveedores - Create payment
export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const body = await request.json();
    const { proveedorId, montoUsd, producto, fecha, metodoPago, cuenta, notas, montoBs, tasaCambio, tasaParalela } = body;

    if (!proveedorId || !montoUsd || !producto?.trim() || !fecha) {
      return new Response(JSON.stringify({ success: false, error: 'Proveedor, monto, producto y fecha son requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await db.prepare(`
      INSERT INTO pagos_proveedores (proveedor_id, monto_usd, monto_bs, tasa_cambio, tasa_paralela, producto, fecha, metodo_pago, cuenta, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      Number(proveedorId),
      Number(montoUsd),
      montoBs ? Number(montoBs) : null,
      tasaCambio ? Number(tasaCambio) : null,
      tasaParalela ? Number(tasaParalela) : null,
      producto.trim(),
      fecha,
      metodoPago || 'pago_movil',
      cuenta || 'pa',
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
    console.error('Error creating pago proveedor:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al registrar pago' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
