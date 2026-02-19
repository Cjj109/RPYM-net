import type { APIRoute } from 'astro';
import { requireBot2Auth } from '../../../../../lib/require-bot2-auth';
import { getAdminPresupuestoUrl } from '../../../../../lib/admin-token';
import { getEnv } from '../../../../../lib/env';

export const prerender = false;

/** Genera la URL admin para ver un presupuesto */
export const GET: APIRoute = async ({ request, locals, params }) => {
  const auth = requireBot2Auth(request, locals);
  if (auth instanceof Response) return auth;

  const presupuestoId = params.id;
  if (!presupuestoId) {
    return new Response(JSON.stringify({ success: false, error: 'ID requerido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const env = getEnv(locals);
    const adminSecret = env.ADMIN_SECRET || 'rpym-default-secret-2024';
    const adminUrl = await getAdminPresupuestoUrl(presupuestoId, adminSecret, 'https://rpym.net');

    return new Response(JSON.stringify({
      success: true,
      id: presupuestoId,
      adminUrl
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[Bot2 Admin URL] Error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al generar URL' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
