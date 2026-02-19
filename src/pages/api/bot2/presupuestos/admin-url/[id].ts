import type { APIRoute } from 'astro';
import { getAdminPresupuestoUrl } from '../../../../../lib/admin-token';
import { getEnv } from '../../../../../lib/env';
import { getD1 } from '../../../../../lib/d1-types';

export const prerender = false;

/**
 * Genera la URL admin para ver un presupuesto.
 * NO requiere auth — los endpoints de presupuestos ya son publicos
 * y este solo genera una URL con token HMAC.
 */
export const GET: APIRoute = async ({ locals, params }) => {
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
