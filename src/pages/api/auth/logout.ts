import type { APIRoute } from 'astro';
import { getD1 } from '../../../lib/d1-types';
import { deleteSession, getSessionFromCookie } from '../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const db = getD1(locals);
    const sessionId = getSessionFromCookie(request.headers.get('Cookie'));

    if (db && sessionId) {
      await deleteSession(db, sessionId);
    }

    // Clear the cookie
    return new Response(JSON.stringify({ success: true }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'rpym_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'
      }
    });

  } catch (error) {
    console.error('Logout error:', error);
    return new Response(JSON.stringify({ success: true }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'rpym_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'
      }
    });
  }
};
