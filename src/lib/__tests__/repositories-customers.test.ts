import { describe, it, expect } from 'vitest';
import { normalizeText, findCustomerByName } from '../repositories/customers';

const mockDb = (customers: { id: number; name: string }[]) => ({
  prepare: () => ({ all: async () => ({ results: customers }) }),
}) as any;

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

  describe('findCustomerByName (bot de Telegram)', () => {
    const CLIENTES = [
      { id: 1, name: 'Canastas del Mar' },
      { id: 2, name: 'José Luis' },
      { id: 3, name: 'Friteria Chon' },
    ];

    it('encuentra por nombre distintivo parcial', async () => {
      expect(await findCustomerByName(mockDb(CLIENTES), 'canastas')).toEqual({ id: 1, name: 'Canastas del Mar' });
      expect(await findCustomerByName(mockDb(CLIENTES), 'chon')).toEqual({ id: 3, name: 'Friteria Chon' });
    });

    it('"jose" no devuelve "José Luis" (el bot mostrará sugerencias)', async () => {
      expect(await findCustomerByName(mockDb(CLIENTES), 'jose')).toBe(null);
    });

    it('"jose luis" exacto sí lo encuentra, con o sin acento', async () => {
      expect(await findCustomerByName(mockDb(CLIENTES), 'jose luis')).toEqual({ id: 2, name: 'José Luis' });
    });
  });
});
