import type { APIRoute } from 'astro';
import { getR2 } from '../../../../lib/d1-types';
import { requireAuth } from '../../../../lib/require-auth';

export const prerender = false;

// DELETE /api/fiscal/pagos-seniat/:id
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;
  const r2 = getR2(locals);

  try {
    const id = params.id;
    if (!id) {
      return new Response(JSON.stringify({ success: false, error: 'ID es requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Obtener el pago para borrar imagen de R2 si existe
    const pago = await db.prepare(
      'SELECT image_key FROM fiscal_pagos_seniat WHERE id = ?'
    ).bind(id).first<{ image_key: string | null }>();

    if (!pago) {
      return new Response(JSON.stringify({ success: false, error: 'Pago no encontrado' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Borrar imagen de R2
    if (pago.image_key && r2) {
      try {
        await r2.delete(pago.image_key);
      } catch (e) {
        console.error('Error deleting R2 image:', e);
      }
    }

    await db.prepare('DELETE FROM fiscal_pagos_seniat WHERE id = ?').bind(id).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error deleting pago SENIAT:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al eliminar pago' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
