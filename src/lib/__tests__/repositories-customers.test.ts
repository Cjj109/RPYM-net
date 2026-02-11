import { describe, it, expect } from 'vitest';
import { normalizeText } from '../repositories/customers';

describe('repositories/customers', () => {
  describe('normalizeText', () => {
    it('removes accents from text', () => {
      expect(normalizeText('Raúl')).toBe('raul');
      expect(normalizeText('José')).toBe('jose');
      expect(normalizeText('ÁÉÍÓÚ')).toBe('aeiou');
    });

    it('handles already normalized text', () => {
      expect(normalizeText('carlos')).toBe('carlos');
      expect(normalizeText('delcy')).toBe('delcy');
    });

    it('handles mixed case', () => {
      expect(normalizeText('Friteria Chon')).toBe('friteria chon');
    });
  });
});
