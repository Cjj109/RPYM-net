/**
 * RPYM - Require auth middleware helper
 * Centraliza la verificación de sesión para endpoints protegidos
 */

import type { D1Database } from './d1-types';
import { getD1 } from './d1-types';
import { validateSession, getSessionFromCookie } from './auth';
import type { AdminUser } from './auth';

export interface AuthResult {
  db: D1Database;
  user: AdminUser;
}

export interface RequireAuthOptions {
  /** Si se requiere rol admin (por defecto cualquier rol autenticado basta) */
  role?: 'admin' | 'viewer' | 'any';
}

/**
 * Verifica autenticación y devuelve db + user, o una Response 401/500 si falla.
 * Uso: const auth = await requireAuth(request, locals); if (auth instanceof Response) return auth;
 */
export async function requireAuth(
  request: Request,
  locals: App.Locals,
  options: RequireAuthOptions = {}
): Promise<AuthResult | Response> {
  const db = getD1(locals);
  if (!db) {
    return jsonResponse({ success: false, error: 'Database no disponible' }, 500);
  }

  const sessionId = getSessionFromCookie(request.headers.get('Cookie'));
  if (!sessionId) {
    return jsonResponse({ success: false, error: 'No autenticado' }, 401);
  }

  const user = await validateSession(db, sessionId);
  if (!user) {
    return jsonResponse({ success: false, error: 'Sesión inválida' }, 401);
  }

  if (options.role === 'admin' && user.role !== 'admin') {
    return jsonResponse({ success: false, error: 'Requiere rol admin' }, 403);
  }

  return { db, user };
}

/**
 * Variante que devuelve null si no autenticado (para endpoints que devuelven authenticated: false)
 */
export async function getAuthOptional(
  request: Request,
  locals: App.Locals
): Promise<{ db: D1Database; user: AdminUser } | { db: D1Database | null; user: null } | { db: null; user: null }> {
  const db = getD1(locals);
  if (!db) return { db: null, user: null };

  const sessionId = getSessionFromCookie(request.headers.get('Cookie'));
  if (!sessionId) return { db, user: null };

  const user = await validateSession(db, sessionId);
  if (!user) return { db, user: null };

  return { db, user };
}

function jsonResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
