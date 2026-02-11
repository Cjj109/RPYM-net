import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';
import { verifyPassword, hashPassword } from '../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const auth = await requireAuth(request, locals);
    if (auth instanceof Response) return auth;
    const { db, user } = auth;

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Contrasena actual y nueva son requeridas'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate new password strength
    if (newPassword.length < 8) {
      return new Response(JSON.stringify({
        success: false,
        error: 'La nueva contrasena debe tener al menos 8 caracteres'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get current password hash
    const dbUser = await db.prepare(`
      SELECT password_hash FROM admin_users WHERE id = ?
    `).bind(user.id).first<{ password_hash: string }>();

    if (!dbUser) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Usuario no encontrado'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, dbUser.password_hash);
    if (!isValid) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Contrasena actual incorrecta'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    // Update password
    await db.prepare(`
      UPDATE admin_users SET password_hash = ? WHERE id = ?
    `).bind(newPasswordHash, user.id).run();

    return new Response(JSON.stringify({
      success: true,
      message: 'Contrasena actualizada exitosamente'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Change password error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al cambiar contrasena'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
