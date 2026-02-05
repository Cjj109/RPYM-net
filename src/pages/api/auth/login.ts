import type { APIRoute } from 'astro';
import { getD1 } from '../../../lib/d1-types';
import {
  authenticateUser,
  createSession,
  getSessionCookieOptions
} from '../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const db = getD1(locals);

    if (!db) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Base de datos no configurada'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Usuario y contraseña requeridos'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const user = await authenticateUser(db, username, password);

    if (!user) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Usuario o contraseña incorrectos'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create session
    const sessionId = await createSession(db, user.id);

    return new Response(JSON.stringify({
      success: true,
      user: {
        username: user.username,
        displayName: user.displayName,
        role: user.role
      }
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `rpym_session=${sessionId}; ${getSessionCookieOptions()}`
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error del servidor'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
