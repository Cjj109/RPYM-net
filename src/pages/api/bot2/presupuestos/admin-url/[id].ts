import type { APIRoute } from 'astro';
import { getAdminPresupuestoUrl } from '../../../../../lib/admin-token';
import { requireBot2Auth } from '../../../../../lib/require-bot2-auth';
import { getEnv } from '../../../../../lib/env';
import { getD1 } from '../../../../../lib/d1-types';

export const prerender = false;

/**
 * Genera la URL admin para ver un presupuesto.
 * Requiere auth de Bot 2: devuelve un token HMAC de administración, así que
 * servirlo abierto equivalía a regalar el token que protege /presupuesto/admin.
 */
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

  // Verificar que el presupuesto existe
  const db = getD1(locals);
  if (db) {
    const exists = await db.prepare('SELECT id FROM presupuestos WHERE id = ?').bind(presupuestoId).first();
    if (!exists) {
      return new Response(JSON.stringify({ success: false, error: 'Presupuesto no encontrado' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  try {
    const env = getEnv(locals);
    const adminSecret = env.ADMIN_SECRET;
    if (!adminSecret) {
      console.error('[Bot2 Admin URL] ADMIN_SECRET no configurado');
      return new Response(JSON.stringify({ success: false, error: 'Configuración incompleta' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
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
