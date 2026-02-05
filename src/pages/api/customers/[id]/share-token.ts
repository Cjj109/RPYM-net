import type { APIRoute } from 'astro';
import { getD1 } from '../../../../lib/d1-types';
import { validateSession, getSessionFromCookie } from '../../../../lib/auth';

export const prerender = false;

function generateShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// POST /api/customers/:id/share-token - Generate public share token
export const POST: APIRoute = async ({ params, request, locals }) => {
  const db = getD1(locals);
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: 'Database no disponible' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  const sessionId = getSessionFromCookie(request.headers.get('Cookie'));
  if (!sessionId) {
    return new Response(JSON.stringify({ success: false, error: 'No autenticado' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }
  const user = await validateSession(db, sessionId);
  if (!user) {
    return new Response(JSON.stringify({ success: false, error: 'Sesion invalida' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const customerId = params.id;
    const token = generateShareToken();

    await db.prepare(`
      UPDATE customers SET share_token = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(token, customerId).run();

    return new Response(JSON.stringify({
      success: true,
      token,
      url: `${new URL(request.url).origin}/cuenta/${token}`
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error generating share token:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al generar enlace' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};

// DELETE /api/customers/:id/share-token - Revoke public share token
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const db = getD1(locals);
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: 'Database no disponible' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  const sessionId = getSessionFromCookie(request.headers.get('Cookie'));
  if (!sessionId) {
    return new Response(JSON.stringify({ success: false, error: 'No autenticado' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }
  const user = await validateSession(db, sessionId);
  if (!user) {
    return new Response(JSON.stringify({ success: false, error: 'Sesion invalida' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const customerId = params.id;

    await db.prepare(`
      UPDATE customers SET share_token = NULL, updated_at = datetime('now') WHERE id = ?
    `).bind(customerId).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error revoking share token:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al revocar enlace' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
