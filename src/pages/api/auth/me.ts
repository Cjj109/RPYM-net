import type { APIRoute } from 'astro';
import { getD1 } from '../../../lib/d1-types';
import { validateSession, getSessionFromCookie } from '../../../lib/auth';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const db = getD1(locals);
    const sessionId = getSessionFromCookie(request.headers.get('Cookie'));

    if (!db || !sessionId) {
      return new Response(JSON.stringify({
        authenticated: false
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const user = await validateSession(db, sessionId);

    if (!user) {
      return new Response(JSON.stringify({
        authenticated: false
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      authenticated: true,
      user: {
        username: user.username,
        displayName: user.displayName,
        role: user.role
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Auth check error:', error);
    return new Response(JSON.stringify({
      authenticated: false
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
