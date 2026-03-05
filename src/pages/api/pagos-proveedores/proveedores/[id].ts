import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';

export const prerender = false;

// PUT /api/pagos-proveedores/proveedores/:id - Update informal supplier
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;
    const body = await request.json();
    const { nombre, notas } = body;

    if (!nombre?.trim()) {
      return new Response(JSON.stringify({ success: false, error: 'El nombre es requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await db.prepare(`
      UPDATE proveedores_informales
      SET nombre = ?, notas = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(nombre.trim(), notas?.trim() || null, id).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error updating proveedor informal:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al actualizar proveedor' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// DELETE /api/pagos-proveedores/proveedores/:id - Delete informal supplier
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;

    const related = await db.prepare(
      'SELECT COUNT(*) as count FROM pagos_proveedores WHERE proveedor_id = ? AND is_active = 1'
    ).bind(id).first<{ count: number }>();

    if (related && related.count > 0) {
      await db.prepare(
        "UPDATE proveedores_informales SET is_active = 0, updated_at = datetime('now') WHERE id = ?"
      ).bind(id).run();
    } else {
      await db.prepare('DELETE FROM proveedores_informales WHERE id = ?').bind(id).run();
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error deleting proveedor informal:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al eliminar proveedor' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
