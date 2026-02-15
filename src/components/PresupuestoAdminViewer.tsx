/**
 * RPYM - Admin Presupuesto Viewer
 * Vista admin con dual pricing y funcionalidad de impresión
 */
import { useState, useEffect } from 'react';
import { printDeliveryNote, type PrintPresupuesto } from '../lib/print-delivery-note';
import { openWhatsAppCardWindow, type WhatsAppCardData } from '../lib/presupuesto-whatsapp-card';
import { formatUSD, formatBs, formatQuantity, formatDateDMY } from '../lib/format';

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

  const formatDate = formatDateDMY;

  const handlePrint = () => {
    if (!presupuesto) return;
    const { modoPrecio, items, delivery = 0, customerName, totalUSD, totalUSDDivisa, hideRate } = presupuesto;
    const isDual = modoPrecio === 'dual' || (modoPrecio !== 'divisa' && totalUSDDivisa != null && totalUSDDivisa > 0);
    const cardData: WhatsAppCardData = {
      id: presupuesto.id,
      fecha: presupuesto.fecha,
      items: items.map(item => ({
        nombre: item.nombre,
        cantidad: item.cantidad,
        unidad: item.unidad,
        subtotalUSD: item.subtotalUSD,
        subtotalUSDDivisa: item.subtotalUSDDivisa,
      })),
      totalUSD: totalUSD,
      totalUSDDivisa: totalUSDDivisa,
      hideRate: hideRate,
      delivery: delivery,
      modoPrecio: isDual ? 'dual' : (modoPrecio || 'bcv'),
      estado: presupuesto.estado,
      customerName: customerName,
    };
    openWhatsAppCardWindow(cardData, { bcvRate });
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
