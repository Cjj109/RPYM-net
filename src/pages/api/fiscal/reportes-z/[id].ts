import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';
import { transformReporteZ, type D1FiscalReporteZ } from '../../../../lib/fiscal-types';

export const prerender = false;

// GET /api/fiscal/reportes-z/:id - Get single Z report
export const GET: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;
    const row = await db.prepare(
      'SELECT * FROM fiscal_reportes_z WHERE id = ?'
    ).bind(id).first<D1FiscalReporteZ>();

    if (!row) {
      return new Response(JSON.stringify({ success: false, error: 'Reporte Z no encontrado' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      reporte: transformReporteZ(row),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error getting reporte Z:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al obtener reporte Z' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// PUT /api/fiscal/reportes-z/:id - Update Z report
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;
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
      notes,
    } = body;

    if (!fecha) {
      return new Response(JSON.stringify({ success: false, error: 'Fecha es requerida' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for duplicate date (excluding self)
    const existing = await db.prepare(
      'SELECT id FROM fiscal_reportes_z WHERE fecha = ? AND id != ?'
    ).bind(fecha, id).first();

    if (existing) {
      return new Response(JSON.stringify({ success: false, error: 'Ya existe otro reporte Z para esa fecha' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await db.prepare(`
      UPDATE fiscal_reportes_z
      SET fecha = ?, subtotal_exento = ?, subtotal_gravable = ?, iva_cobrado = ?,
          base_imponible_igtf = ?, igtf_ventas = ?,
          total_ventas = ?, numeracion_facturas = ?, notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      fecha,
      subtotalExento || 0,
      subtotalGravable || 0,
      ivaCobrado || 0,
      baseImponibleIgtf || 0,
      igtfVentas || 0,
      totalVentas || 0,
      numeracionFacturas || null,
      notes || null,
      id
    ).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error updating reporte Z:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al actualizar reporte Z' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// DELETE /api/fiscal/reportes-z/:id - Delete Z report
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const db = getD1(locals);
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: 'Database no disponible' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sessionId = getSessionFromCookie(request.headers.get('Cookie'));
  if (!sessionId) {
    return new Response(JSON.stringify({ success: false, error: 'No autenticado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = await validateSession(db, sessionId);
  if (!user) {
    return new Response(JSON.stringify({ success: false, error: 'Sesión inválida' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const id = params.id;
    await db.prepare('DELETE FROM fiscal_reportes_z WHERE id = ?').bind(id).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error deleting reporte Z:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al eliminar reporte Z' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
