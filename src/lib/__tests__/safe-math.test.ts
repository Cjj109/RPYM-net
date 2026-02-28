import { describe, it, expect } from 'vitest';
import { evalMathExpr } from '../safe-math';

describe('evalMathExpr', () => {
  it('números simples', () => {
    expect(evalMathExpr('5')).toBe(5);
    expect(evalMathExpr('0')).toBe(0);
    expect(evalMathExpr('3.14')).toBeCloseTo(3.14);
  });

  it('aritmética básica', () => {
    expect(evalMathExpr('3+4')).toBe(7);
    expect(evalMathExpr('10-3')).toBe(7);
    expect(evalMathExpr('6*7')).toBe(42);
    expect(evalMathExpr('15/3')).toBe(5);
  });

  it('decimales con comas', () => {
    expect(evalMathExpr('3,14')).toBeCloseTo(3.14);
    expect(evalMathExpr('1,5+2,5')).toBeCloseTo(4.0);
  });

  it('precedencia de operadores', () => {
    expect(evalMathExpr('2+3*4')).toBe(14);
    expect(evalMathExpr('2*3+4')).toBe(10);
    expect(evalMathExpr('10-2*3')).toBe(4);
    expect(evalMathExpr('10/2+3')).toBe(8);
  });

  it('paréntesis', () => {
    expect(evalMathExpr('(2+3)*4')).toBe(20);
    expect(evalMathExpr('2*(3+4)')).toBe(14);
    expect(evalMathExpr('(10-2)*(3+1)')).toBe(32);
    expect(evalMathExpr('((2+3))')).toBe(5);
  });

  it('menos unario', () => {
    expect(evalMathExpr('-5')).toBe(-5);
    expect(evalMathExpr('(-3)+4')).toBe(1);
    expect(evalMathExpr('-(2+3)')).toBe(-5);
    expect(evalMathExpr('-2*3')).toBe(-6);
  });

  it('división por cero retorna 0', () => {
    expect(evalMathExpr('10/0')).toBe(0);
  });

  it('input inválido retorna 0', () => {
    expect(evalMathExpr('')).toBe(0);
    expect(evalMathExpr('abc')).toBe(0);
    expect(evalMathExpr('   ')).toBe(0);
  });

  it('operador al final se ignora gracefully', () => {
    // El tokenizer debería manejar esto sin crashear
    const result = evalMathExpr('5+');
    expect(typeof result).toBe('number');
  });

  it('expresiones complejas', () => {
    expect(evalMathExpr('100+50*2-25/5')).toBe(195);
    expect(evalMathExpr('(100+50)*2')).toBe(300);
  });

  it('espacios son ignorados', () => {
    expect(evalMathExpr(' 3 + 4 ')).toBe(7);
    expect(evalMathExpr('10 * 2')).toBe(20);
  });

  it('caracteres especiales son eliminados', () => {
    expect(evalMathExpr('$100')).toBe(100);
    expect(evalMathExpr('Bs.50')).toBeCloseTo(0.5); // 'B' y 's' se eliminan, queda .50
  });

  it('plus unario es ignorado', () => {
    expect(evalMathExpr('+5')).toBe(5);
    expect(evalMathExpr('(+3)+4')).toBe(7);
  });
});
