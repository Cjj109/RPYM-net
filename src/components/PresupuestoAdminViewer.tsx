/**
 * RPYM - Admin Presupuesto Viewer
 * Vista admin con dual pricing y funcionalidad de impresión
 */
import { useState, useEffect } from 'react';
import { printDeliveryNote, type PrintPresupuesto } from '../lib/print-delivery-note';

interface PresupuestoItem {
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

interface Presupuesto {
  id: string;
  fecha: string;
  items: PresupuestoItem[];
  totalUSD: number;
  totalBs: number;
  totalUSDDivisa?: number;
  hideRate?: boolean;
  delivery?: number;
  modoPrecio?: 'bcv' | 'divisa' | 'dual';
  estado: 'pendiente' | 'pagado';
  customerName?: string;
  customerAddress?: string;
  fechaPago?: string;
  source?: string;
}

export default function PresupuestoAdminViewer() {
  const [presupuesto, setPresupuesto] = useState<Presupuesto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bcvRate, setBcvRate] = useState<number>(0);

  useEffect(() => {
    const loadPresupuesto = async () => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('id');
      const token = params.get('token');

      if (!id || !token) {
        setError('Faltan parámetros de acceso');
        setIsLoading(false);
        return;
      }

      try {
        // Cargar presupuesto y tasa BCV en paralelo
        const [response, rateRes] = await Promise.all([
          fetch(`/api/presupuesto-admin/${id}?token=${token}`),
          fetch('/api/config/bcv-rate').then(r => r.json()).catch(() => ({ rate: 0 }))
        ]);
        const result = await response.json();

        if (result.success && result.presupuesto) {
          setPresupuesto(result.presupuesto);
        } else {
          setError(result.error || 'Error al cargar');
        }

        if (rateRes?.rate) {
          setBcvRate(rateRes.rate);
        }
      } catch (err) {
        setError('Error de conexión');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    loadPresupuesto();
  }, []);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-VE', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  };

  const formatUSD = (amount: number) => `$${Number(amount).toFixed(2)}`;
  const formatBs = (amount: number) => `Bs. ${Number(amount).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
  const formatQuantity = (q: number) => Number.isInteger(q) ? q.toString() : q.toFixed(2);

  const handlePrint = () => {
    if (!presupuesto) return;

    const { modoPrecio, items, delivery = 0, customerName, totalUSD, totalBs, totalUSDDivisa, hideRate } = presupuesto;
    const date = formatDate(presupuesto.fecha);
    const noteNumber = presupuesto.id;
    const isPaid = presupuesto.estado === 'pagado';
    const showBs = !['divisa', 'divisas'].includes(modoPrecio || '') && !hideRate;

    // Product rows for BCV card
    const productRows = items.map((item) => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid #e0f2fe;">
        <div style="flex:1;font-size:13px;color:#0c4a6e;">${item.nombre}</div>
        <div style="font-size:12px;color:#0369a1;margin:0 8px;white-space:nowrap;">${formatQuantity(item.cantidad)} ${item.unidad}</div>
        <div style="font-size:13px;font-weight:600;color:#0c4a6e;white-space:nowrap;">${formatUSD(item.subtotalUSD)}</div>
      </div>
    `).join('');

    // Product rows for Divisa card
    const divisaProductRows = items.map((item) => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid #fefce8;">
        <div style="flex:1;font-size:13px;color:#713f12;">${item.nombre}</div>
        <div style="font-size:12px;color:#92400e;margin:0 8px;white-space:nowrap;">${formatQuantity(item.cantidad)} ${item.unidad}</div>
        <div style="font-size:13px;font-weight:600;color:#713f12;white-space:nowrap;">${formatUSD(item.subtotalUSDDivisa ?? item.subtotalUSD)}</div>
      </div>
    `).join('');

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
        ${productRows}
      </div>

      <div style="border-top:2px solid #075985;padding-top:10px;margin-bottom:12px;">
        ${delivery > 0 ? `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
          <span style="font-size:12px;color:#0369a1;">Subtotal</span>
          <span style="font-size:14px;font-weight:600;color:#0c4a6e;">${formatUSD(totalUSD - delivery)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
          <span style="font-size:12px;color:#0369a1;font-style:italic;">Delivery</span>
          <span style="font-size:14px;font-weight:600;color:#0c4a6e;">${formatUSD(delivery)}</span>
        </div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <span style="font-size:14px;font-weight:600;color:#0369a1;">Total USD</span>
          <span style="font-size:20px;font-weight:800;color:#0c4a6e;">${formatUSD(totalUSD)}</span>
        </div>
        ${showBs && bcvRate > 0 ? `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px;">
          <span style="font-size:12px;color:#0369a1;">Total Bs.</span>
          <span style="font-size:15px;font-weight:700;color:#ea580c;">${formatBs(totalUSD * bcvRate)}</span>
        </div>` : ''}
      </div>

      <div style="text-align:center;border-top:1px solid #e0f2fe;padding-top:8px;">
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
        ${divisaProductRows}
      </div>
      <div style="border-top:2px solid #92400e;padding-top:10px;margin-bottom:12px;">
        ${delivery > 0 ? `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
          <span style="font-size:12px;color:#92400e;">Subtotal</span>
          <span style="font-size:14px;font-weight:600;color:#713f12;">${formatUSD(totalUSDDivisa - delivery)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
          <span style="font-size:12px;color:#92400e;font-style:italic;">Delivery</span>
          <span style="font-size:14px;font-weight:600;color:#713f12;">${formatUSD(delivery)}</span>
        </div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <span style="font-size:14px;font-weight:600;color:#92400e;">Total USD (Divisa)</span>
          <span style="font-size:20px;font-weight:800;color:#713f12;">${formatUSD(totalUSDDivisa)}</span>
        </div>
      </div>
      <div style="text-align:center;border-top:1px solid #fde68a;padding-top:8px;">
        <div style="font-size:10px;color:#d97706;">${date}</div>
        <div style="font-size:10px;color:#d97706;margin-top:2px;">WhatsApp: +58 414-214-5202</div>
        <div style="font-size:9px;color:#fde68a;margin-top:4px;">Ref: ${noteNumber}</div>
      </div>
    </div>
    ` : ''}
  </div>
</body>
</html>`);

    printWindow.document.close();
  };

  // Función para imprimir en formato Nota de Entrega A4 (usa utilidad compartida)
  const handlePrintDeliveryNote = () => {
    if (!presupuesto) return;
    printDeliveryNote(presupuesto as PrintPresupuesto, bcvRate);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-ocean-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-ocean-200 border-t-ocean-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-ocean-600">Cargando...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-ocean-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 shadow-lg text-center max-w-md w-full">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🔒</span>
          </div>
          <h1 className="text-xl font-bold text-ocean-900 mb-2">Acceso Denegado</h1>
          <p className="text-ocean-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!presupuesto) return null;

  const { modoPrecio, items, delivery = 0, totalUSD, totalBs, totalUSDDivisa, hideRate } = presupuesto;
  const showBsInView = !['divisa', 'divisas'].includes(modoPrecio || '') && !hideRate;

  return (
    <div className="min-h-screen bg-ocean-50 py-6 px-4 print-container">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-ocean-900">Presupuesto #{presupuesto.id}</h1>
            <p className="text-ocean-600 text-sm">{formatDate(presupuesto.fecha)}</p>
          </div>
          <div className="flex gap-3">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              presupuesto.estado === 'pagado'
                ? 'bg-green-100 text-green-700'
                : 'bg-yellow-100 text-yellow-700'
            }`}>
              {presupuesto.estado === 'pagado' ? '✓ Pagado' : '⏳ Pendiente'}
            </span>
            {modoPrecio && (
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                modoPrecio === 'dual' ? 'bg-purple-100 text-purple-700' :
                modoPrecio === 'divisa' ? 'bg-amber-100 text-amber-700' :
                'bg-ocean-100 text-ocean-700'
              }`}>
                {modoPrecio.toUpperCase()}
              </span>
            )}
            {hideRate && (
              <span className="px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-600">
                Sin Bs
              </span>
            )}
          </div>
        </div>

        {/* Customer info */}
        {presupuesto.customerName && (
          <div className="bg-white rounded-xl p-4 mb-4 shadow-sm">
            <p className="text-sm text-ocean-600">Cliente</p>
            <p className="font-semibold text-ocean-900">{presupuesto.customerName}</p>
            {presupuesto.customerAddress && (
              <p className="text-sm text-ocean-600">{presupuesto.customerAddress}</p>
            )}
          </div>
        )}

        {/* Products table */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-4">
          <table className="w-full">
            <thead className="bg-ocean-100">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-ocean-900">Producto</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-ocean-900">Cantidad</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-ocean-900">USD (BCV)</th>
                {modoPrecio === 'dual' && (
                  <th className="px-4 py-3 text-right text-sm font-semibold text-amber-700">USD (Divisa)</th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-ocean-50/50'}>
                  <td className="px-4 py-3 text-ocean-900">{item.nombre}</td>
                  <td className="px-4 py-3 text-center text-ocean-700">{formatQuantity(item.cantidad)} {item.unidad}</td>
                  <td className="px-4 py-3 text-right font-medium text-ocean-900">{formatUSD(item.subtotalUSD)}</td>
                  {modoPrecio === 'dual' && (
                    <td className="px-4 py-3 text-right font-medium text-amber-700">{formatUSD(item.subtotalUSDDivisa ?? item.subtotalUSD)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="bg-white rounded-xl p-4 shadow-sm mb-6">
          {delivery > 0 && (
            <>
              <div className="flex justify-between items-center mb-2">
                <span className="text-ocean-600">Subtotal</span>
                <div className="flex gap-6">
                  <span className="font-medium text-ocean-900">{formatUSD(totalUSD - delivery)}</span>
                  {modoPrecio === 'dual' && totalUSDDivisa && (
                    <span className="font-medium text-amber-700">{formatUSD(totalUSDDivisa - delivery)}</span>
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center mb-2 pb-2 border-b border-ocean-100">
                <span className="text-ocean-600 italic">Delivery</span>
                <span className="font-medium text-ocean-900">{formatUSD(delivery)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between items-center">
            <span className="text-lg font-semibold text-ocean-900">Total USD</span>
            <div className="flex gap-6">
              <span className="text-2xl font-bold text-ocean-900">{formatUSD(totalUSD)}</span>
              {modoPrecio === 'dual' && totalUSDDivisa && (
                <span className="text-2xl font-bold text-amber-600">{formatUSD(totalUSDDivisa)}</span>
              )}
            </div>
          </div>
          {showBsInView && bcvRate > 0 && (
            <div className="flex justify-between items-center mt-2">
              <span className="text-ocean-600">Total Bs.</span>
              <span className="font-semibold text-coral-600">{formatBs(totalUSD * bcvRate)}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3 no-print">
          <div className="flex gap-3">
            <button
              onClick={handlePrint}
              className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z" />
              </svg>
              Vista WhatsApp
            </button>
            <button
              onClick={handlePrintDeliveryNote}
              className="flex-1 py-3 bg-ocean-600 hover:bg-ocean-500 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Imprimir Nota
            </button>
          </div>
          <a
            href="/admin#presupuestos"
            className="py-3 border border-ocean-200 text-ocean-700 font-medium rounded-xl transition-colors flex items-center justify-center gap-2 hover:bg-ocean-50"
          >
            Admin Panel
          </a>
        </div>
      </div>
    </div>
  );
}
