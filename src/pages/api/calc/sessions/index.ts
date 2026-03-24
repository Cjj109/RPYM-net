export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';
import type { SavedSession } from '../../../../components/calculator/types';

export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const rows = await db.prepare(
      'SELECT id, data FROM calc_sessions ORDER BY created_at DESC LIMIT 100'
    ).all<{ id: string; data: string }>();

    const sessions: SavedSession[] = [];
    for (const r of rows.results) {
      try { sessions.push(JSON.parse(r.data)); } catch { /* ignorar filas corruptas */ }
    }

    return new Response(JSON.stringify({ success: true, sessions }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error al leer sesiones:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al leer sesiones' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const session = await request.json() as SavedSession;
    if (!session?.id || typeof session.id !== 'string') {
      return new Response(JSON.stringify({ success: false, error: 'ID de sesión requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await db.prepare(
      'INSERT OR IGNORE INTO calc_sessions (id, data) VALUES (?, ?)'
    ).bind(session.id, JSON.stringify(session)).run();

    // Mantener solo las últimas 100 sesiones
    await db.prepare(`
      DELETE FROM calc_sessions WHERE id NOT IN (
        SELECT id FROM calc_sessions ORDER BY created_at DESC LIMIT 100
      )
    `).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error al guardar sesión:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al guardar sesión' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    await db.prepare('DELETE FROM calc_sessions').run();
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error al limpiar sesiones:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al limpiar sesiones' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
