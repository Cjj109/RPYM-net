/**
 * Utilidad compartida para la Vista WhatsApp (card compacta 320px)
 * Soporta modos BCV, divisa y dual (burbujas separadas)
 * Usado por AdminPanel, AdminBudgetBuilder y PresupuestoAdminViewer
 */
import { formatUSD, formatBs, formatQuantity } from './format';

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
        <div style="flex:1;font-size:13px;color:${colors.text};">${item.nombre}</div>
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
      ${(!isDivisasOnly && !data.hideRate && bcvRate > 0) ? `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px;">
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
        <div style="flex:1;font-size:13px;color:#713f12;">${item.nombre}</div>
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
 * Abre una ventana nueva con la Vista WhatsApp (card compacta 320px)
 */
export function openWhatsAppCardWindow(data: WhatsAppCardData, opts: WhatsAppCardOpts = {}): void {
  const isDivisasOnly = ['divisa', 'divisas'].includes(data.modoPrecio || '');
  const colors = getThemeColors(isDivisasOnly);
  const bubbles = generateBubbles(data, opts);

  const waWindow = window.open('', '_blank', 'width=380,height=700,scrollbars=yes');
  if (!waWindow) {
    alert('No se pudo abrir la ventana. Verifica que no estén bloqueados los popups.');
    return;
  }

  waWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Presupuesto RPYM</title>
  <meta name="viewport" content="width=320" />
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: ${colors.bg};
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px 0;
    }
    .close-btn {
      margin-bottom: 12px;
      padding: 8px 20px;
      background: #dc2626;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .close-btn:hover { background: #b91c1c; }
    @media print { .no-print { display: none !important; } }
  </style>
</head>
<body>
  <button class="close-btn no-print" onclick="window.close()">Cerrar</button>
  ${bubbles}
</body>
</html>`);

  waWindow.document.close();
}
