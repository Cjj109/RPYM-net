/**
 * RPYM - Require auth middleware helper
 * Centraliza la verificación de sesión para endpoints protegidos
 * Soporta autenticación via:
 *   1. Session cookie (admin panel, navegador)
 *   2. Bearer token BOT2_API_KEY (OpenClaw / Bot 2)
 *
 * Sesión deslizante: cada validación exitosa por cookie queda anotada en
 * `locals`, y src/middleware.ts reenvía la cookie con el Max-Age que le queda a
 * la sesión en D1 (applySessionCookie). Así la cookie del navegador (PC o
 * teléfono) se extiende mientras el usuario usa el panel y nunca caduca antes
 * que la sesión en la base de datos.
 */

import type { D1Database } from './d1-types';
import { getD1 } from './d1-types';
import {
  validateSession,
  getSessionFromCookie,
  getSessionMaxAge,
  buildSessionCookie,
  SESSION_COOKIE_NAME,
} from './auth';
import type { AdminUser } from './auth';

export interface AuthResult {
  db: D1Database;
  user: AdminUser;
}

export interface RequireAuthOptions {
  /** Si se requiere rol admin (por defecto cualquier rol autenticado basta) */
  role?: 'admin' | 'viewer' | 'any';
}

/** Sesión validada en este request, pendiente de refrescar en la cookie */
export interface ValidatedSession {
  sessionId: string;
  expiresAt: string;
}

/** Clave en `locals` donde se anota la sesión validada */
const VALIDATED_SESSION_KEY = Symbol.for('rpym.validatedSession');

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

  const session = await validateSession(db, sessionId);
  if (!session) {
    return jsonResponse({ success: false, error: 'Sesión inválida' }, 401);
  }

  markValidatedSession(locals, { sessionId, expiresAt: session.expiresAt });

  if (options.role === 'admin' && session.user.role !== 'admin') {
    return jsonResponse({ success: false, error: 'Requiere rol admin' }, 403);
  }

  return { db, user: session.user };
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

  const session = await validateSession(db, sessionId);
  if (!session) return { db, user: null };

  markValidatedSession(locals, { sessionId, expiresAt: session.expiresAt });

  return { db, user: session.user };
}

/** Anota en `locals` la sesión validada para que el middleware refresque la cookie */
export function markValidatedSession(locals: App.Locals, session: ValidatedSession): void {
  (locals as any)[VALIDATED_SESSION_KEY] = session;
}

/** Lee la sesión validada en este request (si hubo alguna) */
export function getValidatedSession(locals: App.Locals): ValidatedSession | null {
  return ((locals as any)?.[VALIDATED_SESSION_KEY] as ValidatedSession | undefined) ?? null;
}

/**
 * Añade a la respuesta la cookie de sesión con el Max-Age restante de la
 * sesión en D1, si en este request se validó una sesión por cookie.
 * No toca la respuesta si el endpoint ya fijó su propia cookie de sesión
 * (login/logout) o si no hubo sesión.
 */
export function applySessionCookie(
  locals: App.Locals,
  response: Response,
  now: number = Date.now()
): Response {
  const session = getValidatedSession(locals);
  if (!session) return response;

  const existing = response.headers.get('Set-Cookie');
  if (existing && existing.includes(`${SESSION_COOKIE_NAME}=`)) return response;

  const maxAge = getSessionMaxAge(session.expiresAt, now);
  if (maxAge <= 0) return response;

  const cookie = buildSessionCookie(session.sessionId, maxAge);

  try {
    response.headers.append('Set-Cookie', cookie);
    return response;
  } catch {
    // Algunas respuestas (p. ej. Response.redirect o fetch) tienen headers inmutables
    const copy = new Response(response.body, response);
    copy.headers.append('Set-Cookie', cookie);
    return copy;
  }
}

function jsonResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
