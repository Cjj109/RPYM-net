/**
 * RPYM - Require auth middleware helper
 * Centraliza la verificación de sesión para endpoints protegidos
 * Soporta autenticación via:
 *   1. Session cookie (admin panel, navegador)
 *   2. Bearer token BOT2_API_KEY (OpenClaw / Bot 2)
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

/** Usuario virtual para Bot 2 (cuando autentica via API key) */
const BOT2_USER: AdminUser = {
  id: 0,
  username: 'bot2',
  displayName: 'Bot 2 (OpenClaw)',
  role: 'admin',
};

/**
 * Verifica autenticación y devuelve db + user, o una Response 401/500 si falla.
 * Acepta session cookie O Bearer token (BOT2_API_KEY).
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

  // Intento 1: Bearer token (Bot 2 / OpenClaw)
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const runtime = (locals as any).runtime;
    const expectedKey = runtime?.env?.BOT2_API_KEY;
    if (expectedKey && authHeader.slice(7) === expectedKey) {
      return { db, user: BOT2_USER };
    }
  }

  // Intento 2: Session cookie (admin panel)
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
