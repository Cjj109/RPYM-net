import { describe, it, expect } from 'vitest';
import { requireAuth } from '../require-auth';

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
    const mockDb = {
      prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({}), all: async () => ({ results: [] }) }) }),
      dump: async () => new ArrayBuffer(0),
      batch: async () => [],
      exec: async () => ({ count: 0, duration: 0 }),
    };
    const locals = { runtime: { env: { DB: mockDb } } } as unknown as App.Locals;
    const result = await requireAuth(request, locals);
    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) {
      expect(result.status).toBe(401);
    }
  });
});
