import { describe, it, expect } from 'vitest';
import {
  requireAuth,
  getAuthOptional,
  applySessionCookie,
  getValidatedSession,
  markValidatedSession,
} from '../require-auth';
import { SESSION_DURATION_MS } from '../auth';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Mock de D1: `sessionRow` es lo que devuelve el SELECT de sesión */
function createMockDb(sessionRow: Record<string, unknown> | null = null) {
  const updates: unknown[][] = [];
  const mockDb = {
    prepare: (sql: string) => {
      let args: unknown[] = [];
      const stmt = {
        bind: (...values: unknown[]) => { args = values; return stmt; },
        first: async () => sessionRow,
        run: async () => { if (/UPDATE sessions/.test(sql)) updates.push(args); return {}; },
        all: async () => ({ results: [] }),
      };
      return stmt;
    },
    dump: async () => new ArrayBuffer(0),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
  };
  return { mockDb, updates };
}

function localsWith(mockDb: unknown, env: Record<string, unknown> = {}) {
  return { runtime: { env: { DB: mockDb, ...env } } } as unknown as App.Locals;
}

function row(expiresAt: string, role = 'admin') {
  return { id: 1, username: 'carlos', display_name: 'Carlos', role, expires_at: expiresAt };
}

function requestWithSession(id = 'abc123') {
  return new Request('http://test/api/customer-ai', { headers: { Cookie: `foo=bar; rpym_session=${id}` } });
}

function maxAgeOf(setCookie: string | null): number {
  const match = setCookie?.match(/Max-Age=(\d+)/);
  return match ? Number(match[1]) : NaN;
}

describe('require-auth', () => {
  it('returns error Response when no db (500)', async () => {
    const request = new Request('http://test/', { headers: {} });
    const locals = {} as App.Locals;
    const result = await requireAuth(request, locals);
    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) {
      expect(result.status).toBe(500);
      const body = await result.json();
      expect(body.error).toContain('Database');
    }
  });

  it('returns 401 when db exists but no session cookie', async () => {
    const request = new Request('http://test/', { headers: { Cookie: 'foo=bar' } });
    const { mockDb } = createMockDb();
    const locals = localsWith(mockDb);
    const result = await requireAuth(request, locals);
    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) {
      expect(result.status).toBe(401);
      expect((await result.json()).error).toBe('No autenticado');
    }
    expect(getValidatedSession(locals)).toBe(null);
  });

  it('returns 401 "Sesión inválida" when the session does not exist or expired', async () => {
    const { mockDb } = createMockDb(null);
    const locals = localsWith(mockDb);
    const result = await requireAuth(requestWithSession(), locals);
    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) {
      expect(result.status).toBe(401);
      expect((await result.json()).error).toBe('Sesión inválida');
    }
    expect(getValidatedSession(locals)).toBe(null);
  });

  describe('sesión deslizante', () => {
    it('una sesión a punto de vencer se renueva en D1 y queda anotada para refrescar la cookie', async () => {
      const { mockDb, updates } = createMockDb(row(new Date(Date.now() + HOUR).toISOString()));
      const locals = localsWith(mockDb);
      const result = await requireAuth(requestWithSession('abc123'), locals);
      expect(result).not.toBeInstanceOf(Response);
      expect(updates).toHaveLength(1);

      const validated = getValidatedSession(locals)!;
      expect(validated.sessionId).toBe('abc123');
      expect(Date.parse(validated.expiresAt)).toBeGreaterThan(Date.now() + SESSION_DURATION_MS - HOUR);

      const response = applySessionCookie(locals, new Response('{}'));
      const setCookie = response.headers.get('Set-Cookie');
      expect(setCookie).toContain('rpym_session=abc123');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Lax');
      expect(maxAgeOf(setCookie)).toBeGreaterThan(29 * 24 * 60 * 60);
    });

    it('sin renovación en D1 la cookie igual se reenvía con el Max-Age restante de la sesión', async () => {
      const expiresAt = new Date(Date.now() + SESSION_DURATION_MS - 2 * HOUR).toISOString();
      const { mockDb, updates } = createMockDb(row(expiresAt));
      const locals = localsWith(mockDb);
      await requireAuth(requestWithSession(), locals);
      expect(updates).toHaveLength(0);

      const response = applySessionCookie(locals, new Response('{}'));
      const maxAge = maxAgeOf(response.headers.get('Set-Cookie'));
      const expected = Math.floor((Date.parse(expiresAt) - Date.now()) / 1000);
      expect(Math.abs(maxAge - expected)).toBeLessThanOrEqual(2);
    });

    it('getAuthOptional (/api/auth/me) también renueva y anota la sesión', async () => {
      const { mockDb, updates } = createMockDb(row(new Date(Date.now() + 2 * DAY).toISOString()));
      const locals = localsWith(mockDb);
      const auth = await getAuthOptional(requestWithSession('xyz'), locals);
      expect(auth.user?.username).toBe('carlos');
      expect(updates).toHaveLength(1);
      expect(getValidatedSession(locals)?.sessionId).toBe('xyz');
    });

    it('con rol insuficiente devuelve 403 pero la sesión sigue viva', async () => {
      const { mockDb } = createMockDb(row(new Date(Date.now() + 2 * DAY).toISOString(), 'viewer'));
      const locals = localsWith(mockDb);
      const result = await requireAuth(requestWithSession(), locals, { role: 'admin' });
      expect(result instanceof Response && result.status).toBe(403);
      expect(getValidatedSession(locals)).not.toBe(null);
    });

    it('Bearer de Bot 2 no toca cookies', async () => {
      const { mockDb } = createMockDb();
      const locals = localsWith(mockDb, { BOT2_API_KEY: 'secreto' });
      const request = new Request('http://test/', { headers: { Authorization: 'Bearer secreto' } });
      const result = await requireAuth(request, locals);
      expect(result).not.toBeInstanceOf(Response);
      expect(getValidatedSession(locals)).toBe(null);
    });
  });

  describe('applySessionCookie', () => {
    it('no toca la respuesta si no se validó ninguna sesión', () => {
      const original = new Response('{}');
      const response = applySessionCookie({} as App.Locals, original);
      expect(response).toBe(original);
      expect(response.headers.get('Set-Cookie')).toBe(null);
    });

    it('no pisa la cookie que fija el propio endpoint (login/logout)', () => {
      const locals = {} as App.Locals;
      markValidatedSession(locals, { sessionId: 'vieja', expiresAt: new Date(Date.now() + DAY).toISOString() });
      const original = new Response('{}', { headers: { 'Set-Cookie': 'rpym_session=; Path=/; Max-Age=0' } });
      const response = applySessionCookie(locals, original);
      expect(response.headers.get('Set-Cookie')).toBe('rpym_session=; Path=/; Max-Age=0');
    });

    it('funciona con respuestas de headers inmutables (redirect)', () => {
      const locals = {} as App.Locals;
      markValidatedSession(locals, { sessionId: 'abc', expiresAt: new Date(Date.now() + DAY).toISOString() });
      const response = applySessionCookie(locals, Response.redirect('http://test/admin/presupuestos', 302));
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('http://test/admin/presupuestos');
      expect(response.headers.get('Set-Cookie')).toContain('rpym_session=abc');
    });
  });
});
