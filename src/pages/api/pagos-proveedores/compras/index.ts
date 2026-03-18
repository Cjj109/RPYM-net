import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';
import type { D1CompraProveedorWithNombre, D1AbonoProveedor } from '../../../../lib/pagos-proveedores-types';
import { transformCompraProveedor } from '../../../../lib/pagos-proveedores-types';

export const prerender = false;

// GET /api/pagos-proveedores/compras - List purchases with filters
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const mes = url.searchParams.get('mes');
    const proveedorId = url.searchParams.get('proveedor_id');
    const cuenta = url.searchParams.get('cuenta');
    const factura = url.searchParams.get('factura');
    const search = url.searchParams.get('search');
    const estado = url.searchParams.get('estado'); // pendiente | pagada
    const modoPrecio = url.searchParams.get('modo_precio');

    let query = `
      SELECT c.*, pi.nombre as proveedor_nombre,
        COALESCE((SELECT SUM(a.monto_usd) FROM abonos_proveedores a WHERE a.compra_id = c.id AND a.is_active = 1), 0) as total_abonado
      FROM compras_proveedores c
      JOIN proveedores_informales pi ON c.proveedor_id = pi.id
      WHERE c.is_active = 1
    `;
    const params: unknown[] = [];

    if (mes) {
      query += ` AND c.fecha LIKE ?`;
      params.push(`${mes}%`);
    }

    if (proveedorId) {
      query += ` AND c.proveedor_id = ?`;
      params.push(Number(proveedorId));
    }

    if (cuenta) {
      query += ` AND c.id IN (SELECT compra_id FROM abonos_proveedores WHERE cuenta = ? AND is_active = 1)`;
      params.push(cuenta);
    }

    if (factura === '1' || factura === '0') {
      query += ` AND c.tiene_factura = ?`;
      params.push(Number(factura));
    }

    if (search) {
      query += ` AND (c.producto LIKE ? OR pi.nombre LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    if (modoPrecio) {
      query += ` AND c.modo_precio = ?`;
      params.push(modoPrecio);
    }

    if (estado === 'pendiente') {
      query += ` AND COALESCE((SELECT SUM(a.monto_usd) FROM abonos_proveedores a WHERE a.compra_id = c.id AND a.is_active = 1), 0) < c.monto_total`;
    } else if (estado === 'pagada') {
      query += ` AND COALESCE((SELECT SUM(a.monto_usd) FROM abonos_proveedores a WHERE a.compra_id = c.id AND a.is_active = 1), 0) >= c.monto_total`;
    }

    query += ` ORDER BY c.fecha DESC, c.created_at DESC`;

    const stmt = params.length > 0
      ? db.prepare(query).bind(...params)
      : db.prepare(query);
    const comprasResult = await stmt.all<D1CompraProveedorWithNombre>();

    // Fetch abonos for all compras in batch
    const compraIds = comprasResult.results.map(c => c.id);
    let abonosByCompra: Record<number, D1AbonoProveedor[]> = {};

    if (compraIds.length > 0) {
      const placeholders = compraIds.map(() => '?').join(',');
      const abonosResult = await db.prepare(
        `SELECT * FROM abonos_proveedores WHERE compra_id IN (${placeholders}) AND is_active = 1 ORDER BY fecha DESC, created_at DESC`
      ).bind(...compraIds).all<D1AbonoProveedor>();

      for (const abono of abonosResult.results) {
        if (!abonosByCompra[abono.compra_id]) abonosByCompra[abono.compra_id] = [];
        abonosByCompra[abono.compra_id].push(abono);
      }
    }

    const compras = comprasResult.results.map(row =>
      transformCompraProveedor(row, abonosByCompra[row.id] || [])
    );

    return new Response(JSON.stringify({ success: true, compras }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error listing compras:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar compras' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// POST /api/pagos-proveedores/compras - Create purchase
export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const body = await request.json();
    const { proveedorId, producto, montoTotal, montoTotalBs, tasaReferencia, modoPrecio, fecha, tieneFactura, notas } = body;

    const modo = modoPrecio || 'bcv';

    // For Bs mode, calculate USD from Bs + tasa
    let finalMontoTotal = Number(montoTotal);
    if (modo === 'bs') {
      if (!montoTotalBs || !tasaReferencia) {
        return new Response(JSON.stringify({ success: false, error: 'Monto en Bs y tasa de referencia son requeridos para modo Bs' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      finalMontoTotal = Number(montoTotalBs) / Number(tasaReferencia);
    }

    if (!proveedorId || !finalMontoTotal || !producto?.trim() || !fecha) {
      return new Response(JSON.stringify({ success: false, error: 'Proveedor, monto total, producto y fecha son requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await db.prepare(`
      INSERT INTO compras_proveedores (proveedor_id, producto, monto_total, monto_total_bs, tasa_referencia, modo_precio, fecha, tiene_factura, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      Number(proveedorId),
      producto.trim(),
      finalMontoTotal,
      modo === 'bs' ? Number(montoTotalBs) : null,
      modo === 'bs' ? Number(tasaReferencia) : null,
      modo,
      fecha,
      tieneFactura ? 1 : 0,
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
    console.error('Error creating compra:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al registrar compra' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
