// Configuracion de Google Sheets
// Para obtener el SHEET_ID: abrir tu Google Sheet y copiar el ID de la URL
// URL: https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit
// IMPORTANTE: El Sheet debe estar compartido como "Cualquier persona con el enlace puede ver"

const SHEET_ID = import.meta.env.PUBLIC_SHEET_ID || 'TU_SHEET_ID_AQUI';

export interface Product {
  id: string;
  nombre: string;
  descripcion: string;
  descripcionCorta: string;
  categoria: string;
  precioUSD: number;
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
 * Cada descripción destaca: uso recomendado, tamaño, o característica especial
 */
function generarDescripcionCorta(descripcion: string, nombre: string): string {
  if (!descripcion) return '';

  const descLower = descripcion.toLowerCase();
  const nombreLower = nombre.toLowerCase();

  // ═══════════════════════════════════════════════════════════════════
  // CAMARONES
  // ═══════════════════════════════════════════════════════════════════

  // Camarón Vivito - el más popular
  if (nombreLower.includes('vivito')) {
    return '60-70 por libra · Con concha · El favorito';
  }

  // Camarón Jumbo en concha
  if (nombreLower.includes('jumbo') && nombreLower.includes('concha')) {
    return '40-60 por libra · Grande · Ideal parrilla';
  }

  // Camarón pelado sin devenar
  if (nombreLower.includes('pelado') && !nombreLower.includes('desven')) {
    return 'Sin concha · Listo para sazonar';
  }

  // Camarón desvenado regular
  if (nombreLower.includes('desvenado') && !nombreLower.includes('jumbo')) {
    return '41-50 por libra · Listo para cocinar';
  }

  // Camarón desvenado jumbo
  if (nombreLower.includes('desvenado') && nombreLower.includes('jumbo')) {
    return '31-40 por libra · Extra grande · Premium';
  }

  // Cajas de camarón
  if (nombreLower.includes('caja') && nombreLower.includes('camar')) {
    const tallaMatch = nombre.match(/(\d+\/\d+)/);
    if (tallaMatch) {
      const talla = tallaMatch[1];
      // Describir según talla
      if (talla === '61/70') return 'Caja 2kg · Pequeño · Para arroces';
      if (talla === '51/60') return 'Caja 2kg · Mediano · Versátil';
      if (talla === '41/50') return 'Caja 2kg · Buena relación precio-tamaño';
      if (talla === '36/40') return 'Caja 2kg · Grande · Para platos fuertes';
      if (talla === '31/35') return 'Caja 2kg · Jumbo · El más grande';
    }
    return 'Caja 2kg · Desvenado';
  }

  // Camarón precocido
  if (nombreLower.includes('precocido') || descLower.includes('precocido')) {
    return 'Ya cocido · Listo para servir';
  }

  // Langostino
  if (nombreLower.includes('langostino')) {
    return 'Sabor suave y dulce · A la plancha';
  }

  // ═══════════════════════════════════════════════════════════════════
  // CALAMARES
  // ═══════════════════════════════════════════════════════════════════

  if (nombreLower.includes('calamar pota')) {
    return 'Importado · Textura firme · Para frituras';
  }

  if (nombreLower.includes('calamar nacional') && nombreLower.includes('grande')) {
    return 'Fresco · Grande · Para rellenar o plancha';
  }

  if (nombreLower.includes('calamar nacional')) {
    return 'Fresco del día · Mediano · Versátil';
  }

  if (nombreLower.includes('cuerpo') && nombreLower.includes('calamar')) {
    return 'Tubo limpio · Cortar en aros o rellenar';
  }

  if (nombreLower.includes('tentáculo') || nombreLower.includes('tentaculo')) {
    return 'Textura única · Parrilla o fritos';
  }

  // ═══════════════════════════════════════════════════════════════════
  // PULPOS
  // ═══════════════════════════════════════════════════════════════════

  if (nombreLower.includes('pulpo pequeño')) {
    return 'Tierno · Ideal ensaladas y tapas';
  }

  if (nombreLower.includes('pulpo mediano')) {
    return 'Versátil · El más solicitado';
  }

  if (nombreLower.includes('pulpo grande')) {
    return 'El más carnoso · Para platos principales';
  }

  // ═══════════════════════════════════════════════════════════════════
  // VIERAS
  // ═══════════════════════════════════════════════════════════════════

  if (nombreLower.includes('viera') && (descLower.includes('verdadera') || descLower.includes('auténtica') || nombreLower.includes('verdadera'))) {
    return 'Auténticas · Producto gourmet';
  }

  if (nombreLower.includes('viera')) {
    return 'Cortes de calamar · Para gratinar';
  }

  // ═══════════════════════════════════════════════════════════════════
  // MOLUSCOS Y ALMEJAS
  // ═══════════════════════════════════════════════════════════════════

  if (nombreLower.includes('pepitona') && nombreLower.includes('caja')) {
    return 'Caja 10kg · Para negocios';
  }

  if (nombreLower.includes('pepitona')) {
    return 'La clásica venezolana · Para arroces';
  }

  if (nombreLower.includes('mejillón') || nombreLower.includes('mejillon')) {
    if (nombreLower.includes('pelado')) {
      return 'Ya pelados · Listos para cocinar';
    }
    return 'Con concha · Al vapor o gratinados';
  }

  if (nombreLower.includes('guacuco')) {
    return 'Almeja del Caribe · Pelada · Sopas y arroces';
  }

  if (nombreLower.includes('almeja')) {
    return 'Frescas · Pastas, arroces, al vapor';
  }

  if (nombreLower.includes('kigua')) {
    return 'Caracol venezolano · Sabor del Caribe';
  }

  if (nombreLower.includes('vaquita')) {
    return 'Para sopas y caldos tradicionales';
  }

  // ═══════════════════════════════════════════════════════════════════
  // CANGREJOS Y ESPECIALES
  // ═══════════════════════════════════════════════════════════════════

  if (nombreLower.includes('jaiba')) {
    return 'Cangrejo azul · Sopas y asopados';
  }

  if (nombreLower.includes('pulpa de cangrejo') || nombreLower.includes('pulpa cangrejo')) {
    return 'Pura pulpa 250g · Pasapalos y ensaladas';
  }

  if (nombreLower.includes('tinta')) {
    return 'Para arroces negros · Sabor intenso';
  }

  if (nombreLower.includes('salmon') || nombreLower.includes('salmón')) {
    return 'Importado premium · Plancha, horno o crudo';
  }

  // ═══════════════════════════════════════════════════════════════════
  // FALLBACK
  // ═══════════════════════════════════════════════════════════════════

  // Fallback: primera oración corta
  if (descripcion.length <= 40) return descripcion;

  const primerPunto = descripcion.indexOf('.');
  if (primerPunto > 0 && primerPunto <= 45) {
    return descripcion.substring(0, primerPunto);
  }

  const textoCorto = descripcion.substring(0, 35);
  const ultimoEspacio = textoCorto.lastIndexOf(' ');
  return ultimoEspacio > 15 ? textoCorto.substring(0, ultimoEspacio) : textoCorto;
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
const SAMPLE_DATA: Omit<Product, 'precioBs' | 'descripcionCorta' | 'masVendido' | 'incremento' | 'esCaja'>[] = [
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
 */
export async function getBCVRate(): Promise<BCVRate> {
  // Intentar con ve.dolarapi.com primero (más estable)
  try {
    const response = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (data.promedio) {
        const fecha = data.fechaActualizacion
          ? new Date(data.fechaActualizacion).toLocaleDateString('es-VE')
          : new Date().toLocaleDateString('es-VE');
        return {
          rate: data.promedio,
          date: fecha,
          source: 'BCV',
        };
      }
    }
  } catch (error) {
    console.error('Error con ve.dolarapi.com:', error);
  }

  // Fallback: pydolarve.org
  try {
    const response = await fetch('https://pydolarve.org/api/v1/dollar?page=bcv', {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      const bcvData = data.monitors?.usd;
      if (bcvData?.price) {
        return {
          rate: bcvData.price,
          date: bcvData.last_update || new Date().toLocaleDateString('es-VE'),
          source: 'BCV',
        };
      }
    }
  } catch (error) {
    console.error('Error con pydolarve.org:', error);
  }

  // Último fallback: tasa de respaldo
  console.warn('⚠️ Usando tasa de respaldo - APIs no disponibles');
  return {
    rate: 70.00, // Tasa de respaldo actualizada
    date: new Date().toLocaleDateString('es-VE'),
    source: 'Referencial',
  };
}

/**
 * Obtiene los productos desde Google Sheets
 * Si falla o no esta configurado, devuelve datos de ejemplo
 */
export async function getProducts(bcvRate: number): Promise<Product[]> {
  // Si no hay SHEET_ID configurado, usar datos de ejemplo
  if (!SHEET_ID || SHEET_ID === 'TU_SHEET_ID_AQUI') {
    console.log('⚠️ Usando datos de ejemplo. Configura PUBLIC_SHEET_ID para conectar con Google Sheets.');
    return SAMPLE_DATA.map(p => ({
      ...p,
      precioBs: p.precioUSD * bcvRate,
      descripcionCorta: generarDescripcionCorta(p.descripcion, p.nombre),
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
          categoria: String(row.c[5]?.v || 'General'),
          precioUSD,
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
  const categoryOrder = ['Camarones', 'Mariscos', 'Especiales'];

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
