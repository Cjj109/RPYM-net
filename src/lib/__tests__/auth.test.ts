import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  generateSessionId,
  getSessionFromCookie,
  getSessionCookieOptions,
  buildSessionCookie,
  createSession,
  validateSession,
  shouldRenewSession,
  getSessionMaxAge,
  cleanupExpiredSessions,
  deleteOtherUserSessions,
  SESSION_DURATION_MS,
  SESSION_RENEW_INTERVAL_MS,
} from '../auth';
import type { D1Database } from '../d1-types';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-11T15:00:00.000Z');

interface Call { sql: string; args: unknown[]; method: 'first' | 'run' | 'all' }

/** Mock de D1 que registra las consultas y permite simular filas/errores */
function createMockDb(opts: {
  sessionRow?: Record<string, unknown> | null;
  failUpdate?: boolean;
} = {}) {
  const calls: Call[] = [];
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) { args = values; return stmt; },
        async first() {
          calls.push({ sql, args, method: 'first' });
          return opts.sessionRow ?? null;
        },
        async run() {
          calls.push({ sql, args, method: 'run' });
          if (opts.failUpdate && /UPDATE sessions/.test(sql)) throw new Error('D1 caído');
          return { success: true, meta: {} };
        },
        async all() {
          calls.push({ sql, args, method: 'all' });
          return { results: [] };
        },
      };
      return stmt;
    },
    dump: async () => new ArrayBuffer(0),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
  };
  return { db: db as unknown as D1Database, calls };
}

function sessionRow(expiresAt: string) {
  return { id: 1, username: 'carlos', display_name: 'Carlos', role: 'admin', expires_at: expiresAt };
}

describe('auth', () => {
  describe('hashPassword / verifyPassword', () => {
    it('hashes and verifies password correctly', async () => {
      const password = 'TestPassword123!';
      const hash = await hashPassword(password);
      expect(hash).toBeTruthy();
      expect(hash).not.toBe(password);
      expect(await verifyPassword(password, hash)).toBe(true);
      expect(await verifyPassword('wrong', hash)).toBe(false);
    });

    it('produces different hashes for same password (salt)', async () => {
      const password = 'same';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      expect(hash1).not.toBe(hash2);
      expect(await verifyPassword(password, hash1)).toBe(true);
      expect(await verifyPassword(password, hash2)).toBe(true);
    });
  });

  describe('generateSessionId', () => {
    it('generates 64-char hex string', () => {
      const id = generateSessionId();
      expect(id).toHaveLength(64);
      expect(id).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('getSessionFromCookie', () => {
    it('extracts session from cookie header', () => {
      const cookie = 'other=xyz; rpym_session=abc123; foo=bar';
      expect(getSessionFromCookie(cookie)).toBe('abc123');
    });

    it('returns null when no session cookie', () => {
      expect(getSessionFromCookie(null)).toBe(null);
      expect(getSessionFromCookie('')).toBe(null);
      expect(getSessionFromCookie('foo=bar')).toBe(null);
    });
  });

  describe('cookie de sesión', () => {
    it('es persistente (Max-Age de 180 días) y mantiene HttpOnly, Secure y SameSite=Lax', () => {
      const opts = getSessionCookieOptions();
      expect(SESSION_DURATION_MS).toBe(180 * DAY);
      expect(opts).toContain(`Max-Age=${180 * 24 * 60 * 60}`);
      expect(opts).toContain('Path=/');
      expect(opts).toContain('HttpOnly');
      expect(opts).toContain('Secure');
      expect(opts).toContain('SameSite=Lax');
    });

    it('buildSessionCookie arma el header con el id y el Max-Age indicado', () => {
      const cookie = buildSessionCookie('abc', 1234);
      expect(cookie.startsWith('rpym_session=abc; ')).toBe(true);
      expect(cookie).toContain('Max-Age=1234');
      expect(cookie).toContain('HttpOnly');
    });
  });

  describe('createSession', () => {
    it('guarda la sesión con expiración ISO a 180 días', async () => {
      const { db, calls } = createMockDb();
      const id = await createSession(db, 7, NOW);
      expect(id).toMatch(/^[0-9a-f]{64}$/);
      const insert = calls.find(c => /INSERT INTO sessions/.test(c.sql))!;
      expect(insert.args).toEqual([id, 7, new Date(NOW + SESSION_DURATION_MS).toISOString()]);
    });

    it('no borra sesiones de otros dispositivos al iniciar sesión', async () => {
      const { db, calls } = createMockDb();
      await createSession(db, 7, NOW);
      expect(calls.some(c => /DELETE/.test(c.sql))).toBe(false);
    });
  });

  describe('validateSession (expiración deslizante)', () => {
    it('devuelve null sin id de sesión', async () => {
      const { db, calls } = createMockDb();
      expect(await validateSession(db, '', NOW)).toBe(null);
      expect(calls).toHaveLength(0);
    });

    it('devuelve null si la sesión no existe o ya venció', async () => {
      const { db } = createMockDb({ sessionRow: null });
      expect(await validateSession(db, 'abc', NOW)).toBe(null);
    });

    it('compara la expiración contra "ahora" en ISO (mismo formato que expires_at)', async () => {
      const { db, calls } = createMockDb({ sessionRow: null });
      await validateSession(db, 'abc', NOW);
      const select = calls.find(c => c.method === 'first')!;
      expect(select.sql).toContain('s.expires_at > ?');
      expect(select.sql).not.toContain("datetime('now')");
      expect(select.args).toEqual(['abc', new Date(NOW).toISOString()]);
    });

    it('no escribe en D1 si la sesión se renovó hace menos de un día', async () => {
      const expiresAt = new Date(NOW + SESSION_DURATION_MS - 2 * HOUR).toISOString();
      const { db, calls } = createMockDb({ sessionRow: sessionRow(expiresAt) });
      const result = await validateSession(db, 'abc', NOW);
      expect(result).not.toBe(null);
      expect(result!.user).toEqual({ id: 1, username: 'carlos', displayName: 'Carlos', role: 'admin' });
      expect(result!.renewed).toBe(false);
      expect(result!.expiresAt).toBe(expiresAt);
      expect(calls.some(c => /UPDATE sessions/.test(c.sql))).toBe(false);
    });

    it('extiende la sesión 180 días desde ahora cuando el usuario la usa (antes caducaba fija a los 7 días)', async () => {
      // Sesión creada hace 6 días y 23 h con el TTL viejo de 7 días: le queda 1 hora
      const expiresAt = new Date(NOW + HOUR).toISOString();
      const { db, calls } = createMockDb({ sessionRow: sessionRow(expiresAt) });
      const result = await validateSession(db, 'abc', NOW);
      const newExpiresAt = new Date(NOW + SESSION_DURATION_MS).toISOString();
      expect(result!.renewed).toBe(true);
      expect(result!.expiresAt).toBe(newExpiresAt);
      const update = calls.find(c => /UPDATE sessions/.test(c.sql))!;
      expect(update.args).toEqual([newExpiresAt, 'abc']);
    });

    it('si falla el UPDATE la sesión sigue válida (no se echa al usuario)', async () => {
      const expiresAt = new Date(NOW + 3 * DAY).toISOString();
      const { db } = createMockDb({ sessionRow: sessionRow(expiresAt), failUpdate: true });
      const result = await validateSession(db, 'abc', NOW);
      expect(result).not.toBe(null);
      expect(result!.renewed).toBe(false);
      expect(result!.expiresAt).toBe(expiresAt);
    });
  });

  describe('shouldRenewSession', () => {
    it('renueva solo cuando pasó más del intervalo desde la última renovación', () => {
      const justRenewed = new Date(NOW + SESSION_DURATION_MS).toISOString();
      const almostDay = new Date(NOW + SESSION_DURATION_MS - SESSION_RENEW_INTERVAL_MS + HOUR).toISOString();
      const overDay = new Date(NOW + SESSION_DURATION_MS - SESSION_RENEW_INTERVAL_MS - HOUR).toISOString();
      expect(shouldRenewSession(justRenewed, NOW)).toBe(false);
      expect(shouldRenewSession(almostDay, NOW)).toBe(false);
      expect(shouldRenewSession(overDay, NOW)).toBe(true);
      expect(shouldRenewSession('fecha-rota', NOW)).toBe(true);
    });
  });

  describe('getSessionMaxAge', () => {
    it('devuelve los segundos restantes de la sesión en D1', () => {
      expect(getSessionMaxAge(new Date(NOW + 10 * DAY).toISOString(), NOW)).toBe(10 * 24 * 60 * 60);
      expect(getSessionMaxAge(new Date(NOW - HOUR).toISOString(), NOW)).toBe(0);
      expect(getSessionMaxAge('fecha-rota', NOW)).toBe(0);
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('borra solo sesiones vencidas comparando en ISO', async () => {
      const { db, calls } = createMockDb();
      await cleanupExpiredSessions(db, NOW);
      expect(calls[0].sql).toContain('expires_at < ?');
      expect(calls[0].args).toEqual([new Date(NOW).toISOString()]);
    });
  });

  describe('deleteOtherUserSessions', () => {
    it('borra las sesiones del usuario excepto la actual', async () => {
      const { db, calls } = createMockDb();
      await deleteOtherUserSessions(db, 7, 'actual');
      expect(calls[0].sql).toContain('WHERE user_id = ? AND id != ?');
      expect(calls[0].args).toEqual([7, 'actual']);
    });
  });
});
