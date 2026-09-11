import { describe, it, expect } from 'vitest';
import { resolveCustomer, isGenericFirstName, findCustomerInText, type MatchCustomer } from '../customer-match';

const CANASTAS = { id: 1, name: 'Canastas del Mar' };
const JOSE_LUIS = { id: 2, name: 'José Luis' };
const JOSE = { id: 3, name: 'José' };
const JOSE_GARCIA = { id: 4, name: 'Jose Garcia' };
const DELICIAS = { id: 5, name: 'Delicias de la Nona' };
const DELCY = { id: 6, name: 'Delcy' };
const MARIA_F = { id: 7, name: 'Maria Fernanda' };
const MARIA_J = { id: 8, name: 'Maria Jose' };
const JOSEFINA = { id: 9, name: 'Josefina Rodriguez' };
const MARIA_PEREZ = { id: 10, name: 'Maria Perez' };
const JL_PEREZ = { id: 11, name: 'José Luis Pérez' };

const resolve = (customers: MatchCustomer[], input: Parameters<typeof resolveCustomer>[0]) =>
  resolveCustomer(input, customers);

describe('resolveCustomer', () => {
  it('"canastas" asigna "Canastas del Mar" (parcial único y distintivo)', () => {
    const r = resolve([CANASTAS, JOSE_LUIS], { text: 'canastas 3kg pulpo', writtenName: 'canastas', aiCustomerId: 1 });
    expect(r).toEqual({ id: 1, name: 'Canastas del Mar', suggestion: null });
  });

  it('"canasta" en singular también encuentra "Canastas del Mar"', () => {
    const r = resolve([CANASTAS], { text: 'canasta 3kg pulpo', writtenName: 'canasta', aiCustomerId: null });
    expect(r.id).toBe(1);
  });

  it('"jose" NO se asigna solo a "José Luis": queda como nuevo con sugerencia', () => {
    const r = resolve([CANASTAS, JOSE_LUIS], { text: 'jose 2kg jaiba', writtenName: 'jose', aiCustomerId: 2, aiCustomerName: 'José Luis' });
    expect(r).toEqual({ id: null, name: 'jose', suggestion: JOSE_LUIS });
  });

  it('"luis" tampoco se asigna solo a "José Luis"', () => {
    const r = resolve([JOSE_LUIS], { text: 'luis 1kg pulpo', writtenName: 'luis', aiCustomerId: 2 });
    expect(r.id).toBe(null);
    expect(r.suggestion).toEqual(JOSE_LUIS);
  });

  it('"jose luis" contra "José Luis Pérez" pide confirmación (solo nombres de pila)', () => {
    const r = resolve([JL_PEREZ], { text: 'jose luis 1kg pulpo', writtenName: 'jose luis', aiCustomerId: 11 });
    expect(r.id).toBe(null);
    expect(r.suggestion).toEqual(JL_PEREZ);
  });

  it('"jose" con "José" y "José Luis" registrados usa "José" (exacto)', () => {
    const r = resolve([JOSE_LUIS, JOSE], { text: 'jose 2kg jaiba', writtenName: 'jose', aiCustomerId: 2 });
    expect(r).toEqual({ id: 3, name: 'José', suggestion: null });
  });

  it('"jose luis" exacto asigna "José Luis"', () => {
    const r = resolve([JOSE_LUIS, JOSE], { text: 'jose luis 2kg', writtenName: 'Jose Luis', aiCustomerId: 2 });
    expect(r.id).toBe(2);
  });

  it('"garcia" asigna "Jose Garcia" (apellido distintivo)', () => {
    const r = resolve([JOSE_GARCIA], { text: 'garcia 1kg calamar', writtenName: 'garcia', aiCustomerId: 4 });
    expect(r.id).toBe(4);
  });

  it('"Delsy" no se asigna a "Delicias de la Nona" aunque la IA lo elija', () => {
    const r = resolve([DELICIAS], { text: 'Delsy: 2kg jumbo', writtenName: 'Delsy', aiCustomerId: 5 });
    expect(r).toEqual({ id: null, name: 'Delsy', suggestion: null });
  });

  it('dictado "delsi" encuentra "Delcy" por cómo suena', () => {
    const r = resolve([DELCY, DELICIAS], { text: 'delsi 2 kilos jumbo', writtenName: 'delsi', aiCustomerId: 6 });
    expect(r.id).toBe(6);
  });

  it('"maria" con dos Marías no asigna; si la IA eligió una, queda como sugerencia', () => {
    const sinIA = resolve([MARIA_F, MARIA_J], { text: 'maria 1kg', writtenName: 'maria', aiCustomerId: null });
    expect(sinIA).toEqual({ id: null, name: 'maria', suggestion: null });
    const conIA = resolve([MARIA_F, MARIA_J], { text: 'maria 1kg', writtenName: 'maria', aiCustomerId: 7 });
    expect(conIA.id).toBe(null);
    expect(conIA.suggestion).toEqual(MARIA_F);
  });

  it('"jose" no confunde a "Josefina" ni "mar" a "Maria Perez"', () => {
    expect(resolve([JOSEFINA], { text: 'jose 1kg', writtenName: 'jose' }).suggestion).toBe(null);
    expect(resolve([MARIA_PEREZ], { text: 'mar 1kg', writtenName: 'mar' }).id).toBe(null);
  });

  it('"cliente" y sin nombre dan "Cliente"', () => {
    expect(resolve([JOSE], { text: 'cliente 1kg', writtenName: 'cliente' })).toEqual({ id: null, name: 'Cliente', suggestion: null });
    expect(resolve([JOSE], { text: '1kg pulpo', aiCustomerName: '' })).toEqual({ id: null, name: 'Cliente', suggestion: null });
  });

  it('el nombre completo del cliente dentro de lo escrito también sirve', () => {
    const CHON = { id: 20, name: 'Friteria Chon' };
    expect(resolve([CHON], { text: 'friteria chon centro 2kg', writtenName: 'friteria chon centro' }).id).toBe(20);
    // pero un cliente que se llama solo "José" no se asigna a "jose luis"
    expect(resolve([JOSE], { text: 'jose luis 1kg', writtenName: 'jose luis' })).toEqual({ id: null, name: 'jose luis', suggestion: JOSE });
  });

  it('un id inventado por la IA se ignora y se usa el nombre escrito', () => {
    const r = resolve([JOSE], { text: 'Pedro 1kg', writtenName: 'Pedro', aiCustomerId: 999 });
    expect(r).toEqual({ id: null, name: 'Pedro', suggestion: null });
  });

  describe('sin writtenName (la IA no lo devolvió)', () => {
    it('valida contra el texto: "jose" en el texto y la IA eligió "José Luis" → sugerencia', () => {
      const r = resolve([JOSE_LUIS], { text: 'anota a jose 2kg jaiba', aiCustomerId: 2, aiCustomerName: 'José Luis' });
      expect(r).toEqual({ id: null, name: 'José', suggestion: JOSE_LUIS });
    });

    it('"canastas" en el texto confirma "Canastas del Mar"', () => {
      const r = resolve([CANASTAS], { text: 'canastas 3kg pulpo', aiCustomerId: 1, aiCustomerName: 'Canastas del Mar' });
      expect(r.id).toBe(1);
    });

    it('si ninguna palabra del cliente elegido aparece, usa el nombre escrito en el texto', () => {
      const r = resolve([DELICIAS], { text: 'Delsy: 2kg jumbo', aiCustomerId: 5, aiCustomerName: 'Delicias de la Nona' });
      expect(r).toEqual({ id: null, name: 'Delsy', suggestion: null });
    });
  });
});

describe('isGenericFirstName', () => {
  it('reconoce nombres de pila comunes, con o sin acento', () => {
    expect(isGenericFirstName('José')).toBe(true);
    expect(isGenericFirstName('jose luis')).toBe(true);
    expect(isGenericFirstName('María')).toBe(true);
  });
  it('no marca nombres distintivos', () => {
    expect(isGenericFirstName('canastas')).toBe(false);
    expect(isGenericFirstName('garcia')).toBe(false);
    expect(isGenericFirstName('jose garcia')).toBe(false);
  });
});

describe('findCustomerInText', () => {
  it('encuentra al cliente por nombre completo o palabra distintiva', () => {
    expect(findCustomerInText('jose 2kg jaiba', [JOSE_LUIS, JOSE])).toEqual(JOSE);
    expect(findCustomerInText('canastas 3kg pulpo', [CANASTAS, JOSE_LUIS])).toEqual(CANASTAS);
  });

  it('un nombre de pila suelto no basta ("jose" con solo "José Luis")', () => {
    expect(findCustomerInText('jose 2kg jaiba', [JOSE_LUIS])).toBe(null);
  });

  it('no confunde palabras del catálogo con clientes', () => {
    const PULPO_LOCO = { id: 30, name: 'Pulpo Loco' };
    expect(findCustomerInText('2kg pulpo', [PULPO_LOCO], ['Pulpo Mediano'])).toBe(null);
    expect(findCustomerInText('pulpo loco 2kg jaiba', [PULPO_LOCO], ['Pulpo Mediano'])).toEqual(PULPO_LOCO);
  });

  it('con empate no elige', () => {
    expect(findCustomerInText('maria 1kg', [MARIA_F, MARIA_J])).toBe(null);
  });
});
