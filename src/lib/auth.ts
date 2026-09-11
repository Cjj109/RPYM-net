/**
 * RPYM - Authentication utilities
 * Uses Web Crypto API (available in Cloudflare Workers)
 */

import type { D1Database } from './d1-types';

/**
 * Duración de la sesión por inactividad: 180 días.
 * Es deslizante: cada uso la extiende (ver SESSION_RENEW_INTERVAL_MS), así una
 * sesión activa no se cierra sola. Antes era un TTL fijo de 7 días desde el
 * login que nunca se renovaba: a los 7 días exactos la cookie caducaba en el
 * navegador aunque el panel estuviera abierto, y la siguiente llamada (p. ej. la
 * IA de operaciones rápidas) devolvía 401 "No autenticado".
 */
export const SESSION_DURATION_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Cada cuánto se escribe la nueva expiración en D1 como máximo (1 escritura
 * por sesión al día), para no hacer un UPDATE en cada request.
 */
export const SESSION_RENEW_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Nombre de la cookie de sesión */
export const SESSION_COOKIE_NAME = 'rpym_session';

/**
 * Hash a password using PBKDF2
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );

  // Combine salt + hash
  const hashArray = new Uint8Array(derivedBits);
  const combined = new Uint8Array(salt.length + hashArray.length);
  combined.set(salt);
  combined.set(hashArray, salt.length);

  // Return as base64
  return btoa(String.fromCharCode(...combined));
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const combined = Uint8Array.from(atob(storedHash), c => c.charCodeAt(0));

    // Extract salt (first 16 bytes)
    const salt = combined.slice(0, 16);
    const originalHash = combined.slice(16);

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );

    const newHash = new Uint8Array(derivedBits);

    // Constant-time comparison
    if (newHash.length !== originalHash.length) return false;
    let result = 0;
    for (let i = 0; i < newHash.length; i++) {
      result |= newHash[i] ^ originalHash[i];
    }
    return result === 0;
  } catch {
    return false;
  }
}

/**
 * Generate a secure session ID
 */
export function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a new session for a user
 */
export async function createSession(
  db: D1Database,
  userId: number,
  now: number = Date.now()
): Promise<string> {
  const sessionId = generateSessionId();
  const expiresAt = new Date(now + SESSION_DURATION_MS).toISOString();

  await db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (?, ?, ?)
  `).bind(sessionId, userId, expiresAt).run();

  return sessionId;
}

/** Resultado de validar una sesión */
export interface SessionValidation {
  user: AdminUser;
  /** Expiración vigente de la sesión en D1 (ISO), ya renovada si tocaba */
  expiresAt: string;
  /** true si en esta validación se extendió la expiración en D1 */
  renewed: boolean;
}

/**
 * Valida una sesión y, si sigue viva, la renueva (expiración deslizante).
 *
 * expires_at se guarda con toISOString() ("2026-09-18T12:00:00.000Z"), así que
 * se compara contra un "ahora" también en ISO. Antes se comparaba contra
 * datetime('now') ("2026-09-18 12:00:00"): como 'T' > ' ', el día del
 * vencimiento la sesión seguía viva en D1 hasta medianoche UTC mientras la
 * cookie ya había caducado en el navegador.
 *
 * Si falla el UPDATE de renovación la sesión sigue siendo válida (no se echa al
 * usuario por un error de escritura); se reintentará en el siguiente request.
 */
export async function validateSession(
  db: D1Database,
  sessionId: string,
  now: number = Date.now()
): Promise<SessionValidation | null> {
  if (!sessionId) return null;

  const nowIso = new Date(now).toISOString();

  const result = await db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, s.expires_at
    FROM sessions s
    JOIN admin_users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > ?
  `).bind(sessionId, nowIso).first<{
    id: number;
    username: string;
    display_name: string;
    role: string;
    expires_at: string;
  }>();

  if (!result) return null;

  const user: AdminUser = {
    id: result.id,
    username: result.username,
    displayName: result.display_name,
    role: result.role as 'admin' | 'viewer'
  };

  let expiresAt = result.expires_at;
  let renewed = false;

  if (shouldRenewSession(expiresAt, now)) {
    const newExpiresAt = new Date(now + SESSION_DURATION_MS).toISOString();
    try {
      await db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
        .bind(newExpiresAt, sessionId)
        .run();
      expiresAt = newExpiresAt;
      renewed = true;
    } catch (error) {
      console.error('Error al renovar la sesión:', error);
    }
  }

  return { user, expiresAt, renewed };
}

/**
 * Indica si toca extender la sesión en D1: cuando pasó más de
 * SESSION_RENEW_INTERVAL_MS desde la última renovación (o el login).
 */
export function shouldRenewSession(expiresAt: string, now: number = Date.now()): boolean {
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) return true;
  return expiresMs - now < SESSION_DURATION_MS - SESSION_RENEW_INTERVAL_MS;
}

/**
 * Delete a session (logout)
 */
export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

/**
 * Cierra todas las sesiones de un usuario excepto la indicada
 * (se usa al cambiar la contraseña, para revocar otros dispositivos).
 */
export async function deleteOtherUserSessions(
  db: D1Database,
  userId: number,
  keepSessionId: string | null
): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
    .bind(userId, keepSessionId ?? '')
    .run();
}

/**
 * Clean up expired sessions
 */
export async function cleanupExpiredSessions(db: D1Database, now: number = Date.now()): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?')
    .bind(new Date(now).toISOString())
    .run();
}

/**
 * Segundos que le quedan a una sesión (para el Max-Age de la cookie),
 * de modo que la cookie caduque exactamente cuando caduca la sesión en D1.
 */
export function getSessionMaxAge(expiresAt: string, now: number = Date.now()): number {
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) return 0;
  return Math.max(0, Math.floor((expiresMs - now) / 1000));
}

/**
 * Header Set-Cookie completo para la cookie de sesión
 */
export function buildSessionCookie(sessionId: string, maxAge?: number): string {
  return `${SESSION_COOKIE_NAME}=${sessionId}; ${getSessionCookieOptions(maxAge)}`;
}

/**
 * Get session cookie options
 */
export function getSessionCookieOptions(maxAge?: number): string {
  const parts = [
    `Max-Age=${maxAge ?? Math.floor(SESSION_DURATION_MS / 1000)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];

  // Add Secure in production
  if (typeof window === 'undefined') {
    // Server-side, assume production
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Parse session ID from cookie header
 */
export function getSessionFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map(c => c.trim());
  const sessionCookie = cookies.find(c => c.startsWith(`${SESSION_COOKIE_NAME}=`));

  if (!sessionCookie) return null;
  return sessionCookie.split('=')[1] || null;
}

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'viewer';
}

/**
 * Authenticate user with username and password
 */
export async function authenticateUser(
  db: D1Database,
  username: string,
  password: string
): Promise<AdminUser | null> {
  const user = await db.prepare(`
    SELECT id, username, password_hash, display_name, role
    FROM admin_users
    WHERE username = ?
  `).bind(username.toLowerCase()).first<{
    id: number;
    username: string;
    password_hash: string;
    display_name: string;
    role: string;
  }>();

  if (!user) return null;

  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) return null;

  // Update last login
  await db.prepare(`
    UPDATE admin_users SET last_login = datetime('now') WHERE id = ?
  `).bind(user.id).run();

  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role as 'admin' | 'viewer'
  };
}
