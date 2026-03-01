/**
 * Genera tarjeta WhatsApp compacta (320px) para la calculadora.
 * Similar a presupuesto-whatsapp-card.ts pero sin cantidades/unidades.
 */
import { formatUSD, formatBs } from './format';
import type { CalcEntry } from '../components/calculator/types';

export interface CalcCardData {
  entries: CalcEntry[];
  clientName: string;
  totalUSD: number;
  totalBs: number;
  activeRate: number;
  refId: string;
}

function generateBubble(data: CalcCardData, baseUrl: string): string {
  const fechaStr = new Date().toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const productRows = data.entries.map(entry => {
    const name = entry.description || 'Mariscos Varios';
    const sign = entry.isNegative ? '-' : '';
    const color = entry.isNegative ? '#dc2626' : '#0c4a6e';
    return `
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid #e0f2fe;">
        <div style="flex:1;font-size:13px;color:${color};">${name}</div>
        <div style="font-size:13px;font-weight:600;color:${color};white-space:nowrap;">${sign}${formatUSD(entry.amountUSD)}</div>
      </div>`;
  }).join('');

  return `
  <div style="width:320px;background:white;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);border:2px solid #075985;">
    <div style="text-align:center;margin-bottom:12px;">
      <img src="${baseUrl}/camaronlogo-sm.webp" alt="RPYM" style="display:block;width:140px;height:auto;object-fit:contain;margin:0 auto;" />
    </div>
    ${data.clientName ? '<div style="font-size:12px;color:#0369a1;text-align:center;margin-bottom:10px;">Cliente: <strong style="color:#0c4a6e;">' + data.clientName + '</strong></div>' : ''}
    <div style="margin-bottom:12px;">
      ${productRows}
    </div>
    <div style="border-top:2px solid #075985;padding-top:10px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:14px;font-weight:600;color:#0369a1;">Total USD</span>
        <span style="font-size:20px;font-weight:800;color:#0c4a6e;">${data.totalUSD < 0 ? '-' : ''}${formatUSD(Math.abs(data.totalUSD))}</span>
      </div>
      ${data.activeRate > 0 ? `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px;">
        <span style="font-size:12px;color:#0369a1;">Total Bs.</span>
        <span style="font-size:15px;font-weight:700;color:#ea580c;">${data.totalBs < 0 ? '-' : ''}${formatBs(Math.abs(data.totalBs))}</span>
      </div>` : ''}
    </div>
    <div style="text-align:center;border-top:1px solid #e0f2fe;padding-top:8px;">
      <div style="font-size:10px;color:#0ea5e9;">${fechaStr}</div>
      <div style="font-size:10px;color:#0ea5e9;margin-top:2px;">WhatsApp: +58 414-214-5202</div>
      <div style="font-size:9px;color:#e0f2fe;margin-top:4px;">Ref: ${data.refId}</div>
    </div>
  </div>`;
}

/** HTML completo para captura con html2canvas */
export function renderCalcCardHTML(data: CalcCardData, baseUrl: string = ''): string {
  return `
    <div style="font-family:'Inter',-apple-system,sans-serif;width:320px;">
      ${generateBubble(data, baseUrl)}
    </div>
  `;
}

/** Abre ventana de preview para screenshot manual */
export function openCalcCardWindow(data: CalcCardData, baseUrl: string = ''): void {
  const bubble = generateBubble(data, baseUrl);
  const win = window.open('', '_blank', 'width=380,height=700,scrollbars=yes');
  if (!win) {
    alert('No se pudo abrir la ventana. Verifica que no estén bloqueados los popups.');
    return;
  }

  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>RPYM - Calculadora</title>
  <meta name="viewport" content="width=320" />
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f0f9ff;
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
  ${bubble}
</body>
</html>`);

  win.document.close();
}
