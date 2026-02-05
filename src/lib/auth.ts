/**
 * RPYM - Authentication utilities
 * Uses Web Crypto API (available in Cloudflare Workers)
 */

import type { D1Database } from './d1-types';

// Session duration: 7 days
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

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
export async function createSession(db: D1Database, userId: number): Promise<string> {
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  await db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (?, ?, ?)
  `).bind(sessionId, userId, expiresAt).run();

  return sessionId;
}

/**
 * Validate a session and return user info
 */
export async function validateSession(db: D1Database, sessionId: string): Promise<AdminUser | null> {
  if (!sessionId) return null;

  const result = await db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role
    FROM sessions s
    JOIN admin_users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > datetime('now')
  `).bind(sessionId).first<{
    id: number;
    username: string;
    display_name: string;
    role: string;
  }>();

  if (!result) return null;

  return {
    id: result.id,
    username: result.username,
    displayName: result.display_name,
    role: result.role as 'admin' | 'viewer'
  };
}

/**
 * Delete a session (logout)
 */
export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

/**
 * Clean up expired sessions
 */
export async function cleanupExpiredSessions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
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
  const sessionCookie = cookies.find(c => c.startsWith('rpym_session='));

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
