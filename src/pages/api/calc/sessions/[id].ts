export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';

export const DELETE: APIRoute = async ({ request, locals, params }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ success: false, error: 'ID requerido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await db.prepare('DELETE FROM calc_sessions WHERE id = ?').bind(id).run();
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error al eliminar sesión:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al eliminar sesión' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
