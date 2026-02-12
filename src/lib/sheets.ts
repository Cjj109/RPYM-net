// Configuracion de Google Sheets (fallback) y D1 (primary)
// El sistema intenta leer de D1 primero, y si falla usa Google Sheets como fallback.
// Para obtener el SHEET_ID: abrir tu Google Sheet y copiar el ID de la URL
// URL: https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit
// IMPORTANTE: El Sheet debe estar compartido como "Cualquier persona con el enlace puede ver"

import type { D1Database } from './d1-types';

const SHEET_ID = import.meta.env.PUBLIC_SHEET_ID || 'TU_SHEET_ID_AQUI';

interface D1ProductRow {
  id: number;
  nombre: string;
  descripcion: string | null;
  descripcion_corta: string | null;
  descripcion_home: string | null;
  categoria: string;
  precio_usd: number;
  precio_usd_divisa: number | null;
  unidad: string;
  disponible: number;
  sort_order: number;
}

export interface Product {
  id: string;
  nombre: string;
  descripcion: string;
  descripcionCorta: string;
  descripcionHome: string; // Descripción ultra-corta (5-7 palabras) para la home
  categoria: string;
  precioUSD: number;
  precioUSDDivisa?: number | null;
  precioBs: number;
  unidad: string;
  disponible: boolean;
  masVendido?: boolean;
  incremento: number; // Salto de cantidad (0.5 para kg, 1 para cajas/paquetes)
  esCaja?: boolean; // Para ordenar cajas al final
  minimoKg?: number; // Cantidad mínima para productos que vienen en tamaños naturales
  entradaLibre?: boolean; // Si permite entrada libre de decimales (ej: 0.250, 0.350)
}

// Palabras clave para identificar productos más vendidos (búsqueda parcial en nombre)
const MAS_VENDIDOS_KEYWORDS = [
  'pepitona',
  'vivito',
  'jumbo',
  'calamar nacional',
  'pulpo mediano',
  'langostino',
  'guacuco',
  'mejillón con concha',
  'mejillon con concha',
];

/**
 * Genera una descripción corta enfocada en lo esencial del producto
 * Descripciones personalizadas con enfoque comercial
 */
function generarDescripcionCorta(descripcion: string, nombre: string): string {
  if (!descripcion) return '';

  const nombreLower = nombre.toLowerCase();

  // ═══════════════════════════════════════════════════════════════════
  // CAMARONES EN CONCHA
  // ═══════════════════════════════════════════════════════════════════

  if (nombreLower.includes('vivito')) {
    return 'Súper fresco con sabor a mar. Ideal para sopas, arroces y guisos.';
  }

  if (nombreLower.includes('jumbo') && nombreLower.includes('concha')) {
    return 'Más grande, más presencia. Perfecto para parrilla y pastas.';
  }

  // Camarón Jumbo (sin especificar concha) - en concha de primera
  if (nombreLower.includes('camar') && nombreLower.includes('jumbo') && !nombreLower.includes('desven')) {
    return 'Camarón grande en concha de primera. Ideal para parrilla, ajillo y platos especiales.';
  }

  // ═══════════════════════════════════════════════════════════════════
  // CAMARONES POR TALLA (61/70, 51/60, etc.)
  // ═══════════════════════════════════════════════════════════════════

  // Detectar camarones por talla (con o sin "caja")
  if (nombreLower.includes('camar')) {
    const tallaMatch = nombre.match(/(\d+\/\d+)/);
    if (tallaMatch) {
      const talla = tallaMatch[1];
      if (talla === '61/70') return 'Camarón pequeño y rendidor. Ideal para arroces, pastas y salteados.';
      if (talla === '51/60') return 'Tamaño medio-pequeño muy versátil. Perfecto para pastas, arroces y cócteles.';
      if (talla === '41/50') return 'La talla más balanceada y usada. Ideal para casi cualquier receta con camarón.';
      if (talla === '36/40') return 'Camarón grande que se nota en el plato. Perfecto para ajillo, parrilla y platos especiales.';
      if (talla === '31/35') return 'Camarón grande estilo premium. Ideal para parrilla y presentaciones gourmet.';
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CAMARONES PELADOS Y DESVENADOS
  // ═══════════════════════════════════════════════════════════════════

  if (nombreLower.includes('pelado') && !nombreLower.includes('desven')) {
    return 'Listo para rellenar y resolver. Ideal para arepas y empanadas.';
  }

  if (nombreLower.includes('desvenado') && nombreLower.includes('jumbo')) {
    return 'Talla grande para quienes quieren que se note. Ideal para parrilla.';
  }

  if (nombreLower.includes('desvenado') && !nombreLower.includes('jumbo')) {
    return 'El "rey" para cocinar sin complicaciones. Perfecto para ajillo y pastas.';
  }

  // ═══════════════════════════════════════════════════════════════════
  // CAMARÓN PRECOCIDO Y LANGOSTINO
  // ═══════════════════════════════════════════════════════════════════

  if (nombreLower.includes('precocido') || nombreLower.includes('pre cocido')) {
    return 'Para cuando quieres comer ya: abre y sirve. Ideal para cocteles y ensaladas.';
  }

  if (nombreLower.includes('langostino')) {
    return 'Nivel premium: más grande y más sabor. Ideal para parrilla e impresionar.';
  }

  // ═══════════════════════════════════════════════════════════════════
  // CALAMARES
  // ═══════════════════════════════════════════════════════════════════

  if (nombreLower.includes('calamar pota') || nombreLower.includes('pota')) {
    return 'La mejor opción calidad/precio. Rinde perfecto en guisos y anillos.';
  }

  if (nombreLower.includes('calamar nacional') && nombreLower.includes('grande')) {
    return 'Más grande para una presentación superior. Perfecto para parrilla y rellenos.';
  }

  if (nombreLower.includes('calamar nacional')) {
    return 'Sabor premium que opaca al importado. Ideal para frituras y recetas gourmet.';
  }

  if (nombreLower.includes('cuerpo') && nombreLower.includes('calamar')) {
    return 'Ahorra tiempo: limpio y listo para cortar. Ideal para anillos y salteados.';
  }

  if (nombreLower.includes('tentáculo') || nombreLower.includes('tentaculo')) {
    return 'La alternativa económica al pulpo, con buena textura. Ideal para parrilla.';
  }

  // ═══════════════════════════════════════════════════════════════════
  // PULPOS
  // ═══════════════════════════════════════════════════════════════════

  if (nombreLower.includes('pulpo pequeño')) {
    return 'Pulpo tierno y fácil de porcionar. Perfecto para ceviches y entradas.';
  }

  if (nombreLower.includes('pulpo mediano')) {
    return 'Equilibrio perfecto de tamaño y suavidad. Ideal para parrilla y ceviches.';
  }

  if (nombreLower.includes('pulpo grande')) {
    return 'Pulpo protagonista para eventos. Ideal para impresionar y rendir en grande.';
  }

  // ═══════════════════════════════════════════════════════════════════
  // VIERAS
  // ═══════════════════════════════════════════════════════════════════

  if (nombreLower.includes('viera') && nombreLower.includes('verdadera')) {
    return 'La vieira auténtica volvió: sabor superior. Ideal para platos gourmet.';
  }

  if (nombreLower.includes('viera')) {
    return 'Forma de vieira a precio inteligente. Ideal para pastas y cremas.';
  }

  // ═══════════════════════════════════════════════════════════════════
  // MOLUSCOS Y ALMEJAS
  // ═══════════════════════════════════════════════════════════════════

  if (nombreLower.includes('pepitona') && nombreLower.includes('caja')) {
    return 'Para negocios o verdaderos fanáticos. Ideal para cocina industrial.';
  }

  if (nombreLower.includes('pepitona')) {
    return 'Sabor marino intenso para fanáticos del marisco. Ideal para arroces.';
  }

  if ((nombreLower.includes('mejillón') || nombreLower.includes('mejillon')) && nombreLower.includes('pelado')) {
    return 'Listo para usar sin concha y sin trabajo. Perfecto para pastas y arroz.';
  }

  if (nombreLower.includes('mejillón') || nombreLower.includes('mejillon')) {
    return 'El clásico que levanta cualquier paella. Ideal para vapor y mediterráneos.';
  }

  if (nombreLower.includes('guacuco')) {
    return 'La "carne molida" del mar: rinde muchísimo. Ideal para arepas y empanadas.';
  }

  if (nombreLower.includes('almeja')) {
    return 'Toque gourmet para sopas y pastas marinas. Ideal para arroces y cremas.';
  }

  if (nombreLower.includes('kigua')) {
    return 'Caracol de mar perfecto para vinagretas. Ideal para cocteles y "7 potencias".';
  }

  if (nombreLower.includes('vaquita')) {
    return 'Caracol de mar ideal para vinagretas y cocteles. Perfecto con limón.';
  }

  // ═══════════════════════════════════════════════════════════════════
  // CANGREJOS Y ESPECIALES
  // ═══════════════════════════════════════════════════════════════════

  if (nombreLower.includes('jaiba')) {
    return 'El cangrejo que da sabor y color al plato. Ideal para sopas y guisos.';
  }

  if (nombreLower.includes('pulpa de cangrejo') || nombreLower.includes('pulpa cangrejo')) {
    return 'Perfecta para ensaladas y curtidos en minutos. Ideal para rellenos y dips.';
  }

  if (nombreLower.includes('tinta')) {
    return 'El secreto del arroz negro perfecto. Ideal para pastas y risottos.';
  }

  if (nombreLower.includes('salmon') || nombreLower.includes('salmón')) {
    return 'Salmón premium con explosión de Omega 3. Ideal para plancha y horno.';
  }

  // ═══════════════════════════════════════════════════════════════════
  // FALLBACK
  // ═══════════════════════════════════════════════════════════════════

  if (descripcion.length <= 50) return descripcion;

  const primerPunto = descripcion.indexOf('.');
  if (primerPunto > 0 && primerPunto <= 55) {
    return descripcion.substring(0, primerPunto);
  }

  const textoCorto = descripcion.substring(0, 45);
  const ultimoEspacio = textoCorto.lastIndexOf(' ');
  return ultimoEspacio > 15 ? textoCorto.substring(0, ultimoEspacio) : textoCorto;
}

/**
 * Genera descripción ultra-corta (5-7 palabras) para la home
 */
function generarDescripcionHome(nombre: string): string {
  const nombreLower = nombre.toLowerCase();

  // Camarones en concha
  if (nombreLower.includes('vivito')) return 'Súper fresco, sabor real';
  if (nombreLower.includes('jumbo') && nombreLower.includes('concha')) return 'Tamaño grande que se luce';

  // Camarón Jumbo (sin especificar concha)
  if (nombreLower.includes('camar') && nombreLower.includes('jumbo') && !nombreLower.includes('desven')) {
    return 'Grande y llamativo';
  }

  // Camarones por talla (con o sin "caja")
  if (nombreLower.includes('camar')) {
    const tallaMatch = nombre.match(/(\d+\/\d+)/);
    if (tallaMatch) {
      const talla = tallaMatch[1];
      if (talla === '61/70') return 'Pequeño y rendidor';
      if (talla === '51/60') return 'Versátil para todo';
      if (talla === '41/50') return 'La talla más usada';
      if (talla === '36/40') return 'Grande y protagonista';
      if (talla === '31/35') return 'Nivel premium';
    }
  }

  // Camarones pelados y desvenados
  if (nombreLower.includes('pelado') && !nombreLower.includes('desven')) return 'Práctico y rendidor';
  if (nombreLower.includes('desvenado') && nombreLower.includes('jumbo')) return 'Más grande, más impacto';
  if (nombreLower.includes('desvenado') && !nombreLower.includes('jumbo')) return 'El favorito para cocinar fácil';

  // Camarón precocido y langostino
  if (nombreLower.includes('precocido') || nombreLower.includes('pre cocido')) return 'Listo para servir';
  if (nombreLower.includes('langostino')) return 'Nivel premium';

  // Calamares
  if (nombreLower.includes('calamar pota') || nombreLower.includes('pota')) return 'Rinde bien todos los días';
  if (nombreLower.includes('calamar nacional') && nombreLower.includes('grande')) return 'Más grande, mejor presentación';
  if (nombreLower.includes('calamar nacional')) return 'Sabor premium nacional';
  if (nombreLower.includes('cuerpo') && nombreLower.includes('calamar')) return 'Limpio y listo para usar';
  if (nombreLower.includes('tentáculo') || nombreLower.includes('tentaculo')) return 'Alternativa al pulpo';

  // Pulpos
  if (nombreLower.includes('pulpo pequeño')) return 'Tierno y fácil de preparar';
  if (nombreLower.includes('pulpo mediano')) return 'Equilibrio perfecto';
  if (nombreLower.includes('pulpo grande')) return 'Para impresionar';

  // Vieras
  if (nombreLower.includes('viera') && nombreLower.includes('verdadera')) return 'Vieira auténtica';
  if (nombreLower.includes('viera')) return 'Presentación bonita';

  // Moluscos
  if (nombreLower.includes('pepitona') && nombreLower.includes('caja')) return 'Formato negocio';
  if (nombreLower.includes('pepitona')) return 'Sabor intenso a mar';
  if ((nombreLower.includes('mejillón') || nombreLower.includes('mejillon')) && nombreLower.includes('pelado')) return 'Sin concha, sin trabajo';
  if (nombreLower.includes('mejillón') || nombreLower.includes('mejillon')) return 'Clásico para paellas';
  if (nombreLower.includes('guacuco')) return 'Rinde muchísimo';
  if (nombreLower.includes('almeja')) return 'Toque gourmet marino';
  if (nombreLower.includes('kigua')) return 'Ideal para vinagretas';
  if (nombreLower.includes('vaquita')) return 'Perfecto para recetas frías';

  // Cangrejos y especiales
  if (nombreLower.includes('jaiba')) return 'Sabor que levanta platos';
  if (nombreLower.includes('pulpa de cangrejo') || nombreLower.includes('pulpa cangrejo')) return 'Listo para usar';
  if (nombreLower.includes('tinta')) return 'Color y sabor intenso';
  if (nombreLower.includes('salmon') || nombreLower.includes('salmón')) return 'Salmón premium';

  // Fallback
  return '';
}

/**
 * Verifica si un producto es de los más vendidos
 */
function esMasVendido(nombre: string): boolean {
  const nombreLower = nombre.toLowerCase();
  return MAS_VENDIDOS_KEYWORDS.some(keyword =>
    nombreLower.includes(keyword.toLowerCase())
  );
}

/**
 * Determina el incremento de cantidad según el tipo de producto
 * - Cajas: solo unidades enteras (1, 2, 3...)
 * - Paquetes (pulpa cangrejo, tinta): solo unidades enteras
 * - Guacuco: saltos de 0.5 kg (se vende en bolsas de medio kg)
 * - Resto: libre (0.1 kg) para permitir 0.250, 0.300, 0.700, etc.
 */
function determinarIncremento(nombre: string, unidad: string): number {
  const nombreLower = nombre.toLowerCase();
  const unidadLower = unidad.toLowerCase();

  // Productos que solo se venden por unidad entera
  if (unidadLower === 'caja' || unidadLower === 'paquete' || unidadLower === 'bolsa') {
    return 1;
  }

  // Tinta de calamar se vende por unidad
  if (nombreLower.includes('tinta')) {
    return 1;
  }

  // Guacuco en bolsas de medio kg
  if (nombreLower.includes('guacuco')) {
    return 0.5;
  }

  // Por defecto, saltos de 0.1 kg para permitir gramajes precisos (250g, 300g, 700g, etc.)
  return 0.1;
}

/**
 * Determina si un producto es una caja (para ordenamiento)
 */
function esProductoCaja(nombre: string, unidad: string): boolean {
  const nombreLower = nombre.toLowerCase();
  return nombreLower.includes('caja') || unidad.toLowerCase() === 'caja';
}

/**
 * Determina la cantidad mínima en kg para productos que tienen tamaño natural
 * Ej: un pulpo grande pesa ~1kg mínimo, no puedes comprar 0.1kg de pulpo grande
 */
function determinarMinimoKg(nombre: string, unidad: string): number | undefined {
  const nombreLower = nombre.toLowerCase();
  const unidadLower = unidad.toLowerCase();

  // Productos por unidad no tienen mínimo en kg
  if (unidadLower === 'caja' || unidadLower === 'paquete' || unidadLower === 'bolsa') {
    return undefined;
  }

  // Pulpos tienen tamaño mínimo natural
  if (nombreLower.includes('pulpo grande')) return 0.8;
  if (nombreLower.includes('pulpo mediano')) return 0.5;
  if (nombreLower.includes('pulpo pequeño')) return 0.3;

  // Salmón se vende por filet, mínimo razonable
  if (nombreLower.includes('salmon') || nombreLower.includes('salmón')) return 0.2;

  return undefined;
}

/**
 * Determina si un producto permite entrada libre de decimales
 * Los productos por kg permiten gramajes precisos (0.250, 0.350, etc.)
 * Los productos por unidad (caja, paquete, bolsa) solo enteros
 */
function tieneEntradaLibre(nombre: string, unidad: string): boolean {
  const nombreLower = nombre.toLowerCase();
  const unidadLower = unidad.toLowerCase();

  // Productos que solo se venden por unidad entera
  if (unidadLower === 'caja' || unidadLower === 'paquete' || unidadLower === 'bolsa') {
    return false;
  }

  // Tinta de calamar se vende por unidad
  if (nombreLower.includes('tinta')) {
    return false;
  }

  // Guacuco se vende en bolsas de 0.5kg, no entrada libre
  if (nombreLower.includes('guacuco')) {
    return false;
  }

  // El resto permite entrada libre para gramajes precisos
  return true;
}

export interface Category {
  name: string;
  products: Product[];
}

export interface BCVRate {
  rate: number;
  date: string;
  source: string;
}

// Datos de ejemplo mientras no se configure el Sheet real
// Actualizados con precios reales del negocio
const SAMPLE_DATA: Omit<Product, 'precioBs' | 'descripcionCorta' | 'descripcionHome' | 'precioUSDDivisa' | 'masVendido' | 'incremento' | 'esCaja'>[] = [
  // ═══════════════════════════════════════════════════════════════════
  // CAMARONES EN CONCHA
  // ═══════════════════════════════════════════════════════════════════
  {
    id: '1',
    nombre: 'Camarón Vivito (en concha)',
    descripcion: 'Talla 60/70 (60-70 camarones por libra). Fresco con concha, ideal para preparar en casa.',
    categoria: 'Camarones',
    precioUSD: 11.50,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '2',
    nombre: 'Camarón Jumbo (en concha)',
    descripcion: 'Talla 40/50 a 50/60. Camarón grande con concha, perfecto para parrilla o a la plancha.',
    categoria: 'Camarones',
    precioUSD: 13.00,
    unidad: 'kg',
    disponible: true,
  },

  // ═══════════════════════════════════════════════════════════════════
  // CAMARONES PELADOS Y DESVENADOS (por kg a mostrador)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: '3',
    nombre: 'Camarón Pelado',
    descripcion: 'Camarón pelado sin devenar. Listo para cocinar, venta por kg.',
    categoria: 'Camarones',
    precioUSD: 13.00,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '4',
    nombre: 'Camarón Desvenado',
    descripcion: 'Talla 41/50. Pelado y desvenado, listo para cocinar. Venta por kg.',
    categoria: 'Camarones',
    precioUSD: 17.00,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '5',
    nombre: 'Camarón Desvenado Jumbo',
    descripcion: 'Talla 31/35 a 36/40. Camarón grande pelado y desvenado. Venta por kg.',
    categoria: 'Camarones',
    precioUSD: 22.00,
    unidad: 'kg',
    disponible: true,
  },

  // ═══════════════════════════════════════════════════════════════════
  // CAMARONES DESVENADOS (cajas de 2 kg)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: '6',
    nombre: 'Caja Camarón 61/70 (2 kg)',
    descripcion: 'Caja de 2 kg. Camarón pequeño desvenado, ideal para arroces y pastas.',
    categoria: 'Camarones',
    precioUSD: 23.00,
    unidad: 'caja',
    disponible: true,
  },
  {
    id: '7',
    nombre: 'Caja Camarón 51/60 (2 kg)',
    descripcion: 'Caja de 2 kg. Camarón mediano desvenado, versátil para cualquier preparación.',
    categoria: 'Camarones',
    precioUSD: 24.00,
    unidad: 'caja',
    disponible: true,
  },
  {
    id: '8',
    nombre: 'Caja Camarón 41/50 (2 kg)',
    descripcion: 'Caja de 2 kg. Camarón desvenado, excelente relación tamaño-precio.',
    categoria: 'Camarones',
    precioUSD: 25.00,
    unidad: 'caja',
    disponible: true,
  },
  {
    id: '9',
    nombre: 'Caja Camarón 36/40 (2 kg)',
    descripcion: 'Caja de 2 kg. Camarón grande desvenado, ideal para platos principales.',
    categoria: 'Camarones',
    precioUSD: 30.00,
    unidad: 'caja',
    disponible: true,
  },
  {
    id: '10',
    nombre: 'Caja Camarón 31/35 (2 kg)',
    descripcion: 'Caja de 2 kg. Camarón jumbo desvenado, el más grande disponible.',
    categoria: 'Camarones',
    precioUSD: 32.00,
    unidad: 'caja',
    disponible: true,
  },

  // ═══════════════════════════════════════════════════════════════════
  // CAMARÓN PRECOCIDO Y LANGOSTINO
  // ═══════════════════════════════════════════════════════════════════
  {
    id: '11',
    nombre: 'Camarón Precocido',
    descripcion: 'Bolsa de aprox. 1 kg. Ya cocido, listo para ensaladas, cocteles o calentar.',
    categoria: 'Camarones',
    precioUSD: 14.00,
    unidad: 'bolsa',
    disponible: true,
  },
  {
    id: '12',
    nombre: 'Langostino Blanco',
    descripcion: 'Langostino fresco de alta calidad. Sabor delicado, ideal a la plancha.',
    categoria: 'Camarones',
    precioUSD: 16.00,
    unidad: 'kg',
    disponible: true,
  },

  // ═══════════════════════════════════════════════════════════════════
  // CALAMARES
  // ═══════════════════════════════════════════════════════════════════
  {
    id: '13',
    nombre: 'Calamar Pota',
    descripcion: 'Calamar importado. Textura firme, ideal para frituras y guisos.',
    categoria: 'Mariscos',
    precioUSD: 18.00,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '14',
    nombre: 'Calamar Nacional',
    descripcion: 'Calamar fresco nacional de tamaño mediano. Perfecto para arroz, pasta o frito.',
    categoria: 'Mariscos',
    precioUSD: 18.00,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '15',
    nombre: 'Calamar Nacional Grande',
    descripcion: 'Calamar fresco grande. Ideal para rellenar o preparar a la plancha.',
    categoria: 'Mariscos',
    precioUSD: 20.00,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '16',
    nombre: 'Cuerpo de Calamar Limpio',
    descripcion: 'Tubo de calamar ya limpio. Listo para cortar en aros o rellenar.',
    categoria: 'Mariscos',
    precioUSD: 18.00,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '17',
    nombre: 'Tentáculo de Calamar',
    descripcion: 'Tentáculos de calamar. Textura única, ideales a la parrilla o fritos.',
    categoria: 'Mariscos',
    precioUSD: 19.00,
    unidad: 'kg',
    disponible: true,
  },

  // ═══════════════════════════════════════════════════════════════════
  // PULPOS
  // ═══════════════════════════════════════════════════════════════════
  {
    id: '18',
    nombre: 'Pulpo Pequeño',
    descripcion: 'Pulpo fresco de tamaño pequeño. Excelente para ensaladas y tapas.',
    categoria: 'Mariscos',
    precioUSD: 20.00,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '19',
    nombre: 'Pulpo Mediano',
    descripcion: 'Pulpo fresco de tamaño mediano. Versátil para cualquier preparación.',
    categoria: 'Mariscos',
    precioUSD: 23.00,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '20',
    nombre: 'Pulpo Grande',
    descripcion: 'Pulpo fresco grande. El más codiciado, ideal para platos principales.',
    categoria: 'Mariscos',
    precioUSD: 23.00,
    unidad: 'kg',
    disponible: true,
  },

  // ═══════════════════════════════════════════════════════════════════
  // VIERAS
  // ═══════════════════════════════════════════════════════════════════
  {
    id: '21',
    nombre: 'Vieras',
    descripcion: 'Cortes circulares de calamar estilo viera. Alternativa para gratinados y pastas.',
    categoria: 'Mariscos',
    precioUSD: 18.00,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '22',
    nombre: 'Vieras Verdaderas',
    descripcion: 'Vieras auténticas. Producto premium para preparaciones gourmet.',
    categoria: 'Mariscos',
    precioUSD: 16.00,
    unidad: 'kg',
    disponible: true,
  },

  // ═══════════════════════════════════════════════════════════════════
  // ALMEJAS Y MOLUSCOS
  // ═══════════════════════════════════════════════════════════════════
  {
    id: '23',
    nombre: 'Pepitona',
    descripcion: 'Almeja venezolana típica. Imprescindible para el arroz con mariscos.',
    categoria: 'Mariscos',
    precioUSD: 4.50,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '24',
    nombre: 'Pepitona (Caja 10 kg)',
    descripcion: 'Caja de 10 kg de pepitona. Ideal para negocios y eventos grandes.',
    categoria: 'Mariscos',
    precioUSD: 33.00,
    unidad: 'caja',
    disponible: true,
  },
  {
    id: '25',
    nombre: 'Mejillón con Concha',
    descripcion: 'Mejillones frescos con concha. Ideales al vapor, a la marinera o gratinados.',
    categoria: 'Mariscos',
    precioUSD: 6.50,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '26',
    nombre: 'Mejillón Pelado',
    descripcion: 'Mejillones ya pelados, listos para cocinar. Prácticos para arroces y pastas.',
    categoria: 'Mariscos',
    precioUSD: 12.00,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '27',
    nombre: 'Guacuco Pelado',
    descripcion: 'Almeja grande típica del Caribe, ya pelada. Excelente para sopas y arroces.',
    categoria: 'Mariscos',
    precioUSD: 6.00,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '28',
    nombre: 'Almeja',
    descripcion: 'Almejas frescas. Versátiles para pastas, arroces y preparaciones al vapor.',
    categoria: 'Mariscos',
    precioUSD: 6.50,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '29',
    nombre: 'Kigua',
    descripcion: 'Caracol de mar venezolano. Sabor único del Caribe.',
    categoria: 'Mariscos',
    precioUSD: 10.00,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '30',
    nombre: 'Vaquita',
    descripcion: 'Molusco típico venezolano. Ideal para sopas tradicionales.',
    categoria: 'Mariscos',
    precioUSD: 7.00,
    unidad: 'kg',
    disponible: true,
  },

  // ═══════════════════════════════════════════════════════════════════
  // CANGREJOS
  // ═══════════════════════════════════════════════════════════════════
  {
    id: '31',
    nombre: 'Jaiba',
    descripcion: 'Cangrejo azul fresco. Ideal para sopas, asopados y platos típicos.',
    categoria: 'Mariscos',
    precioUSD: 6.00,
    unidad: 'kg',
    disponible: true,
  },
  {
    id: '32',
    nombre: 'Pulpa de Cangrejo (250g)',
    descripcion: 'Paquete de 250 gramos de pura pulpa de cangrejo. Lista para pasapalos y ensaladas.',
    categoria: 'Especiales',
    precioUSD: 4.00,
    unidad: 'paquete',
    disponible: true,
  },

  // ═══════════════════════════════════════════════════════════════════
  // ESPECIALES
  // ═══════════════════════════════════════════════════════════════════
  {
    id: '33',
    nombre: 'Filet de Salmón Premium',
    descripcion: 'Filet de salmón importado de primera calidad. A la plancha, al horno o crudo.',
    categoria: 'Especiales',
    precioUSD: 32.00,
    unidad: 'kg',
    disponible: true,
  },
];

/**
 * Obtiene la tasa del dolar BCV del dia
 * Usa múltiples APIs con fallback para mayor confiabilidad
 * @param db - Opcional: D1 database para cache/fallback
 */
export async function getBCVRate(db?: D1Database | null): Promise<BCVRate> {
  const TIMEOUT_MS = 8000;

  // Helper: fetch con timeout usando AbortController
  async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  // Helper: guardar tasa en D1 para futuro fallback
  async function saveToD1(rate: number, source: string, date: string): Promise<void> {
    if (!db) return;
    try {
      await db.batch([
        db.prepare("INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES ('bcv_rate_auto', ?, datetime('now'))").bind(String(rate)),
        db.prepare("INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES ('bcv_rate_source', ?, datetime('now'))").bind(source),
        db.prepare("INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES ('bcv_rate_date', ?, datetime('now'))").bind(date),
      ]);
    } catch (e) {
      console.error('[BCV] Error saving to D1:', e);
    }
  }

  // Helper: leer última tasa de D1 (fallback)
  async function getFromD1(): Promise<BCVRate | null> {
    if (!db) return null;
    try {
      const result = await db.prepare("SELECT value FROM site_config WHERE key = 'bcv_rate_auto'").first<{ value: string }>();
      if (result?.value) {
        const rate = parseFloat(result.value);
        if (rate > 0) {
          return { rate, date: new Date().toLocaleDateString('es-VE'), source: 'BCV (cache)' };
        }
      }
    } catch (e) {
      console.error('[BCV] Error reading from D1:', e);
    }
    return null;
  }

  // API 1: exchangedyn.com (más rápida en actualizar la tasa BCV)
  try {
    const response = await fetchWithTimeout('https://api.exchangedyn.com/markets/quotes/usdves/bcv', {
      headers: { 'Accept': 'application/json' },
    });

    if (response.ok) {
      const data = await response.json();
      const bcvData = data.sources?.BCV;
      if (bcvData?.quote) {
        const rate = Math.round(parseFloat(bcvData.quote) * 100) / 100;
        const fecha = bcvData.last_retrieved
          ? new Date(bcvData.last_retrieved).toLocaleDateString('es-VE')
          : new Date().toLocaleDateString('es-VE');
        // Guardar en D1 para futuro fallback
        saveToD1(rate, 'BCV', fecha);
        return { rate, date: fecha, source: 'BCV' };
      }
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.warn('[BCV] Timeout con exchangedyn.com');
    } else {
      console.error('[BCV] Error con exchangedyn.com:', error);
    }
  }

  // API 2: bcvapi.tech (fallback)
  try {
    const response = await fetchWithTimeout('https://bcvapi.tech/api/v1/dolar/public', {
      headers: { 'Accept': 'application/json' },
    });

    if (response.ok) {
      const data = await response.json();
      if (data.tasa) {
        const rate = Math.round(data.tasa * 100) / 100;
        const fecha = data.fecha || new Date().toLocaleDateString('es-VE');
        // Guardar en D1 para futuro fallback
        saveToD1(rate, 'BCV', fecha);
        return { rate, date: fecha, source: 'BCV' };
      }
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.warn('[BCV] Timeout con bcvapi.tech');
    } else {
      console.error('[BCV] Error con bcvapi.tech:', error);
    }
  }

  // Fallback: leer última tasa de D1
  const cached = await getFromD1();
  if (cached) {
    console.log('[BCV] Usando tasa cacheada de D1:', cached.rate);
    return cached;
  }

  // Último fallback: tasa hardcodeada
  console.warn('[BCV] Usando tasa de respaldo - APIs y D1 no disponibles');
  return {
    rate: 70.00,
    date: new Date().toLocaleDateString('es-VE'),
    source: 'Referencial',
  };
}

/**
 * Obtiene los productos desde D1 (primary) o Google Sheets (fallback)
 * @param bcvRate - Tasa de cambio BCV
 * @param db - Opcional: instancia de D1 database para consulta directa
 */
export async function getProducts(bcvRate: number, db?: D1Database): Promise<Product[]> {
  // Si tenemos acceso a D1, intentar leer de ahí primero
  if (db) {
    try {
      const results = await db.prepare(`
        SELECT * FROM products ORDER BY sort_order ASC, categoria ASC, nombre ASC
      `).all<D1ProductRow>();

      if (results.results && results.results.length > 0) {
        console.log(`✅ Cargados ${results.results.length} productos desde D1`);
        return results.results.map((row, index) => {
          const nombre = row.nombre;
          const descripcion = row.descripcion || '';
          const unidad = row.unidad;
          // Usar descripciones de D1 si existen, sino generar automáticamente
          const descripcionCorta = row.descripcion_corta || generarDescripcionCorta(descripcion, nombre);
          const descripcionHome = row.descripcion_home || generarDescripcionHome(nombre);
          return {
            id: String(row.id),
            nombre,
            descripcion,
            descripcionCorta,
            descripcionHome,
            categoria: row.categoria,
            precioUSD: row.precio_usd,
            precioUSDDivisa: row.precio_usd_divisa ?? null,
            precioBs: row.precio_usd * bcvRate,
            unidad,
            disponible: row.disponible === 1,
            masVendido: esMasVendido(nombre),
            incremento: determinarIncremento(nombre, unidad),
            esCaja: esProductoCaja(nombre, unidad),
            minimoKg: determinarMinimoKg(nombre, unidad),
            entradaLibre: tieneEntradaLibre(nombre, unidad),
          };
        });
      }
      console.log('⚠️ D1 vacío, usando fallback...');
    } catch (error) {
      console.error('Error leyendo de D1:', error);
    }
  }

  // Fallback: Google Sheets o datos de ejemplo
  // Si no hay SHEET_ID configurado, usar datos de ejemplo
  if (!SHEET_ID || SHEET_ID === 'TU_SHEET_ID_AQUI') {
    console.log('⚠️ Usando datos de ejemplo. Configura PUBLIC_SHEET_ID para conectar con Google Sheets.');
    return SAMPLE_DATA.map(p => ({
      ...p,
      precioBs: p.precioUSD * bcvRate,
      descripcionCorta: generarDescripcionCorta(p.descripcion, p.nombre),
      descripcionHome: generarDescripcionHome(p.nombre),
      masVendido: esMasVendido(p.nombre),
      incremento: determinarIncremento(p.nombre, p.unidad),
      esCaja: esProductoCaja(p.nombre, p.unidad),
      minimoKg: determinarMinimoKg(p.nombre, p.unidad),
      entradaLibre: tieneEntradaLibre(p.nombre, p.unidad),
    }));
  }

  try {
    // Usar la API publica de Google Sheets (formato JSON)
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Error fetching sheet: ${response.status}`);
    }

    const text = await response.text();

    // Google devuelve JSONP, necesitamos extraer el JSON
    const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);

    if (!jsonMatch) {
      throw new Error('Formato de respuesta invalido');
    }

    const data = JSON.parse(jsonMatch[1]);
    const rows = data.table.rows;

    // Mapear columnas según estructura del usuario:
    // A: Producto, D: Precio, E: Disponible, F: Categoria, G: Unidad, H: Descripcion
    const products: Product[] = rows
      .filter((row: any) => row.c && row.c[0]?.v) // Filtrar filas vacias
      .map((row: any, index: number) => {
        const precioUSD = parseFloat(row.c[3]?.v) || 0;
        const nombre = String(row.c[0]?.v || '');
        const descripcion = String(row.c[7]?.v || '');
        const unidad = String(row.c[6]?.v || 'kg');
        return {
          id: String(index + 1),
          nombre,
          descripcion,
          descripcionCorta: generarDescripcionCorta(descripcion, nombre),
          descripcionHome: generarDescripcionHome(nombre),
          categoria: String(row.c[5]?.v || 'General'),
          precioUSD,
          precioUSDDivisa: null,
          precioBs: precioUSD * bcvRate,
          unidad,
          disponible: String(row.c[4]?.v || 'SI').toUpperCase() !== 'NO',
          masVendido: esMasVendido(nombre),
          incremento: determinarIncremento(nombre, unidad),
          esCaja: esProductoCaja(nombre, unidad),
          minimoKg: determinarMinimoKg(nombre, unidad),
          entradaLibre: tieneEntradaLibre(nombre, unidad),
        };
      });

    return products;
  } catch (error) {
    console.error('Error al obtener datos de Google Sheets:', error);
    console.log('Usando datos de ejemplo como fallback.');
    return SAMPLE_DATA.map(p => ({
      ...p,
      precioBs: p.precioUSD * bcvRate,
      descripcionCorta: generarDescripcionCorta(p.descripcion, p.nombre),
      descripcionHome: generarDescripcionHome(p.nombre),
      masVendido: esMasVendido(p.nombre),
      incremento: determinarIncremento(p.nombre, p.unidad),
      esCaja: esProductoCaja(p.nombre, p.unidad),
      minimoKg: determinarMinimoKg(p.nombre, p.unidad),
      entradaLibre: tieneEntradaLibre(p.nombre, p.unidad),
    }));
  }
}

/**
 * Agrupa los productos por categoria
 * Ordena: productos a detal primero, cajas al final
 */
export function groupByCategory(products: Product[]): Category[] {
  const categoryMap = new Map<string, Product[]>();

  // Orden preferido de categorías
  const categoryOrder = ['Camarones', 'Calamares', 'Mariscos', 'Especiales'];

  products.forEach(product => {
    const existing = categoryMap.get(product.categoria) || [];
    categoryMap.set(product.categoria, [...existing, product]);
  });

  // Ordenar categorias segun el orden preferido
  const sortedCategories = Array.from(categoryMap.entries())
    .sort(([a], [b]) => {
      const indexA = categoryOrder.indexOf(a);
      const indexB = categoryOrder.indexOf(b);
      if (indexA === -1 && indexB === -1) return a.localeCompare(b);
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });

  return sortedCategories.map(([name, categoryProducts]) => ({
    name,
    // Ordenar: primero productos a detal (no cajas), luego cajas
    products: categoryProducts.sort((a, b) => {
      // Cajas van al final
      if (a.esCaja && !b.esCaja) return 1;
      if (!a.esCaja && b.esCaja) return -1;
      // Dentro del mismo tipo, ordenar alfabeticamente
      return a.nombre.localeCompare(b.nombre);
    }),
  }));
}

/**
 * Obtiene los productos más vendidos
 */
export function getMasVendidos(products: Product[]): Product[] {
  return products.filter(p => p.masVendido && p.disponible);
}

/**
 * Formatea precio en dolares
 */
export function formatPriceUSD(price: number): string {
  return `$${price.toFixed(2)}`;
}

/**
 * Formatea precio en bolivares
 */
export function formatPriceBs(price: number): string {
  return `Bs. ${price.toFixed(2)}`;
}
