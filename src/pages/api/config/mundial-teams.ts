import type { APIRoute } from 'astro';
import { getD1, type D1Database } from '../../../lib/d1-types';
import { requireAuth } from '../../../lib/require-auth';
import { sanitizeTeamIds } from '../../../lib/mundial-teams';

export const prerender = false;

const jsonHeaders = { 'Content-Type': 'application/json' };

/** Lee la lista de selecciones deshabilitadas de site_config. */
async function readDisabled(db: D1Database): Promise<string[]> {
  const result = await db.prepare(
    "SELECT value FROM site_config WHERE key = 'mundial_disabled'"
  ).first<{ value: string }>();
  if (!result?.value) return [];
  try {
    return sanitizeTeamIds(JSON.parse(result.value));
  } catch {
    return [];
  }
}

// GET público: lista de selecciones deshabilitadas
export const GET: APIRoute = async ({ locals }) => {
  try {
    const db = getD1(locals);
    if (!db) {
      return new Response(JSON.stringify({ success: true, disabled: [] }), {
        headers: { ...jsonHeaders, 'Cache-Control': 'no-cache, no-store, must-revalidate' }
      });
    }

    const disabled = await readDisabled(db);
    return new Response(JSON.stringify({ success: true, disabled }), {
      headers: { ...jsonHeaders, 'Cache-Control': 'no-cache, no-store, must-revalidate' }
    });
  } catch (error) {
    console.error('Error al obtener selecciones deshabilitadas:', error);
    return new Response(JSON.stringify({ success: true, disabled: [] }), {
      headers: { ...jsonHeaders, 'Cache-Control': 'no-cache, no-store, must-revalidate' }
    });
  }
};

// PUT protegido: guardar lista de selecciones deshabilitadas
export const PUT: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const body = await request.json();
    const disabled = sanitizeTeamIds(body.disabled);

    await db.prepare(
      "INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES ('mundial_disabled', ?, datetime('now'))"
    ).bind(JSON.stringify(disabled)).run();

    return new Response(JSON.stringify({ success: true, disabled }), {
      headers: jsonHeaders
    });
  } catch (error) {
    console.error('Error al guardar selecciones deshabilitadas:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al guardar las selecciones deshabilitadas'
    }), {
      status: 500,
      headers: jsonHeaders
    });
  }
};
