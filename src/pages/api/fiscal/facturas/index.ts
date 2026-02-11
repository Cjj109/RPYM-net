import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';
import { transformFactura, type D1FiscalFacturaCompraWithProveedor } from '../../../../lib/fiscal-types';

export const prerender = false;

// GET /api/fiscal/facturas - List all purchase invoices
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const periodo = url.searchParams.get('periodo'); // YYYY-MM
    const proveedorId = url.searchParams.get('proveedor');

    let query = `
      SELECT f.*, p.nombre as proveedor_nombre, p.rif as proveedor_rif
      FROM fiscal_facturas_compra f
      LEFT JOIN fiscal_proveedores p ON f.proveedor_id = p.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (periodo) {
      query += ` AND f.fecha_factura LIKE ?`;
      params.push(`${periodo}%`);
    }

    if (proveedorId) {
      query += ` AND f.proveedor_id = ?`;
      params.push(proveedorId);
    }

    query += ` ORDER BY f.fecha_factura DESC`;

    const stmt = params.length > 0
      ? db.prepare(query).bind(...params)
      : db.prepare(query);
    const results = await stmt.all<D1FiscalFacturaCompraWithProveedor>();

    return new Response(JSON.stringify({
      success: true,
      facturas: results.results.map(transformFactura),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error listing facturas:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar facturas' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// POST /api/fiscal/facturas - Create new purchase invoice
export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const body = await request.json();
    const {
      proveedorId,
      numeroFactura,
      numeroControl,
      fechaFactura,
      fechaRecepcion,
      subtotalExento,
      subtotalGravable,
      iva,
      total,
      retencionIva,
      anticipoIslr,
      igtf,
      paymentCurrency,
      exchangeRate,
      notes,
    } = body;

    if (!proveedorId || !numeroFactura || !fechaFactura) {
      return new Response(JSON.stringify({ success: false, error: 'Proveedor, número de factura y fecha son requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await db.prepare(`
      INSERT INTO fiscal_facturas_compra (
        proveedor_id, numero_factura, numero_control, fecha_factura, fecha_recepcion,
        subtotal_exento, subtotal_gravable, iva, total, retencion_iva, anticipo_islr,
        igtf, payment_currency, exchange_rate, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      proveedorId,
      numeroFactura.trim(),
      numeroControl?.trim() || null,
      fechaFactura,
      fechaRecepcion || fechaFactura,
      subtotalExento || 0,
      subtotalGravable || 0,
      iva || 0,
      total || 0,
      retencionIva || 0,
      anticipoIslr || 0,
      igtf || null,
      paymentCurrency || 'bs',
      exchangeRate || null,
      notes || null
    ).run();

    return new Response(JSON.stringify({
      success: true,
      id: result.meta.last_row_id,
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error creating factura:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al crear factura' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
