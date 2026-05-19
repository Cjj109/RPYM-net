/**
 * Utilidad compartida para imprimir notas de entrega/presupuestos
 * Formato IDENTICO al AdminPanel.tsx printNote()
 * Usado por PresupuestoViewer.tsx y PresupuestoAdminViewer.tsx
 */
import { formatUSD, formatBs, formatQuantity } from './format';

export interface PrintItem {
  nombre: string;
  cantidad: number;
  unidad: string;
  precioUSD: number;
  subtotalUSD: number;
  precioUSDDivisa?: number;
  subtotalUSDDivisa?: number;
}

export interface PrintPresupuesto {
  id: string;
  fecha: string;
  items: PrintItem[];
  totalUSD: number;
  totalBs: number;
  totalUSDDivisa?: number;
  hideRate?: boolean;
  delivery?: number;
  modoPrecio?: string;
  estado: 'pendiente' | 'pagado';
  customerName?: string;
  customerAddress?: string;
}


/**
 * Abre una ventana de impresión con formato de Nota de Entrega A4
 * FORMATO IDENTICO AL ADMIN PANEL
 * Soporta todos los modos: BCV, divisas, dual
 * Respeta el flag hideRate para ocultar Bs
 * @param bcvRate - Tasa BCV actual (opcional). Si se proporciona, recalcula los Bs dinámicamente
 */
export function printDeliveryNote(presupuesto: PrintPresupuesto, bcvRate?: number): void {
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  if (!printWindow) {
    alert('No se pudo abrir la ventana de impresion. Verifica que no esten bloqueados los popups.');
    return;
  }

  const origin = window.location.origin;
  const modoPrecio = presupuesto.modoPrecio || '';
  // isDualMode = modo dual real (mostrar AMBAS páginas)
  const isDualMode = modoPrecio === 'dual';
  // isDivisasOnly = modo divisas puro (mostrar SOLO página divisa, no BCV)
  const isDivisasOnly = ['divisa', 'divisas'].includes(modoPrecio);
  // hideRateOnly = modo BCV pero ocultando la tasa (totalBs existe pero tasa oculta)
  const hideRateOnly = presupuesto.hideRate === true;
  // showBcvPage = mostrar la primera página BCV (NO mostrar si es divisas puro)
  const showBcvPage = !isDivisasOnly;
  // showDivisaPage = mostrar página divisa (para dual o divisas)
  const showDivisaPage = isDualMode || isDivisasOnly;
  const showPaid = presupuesto.estado === 'pagado';
  const dateStr = new Date(presupuesto.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const customerName = presupuesto.customerName || '';
  const customerAddress = presupuesto.customerAddress || '';

  // Delivery cost
  const deliveryCost = presupuesto.delivery || 0;
  const subtotalUSD = presupuesto.totalUSD - deliveryCost;

  // Filas de productos BCV
  const rows = presupuesto.items.map((item, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#f0f9ff'}">
      <td style="border-right:1px solid #075985;padding:6px 10px;color:#0c4a6e;">${item.nombre}</td>
      <td style="border-right:1px solid #075985;padding:6px 10px;text-align:center;color:#0c4a6e;">${formatQuantity(item.cantidad)}</td>
      <td style="border-right:1px solid #075985;padding:6px 10px;text-align:center;color:#0c4a6e;">${item.unidad}</td>
      <td style="border-right:1px solid #075985;padding:6px 10px;text-align:right;color:#0c4a6e;">${formatUSD(item.precioUSD)}</td>
      <td style="padding:6px 10px;text-align:right;font-weight:600;color:#0c4a6e;">${formatUSD(item.subtotalUSD)}</td>
    </tr>
  `).join('');

  // Filas de productos Divisa (para presupuestos duales o divisas puro)
  const divisaRows = showDivisaPage ? presupuesto.items.map((item, i) => {
    const precio = isDualMode ? (item.precioUSDDivisa ?? item.precioUSD) : item.precioUSD;
    const subtotal = isDualMode ? (item.subtotalUSDDivisa ?? item.subtotalUSD) : item.subtotalUSD;
    return `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#fefce8'}">
      <td style="border-right:1px solid #92400e;padding:6px 10px;color:#713f12;">${item.nombre}</td>
      <td style="border-right:1px solid #92400e;padding:6px 10px;text-align:center;color:#713f12;">${formatQuantity(item.cantidad)}</td>
      <td style="border-right:1px solid #92400e;padding:6px 10px;text-align:center;color:#713f12;">${item.unidad}</td>
      <td style="border-right:1px solid #92400e;padding:6px 10px;text-align:right;color:#713f12;">${formatUSD(precio)}</td>
      <td style="padding:6px 10px;text-align:right;font-weight:600;color:#713f12;">${formatUSD(subtotal)}</td>
    </tr>
  `;}).join('') : '';

  // Pagina divisa (envuelta en #page-divisa para captura con html2canvas)
  const divisaPageHtml = showDivisaPage ? `
    ${isDualMode ? '<div style="page-break-before:always;"></div>' : ''}
    <div id="page-divisa" style="position:relative;padding:12mm 15mm;background:white;">
    <div class="watermark" style="color:rgba(234,179,8,0.06);">PRESUPUESTO</div>
    ${showPaid ? `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-15deg);border:6px solid #16a34a;border-radius:12px;padding:15px 40px;color:#16a34a;font-size:36px;font-weight:900;text-transform:uppercase;letter-spacing:3px;opacity:0.35;pointer-events:none;z-index:1;">PAGADO</div>` : ''}
    <div style="display:flex;align-items:center;justify-content:space-between;border:2px solid #92400e;padding:12px 16px;margin-bottom:16px;">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <div style="width:48px;height:48px;border-radius:50%;border:2px solid #fde68a;overflow:hidden;flex-shrink:0;background:white;display:flex;align-items:center;justify-content:center;">
            <img src="/camaronlogo-sm.webp" alt="RPYM" style="width:140%;height:140%;object-fit:contain;" />
          </div>
          <div style="font-size:22px;font-weight:800;color:#713f12;">RPYM</div>
        </div>
        <div style="font-size:10px;color:#92400e;">Muelle Pesquero "El Mosquero", Puesto 3 y 4, Maiquetia</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:16px;font-weight:700;color:#713f12;border-bottom:2px solid #92400e;padding-bottom:4px;margin-bottom:6px;">PRESUPUESTO</div>
        <div style="background:#fef3c7;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;color:#92400e;margin-bottom:4px;">PRECIOS DIVISA</div>
        <div style="font-size:10px;color:#92400e;">No: <span style="font-family:monospace;font-weight:600;color:#713f12;">${presupuesto.id}</span></div>
        <div style="font-size:10px;color:#92400e;margin-top:2px;">Fecha: <span style="font-weight:600;color:#713f12;">${dateStr}</span></div>
      </div>
    </div>
    <div style="border:2px solid #92400e;padding:10px 16px;margin-bottom:16px;">
      <div style="margin-bottom:6px;"><span style="font-size:10px;font-weight:600;color:#92400e;">Cliente:</span><span style="font-size:12px;color:#713f12;margin-left:8px;">${customerName || '---'}</span></div>
      <div><span style="font-size:10px;font-weight:600;color:#92400e;">Direccion:</span><span style="font-size:12px;color:#713f12;margin-left:8px;">${customerAddress || '---'}</span></div>
    </div>
    <div style="border:2px solid #92400e;margin-bottom:16px;">
      <table>
        <thead>
          <tr style="background:#fef3c7;">
            <th style="border-bottom:2px solid #92400e;border-right:1px solid #92400e;padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#713f12;">Producto</th>
            <th style="border-bottom:2px solid #92400e;border-right:1px solid #92400e;padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#713f12;width:60px;">Cant</th>
            <th style="border-bottom:2px solid #92400e;border-right:1px solid #92400e;padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#713f12;width:60px;">Unidad</th>
            <th style="border-bottom:2px solid #92400e;border-right:1px solid #92400e;padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#713f12;width:80px;">P.Unitario</th>
            <th style="border-bottom:2px solid #92400e;padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#713f12;width:80px;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${divisaRows}</tbody>
      </table>
    </div>
    <div style="border:2px solid #92400e;margin-bottom:16px;display:flex;">
      <div style="flex:1;padding:10px 16px;border-right:2px solid #92400e;">
        <div style="font-size:10px;font-weight:600;color:#92400e;margin-bottom:4px;">OBSERVACIONES:</div>
        <div style="font-size:10px;color:#92400e;">Precios en USD efectivo</div>
      </div>
      <div style="width:200px;padding:10px 16px;">
        ${(() => {
          const totalDivisa = isDualMode ? (presupuesto.totalUSDDivisa || presupuesto.totalUSD) : presupuesto.totalUSD;
          const subtotalDivisa = totalDivisa - deliveryCost;
          return deliveryCost > 0 ? `
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;">
          <span style="color:#92400e;">Subtotal:</span>
          <span style="font-weight:600;color:#713f12;">${formatUSD(subtotalDivisa)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:6px;">
          <span style="color:#92400e;">Delivery:</span>
          <span style="font-weight:600;color:#713f12;">${formatUSD(deliveryCost)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;border-top:1px solid #fde68a;padding-top:6px;">
          <span style="color:#92400e;font-weight:600;">Total USD:</span>
          <span style="font-weight:800;color:#713f12;">${formatUSD(totalDivisa)}</span>
        </div>` : `
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:#92400e;font-weight:600;">Total USD:</span>
          <span style="font-weight:800;color:#713f12;">${formatUSD(totalDivisa)}</span>
        </div>`;
        })()}
      </div>
    </div>
    <div style="display:flex;gap:40px;margin-top:40px;">
      <div style="flex:1;text-align:center;"><div style="border-top:2px solid #92400e;padding-top:6px;margin:0 30px;"><span style="font-size:10px;font-weight:600;color:#92400e;">CONFORME CLIENTE</span></div></div>
      <div style="flex:1;text-align:center;"><div style="border-top:2px solid #92400e;padding-top:6px;margin:0 30px;"><span style="font-size:10px;font-weight:600;color:#92400e;">ENTREGADO POR</span></div></div>
    </div>
    ${showPaid ? '<div style="background:#dcfce7;color:#166534;padding:12px;border-radius:8px;text-align:center;margin-top:16px;font-weight:600;font-size:13px;">Gracias por su compra!</div>' : ''}
    <div style="margin-top:${showPaid ? '8' : '20'}px;padding:6px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:4px;text-align:center;">
      <span style="font-size:10px;color:#b45309;font-weight:500;">Este documento no tiene validez fiscal - Solo para referencia</span>
    </div>
    <div style="margin-top:12px;padding-top:8px;border-top:1px solid #fde68a;text-align:center;">
      <span style="font-size:10px;color:#d97706;">www.rpym.net • WhatsApp: +58 414-214-5202</span>
    </div>
    </div>
  ` : '';

  // Botones de descarga según el modo
  const downloadBtns = isDualMode
    ? `<button onclick="downloadImage('page-bcv','presupuesto-bcv-${presupuesto.id}.png')" style="padding:8px 14px;background:#0369a1;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);">&#11015; Imagen BCV</button>
       <button onclick="downloadImage('page-divisa','presupuesto-divisa-${presupuesto.id}.png')" style="padding:8px 14px;background:#d97706;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);">&#11015; Imagen Divisa</button>`
    : `<button onclick="downloadImage('${isDivisasOnly ? 'page-divisa' : 'page-bcv'}','presupuesto-${presupuesto.id}.png')" style="padding:8px 14px;background:#16a34a;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);">&#11015; Descargar imagen</button>`;

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Presupuesto - ${presupuesto.id}</title>
  <base href="${origin}" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: white;
      color: #0c4a6e;
    }
    #page-bcv {
      padding: 12mm 15mm;
      position: relative;
      background: white;
    }
    table { width:100%; border-collapse:collapse; }
    @media print {
      body { padding: 0; }
      @page { size: A4; margin: 12mm 15mm; }
      .no-print { display: none !important; }
      #page-bcv, #page-divisa { padding: 0; }
    }
    .watermark {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-30deg);
      font-size: 80px;
      font-weight: 900;
      letter-spacing: 12px;
      pointer-events: none;
      z-index: 0;
      color: rgba(14, 165, 233, 0.06);
    }
  </style>
</head>
<body>
  <div class="no-print" id="dl-toolbar" style="position:fixed;bottom:20px;right:20px;display:flex;flex-direction:column;gap:8px;z-index:9999;">
    ${downloadBtns}
    <button onclick="window.close()" style="padding:8px 14px;background:#dc2626;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);">Cerrar</button>
  </div>

  ${showBcvPage ? `
  <div id="page-bcv">
    <div class="watermark">PRESUPUESTO</div>

    ${showPaid ? '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-15deg);border:6px solid #16a34a;border-radius:12px;padding:15px 40px;color:#16a34a;font-size:36px;font-weight:900;text-transform:uppercase;letter-spacing:3px;opacity:0.35;pointer-events:none;z-index:1;">PAGADO</div>' : ''}

    <!-- Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;border:2px solid #075985;padding:12px 16px;margin-bottom:16px;">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <div style="width:48px;height:48px;border-radius:50%;border:2px solid #7dd3fc;overflow:hidden;flex-shrink:0;background:white;display:flex;align-items:center;justify-content:center;">
            <img src="/camaronlogo-sm.webp" alt="RPYM" style="width:140%;height:140%;object-fit:contain;" />
          </div>
          <div style="font-size:22px;font-weight:800;color:#0c4a6e;">RPYM</div>
        </div>
        <div style="font-size:10px;color:#0369a1;">Muelle Pesquero "El Mosquero", Puesto 3 y 4, Maiquetia</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:16px;font-weight:700;color:#0c4a6e;border-bottom:2px solid #075985;padding-bottom:4px;margin-bottom:6px;">PRESUPUESTO</div>
        ${isDualMode || hideRateOnly ? '<div style="background:#e0f2fe;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;color:#075985;margin-bottom:4px;">PRECIOS BCV</div>' : ''}
        <div style="font-size:10px;color:#0369a1;">No: <span style="font-family:monospace;font-weight:600;color:#0c4a6e;">${presupuesto.id}</span></div>
        <div style="font-size:10px;color:#0369a1;margin-top:2px;">Fecha: <span style="font-weight:600;color:#0c4a6e;">${dateStr}</span></div>
      </div>
    </div>

    <!-- Client info -->
    <div style="border:2px solid #075985;padding:10px 16px;margin-bottom:16px;">
      <div style="margin-bottom:6px;">
        <span style="font-size:10px;font-weight:600;color:#0369a1;">Cliente:</span>
        <span style="font-size:12px;color:#0c4a6e;margin-left:8px;">${customerName || '---'}</span>
      </div>
      <div>
        <span style="font-size:10px;font-weight:600;color:#0369a1;">Direccion:</span>
        <span style="font-size:12px;color:#0c4a6e;margin-left:8px;">${customerAddress || '---'}</span>
      </div>
    </div>

    <!-- Products table -->
    <div style="border:2px solid #075985;margin-bottom:16px;">
      <table>
        <thead>
          <tr style="background:#e0f2fe;">
            <th style="border-bottom:2px solid #075985;border-right:1px solid #075985;padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#0c4a6e;">Producto</th>
            <th style="border-bottom:2px solid #075985;border-right:1px solid #075985;padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#0c4a6e;width:60px;">Cant</th>
            <th style="border-bottom:2px solid #075985;border-right:1px solid #075985;padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#0c4a6e;width:60px;">Unidad</th>
            <th style="border-bottom:2px solid #075985;border-right:1px solid #075985;padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#0c4a6e;width:80px;">P.Unitario</th>
            <th style="border-bottom:2px solid #075985;padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#0c4a6e;width:80px;">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>

    <!-- Totals -->
    <div style="border:2px solid #075985;margin-bottom:16px;display:flex;">
      <div style="flex:1;padding:10px 16px;border-right:2px solid #075985;">
        <div style="font-size:10px;font-weight:600;color:#0369a1;margin-bottom:4px;">OBSERVACIONES:</div>
        <div style="font-size:10px;color:#0369a1;">Tasa BCV aplicada al momento de pago</div>
      </div>
      <div style="width:200px;padding:10px 16px;">
        ${deliveryCost > 0 ? `
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;">
          <span style="color:#0369a1;">Subtotal:</span>
          <span style="font-weight:600;color:#0c4a6e;">${formatUSD(subtotalUSD)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:6px;">
          <span style="color:#0369a1;">Delivery:</span>
          <span style="font-weight:600;color:#0c4a6e;">${formatUSD(deliveryCost)}</span>
        </div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;font-size:13px;${deliveryCost > 0 ? 'border-top:1px solid #7dd3fc;padding-top:6px;' : ''}">
          <span style="color:#0369a1;font-weight:600;">Total USD:</span>
          <span style="font-weight:800;color:#0c4a6e;">${formatUSD(presupuesto.totalUSD)}</span>
        </div>
        ${!hideRateOnly ? `<div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px;border-top:1px solid #7dd3fc;padding-top:4px;">
          <span style="color:#0369a1;">Total Bs.:</span>
          <span style="font-weight:700;color:#ea580c;">${formatBs(bcvRate ? presupuesto.totalUSD * bcvRate : presupuesto.totalBs)}</span>
        </div>` : ''}
      </div>
    </div>

    <!-- Signatures -->
    <div style="display:flex;gap:40px;margin-top:40px;">
      <div style="flex:1;text-align:center;">
        <div style="border-top:2px solid #075985;padding-top:6px;margin:0 30px;">
          <span style="font-size:10px;font-weight:600;color:#0369a1;">CONFORME CLIENTE</span>
        </div>
      </div>
      <div style="flex:1;text-align:center;">
        <div style="border-top:2px solid #075985;padding-top:6px;margin:0 30px;">
          <span style="font-size:10px;font-weight:600;color:#0369a1;">ENTREGADO POR</span>
        </div>
      </div>
    </div>

    ${showPaid ? '<div style="background:#dcfce7;color:#166534;padding:12px;border-radius:8px;text-align:center;margin-top:16px;font-weight:600;font-size:13px;">Gracias por su compra!</div>' : ''}

    <!-- Non-fiscal notice -->
    <div style="margin-top:${showPaid ? '8' : '20'}px;padding:6px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:4px;text-align:center;">
      <span style="font-size:10px;color:#b45309;font-weight:500;">Este documento no tiene validez fiscal - Solo para referencia</span>
    </div>

    <!-- Footer -->
    <div style="margin-top:12px;padding-top:8px;border-top:1px solid #bae6fd;text-align:center;">
      <span style="font-size:10px;color:#0ea5e9;">www.rpym.net • WhatsApp: +58 414-214-5202</span>
    </div>
  </div>
  ` : ''}

  ${divisaPageHtml}

  <script>
  async function downloadImage(elementId, filename) {
    if (typeof html2canvas === 'undefined') {
      alert('Cargando libreria... Intenta nuevamente en un momento.');
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
        backgroundColor: '#ffffff',
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

  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
}
