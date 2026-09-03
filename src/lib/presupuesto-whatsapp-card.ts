/**
 * Utilidad compartida para la Vista WhatsApp (card compacta 320px)
 * Soporta modos BCV, divisa y dual (burbujas separadas)
 * Usado por AdminPanel, AdminBudgetBuilder y PresupuestoAdminViewer
 */
import { formatUSD, formatBs, formatQuantity, formatUSDCompact } from './format';

export interface WhatsAppCardItem {
  nombre: string;
  cantidad: number;
  unidad: string;
  subtotalUSD: number;
  subtotalUSDDivisa?: number;
}

export interface WhatsAppCardData {
  id: string;
  fecha: string;
  items: WhatsAppCardItem[];
  totalUSD: number;
  totalUSDDivisa?: number;
  hideRate?: boolean;
  delivery?: number;
  modoPrecio?: string;
  estado: 'pendiente' | 'pagado';
  customerName?: string;
}

export interface WhatsAppCardOpts {
  bcvRate?: number;
  baseUrl?: string; // prefix for image paths (e.g. window.location.origin para html2canvas)
}


/**
 * Etiqueta de precio unitario que va junto al nombre: " ($12/kg)".
 * Se deriva del subtotal para no depender de que el item traiga precioUSD.
 * Devuelve '' cuando no hay cantidad con la que dividir.
 */
function unitPriceLabel(subtotal: number, cantidad: number, unidad: string): string {
  if (!(cantidad > 0) || !(subtotal > 0)) return '';
  return ` (${formatUSDCompact(subtotal / cantidad)}/${unidad})`;
}

function getThemeColors(isDivisasOnly: boolean) {
  return isDivisasOnly ? {
    bg: '#fffbeb', border: '#fde68a', borderDark: '#92400e', text: '#713f12', textLight: '#92400e', accent: '#d97706'
  } : {
    bg: '#f0f9ff', border: '#e0f2fe', borderDark: '#075985', text: '#0c4a6e', textLight: '#0369a1', accent: '#0ea5e9'
  };
}

/**
 * Genera solo las burbujas HTML (main + divisa si dual)
 * Sin wrapper de página ni fondo
 */
function generateBubbles(data: WhatsAppCardData, opts: WhatsAppCardOpts): string {
  const isDivisasOnly = ['divisa', 'divisas'].includes(data.modoPrecio || '');
  const isDual = data.modoPrecio === 'dual';
  const isPaid = data.estado === 'pagado';
  const colors = getThemeColors(isDivisasOnly);
  const baseUrl = opts.baseUrl || '';
  const bcvRate = opts.bcvRate || 0;
  const delivery = data.delivery || 0;
  const subtotalUSD = data.totalUSD - delivery;
  const fechaStr = new Date(data.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const productRows = data.items.map(item => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid ${colors.border};">
        <div style="flex:1;font-size:13px;color:${colors.text};">${item.nombre}<span style="color:${colors.textLight};font-size:12px;">${unitPriceLabel(item.subtotalUSD, item.cantidad, item.unidad)}</span></div>
        <div style="font-size:12px;color:${colors.textLight};margin:0 8px;white-space:nowrap;">${formatQuantity(item.cantidad)} ${item.unidad}</div>
        <div style="font-size:13px;font-weight:600;color:${colors.text};white-space:nowrap;">${formatUSD(item.subtotalUSD)}</div>
      </div>
  `).join('');

  // Main bubble
  const mainBubble = `
  <div style="width:320px;background:white;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);border:2px solid ${colors.borderDark};">
    <div style="text-align:center;margin-bottom:12px;">
      <img src="${baseUrl}/camaronlogo-sm.webp" alt="RPYM" style="display:block;width:140px;height:auto;object-fit:contain;margin:0 auto;" />
      <div style="font-size:12px;color:${colors.textLight};margin-top:4px;">Presupuesto</div>
      ${isDivisasOnly ? '<div style="background:#fef3c7;display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;color:#92400e;margin-top:4px;">Precios Divisa</div>' : '<div style="background:#e0f2fe;display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;color:#075985;margin-top:4px;">Precios BCV</div>'}
      ${isPaid ? '<div style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#166534;font-size:12px;font-weight:600;padding:3px 10px;border-radius:9999px;margin-top:6px;">PAGADO</div>' : ''}
    </div>
    ${data.customerName ? '<div style="font-size:12px;color:' + colors.textLight + ';text-align:center;margin-bottom:10px;">Cliente: <strong style="color:' + colors.text + ';">' + data.customerName + '</strong></div>' : ''}
    <div style="margin-bottom:12px;">
      ${productRows}
    </div>
    <div style="border-top:2px solid ${colors.borderDark};padding-top:10px;margin-bottom:12px;">
      ${delivery > 0 ? `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
        <span style="font-size:12px;color:${colors.textLight};">Subtotal</span>
        <span style="font-size:14px;font-weight:600;color:${colors.text};">${formatUSD(subtotalUSD)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
        <span style="font-size:12px;color:${colors.textLight};">Delivery</span>
        <span style="font-size:14px;font-weight:600;color:${colors.text};">${formatUSD(delivery)}</span>
      </div>
      ` : ''}
      <div style="display:flex;justify-content:space-between;align-items:baseline;${delivery > 0 ? 'border-top:1px solid ' + colors.border + ';padding-top:6px;' : ''}">
        <span style="font-size:14px;font-weight:600;color:${colors.textLight};">${isDivisasOnly ? 'Total USD (Divisa)' : 'Total USD'}</span>
        <span style="font-size:20px;font-weight:800;color:${colors.text};">${formatUSD(data.totalUSD)}</span>
      </div>
      ${(!isDivisasOnly && !data.hideRate && bcvRate > 0) ? `<div class="bs-toggle-row" style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px;">
        <span style="font-size:12px;color:${colors.textLight};">Total Bs.</span>
        <span style="font-size:15px;font-weight:700;color:#ea580c;">${formatBs(data.totalUSD * bcvRate)}</span>
      </div>` : ''}
    </div>
    <div style="text-align:center;border-top:1px solid ${colors.border};padding-top:8px;">
      <div style="font-size:10px;color:${colors.accent};">${fechaStr}</div>
      <div style="font-size:10px;color:${colors.accent};margin-top:2px;">WhatsApp: +58 414-214-5202</div>
      <div style="font-size:9px;color:${colors.border};margin-top:4px;">Ref: ${data.id}</div>
    </div>
  </div>`;

  // Divisa bubble (solo para modo dual)
  const divisaBubble = (isDual && data.totalUSDDivisa) ? (() => {
    const divisaProductRows = data.items.map(item => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid #fefce8;">
        <div style="flex:1;font-size:13px;color:#713f12;">${item.nombre}<span style="color:#92400e;font-size:12px;">${unitPriceLabel(item.subtotalUSDDivisa ?? item.subtotalUSD, item.cantidad, item.unidad)}</span></div>
        <div style="font-size:12px;color:#92400e;margin:0 8px;white-space:nowrap;">${formatQuantity(item.cantidad)} ${item.unidad}</div>
        <div style="font-size:13px;font-weight:600;color:#713f12;white-space:nowrap;">${formatUSD(item.subtotalUSDDivisa ?? item.subtotalUSD)}</div>
      </div>
    `).join('');
    return `
    <div style="width:320px;background:white;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);margin-top:16px;border:2px solid #fde68a;">
      <div style="text-align:center;margin-bottom:12px;">
        <img src="${baseUrl}/camaronlogo-sm.webp" alt="RPYM" style="display:block;width:140px;height:auto;object-fit:contain;margin:0 auto;" />
        <div style="background:#fef3c7;display:inline-block;padding:3px 12px;border-radius:6px;font-size:12px;font-weight:700;color:#92400e;margin-top:4px;">Precios Divisa</div>
        ${isPaid ? '<div style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#166534;font-size:12px;font-weight:600;padding:3px 10px;border-radius:9999px;margin-top:6px;">PAGADO</div>' : ''}
      </div>
      ${data.customerName ? '<div style="font-size:12px;color:#92400e;text-align:center;margin-bottom:10px;">Cliente: <strong style="color:#713f12;">' + data.customerName + '</strong></div>' : ''}
      <div style="margin-bottom:12px;">
        ${divisaProductRows}
      </div>
      <div style="border-top:2px solid #92400e;padding-top:10px;margin-bottom:12px;">
        ${delivery > 0 ? `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
          <span style="font-size:12px;color:#92400e;">Subtotal</span>
          <span style="font-size:14px;font-weight:600;color:#713f12;">${formatUSD(data.totalUSDDivisa! - delivery)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
          <span style="font-size:12px;color:#92400e;">Delivery</span>
          <span style="font-size:14px;font-weight:600;color:#713f12;">${formatUSD(delivery)}</span>
        </div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;align-items:baseline;${delivery > 0 ? 'border-top:1px solid #fde68a;padding-top:6px;' : ''}">
          <span style="font-size:14px;font-weight:600;color:#92400e;">Total USD (Divisa)</span>
          <span style="font-size:20px;font-weight:800;color:#713f12;">${formatUSD(data.totalUSDDivisa!)}</span>
        </div>
      </div>
      <div style="text-align:center;border-top:1px solid #fde68a;padding-top:8px;">
        <div style="font-size:10px;color:#d97706;">${fechaStr}</div>
        <div style="font-size:10px;color:#d97706;margin-top:2px;">WhatsApp: +58 414-214-5202</div>
        <div style="font-size:9px;color:#fde68a;margin-top:4px;">Ref: ${data.id}</div>
      </div>
    </div>`;
  })() : '';

  return mainBubble + divisaBubble;
}

// ─── Diseño "Factura" (alterno, tipo comprobante) ──────────────────────────

function getFacturaColors(isAmber: boolean) {
  return isAmber ? {
    dark: '#78350f', ribbonBg: '#fef3c7', text: '#713f12', textLight: '#92400e', orange: '#b45309', border: '#fde68a'
  } : {
    dark: '#0c3b6d', ribbonBg: '#dbeafe', text: '#0c3b6d', textLight: '#3b6ea5', orange: '#ea580c', border: '#bfdbfe'
  };
}

const iconPerson = (c: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/></svg>`;
const iconCalendar = (c: string) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>`;
const iconTag = (c: string) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 12.6 12 21.2a2 2 0 0 1-2.8 0l-7.4-7.4a2 2 0 0 1 0-2.8L10.4 2.4a2 2 0 0 1 1.4-.6H19a2 2 0 0 1 2 2v6.8a2 2 0 0 1-.4 1.4Z"/><circle cx="15.5" cy="7.5" r="1.5"/></svg>`;
const iconWhatsApp = (c: string) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="${c}"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.7 14.2c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.2-3.7-.8-3.1-1.3-5.1-4.4-5.3-4.6-.1-.2-1.3-1.7-1.3-3.2s.8-2.3 1.1-2.6c.3-.3.6-.4.8-.4h.6c.2 0 .5 0 .7.6.3.7.9 2.2 1 2.4.1.2.1.4 0 .6-.1.2-.2.3-.3.5l-.5.5c-.2.2-.3.4-.1.7.2.3.9 1.4 1.9 2.3 1.3 1.2 2.4 1.5 2.7 1.7.3.1.5.1.7-.1.2-.2.8-.9 1-1.2.2-.3.4-.2.7-.1.3.1 1.8.9 2.1 1 .3.2.5.2.6.3.1.2.1.7-.1 1.4Z"/></svg>`;
const iconHeart = (c: string) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="${c}"><path d="M12 21s-7.5-4.6-10-9.1C.5 8.6 2 5 5.6 5c2 0 3.3 1 4.4 2.5C11.1 6 12.4 5 14.4 5 18 5 19.5 8.6 22 11.9 19.5 16.4 12 21 12 21Z"/></svg>`;
const iconDoc = (c: string) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg>`;

/**
 * Genera una tarjeta estilo "factura" (una por moneda: bcv o divisa)
 */
function generateFacturaCard(data: WhatsAppCardData, opts: WhatsAppCardOpts, variant: 'bcv' | 'divisa'): string {
  const isAmber = variant === 'divisa';
  const colors = getFacturaColors(isAmber);
  const isPaid = data.estado === 'pagado';
  const baseUrl = opts.baseUrl || '';
  const bcvRate = opts.bcvRate || 0;
  const delivery = data.delivery || 0;
  const totalUSD = variant === 'divisa' ? (data.totalUSDDivisa ?? data.totalUSD) : data.totalUSD;
  const subtotalUSD = totalUSD - delivery;
  const fechaStr = new Date(data.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const showBcvBlocks = !isAmber && !data.hideRate && bcvRate > 0;

  const rows = data.items.map(item => {
    const itemTotal = variant === 'divisa' ? (item.subtotalUSDDivisa ?? item.subtotalUSD) : item.subtotalUSD;
    const unitLabel = (item.cantidad > 0 && itemTotal > 0) ? formatUSDCompact(itemTotal / item.cantidad) : '—';
    return `
      <div style="display:flex;align-items:center;padding:11px 12px;border-bottom:1px solid ${colors.ribbonBg};">
        <div style="flex:2;min-width:0;font-size:13px;font-weight:700;color:${colors.text};">${item.nombre}</div>
        <div style="flex:1;text-align:center;font-size:12px;color:${colors.textLight};white-space:nowrap;">${formatQuantity(item.cantidad)} ${item.unidad}</div>
        <div style="flex:1;text-align:right;font-size:12px;color:${colors.textLight};white-space:nowrap;">${unitLabel} / ${item.unidad}</div>
        <div style="flex:1;text-align:right;font-size:13px;font-weight:800;color:${colors.text};white-space:nowrap;">${formatUSD(itemTotal)}</div>
      </div>`;
  }).join('');

  return `
  <div style="width:440px;background:white;border-radius:20px;padding:22px;box-shadow:0 4px 16px rgba(0,0,0,0.1);border:2px solid ${colors.dark};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="text-align:center;">
      <img src="${baseUrl}/camaronlogo-trim.webp" alt="RPYM" style="display:block;width:280px;height:auto;object-fit:contain;margin:0 auto;" />
    </div>

    <div style="text-align:center;margin:16px 0;">
      <span style="display:inline-flex;align-items:center;gap:6px;background:${colors.dark};color:white;padding:8px 22px;border-radius:8px;font-weight:700;font-size:13px;letter-spacing:0.5px;white-space:nowrap;">
        ${iconDoc('white')} PRESUPUESTO
      </span>
    </div>

    ${isPaid ? `<div style="text-align:center;margin-bottom:12px;"><span style="display:inline-block;background:#dcfce7;color:#166534;font-size:11px;font-weight:700;padding:3px 12px;border-radius:9999px;">PAGADO</span></div>` : ''}

    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:8px;min-width:0;">
        <div style="width:30px;height:30px;border-radius:50%;background:${colors.dark};display:flex;align-items:center;justify-content:center;flex-shrink:0;">${iconPerson('white')}</div>
        <div style="min-width:0;">
          <div style="font-size:11px;color:${colors.textLight};">Cliente</div>
          <div style="font-size:15px;font-weight:800;color:${colors.text};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${data.customerName || '—'}</div>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;padding-left:8px;">
        <div style="display:flex;align-items:center;gap:5px;justify-content:flex-end;font-size:11px;color:${colors.text};margin-bottom:4px;">${iconCalendar(colors.text)} ${fechaStr}</div>
        <div style="display:flex;align-items:center;gap:5px;justify-content:flex-end;font-size:11px;color:${colors.text};">${iconTag(colors.text)} Ref. ${data.id}</div>
      </div>
    </div>

    ${showBcvBlocks ? `
    <div class="bs-toggle-row" style="display:flex;align-items:center;gap:10px;background:${colors.ribbonBg};border-radius:10px;padding:10px 12px;margin-bottom:14px;">
      <div style="width:26px;height:26px;border-radius:50%;background:${colors.dark};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <span style="color:white;font-size:13px;font-weight:800;">$</span>
      </div>
      <div style="font-size:12px;color:${colors.text};line-height:1.4;">Tasa aplicada: <strong>BCV</strong><br/>${formatBs(bcvRate)} / USD</div>
    </div>` : ''}

    <div style="border-radius:8px;overflow:hidden;margin-bottom:14px;border:1px solid ${colors.ribbonBg};">
      <div style="display:flex;background:${colors.dark};color:white;font-size:10px;font-weight:700;padding:8px 12px;text-transform:uppercase;letter-spacing:0.3px;">
        <div style="flex:2;">Producto</div>
        <div style="flex:1;text-align:center;">Cant.</div>
        <div style="flex:1;text-align:right;">Precio Unit.</div>
        <div style="flex:1;text-align:right;">Total</div>
      </div>
      ${rows}
    </div>

    <div style="border-radius:12px;overflow:hidden;border:2px solid ${colors.dark};">
      <div style="background:${colors.dark};color:white;text-align:center;padding:8px;font-size:12px;font-weight:700;letter-spacing:0.5px;">TOTAL A PAGAR</div>
      <div style="padding:16px;text-align:center;">
        ${delivery > 0 ? `
        <div style="display:flex;justify-content:center;align-items:baseline;gap:6px;font-size:12px;color:${colors.textLight};">
          <span>Subtotal <strong style="color:${colors.text};">${formatUSD(subtotalUSD)}</strong></span>
          <span>+</span>
          <span>Delivery <strong style="color:${colors.text};">${formatUSD(delivery)}</strong></span>
        </div>` : ''}
        <div style="font-size:34px;font-weight:900;line-height:1.1;color:${colors.text};${delivery > 0 ? 'margin-top:8px;' : ''}">${formatUSD(totalUSD)}</div>
        ${(showBcvBlocks) ? `
        <div class="bs-toggle-row">
          <div style="border-top:1px dashed ${colors.border};margin:12px 0 10px;"></div>
          <div style="font-size:11px;color:${colors.textLight};">Equivalente en bolívares</div>
          <div style="font-size:24px;font-weight:800;color:${colors.orange};margin-top:2px;">${formatBs(totalUSD * bcvRate)}</div>
        </div>` : ''}
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:10px;border-top:1px solid ${colors.ribbonBg};font-size:11px;color:${colors.text};">
      <div style="display:flex;align-items:center;gap:6px;">${iconWhatsApp(colors.dark)} +58 414-214-5202</div>
      <div style="display:flex;align-items:center;gap:6px;text-align:right;">¡Gracias por preferir los mejores productos! ${iconHeart(colors.dark)}</div>
    </div>
    <div style="text-align:center;margin-top:10px;padding-top:8px;border-top:1px dashed ${colors.ribbonBg};font-size:10px;font-weight:600;color:${colors.textLight};">
      RPYM &ndash; El Rey de los Pescados y Mariscos
    </div>
  </div>`;
}

/**
 * Genera el diseño "factura" completo (bcv y/o divisa según modoPrecio)
 */
function generateFacturaBubbles(data: WhatsAppCardData, opts: WhatsAppCardOpts): string {
  const isDivisasOnly = ['divisa', 'divisas'].includes(data.modoPrecio || '');
  const isDual = data.modoPrecio === 'dual';
  const mainCard = generateFacturaCard(data, opts, isDivisasOnly ? 'divisa' : 'bcv');
  const divisaCard = (isDual && data.totalUSDDivisa) ? `<div style="margin-top:16px;">${generateFacturaCard(data, opts, 'divisa')}</div>` : '';
  return mainCard + divisaCard;
}

/**
 * Genera HTML completo para captura (html2canvas)
 * Incluye wrapper con fondo gris y tipografia
 */
export function renderWhatsAppCardHTML(data: WhatsAppCardData, opts: WhatsAppCardOpts = {}): string {
  const bubbles = generateBubbles(data, opts);
  return `
    <div style="font-family:'Inter',-apple-system,sans-serif;background:#e5e7eb;padding:16px;display:flex;flex-direction:column;align-items:center;">
      ${bubbles}
    </div>
  `;
}

/**
 * Abre una ventana nueva con la Vista WhatsApp.
 * Permite alternar entre el diseño clásico (card compacta) y el diseño
 * "factura" (comprobante), y descargar la imagen del que esté visible.
 * Si hay tasa BCV visible, también permite ocultar Bs./tasa antes de descargar.
 */
export function openWhatsAppCardWindow(data: WhatsAppCardData, opts: WhatsAppCardOpts = {}): void {
  const isDivisasOnly = ['divisa', 'divisas'].includes(data.modoPrecio || '');
  const colors = getThemeColors(isDivisasOnly);
  const bubbles = generateBubbles(data, opts);
  const facturaBubbles = generateFacturaBubbles(data, opts);
  const origin = window.location.origin;

  const bcvRate = opts.bcvRate || 0;
  const showBsToggle = !isDivisasOnly && !data.hideRate && bcvRate > 0;
  const bsToggleBtn = showBsToggle
    ? `<button id="btn-bs-toggle" onclick="toggleBs()" style="background:#ea580c;">Ocultar Bs.</button>`
    : '';

  const waWindow = window.open('', '_blank', 'width=520,height=780,scrollbars=yes');
  if (!waWindow) {
    alert('No se pudo abrir la ventana. Verifica que no estén bloqueados los popups.');
    return;
  }

  waWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Presupuesto RPYM</title>
  <base href="${origin}" />
  <meta name="viewport" content="width=480, viewport-fit=cover" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f1f5f9;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px 0;
    }
    #dl-toolbar {
      position: -webkit-sticky;
      position: sticky;
      top: 0;
      width: 100%;
      background: rgba(255, 255, 255, 0.97);
      border-bottom: 1px solid #e2e8f0;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      padding-top: max(10px, env(safe-area-inset-top, 0px));
      z-index: 9999;
    }
    #dl-toolbar button {
      padding: 8px 16px;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    }
    .hide-bs .bs-toggle-row { display: none !important; }
    @media print { .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="no-print" id="dl-toolbar">
    ${bsToggleBtn}
    <button id="btn-design-toggle" onclick="toggleDesign()" style="background:#7c3aed;">Ver diseño clásico</button>
    <button onclick="downloadCurrent()" style="background:#16a34a;">&#11015; Descargar imagen</button>
    <button onclick="window.close()" style="background:#dc2626;">Cerrar</button>
  </div>
  <div id="card-content" style="display:none;padding:16px;background:${colors.bg};flex-direction:column;align-items:center;">
    ${bubbles}
  </div>
  <div id="card-content-new" style="padding:16px;background:#f1f5f9;display:flex;flex-direction:column;align-items:center;">
    ${facturaBubbles}
  </div>
  <script>
  var currentDesign = 'new';
  function toggleDesign() {
    currentDesign = currentDesign === 'old' ? 'new' : 'old';
    var oldEl = document.getElementById('card-content');
    var newEl = document.getElementById('card-content-new');
    var btn = document.getElementById('btn-design-toggle');
    if (currentDesign === 'new') {
      oldEl.style.display = 'none';
      newEl.style.display = 'flex';
      if (btn) btn.textContent = 'Ver diseño clásico';
    } else {
      oldEl.style.display = 'flex';
      newEl.style.display = 'none';
      if (btn) btn.textContent = 'Ver diseño nuevo';
    }
  }
  function toggleBs() {
    document.body.classList.toggle('hide-bs');
    var btn = document.getElementById('btn-bs-toggle');
    if (btn) btn.textContent = document.body.classList.contains('hide-bs') ? 'Mostrar Bs.' : 'Ocultar Bs.';
  }
  function downloadCurrent() {
    var elementId = currentDesign === 'new' ? 'card-content-new' : 'card-content';
    var filename = 'presupuesto-' + (currentDesign === 'old' ? 'clasico-' : '') + '${data.id}.png';
    downloadImage(elementId, filename);
  }
  async function downloadImage(elementId, filename) {
    if (typeof html2canvas === 'undefined') {
      alert('Cargando... Intenta nuevamente en un momento.');
      return;
    }
    var toolbar = document.getElementById('dl-toolbar');
    if (toolbar) toolbar.style.visibility = 'hidden';
    try {
      var el = document.getElementById(elementId);
      if (!el) return;
      var canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false
      });
      var a = document.createElement('a');
      a.download = filename;
      a.href = canvas.toDataURL('image/png');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch(err) {
      alert('Error al generar imagen. Intenta de nuevo.');
      console.error(err);
    } finally {
      if (toolbar) toolbar.style.visibility = '';
    }
  }
  <\/script>
</body>
</html>`);

  waWindow.document.close();
}
