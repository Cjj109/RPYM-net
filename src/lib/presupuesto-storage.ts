/**
 * RPYM - Módulo de almacenamiento de presupuestos
 *
 * Este módulo maneja la comunicación con Cloudflare D1
 * para guardar y gestionar presupuestos.
 *
 * Anteriormente usaba Google Apps Script, ahora usa D1 APIs.
 */

// ============================================
// TIPOS
// ============================================

export interface PresupuestoItem {
  nombre: string;
  cantidad: number;
  unidad: string;
  precioUSD: number;
  precioBs: number;
  subtotalUSD: number;
  subtotalBs: number;
  precioUSDDivisa?: number;
  subtotalUSDDivisa?: number;
}

export interface Presupuesto {
  id: string;
  fecha: string;
  items: PresupuestoItem[];
  totalUSD: number;
  totalBs: number;
  totalUSDDivisa?: number;
  hideRate?: boolean; // True = hide BCV rate in print (but NOT same as divisas mode)
  delivery?: number; // Delivery cost in USD
  modoPrecio?: 'bcv' | 'divisa' | 'dual'; // Pricing mode
  estado: 'pendiente' | 'pagado';
  clientIP?: string;
  fechaPago?: string;
  customerName?: string;
  customerAddress?: string;
  source?: 'admin' | 'cliente';
  isLinked?: boolean; // True if linked to a customer transaction
}

export interface SavePresupuestoData {
  items: PresupuestoItem[];
  totalUSD: number;
  totalBs: number;
  totalUSDDivisa?: number;
  hideRate?: boolean;
  delivery?: number;
  modoPrecio?: 'bcv' | 'divisa' | 'dual';
  customerName?: string;
  customerAddress?: string;
  status?: 'pendiente' | 'pagado';
  source?: 'admin' | 'cliente';
  customDate?: string; // YYYY-MM-DD format for past presupuestos
}

export interface PresupuestoStats {
  totalHoy: number;
  vendidoHoyUSD: string;
  vendidoHoyBs: string;
  pendientes: number;
  totalGeneral: number;
}

// ============================================
// FUNCIONES DE ALMACENAMIENTO
// ============================================

/**
 * Guarda un presupuesto en D1
 * Esta función es silenciosa - no muestra errores al usuario
 */
export async function savePresupuesto(data: SavePresupuestoData): Promise<{ success: boolean; id?: string }> {
  try {
    // Obtener IP del cliente (aproximada)
    let clientIP = '';
    try {
      const ipResponse = await fetch('https://api.ipify.org?format=json');
      const ipData = await ipResponse.json();
      clientIP = ipData.ip;
    } catch {
      // Si falla obtener IP, continuar sin ella
    }

    const response = await fetch('/api/presupuestos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: data.items,
        totalUSD: data.totalUSD,
        totalBs: data.totalBs,
        totalUSDDivisa: data.totalUSDDivisa || null,
        hideRate: data.hideRate || false,
        delivery: data.delivery || 0,
        modoPrecio: data.modoPrecio || 'bcv',
        customerName: data.customerName || '',
        customerAddress: data.customerAddress || '',
        clientIP: clientIP,
        status: data.status || 'pendiente',
        source: data.source || 'cliente',
        customDate: data.customDate || null,
      })
    });

    const result = await response.json();
    return {
      success: result.success || false,
      id: result.id
    };
  } catch (error) {
    // Silencioso - no bloquear la experiencia del usuario
    console.error('Error guardando presupuesto:', error);
    return { success: false };
  }
}

/**
 * Obtiene un presupuesto por ID
 */
export async function getPresupuesto(id: string): Promise<Presupuesto | null> {
  try {
    const response = await fetch(`/api/presupuestos/${encodeURIComponent(id)}`);
    const result = await response.json();

    if (result.success && result.presupuesto) {
      return result.presupuesto;
    }
    return null;
  } catch (error) {
    console.error('Error obteniendo presupuesto:', error);
    return null;
  }
}

/**
 * Lista todos los presupuestos
 */
export async function listPresupuestos(
  status?: 'pendiente' | 'pagado' | 'all',
  search?: string
): Promise<Presupuesto[]> {
  try {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search?.trim()) params.set('search', search.trim());
    const queryString = params.toString();
    const response = await fetch(`/api/presupuestos${queryString ? '?' + queryString : ''}`);
    const result = await response.json();

    return result.presupuestos || [];
  } catch (error) {
    console.error('Error listando presupuestos:', error);
    return [];
  }
}

/**
 * Actualiza el estado de un presupuesto
 */
export async function updatePresupuestoStatus(
  id: string,
  status: 'pendiente' | 'pagado'
): Promise<boolean> {
  try {
    const response = await fetch(`/api/presupuestos/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status })
    });

    const result = await response.json();
    return result.success || false;
  } catch (error) {
    console.error('Error actualizando estado:', error);
    return false;
  }
}

/**
 * Actualiza los items y totales de un presupuesto existente
 */
export async function updatePresupuesto(
  id: string,
  items: PresupuestoItem[],
  totalUSD: number,
  totalBs: number,
  customerName?: string,
  customerAddress?: string,
  totalUSDDivisa?: number,
  hideRate?: boolean,
  delivery?: number,
  modoPrecio?: 'bcv' | 'divisa' | 'dual',
  fecha?: string
): Promise<boolean> {
  try {
    const response = await fetch(`/api/presupuestos/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items,
        totalUSD,
        totalBs,
        totalUSDDivisa: totalUSDDivisa || null,
        hideRate: hideRate || false,
        delivery: delivery || 0,
        modoPrecio: modoPrecio || 'bcv',
        customerName: customerName || '',
        customerAddress: customerAddress || '',
        fecha: fecha || null,
      })
    });

    const result = await response.json();
    return result.success || false;
  } catch (error) {
    console.error('Error actualizando presupuesto:', error);
    return false;
  }
}

/**
 * Elimina un presupuesto
 */
export async function deletePresupuesto(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`/api/presupuestos/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });

    const result = await response.json();
    return { success: result.success || false, error: result.error };
  } catch (error) {
    console.error('Error eliminando presupuesto:', error);
    return { success: false, error: 'Error de conexión' };
  }
}

/**
 * Obtiene estadísticas de presupuestos
 */
export async function getPresupuestoStats(): Promise<PresupuestoStats | null> {
  try {
    const response = await fetch('/api/presupuestos/stats');
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    return null;
  }
}

/**
 * Genera URL para ver un presupuesto
 */
export function getPresupuestoViewUrl(id: string): string {
  return `/presupuesto/ver?id=${encodeURIComponent(id)}`;
}

/**
 * Verifica si el módulo está configurado correctamente
 * Siempre devuelve true ya que D1 se configura automáticamente
 */
export function isConfigured(): boolean {
  return true;
}
