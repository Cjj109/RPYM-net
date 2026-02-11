import { describe, it, expect } from 'vitest';
import { PAYMENT_METHOD_NAMES } from '../services/telegram/budget-handlers';

describe('telegram/budget-handlers', () => {
  describe('PAYMENT_METHOD_NAMES', () => {
    it('contains expected payment methods', () => {
      expect(PAYMENT_METHOD_NAMES.pago_movil).toBe('Pago Móvil');
      expect(PAYMENT_METHOD_NAMES.transferencia).toBe('Transferencia');
      expect(PAYMENT_METHOD_NAMES.zelle).toBe('Zelle');
      expect(PAYMENT_METHOD_NAMES.efectivo).toBe('Efectivo');
      expect(PAYMENT_METHOD_NAMES.tarjeta).toBe('Tarjeta');
      expect(PAYMENT_METHOD_NAMES.usdt).toBe('USDT');
      expect(PAYMENT_METHOD_NAMES.binance).toBe('Binance');
    });

    it('has 7 payment methods', () => {
      expect(Object.keys(PAYMENT_METHOD_NAMES)).toHaveLength(7);
    });
  });
});
