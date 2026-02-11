import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';
import { transformReporteZ, type D1FiscalReporteZ } from '../../../../lib/fiscal-types';

export const prerender = false;

// GET /api/fiscal/reportes-z - List all Z reports
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const periodo = url.searchParams.get('periodo'); // YYYY-MM

    let query = `SELECT * FROM fiscal_reportes_z WHERE 1=1`;
    const params: unknown[] = [];

    if (periodo) {
      query += ` AND fecha LIKE ?`;
      params.push(`${periodo}%`);
    }

    query += ` ORDER BY fecha DESC`;

    const stmt = params.length > 0
      ? db.prepare(query).bind(...params)
      : db.prepare(query);
    const results = await stmt.all<D1FiscalReporteZ>();

    return new Response(JSON.stringify({
      success: true,
      reportes: results.results.map(transformReporteZ),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error listing reportes Z:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar reportes Z' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// POST /api/fiscal/reportes-z - Create new Z report
export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const body = await request.json();
    const {
      fecha,
      subtotalExento,
      subtotalGravable,
      ivaCobrado,
      baseImponibleIgtf,
      igtfVentas,
      totalVentas,
      numeracionFacturas,
      imageKey,
      ocrVerified,
      ocrRawData,
      notes,
    } = body;

    if (!fecha) {
      return new Response(JSON.stringify({ success: false, error: 'Fecha es requerida' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for duplicate date
    const existing = await db.prepare(
      'SELECT id FROM fiscal_reportes_z WHERE fecha = ?'
    ).bind(fecha).first();

    if (existing) {
      return new Response(JSON.stringify({ success: false, error: 'Ya existe un reporte Z para esa fecha' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await db.prepare(`
      INSERT INTO fiscal_reportes_z (
        fecha, subtotal_exento, subtotal_gravable, iva_cobrado,
        base_imponible_igtf, igtf_ventas, total_ventas,
        numeracion_facturas, image_key, ocr_verified, ocr_raw_data, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      fecha,
      subtotalExento || 0,
      subtotalGravable || 0,
      ivaCobrado || 0,
      baseImponibleIgtf || 0,
      igtfVentas || 0,
      totalVentas || 0,
      numeracionFacturas || null,
      imageKey || null,
      ocrVerified ? 1 : 0,
      ocrRawData || null,
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
    console.error('Error creating reporte Z:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al crear reporte Z' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
