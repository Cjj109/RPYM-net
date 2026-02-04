/**
 * RPYM - Módulo de almacenamiento de presupuestos
 *
 * Este módulo maneja la comunicación con Google Apps Script
 * para guardar y gestionar presupuestos.
 */

// ============================================
// CONFIGURACIÓN
// ============================================

// URL del Google Apps Script desplegado
// IMPORTANTE: Reemplazar después del deploy del script
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxq9yoSKmAFMbVsVAcN3yURQXh24jit3Nhl8RR5yQW81va7lfXw2DjQbdguTaiMVbx2RA/exec';

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
}

export interface Presupuesto {
  id: string;
  fecha: string;
  items: PresupuestoItem[];
  totalUSD: number;
  totalBs: number;
  estado: 'pendiente' | 'pagado';
  clientIP?: string;
  fechaPago?: string;
  customerName?: string;
  customerAddress?: string;
  source?: 'admin' | 'cliente';
}

export interface SavePresupuestoData {
  items: PresupuestoItem[];
  totalUSD: number;
  totalBs: number;
  customerName?: string;
  customerAddress?: string;
  status?: 'pendiente' | 'pagado';
  source?: 'admin' | 'cliente';
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
 * Guarda un presupuesto en Google Sheets
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

    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: {
        'Content-Type': 'text/plain', // Apps Script requiere text/plain para CORS
      },
      body: JSON.stringify({
        action: 'create',
        items: data.items,
        totalUSD: data.totalUSD,
        totalBs: data.totalBs,
        customerName: data.customerName || '',
        customerAddress: data.customerAddress || '',
        clientIP: clientIP,
        status: data.status || 'pendiente',
        source: data.source || 'cliente',
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
    const response = await fetch(`${APPS_SCRIPT_URL}?action=get&id=${encodeURIComponent(id)}`);
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
export async function listPresupuestos(status?: 'pendiente' | 'pagado' | 'all'): Promise<Presupuesto[]> {
  try {
    const statusParam = status ? `&status=${status}` : '';
    const response = await fetch(`${APPS_SCRIPT_URL}?action=list${statusParam}`);
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
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({
        action: 'updateStatus',
        id: id,
        status: status
      })
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
export async function updatePresupuesto(data: {
  id: string;
  items: PresupuestoItem[];
  totalUSD: number;
  totalBs: number;
  customerName?: string;
  customerAddress?: string;
}): Promise<{ success: boolean }> {
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({
        action: 'update',
        id: data.id,
        items: data.items,
        totalUSD: data.totalUSD,
        totalBs: data.totalBs,
        customerName: data.customerName || '',
        customerAddress: data.customerAddress || '',
      })
    });

    const result = await response.json();
    return { success: result.success || false };
  } catch (error) {
    console.error('Error actualizando presupuesto:', error);
    return { success: false };
  }
}

/**
 * Elimina un presupuesto
 */
export async function deletePresupuesto(id: string): Promise<boolean> {
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({
        action: 'delete',
        id: id
      })
    });

    const result = await response.json();
    return result.success || false;
  } catch (error) {
    console.error('Error eliminando presupuesto:', error);
    return false;
  }
}

/**
 * Obtiene estadísticas de presupuestos
 */
export async function getPresupuestoStats(): Promise<PresupuestoStats | null> {
  try {
    const response = await fetch(`${APPS_SCRIPT_URL}?action=stats`);
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
 */
export function isConfigured(): boolean {
  return !APPS_SCRIPT_URL.includes('TU_DEPLOYMENT_ID');
}
