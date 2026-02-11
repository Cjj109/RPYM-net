import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';
import { transformProveedor, type D1FiscalProveedor } from '../../../../lib/fiscal-types';

export const prerender = false;

// GET /api/fiscal/proveedores/:id - Get single supplier
export const GET: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;
    const row = await db.prepare(
      'SELECT * FROM fiscal_proveedores WHERE id = ?'
    ).bind(id).first<D1FiscalProveedor>();

    if (!row) {
      return new Response(JSON.stringify({ success: false, error: 'Proveedor no encontrado' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      proveedor: transformProveedor(row),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error getting proveedor:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al obtener proveedor' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// PUT /api/fiscal/proveedores/:id - Update supplier
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;
    const body = await request.json();
    const { rif, nombre, direccion, telefono, email, retencionIvaPct, islrPct } = body;

    if (!rif || !nombre) {
      return new Response(JSON.stringify({ success: false, error: 'RIF y nombre son requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for duplicate RIF (excluding self)
    const existing = await db.prepare(
      'SELECT id FROM fiscal_proveedores WHERE rif = ? AND id != ?'
    ).bind(rif, id).first();

    if (existing) {
      return new Response(JSON.stringify({ success: false, error: 'Ya existe otro proveedor con ese RIF' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await db.prepare(`
      UPDATE fiscal_proveedores
      SET rif = ?, nombre = ?, direccion = ?, telefono = ?, email = ?,
          retencion_iva_pct = ?, islr_pct = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      rif.trim(),
      nombre.trim(),
      direccion?.trim() || null,
      telefono?.trim() || null,
      email?.trim() || null,
      retencionIvaPct || 75,
      islrPct || 1.0,
      id
    ).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error updating proveedor:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al actualizar proveedor' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// DELETE /api/fiscal/proveedores/:id - Soft delete supplier
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;

    // Check if there are related facturas
    const related = await db.prepare(
      'SELECT COUNT(*) as count FROM fiscal_facturas_compra WHERE proveedor_id = ?'
    ).bind(id).first<{ count: number }>();

    if (related && related.count > 0) {
      // Soft delete (keep for historical records)
      await db.prepare(
        "UPDATE fiscal_proveedores SET is_active = 0, updated_at = datetime('now') WHERE id = ?"
      ).bind(id).run();
    } else {
      // Hard delete if no related records
      await db.prepare('DELETE FROM fiscal_proveedores WHERE id = ?').bind(id).run();
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error deleting proveedor:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al eliminar proveedor' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
