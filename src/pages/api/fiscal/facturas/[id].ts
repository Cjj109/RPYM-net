import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';
import { transformFactura, type D1FiscalFacturaCompraWithProveedor } from '../../../../lib/fiscal-types';

export const prerender = false;

// GET /api/fiscal/facturas/:id - Get single purchase invoice
export const GET: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;
    const row = await db.prepare(`
      SELECT f.*, p.nombre as proveedor_nombre, p.rif as proveedor_rif
      FROM fiscal_facturas_compra f
      LEFT JOIN fiscal_proveedores p ON f.proveedor_id = p.id
      WHERE f.id = ?
    `).bind(id).first<D1FiscalFacturaCompraWithProveedor>();

    if (!row) {
      return new Response(JSON.stringify({ success: false, error: 'Factura no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      factura: transformFactura(row),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error getting factura:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al obtener factura' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// PUT /api/fiscal/facturas/:id - Update purchase invoice
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;
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

    await db.prepare(`
      UPDATE fiscal_facturas_compra
      SET proveedor_id = ?, numero_factura = ?, numero_control = ?, fecha_factura = ?,
          fecha_recepcion = ?, subtotal_exento = ?, subtotal_gravable = ?, iva = ?,
          total = ?, retencion_iva = ?, anticipo_islr = ?, igtf = ?,
          payment_currency = ?, exchange_rate = ?, notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      proveedorId,
      numeroFactura?.trim(),
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
      notes || null,
      id
    ).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error updating factura:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al actualizar factura' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// DELETE /api/fiscal/facturas/:id - Delete purchase invoice
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;

    // Check if there are related retenciones
    const related = await db.prepare(
      'SELECT COUNT(*) as count FROM fiscal_retenciones_iva WHERE factura_id = ?'
    ).bind(id).first<{ count: number }>();

    if (related && related.count > 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No se puede eliminar: tiene comprobantes de retención asociados',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await db.prepare('DELETE FROM fiscal_facturas_compra WHERE id = ?').bind(id).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error deleting factura:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al eliminar factura' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
