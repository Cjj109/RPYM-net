import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizePhone, isAdmin } from '../services/whatsapp/admin-handlers';
import { isNewTopicMessage, formatHistoryForGemini } from '../services/whatsapp/chat-handlers';
import { formatProductsForAI } from '../services/whatsapp/product-cache';
import { splitLongMessage } from '../services/whatsapp/wa-api';

// Mock console.log para isAdmin (evita ruido en tests)
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('whatsapp/admin-handlers', () => {
  describe('normalizePhone', () => {
    it('removes non-digit characters', () => {
      expect(normalizePhone('+58 414-214-5202')).toBe('584142145202');
      expect(normalizePhone('0414 214 52 02')).toBe('04142145202');
    });

    it('handles digits only', () => {
      expect(normalizePhone('584142145202')).toBe('584142145202');
    });

    it('handles empty string', () => {
      expect(normalizePhone('')).toBe('');
    });
  });

  describe('isAdmin', () => {
    it('returns true for admin phones', () => {
      expect(isAdmin('584142145202')).toBe(true);
      expect(isAdmin('584122939126')).toBe(true);
      expect(isAdmin('+58 414-214-5202')).toBe(true);
    });

    it('returns false for non-admin phones', () => {
      expect(isAdmin('584241234567')).toBe(false);
      expect(isAdmin('1234567890')).toBe(false);
    });
  });
});

describe('whatsapp/chat-handlers', () => {
  describe('isNewTopicMessage', () => {
    it('returns true for greetings', () => {
      expect(isNewTopicMessage('Hola')).toBe(true);
      expect(isNewTopicMessage('Buenos dias')).toBe(true);
      expect(isNewTopicMessage('Epale mi pana')).toBe(true);
    });

    it('returns true for price queries', () => {
      expect(isNewTopicMessage('Cuanto cuesta el camaron')).toBe(true);
      expect(isNewTopicMessage('Precio del pulpo')).toBe(true);
      expect(isNewTopicMessage('A que precio esta el langostino')).toBe(true);
    });

    it('returns true for product-only messages', () => {
      expect(isNewTopicMessage('calamares')).toBe(true);
      expect(isNewTopicMessage('y los calamares?')).toBe(true);
      expect(isNewTopicMessage('el pulpo?')).toBe(true);
    });

    it('returns true for admin commands', () => {
      expect(isNewTopicMessage('estado')).toBe(true);
      expect(isNewTopicMessage('status')).toBe(true);
    });

    it('returns false for follow-up messages', () => {
      expect(isNewTopicMessage('y si le agrego 2kg mas')).toBe(false);
      expect(isNewTopicMessage('ok perfecto gracias')).toBe(false);
    });
  });

  describe('formatHistoryForGemini', () => {
    it('converts chat history to Gemini format', () => {
      const history = [
        { role: 'user' as const, content: 'Hola' },
        { role: 'assistant' as const, content: '¡Épale!' },
      ];
      const result = formatHistoryForGemini(history);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: 'user', parts: [{ text: 'Hola' }] });
      expect(result[1]).toEqual({ role: 'model', parts: [{ text: '¡Épale!' }] });
    });

    it('handles empty history', () => {
      expect(formatHistoryForGemini([])).toEqual([]);
    });
  });
});

describe('whatsapp/product-cache', () => {
  describe('formatProductsForAI', () => {
    it('formats products by category', () => {
      const products = [
        { nombre: 'Camarón', precioUSD: 12, unidad: 'kg', disponible: true, categoria: 'Mariscos' } as any,
        { nombre: 'Pulpo', precioUSD: 18, unidad: 'kg', disponible: true, categoria: 'Mariscos' } as any,
      ];
      const result = formatProductsForAI(products, 36.5);
      expect(result).toContain('LISTA DE PRODUCTOS Y PRECIOS');
      expect(result).toContain('═══ MARISCOS ═══');
      expect(result).toContain('Camarón: $12.00 / Bs. 438.00 por kg');
      expect(result).toContain('Pulpo: $18.00 / Bs. 657.00 por kg');
    });

    it('excludes unavailable products', () => {
      const products = [
        { nombre: 'Camarón', precioUSD: 12, unidad: 'kg', disponible: false, categoria: 'Mariscos' } as any,
      ];
      const result = formatProductsForAI(products, 36.5);
      expect(result).not.toContain('Camarón');
    });
  });
});

describe('whatsapp/wa-api', () => {
  describe('splitLongMessage', () => {
    it('returns single part for short text', () => {
      const text = 'Hola mi pana';
      expect(splitLongMessage(text)).toEqual(['Hola mi pana']);
    });

    it('splits long text at paragraph boundaries', () => {
      const part1 = 'Primer párrafo.'.repeat(100);
      const part2 = 'Segundo párrafo.'.repeat(100);
      const text = part1 + '\n\n' + part2;
      const result = splitLongMessage(text, 500);
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.every(p => p.length <= 550)).toBe(true); // maxLen + overhead for indicators
    });

    it('adds part indicators for multiple parts', () => {
      const longText = 'x'.repeat(5000);
      const result = splitLongMessage(longText, 1000);
      expect(result.length).toBeGreaterThan(1);
      expect(result[0]).toMatch(/\(1\/\d+\)/);
      expect(result[result.length - 1]).toMatch(new RegExp(`\\(${result.length}/\\d+\\)`));
    });
  });
});
