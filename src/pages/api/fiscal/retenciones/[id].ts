import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';

export const prerender = false;

// GET /api/fiscal/retenciones/[id] - Get single retention voucher
export const GET: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;
    const result = await db.prepare(`
      SELECT r.*, p.nombre as proveedor_nombre, p.rif as proveedor_rif,
             f.numero_factura, f.fecha_factura
      FROM fiscal_retenciones_iva r
      LEFT JOIN fiscal_facturas_compra f ON r.factura_id = f.id
      LEFT JOIN fiscal_proveedores p ON f.proveedor_id = p.id
      WHERE r.id = ?
    `).bind(id).first();

    if (!result) {
      return new Response(JSON.stringify({ success: false, error: 'Retención no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      retencion: result,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error getting retencion:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al obtener retención' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// PUT /api/fiscal/retenciones/[id] - Update retention voucher
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;
    const body = await request.json();
    const { numeroComprobante, fechaEmision, periodoFiscal, montoRetenido } = body;

    if (!numeroComprobante || !fechaEmision || !periodoFiscal || montoRetenido === undefined) {
      return new Response(JSON.stringify({ success: false, error: 'Faltan campos requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await db.prepare(`
      UPDATE fiscal_retenciones_iva
      SET numero_comprobante = ?, fecha_emision = ?, periodo_fiscal = ?, monto_retenido = ?
      WHERE id = ?
    `).bind(
      numeroComprobante,
      fechaEmision,
      periodoFiscal,
      montoRetenido,
      id
    ).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error updating retencion:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al actualizar retención' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// DELETE /api/fiscal/retenciones/[id] - Delete retention voucher
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

    await db.prepare(`
      DELETE FROM fiscal_retenciones_iva WHERE id = ?
    `).bind(id).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error deleting retencion:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al eliminar retención' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
