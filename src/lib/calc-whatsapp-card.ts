/**
 * Tarjeta WhatsApp de la calculadora. Usa el mismo diseño "factura" que los
 * presupuestos (presupuesto-whatsapp-card.ts), con filas de descripción y monto.
 */
import {
  renderWhatsAppCardHTML,
  openWhatsAppCardWindow,
  type WhatsAppCardData,
  type WhatsAppCardOpts,
} from './presupuesto-whatsapp-card';
import type { CalcEntry } from '../components/calculator/types';

export interface CalcCardData {
  entries: CalcEntry[];
  clientName: string;
  totalUSD: number;
  totalBs: number;
  activeRate: number;
  refId: string;
  hideBs?: boolean;
}

function toCardData(data: CalcCardData): WhatsAppCardData {
  return {
    id: data.refId,
    fecha: new Date().toISOString(),
    items: data.entries.map(entry => {
      const amount = Math.abs(entry.amountUSD);
      return { nombre: entry.description || 'Mariscos Varios', subtotalUSD: entry.isNegative ? -amount : amount };
    }),
    totalUSD: data.totalUSD,
    totalBs: data.totalBs,
    hideRate: data.hideBs,
    modoPrecio: 'bcv',
    estado: 'pendiente',
    customerName: data.clientName,
  };
}

// La tasa de la calculadora es la BCV (automática o puesta a mano)
function cardOpts(data: CalcCardData, baseUrl: string): WhatsAppCardOpts {
  return { bcvRate: data.activeRate, baseUrl };
}

/** HTML completo para captura con html2canvas */
export function renderCalcCardHTML(data: CalcCardData, baseUrl: string = ''): string {
  return renderWhatsAppCardHTML(toCardData(data), cardOpts(data, baseUrl));
}

/** Abre ventana de preview con botón de descarga y el de mostrar/ocultar Bs */
export function openCalcCardWindow(data: CalcCardData, baseUrl: string = ''): void {
  openWhatsAppCardWindow(toCardData(data), { ...cardOpts(data, baseUrl), showBs: !data.hideBs });
}
