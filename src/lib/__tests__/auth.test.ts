import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  generateSessionId,
  getSessionFromCookie,
} from '../auth';

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
});
