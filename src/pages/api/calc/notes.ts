export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';

export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const row = await db.prepare(
      'SELECT content, updated_at FROM calc_notes WHERE id = ?'
    ).bind('global').first<{ content: string; updated_at: string }>();

    return new Response(JSON.stringify({
      success: true,
      content: row?.content ?? '',
      updated_at: row?.updated_at ?? null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error al leer notas:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al leer notas' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const body = await request.json() as { content?: unknown };
    const content = typeof body.content === 'string' ? body.content : '';

    await db.prepare(`
      INSERT INTO calc_notes (id, content, updated_at) VALUES ('global', ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `).bind(content).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error al guardar notas:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al guardar notas' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
