import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';
import { transformRetencion, type D1FiscalRetencionIvaWithDetails } from '../../../../lib/fiscal-types';

export const prerender = false;

// GET /api/fiscal/retenciones - List all IVA retention vouchers
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const periodo = url.searchParams.get('periodo'); // YYYY-MM

    let query = `
      SELECT r.*, p.nombre as proveedor_nombre, p.rif as proveedor_rif,
             f.numero_factura, f.fecha_factura
      FROM fiscal_retenciones_iva r
      LEFT JOIN fiscal_facturas_compra f ON r.factura_id = f.id
      LEFT JOIN fiscal_proveedores p ON f.proveedor_id = p.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (periodo) {
      query += ` AND r.periodo_fiscal = ?`;
      params.push(periodo);
    }

    query += ` ORDER BY r.fecha_emision DESC`;

    const stmt = params.length > 0
      ? db.prepare(query).bind(...params)
      : db.prepare(query);
    const results = await stmt.all<D1FiscalRetencionIvaWithDetails>();

    return new Response(JSON.stringify({
      success: true,
      retenciones: results.results.map(transformRetencion),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error listing retenciones:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar retenciones' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// POST /api/fiscal/retenciones - Create new IVA retention voucher
export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const body = await request.json();
    const { facturaId, numeroComprobante, fechaEmision, periodoFiscal, montoRetenido, pdfKey } = body;

    if (!facturaId || !numeroComprobante || !fechaEmision || !periodoFiscal || !montoRetenido) {
      return new Response(JSON.stringify({ success: false, error: 'Faltan campos requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await db.prepare(`
      INSERT INTO fiscal_retenciones_iva (
        factura_id, numero_comprobante, fecha_emision, periodo_fiscal, monto_retenido, pdf_key
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      facturaId,
      numeroComprobante,
      fechaEmision,
      periodoFiscal,
      montoRetenido,
      pdfKey || null
    ).run();

    return new Response(JSON.stringify({
      success: true,
      id: result.meta.last_row_id,
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error creating retencion:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al crear retención' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
