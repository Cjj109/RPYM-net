/**
 * RPYM - Visor de Presupuesto Individual
 */
import { useState, useEffect } from 'react';
import { getPresupuesto, type Presupuesto } from '../lib/presupuesto-storage';
import { printDeliveryNote } from '../lib/print-delivery-note';
import { formatUSD, formatBs, formatDateWithTime } from '../lib/format';

export default function PresupuestoViewer() {
  const [presupuesto, setPresupuesto] = useState<Presupuesto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bcvRate, setBcvRate] = useState<number>(0);

  useEffect(() => {
    const loadPresupuesto = async () => {
      // Obtener ID de la URL
      const params = new URLSearchParams(window.location.search);
      const id = params.get('id');

      if (!id) {
        setError('No se especificó un ID de presupuesto');
        setIsLoading(false);
        return;
      }

      try {
        // Cargar presupuesto y tasa BCV en paralelo
        const [data, rateRes] = await Promise.all([
          getPresupuesto(id),
          fetch('/api/config/bcv-rate').then(r => r.json()).catch(() => ({ rate: 0 }))
        ]);

        if (data) {
          setPresupuesto(data);
        } else {
          setError('Presupuesto no encontrado');
        }

        if (rateRes?.rate) {
          setBcvRate(rateRes.rate);
        }
      } catch (err) {
        setError('Error al cargar el presupuesto');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    loadPresupuesto();
  }, []);

  const formatDate = formatDateWithTime;

  // Función para imprimir en formato tarjeta WhatsApp
  const handlePrint = () => {
    if (!presupuesto) return;

    const noteNumber = presupuesto.id;
    const date = formatDate(presupuesto.fecha);
    const customerName = presupuesto.customerName || '';
    const isPaid = presupuesto.estado === 'pagado';
    const modoPrecio = presupuesto.modoPrecio || 'bcv';
    const totalUSD = presupuesto.totalUSD;
    const totalUSDDivisa = presupuesto.totalUSDDivisa;
    const totalBs = presupuesto.totalBs;
    const delivery = presupuesto.delivery || 0;
    const hideRateBs = presupuesto.hideRate || false;

    // Generar filas de productos BCV
    const bcvProductRows = presupuesto.items.map(item => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e0f2fe;font-size:11px;">${item.nombre}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e0f2fe;text-align:center;font-size:11px;">${item.cantidad} ${item.unidad}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e0f2fe;text-align:right;font-size:11px;">$\{formatUSD(item.precioUSD)\}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e0f2fe;text-align:right;font-size:11px;font-weight:600;">$\{formatUSD(item.subtotalUSD)\}</td>
      </tr>
    `).join('');

    // Generar filas de productos Divisa (si es dual)
    const divisaProductRows = modoPrecio === 'dual' ? presupuesto.items.map(item => {
      const precioDivisa = item.precioUSDDivisa || item.precioUSD;
      const subtotalDivisa = item.subtotalUSDDivisa || item.subtotalUSD;
      return `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #fef3c7;font-size:11px;">${item.nombre}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #fef3c7;text-align:center;font-size:11px;">${item.cantidad} ${item.unidad}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #fef3c7;text-align:right;font-size:11px;">$\{formatUSD(precioDivisa)\}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #fef3c7;text-align:right;font-size:11px;font-weight:600;">$\{formatUSD(subtotalDivisa)\}</td>
        </tr>
      `;
    }).join('') : '';

    const printWindow = window.open('', '_blank', 'width=800,height=900');
    if (!printWindow) return;

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Presupuesto #${noteNumber}</title>
  <style>
    @page { size: auto; margin: 10mm; }
    @media print {
      body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .no-print { display: none !important; }
      .card { width: 100% !important; max-width: 400px !important; page-break-inside: avoid; }
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f0f9ff; }
    .container { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; }
    .card { width: 100%; max-width: 400px; background: white; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  </style>
</head>
<body>
  <div class="no-print" style="text-align:center;margin-bottom:20px;">
    <button onclick="window.print()" style="padding:12px 24px;background:#0ea5e9;color:white;border:none;border-radius:8px;font-size:16px;cursor:pointer;">
      Imprimir
    </button>
  </div>
  <div class="container">
    <!-- BCV Card -->
    <div class="card" style="border:2px solid #0ea5e9;">
      <div style="text-align:center;margin-bottom:12px;">
        <img src="/camaronlogo-sm.webp" alt="RPYM" style="display:block;width:140px;height:auto;object-fit:contain;margin:0 auto;" />
        <div style="font-size:12px;color:#0369a1;margin-top:4px;">Presupuesto</div>
        ${modoPrecio === 'dual' ? '<div style="background:#e0f2fe;display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;color:#075985;margin-top:4px;">Precios BCV</div>' : ''}
        ${isPaid ? '<div style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#166534;font-size:12px;font-weight:600;padding:3px 10px;border-radius:9999px;margin-top:6px;">PAGADO</div>' : ''}
      </div>

      ${customerName ? `<div style="font-size:12px;color:#0369a1;text-align:center;margin-bottom:10px;">Cliente: <strong style="color:#0c4a6e;">${customerName}</strong></div>` : ''}

      <div style="margin-bottom:12px;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#e0f2fe;">
              <th style="padding:6px 8px;text-align:left;font-size:10px;font-weight:600;color:#0369a1;">Producto</th>
              <th style="padding:6px 8px;text-align:center;font-size:10px;font-weight:600;color:#0369a1;">Cant.</th>
              <th style="padding:6px 8px;text-align:right;font-size:10px;font-weight:600;color:#0369a1;">P.Unit</th>
              <th style="padding:6px 8px;text-align:right;font-size:10px;font-weight:600;color:#0369a1;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${bcvProductRows}
            ${delivery > 0 ? `
            <tr style="background:#fef3c7;">
              <td style="padding:6px 8px;border-bottom:1px solid #e0f2fe;font-size:11px;font-style:italic;">Delivery</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e0f2fe;text-align:center;font-size:11px;">1</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e0f2fe;text-align:right;font-size:11px;">$\{formatUSD(delivery)\}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e0f2fe;text-align:right;font-size:11px;font-weight:600;">$\{formatUSD(delivery)\}</td>
            </tr>
            ` : ''}
          </tbody>
        </table>
      </div>

      <div style="background:#fff7ed;padding:10px;border-radius:8px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:#0369a1;">Total USD:</span>
          <span style="font-size:18px;font-weight:700;color:#ea580c;">$\{formatUSD(totalUSD)\}</span>
        </div>
        ${!hideRateBs && bcvRate > 0 ? `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
          <span style="font-size:11px;color:#64748b;">Total Bs:</span>
          <span style="font-size:12px;font-weight:600;color:#0c4a6e;">$\{formatBs((totalUSD * bcvRate))\}</span>
        </div>
        ` : ''}
      </div>

      <div style="text-align:center;padding-top:8px;border-top:1px dashed #bae6fd;">
        <div style="font-size:10px;color:#0ea5e9;">${date}</div>
        <div style="font-size:10px;color:#0ea5e9;margin-top:2px;">WhatsApp: +58 414-214-5202</div>
        <div style="font-size:9px;color:#7dd3fc;margin-top:4px;">Ref: ${noteNumber}</div>
      </div>
    </div>

    ${modoPrecio === 'dual' && totalUSDDivisa ? `
    <!-- Divisa Card -->
    <div class="card" style="border:2px solid #fde68a;">
      <div style="text-align:center;margin-bottom:12px;">
        <img src="/camaronlogo-sm.webp" alt="RPYM" style="display:block;width:140px;height:auto;object-fit:contain;margin:0 auto;" />
        <div style="background:#fef3c7;display:inline-block;padding:3px 12px;border-radius:6px;font-size:12px;font-weight:700;color:#92400e;margin-top:4px;">Precios Divisa</div>
        ${isPaid ? '<div style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#166534;font-size:12px;font-weight:600;padding:3px 10px;border-radius:9999px;margin-top:6px;">PAGADO</div>' : ''}
      </div>
      ${customerName ? '<div style="font-size:12px;color:#92400e;text-align:center;margin-bottom:10px;">Cliente: <strong style="color:#713f12;">' + customerName + '</strong></div>' : ''}
      <div style="margin-bottom:12px;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#fef3c7;">
              <th style="padding:6px 8px;text-align:left;font-size:10px;font-weight:600;color:#92400e;">Producto</th>
              <th style="padding:6px 8px;text-align:center;font-size:10px;font-weight:600;color:#92400e;">Cant.</th>
              <th style="padding:6px 8px;text-align:right;font-size:10px;font-weight:600;color:#92400e;">P.Unit</th>
              <th style="padding:6px 8px;text-align:right;font-size:10px;font-weight:600;color:#92400e;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${divisaProductRows}
            ${delivery > 0 ? `
            <tr style="background:#fef3c7;">
              <td style="padding:6px 8px;border-bottom:1px solid #fde68a;font-size:11px;font-style:italic;">Delivery</td>
              <td style="padding:6px 8px;border-bottom:1px solid #fde68a;text-align:center;font-size:11px;">1</td>
              <td style="padding:6px 8px;border-bottom:1px solid #fde68a;text-align:right;font-size:11px;">$\{formatUSD(delivery)\}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #fde68a;text-align:right;font-size:11px;font-weight:600;">$\{formatUSD(delivery)\}</td>
            </tr>
            ` : ''}
          </tbody>
        </table>
      </div>
      <div style="background:#fffbeb;padding:10px;border-radius:8px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:#92400e;">Total USD:</span>
          <span style="font-size:18px;font-weight:700;color:#d97706;">$\{formatUSD(totalUSDDivisa)\}</span>
        </div>
      </div>
      <div style="text-align:center;padding-top:8px;border-top:1px dashed #fde68a;">
        <div style="font-size:10px;color:#d97706;">${date}</div>
        <div style="font-size:10px;color:#d97706;margin-top:2px;">WhatsApp: +58 414-214-5202</div>
        <div style="font-size:9px;color:#fcd34d;margin-top:4px;">Ref: ${noteNumber}</div>
      </div>
    </div>
    ` : ''}
  </div>
</body>
</html>`);
    printWindow.document.close();
  };

  // Función para imprimir en formato Nota de Entrega A4 (tipo admin panel)
  const handlePrintDeliveryNote = () => {
    if (!presupuesto) return;
    printDeliveryNote(presupuesto, bcvRate);
  };

  // Generar mensaje de WhatsApp
  const generateWhatsAppMessage = () => {
    if (!presupuesto) return '';

    let message = `¡Hola! Quiero confirmar el presupuesto *${presupuesto.id}*\n\n`;

    presupuesto.items.forEach((item) => {
      message += `• ${item.nombre}: ${item.cantidad} ${item.unidad} (${formatUSD(item.subtotalUSD)})\n`;
    });

    if (presupuesto.delivery && presupuesto.delivery > 0) {
      message += `• Delivery: ${formatUSD(presupuesto.delivery)}\n`;
    }

    message += `\n─────────────────\n`;
    message += `*TOTAL: ${formatUSD(presupuesto.totalUSD)}*\n`;
    // Solo mostrar Bs si no es modo divisas, no tiene hideRate, y tenemos tasa BCV
    const showBsInMsg = !presupuesto.hideRate && !['divisa', 'divisas'].includes(presupuesto.modoPrecio || '') && bcvRate > 0;
    if (showBsInMsg) {
      message += `($\{formatBs((presupuesto.totalUSD * bcvRate))\})\n`;
    }
    message += `\n¿Está disponible? Gracias.`;

    return encodeURIComponent(message);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-ocean-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-ocean-200 border-t-ocean-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-ocean-600">Cargando presupuesto...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-ocean-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 shadow-lg text-center max-w-md w-full">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">😕</span>
          </div>
          <h1 className="text-xl font-bold text-ocean-900 mb-2">Error</h1>
          <p className="text-ocean-600 mb-6">{error}</p>
          <a
            href="/presupuesto"
            className="inline-block px-6 py-3 bg-ocean-600 text-white rounded-xl font-medium hover:bg-ocean-500 transition-colors"
          >
            Crear nuevo presupuesto
          </a>
        </div>
      </div>
    );
  }

  if (!presupuesto) return null;

  return (
    <div className="min-h-screen bg-ocean-50 py-8 px-4 print-container">
      <div className="max-w-2xl mx-auto">
        {/* Estado del presupuesto */}
        <div className={`mb-6 p-4 rounded-2xl text-center ${
          presupuesto.estado === 'pagado'
            ? 'bg-green-100 border-2 border-green-300'
            : 'bg-yellow-100 border-2 border-yellow-300'
        }`}>
          {presupuesto.estado === 'pagado' ? (
            <div>
              <span className="text-4xl">✅</span>
              <p className="text-lg font-bold text-green-700 mt-2">PAGADO</p>
              {presupuesto.fechaPago && (
                <p className="text-sm text-green-600">
                  Pagado el {formatDate(presupuesto.fechaPago)}
                </p>
              )}
            </div>
          ) : (
            <div>
              <span className="text-4xl">⏳</span>
              <p className="text-lg font-bold text-yellow-700 mt-2">PENDIENTE DE PAGO</p>
              <p className="text-sm text-yellow-600">
                Este presupuesto está esperando confirmación
              </p>
            </div>
          )}
        </div>

        {/* Contenido del presupuesto — estilo admin */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-5 pb-4 border-b-2 border-ocean-800">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 rounded-full border-2 border-ocean-300 flex items-center justify-center overflow-hidden flex-shrink-0 bg-white">
                  <img src="/camaronlogo-sm.webp" alt="RPYM" className="w-[140%] h-[140%] object-contain" />
                </div>
                <h1 className="text-xl font-bold text-ocean-900">RPYM</h1>
              </div>
              <div className="text-xs text-ocean-600 space-y-0.5">
                <p>
                  <a href="https://www.google.com/maps/search/?api=1&query=Mercado+El+Mosquero%2C+Maiquet%C3%ADa" target="_blank" rel="noopener noreferrer" className="underline hover:text-ocean-900">
                    Muelle Pesquero "El Mosquero"
                  </a>, Puesto 3 y 4
                </p>
                <p>WhatsApp: +58 414-214-5202</p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-bold text-ocean-900 text-base border-b-2 border-ocean-800 pb-1 mb-2">PRESUPUESTO</p>
              <p className="text-xs text-ocean-600">
                Nº: <span className="font-mono font-semibold text-ocean-900">{presupuesto.id}</span>
              </p>
              <p className="text-xs text-ocean-600 mt-1">
                Fecha: <span className="font-medium text-ocean-900">{formatDate(presupuesto.fecha)}</span>
              </p>
            </div>
          </div>

          {/* Datos del cliente */}
          {(presupuesto.customerName || presupuesto.customerAddress) && (
            <div className="bg-ocean-50 p-3 px-5 rounded-lg mx-4 mt-4">
              <p className="text-[10px] text-ocean-600 mb-1">CLIENTE</p>
              {presupuesto.customerName && (
                <p className="font-semibold text-ocean-900 text-sm">{presupuesto.customerName}</p>
              )}
              {presupuesto.customerAddress && (
                <p className="text-xs text-ocean-600">{presupuesto.customerAddress}</p>
              )}
            </div>
          )}

          {/* Tabla de productos */}
          <div className="px-4 mt-4">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-ocean-100">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-ocean-900 border-b-2 border-ocean-800">Producto</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-ocean-900 border-b-2 border-ocean-800">Cantidad</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-ocean-900 border-b-2 border-ocean-800">Precio Unit.</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-ocean-900 border-b-2 border-ocean-800">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {presupuesto.items.map((item, idx) => (
                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-ocean-50/50'}>
                    <td className="px-3 py-2 text-sm text-ocean-900">{item.nombre}</td>
                    <td className="px-3 py-2 text-center text-sm text-ocean-900">{item.cantidad} {item.unidad}</td>
                    <td className="px-3 py-2 text-right text-sm text-ocean-900">{formatUSD(item.precioUSD)}</td>
                    <td className="px-3 py-2 text-right text-sm font-semibold text-ocean-900">{formatUSD(item.subtotalUSD)}</td>
                  </tr>
                ))}
                {presupuesto.delivery && presupuesto.delivery > 0 && (
                  <tr className="bg-amber-50">
                    <td className="px-3 py-2 text-sm text-ocean-900 italic">Delivery</td>
                    <td className="px-3 py-2 text-center text-sm text-ocean-900">1 servicio</td>
                    <td className="px-3 py-2 text-right text-sm text-ocean-900">{formatUSD(presupuesto.delivery)}</td>
                    <td className="px-3 py-2 text-right text-sm font-semibold text-ocean-900">{formatUSD(presupuesto.delivery)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Totales */}
          <div className="mx-4 mt-4 bg-orange-50 rounded-lg p-4">
            {presupuesto.delivery && presupuesto.delivery > 0 && (
              <>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-ocean-600 text-sm">Subtotal:</span>
                  <span className="text-sm font-medium text-ocean-900">{formatUSD(presupuesto.totalUSD - presupuesto.delivery)}</span>
                </div>
                <div className="flex justify-between items-center mb-2 pb-2 border-b border-orange-200">
                  <span className="text-ocean-600 text-sm">Delivery:</span>
                  <span className="text-sm font-medium text-ocean-900">{formatUSD(presupuesto.delivery)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between items-center mb-1">
              <span className="text-ocean-600">Total USD:</span>
              <span className="text-xl font-bold text-coral-600">{formatUSD(presupuesto.totalUSD)}</span>
            </div>
            {/* Ocultar Bs en modo divisas o si hideRate está activo */}
            {!presupuesto.hideRate && !['divisa', 'divisas'].includes(presupuesto.modoPrecio || '') && bcvRate > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-ocean-600 text-sm">Total Bolívares:</span>
                <span className="text-sm font-semibold text-ocean-900">Bs. {(presupuesto.totalUSD * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            )}
          </div>

          {/* Aviso no fiscal */}
          <div className="mx-4 mt-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-[10px] text-amber-700 text-center font-medium">
              ESTE DOCUMENTO NO TIENE VALIDEZ FISCAL - Solo para referencia
            </p>
          </div>

          {/* Acciones */}
          <div className="p-4 flex flex-col gap-3 no-print">
            {/* Fila 1: WhatsApp y Vista Tarjeta */}
            <div className="flex gap-3">
              <a
                href={`https://wa.me/584142145202?text=${generateWhatsAppMessage()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-3 bg-green-600 hover:bg-green-500 text-white font-medium
                  rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z" />
                </svg>
                Confirmar
              </a>
              <button
                onClick={handlePrint}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-white font-medium
                  rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z" />
                </svg>
                Vista WhatsApp
              </button>
            </div>
            {/* Fila 2: Imprimir Nota de Entrega */}
            <button
              onClick={handlePrintDeliveryNote}
              className="py-3 bg-ocean-600 hover:bg-ocean-500 text-white font-medium
                rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Imprimir Nota
            </button>
            <a
              href="/presupuesto"
              className="py-3 border border-ocean-200 text-ocean-700 font-medium
                rounded-xl transition-colors flex items-center justify-center gap-2 hover:bg-ocean-50 text-sm"
            >
              Crear nuevo presupuesto
            </a>
          </div>

          {/* Footer */}
          <div className="text-center p-3 pt-0 border-t border-ocean-100">
            <p className="text-xs text-ocean-500 pt-3">
              <a href="https://www.google.com/maps/search/?api=1&query=Mercado+El+Mosquero%2C+Maiquet%C3%ADa" target="_blank" rel="noopener noreferrer" className="underline hover:text-ocean-700">Muelle Pesquero "El Mosquero"</a> · Puesto 3 y 4, Maiquetía
            </p>
            <p className="text-xs text-ocean-500 mt-1">
              www.rpym.net · WhatsApp: +58 414-214-5202
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
