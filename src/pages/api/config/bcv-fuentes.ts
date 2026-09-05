import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';
import { getEnv } from '../../../lib/env';
import {
  leerTodasLasFuentes,
  getPreferenciaFuentes,
  guardarPreferenciaFuentes,
  esFuenteBCV,
} from '../../../lib/bcv-fuentes';

export const prerender = false;

const jsonHeaders = { 'Content-Type': 'application/json' };

/**
 * Devuelve la preferencia de fuentes y lo que da cada una ahora mismo, para
 * poder compararlas en el panel antes de elegir.
 */
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const env = getEnv(locals) as Record<string, string | undefined>;
    const [fuentes, preferencia] = await Promise.all([
      leerTodasLasFuentes(env.COTIZAVE_API_KEY),
      getPreferenciaFuentes(db),
    ]);

    return new Response(JSON.stringify({ success: true, ...preferencia, fuentes }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error('Error al cargar las fuentes de la tasa:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al consultar las fuentes' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
};

/** Guarda qué fuente manda y cuál es el respaldo. */
export const PUT: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const { principal, respaldo } = await request.json();

    if (!esFuenteBCV(principal) || !esFuenteBCV(respaldo)) {
      return new Response(JSON.stringify({ success: false, error: 'Fuente inválida' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    await guardarPreferenciaFuentes(db, principal, respaldo);

    return new Response(JSON.stringify({ success: true, principal, respaldo }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error('Error al guardar las fuentes de la tasa:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al guardar' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
};
