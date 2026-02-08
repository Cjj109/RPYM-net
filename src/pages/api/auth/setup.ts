import type { APIRoute } from 'astro';
import { getD1 } from '../../../lib/d1-types';
import { hashPassword } from '../../../lib/auth';

export const prerender = false;

/**
 * Setup endpoint to create initial admin users
 * DISABLED: Initial setup complete. Uncomment code below if you need to add more users.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  // Setup disabled - users already configured
  return new Response(JSON.stringify({
    success: false,
    error: 'Endpoint deshabilitado'
  }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });

  /* ORIGINAL CODE - DISABLED
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

    // Check if users already exist
    const existingUsers = await db.prepare('SELECT COUNT(*) as count FROM admin_users').first<{ count: number }>();

    if (existingUsers && existingUsers.count > 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Ya existen usuarios configurados'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { users, setupKey } = body;

    // Simple security: require a setup key
    // In production, use a more secure method
    if (setupKey !== 'RPYM-Setup-2026!') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Clave de configuracion invalida'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!Array.isArray(users) || users.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Se requiere al menos un usuario'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create users
    const createdUsers: string[] = [];

    for (const user of users) {
      const { username, password, displayName, role = 'admin' } = user;

      if (!username || !password || !displayName) {
        continue;
      }

      const passwordHash = await hashPassword(password);

      await db.prepare(`
        INSERT INTO admin_users (username, password_hash, display_name, role)
        VALUES (?, ?, ?, ?)
      `).bind(username.toLowerCase(), passwordHash, displayName, role).run();

      createdUsers.push(username);
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Usuarios creados: ${createdUsers.join(', ')}`
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Setup error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al crear usuarios'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  END OF DISABLED CODE */
};
