import { describe, it, expect } from 'vitest';
import {
  singularizeWord,
  tokenizeForMatch,
  matchRecommendationsToProducts,
} from '../jose-product-match';
import type { Product } from '../sheets';

/** Catalogo reducido con los nombres reales del negocio. */
const NOMBRES = [
  'Camaron Vivito (concha)',
  'Camaron Jumbo',
  'Camaron Pelado',
  'Camaron Desvenado',
  'Calamar Nacional',
  'Calamar Nacional Grande',
  'Cuerpo de calamar limpio',
  'Camaron 61/70',
  'Pulpo Pequeno',
  'Mejillon Concha',
  'Almeja',
  'Langostino Blanco',
  'Tentaculo de calamar',
  'Tinta de Calamar',
  'Pepitona (Caja de 10kg)',
];

const productos: Product[] = NOMBRES.map((nombre, i) => ({
  id: String(i + 1),
  nombre,
  descripcion: '',
  descripcionCorta: '',
  descripcionHome: '',
  categoria: 'mariscos',
  precioUSD: 10,
  precioBs: 1000,
  unidad: 'kg',
  disponible: true,
  incremento: 0.5,
  esCaja: nombre.includes('Caja'),
}));

/** Devuelve los nombres de producto emparejados, en orden. */
function emparejar(nombres: string[]): string[] {
  const recs = nombres.map(nombre => ({ nombre, kg: 0.3 }));
  return matchRecommendationsToProducts(recs, productos).map(m => m.product.nombre);
}

describe('singularizeWord', () => {
  it('pasa a singular los plurales en -es', () => {
    expect(singularizeWord('camarones')).toBe('camaron');
    expect(singularizeWord('calamares')).toBe('calamar');
    expect(singularizeWord('mejillones')).toBe('mejillon');
  });

  it('pasa a singular los plurales en -s', () => {
    expect(singularizeWord('pulpos')).toBe('pulpo');
    expect(singularizeWord('almejas')).toBe('almeja');
  });

  it('no toca palabras cortas ni singulares', () => {
    expect(singularizeWord('mes')).toBe('mes');
    expect(singularizeWord('jaiba')).toBe('jaiba');
    expect(singularizeWord('camaron')).toBe('camaron');
  });
});

describe('tokenizeForMatch', () => {
  it('quita acentos, parentesis y palabras vacias', () => {
    expect(tokenizeForMatch('Camaron Vivito (concha)')).toEqual(['camaron', 'vivito']);
    expect(tokenizeForMatch('Cuerpo de calamar limpio')).toEqual(['cuerpo', 'calamar', 'limpio']);
  });
});

describe('matchRecommendationsToProducts', () => {
  // Caso reportado: Jose recomendaba dos productos y solo aparecia el boton
  // del primero, porque "calamar pota" no coincidia con ningun nombre completo.
  it('empareja TODOS los productos de una receta, no solo el primero', () => {
    expect(emparejar(['camaron vivito', 'calamar pota'])).toEqual([
      'Camaron Vivito (concha)',
      'Calamar Nacional',
    ]);
  });

  it('empareja cuando Jose escribe en plural', () => {
    expect(emparejar(['camarones', 'calamares', 'mejillones'])).toEqual([
      'Camaron Vivito (concha)',
      'Calamar Nacional',
      'Mejillon Concha',
    ]);
  });

  it('prefiere el producto cuyo sustantivo principal coincide', () => {
    // "Tinta de Calamar" tambien contiene "calamar", pero no es el ingrediente.
    expect(emparejar(['calamar'])).toEqual(['Calamar Nacional']);
  });

  it('respeta los nombres especificos', () => {
    expect(emparejar(['camaron pelado', 'camaron jumbo'])).toEqual([
      'Camaron Pelado',
      'Camaron Jumbo',
    ]);
    expect(emparejar(['tentaculo de calamar'])).toEqual(['Tentaculo de calamar']);
    expect(emparejar(['tinta de calamar'])).toEqual(['Tinta de Calamar']);
  });

  it('no repite el mismo producto dos veces', () => {
    // Ambas recomendaciones caen en el mismo producto; solo debe salir un boton
    // porque el render usa product.id como key de React.
    expect(emparejar(['camaron', 'camarones'])).toEqual(['Camaron Vivito (concha)']);
  });

  it('omite los productos no disponibles y las cajas', () => {
    expect(emparejar(['pepitona'])).toEqual([]);
  });

  it('conserva la cantidad sugerida por Jose', () => {
    const out = matchRecommendationsToProducts(
      [{ nombre: 'camaron vivito', kg: 0.5 }, { nombre: 'calamar pota', kg: 0.4 }],
      productos
    );
    expect(out.map(m => m.quantity)).toEqual([0.5, 0.4]);
  });

  it('deja sin cantidad cuando Jose no la indica', () => {
    const out = matchRecommendationsToProducts([{ nombre: 'almeja', kg: 0 }], productos);
    expect(out[0].quantity).toBeUndefined();
  });

  it('no inventa emparejamientos cuando no hay relacion', () => {
    expect(emparejar(['pollo', 'chorizo'])).toEqual([]);
  });
});
