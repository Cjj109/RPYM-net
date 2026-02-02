/**
 * RPYM - Visor de Presupuesto Individual
 */
import { useState, useEffect } from 'react';
import { getPresupuesto, type Presupuesto } from '../lib/presupuesto-storage';

export default function PresupuestoViewer() {
  const [presupuesto, setPresupuesto] = useState<Presupuesto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        const data = await getPresupuesto(id);
        if (data) {
          setPresupuesto(data);
        } else {
          setError('Presupuesto no encontrado');
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

  // Formatear fecha
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-VE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Formatear moneda
  const formatUSD = (amount: number) => `$${Number(amount).toFixed(2)}`;
  const formatBs = (amount: number) => `Bs. ${Number(amount).toFixed(2)}`;

  // Generar mensaje de WhatsApp
  const generateWhatsAppMessage = () => {
    if (!presupuesto) return '';

    let message = `¡Hola! Quiero confirmar el presupuesto *${presupuesto.id}*\n\n`;

    presupuesto.items.forEach((item) => {
      message += `• ${item.nombre}: ${item.cantidad} ${item.unidad} (${formatUSD(item.subtotalUSD)})\n`;
    });

    message += `\n─────────────────\n`;
    message += `*TOTAL: ${formatUSD(presupuesto.totalUSD)}*\n`;
    message += `(${formatBs(presupuesto.totalBs)})\n\n`;
    message += `¿Está disponible? Gracias.`;

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
    <div className="min-h-screen bg-ocean-50 py-8 px-4">
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

        {/* Contenido del presupuesto */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Header */}
          <div className="bg-ocean-800 text-white p-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-ocean-700 rounded-full flex items-center justify-center">
                <span className="text-3xl">🦐</span>
              </div>
              <div>
                <h1 className="text-xl font-bold">RPYM</h1>
                <p className="text-ocean-300 text-sm">El Rey de los Pescados y Mariscos</p>
              </div>
            </div>
          </div>

          {/* Info del presupuesto */}
          <div className="border-b border-ocean-100 p-4 bg-ocean-50">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-ocean-600">Presupuesto Nº</p>
                <p className="font-mono font-bold text-ocean-900">{presupuesto.id}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-ocean-600">Fecha</p>
                <p className="text-sm text-ocean-900">{formatDate(presupuesto.fecha)}</p>
              </div>
            </div>
          </div>

          {/* Datos del cliente */}
          {(presupuesto.customerName || presupuesto.customerAddress) && (
            <div className="border-b border-ocean-100 p-4">
              <p className="text-xs text-ocean-600 mb-1">Cliente</p>
              {presupuesto.customerName && (
                <p className="font-medium text-ocean-900">{presupuesto.customerName}</p>
              )}
              {presupuesto.customerAddress && (
                <p className="text-sm text-ocean-700">{presupuesto.customerAddress}</p>
              )}
            </div>
          )}

          {/* Productos */}
          <div className="p-4">
            <p className="text-xs text-ocean-600 mb-3 font-medium">DETALLE DEL PEDIDO</p>
            <div className="space-y-3">
              {presupuesto.items.map((item, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center py-3 border-b border-ocean-100 last:border-0"
                >
                  <div className="flex-1">
                    <p className="font-medium text-ocean-900">{item.nombre}</p>
                    <p className="text-sm text-ocean-600">
                      {item.cantidad} {item.unidad} × {formatUSD(item.precioUSD)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-coral-600">{formatUSD(item.subtotalUSD)}</p>
                    <p className="text-xs text-ocean-500">{formatBs(item.subtotalBs)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Totales */}
          <div className="bg-coral-50 p-4 border-t border-coral-100">
            <div className="flex justify-between items-center mb-2">
              <span className="text-ocean-700 font-medium">Total USD:</span>
              <span className="text-2xl font-bold text-coral-600">{formatUSD(presupuesto.totalUSD)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-ocean-700">Total Bolívares:</span>
              <span className="text-lg font-semibold text-ocean-900">{formatBs(presupuesto.totalBs)}</span>
            </div>
          </div>

          {/* Aviso no fiscal */}
          <div className="mx-4 mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <p className="text-xs text-amber-700 text-center font-medium">
              📋 Este documento no tiene validez fiscal - Solo para referencia
            </p>
          </div>

          {/* Acciones */}
          <div className="p-4 pt-0">
            <a
              href="/presupuesto"
              className="w-full py-3 border border-ocean-200 text-ocean-700 font-medium
                rounded-xl transition-colors flex items-center justify-center gap-2 hover:bg-ocean-50"
            >
              Crear nuevo presupuesto
            </a>
          </div>

          {/* Footer */}
          <div className="bg-ocean-50 p-4 text-center border-t border-ocean-100">
            <p className="text-xs text-ocean-500">
              Muelle Pesquero "El Mosquero" • Puesto 3 y 4, Maiquetía
            </p>
            <p className="text-xs text-ocean-500 mt-1">
              www.rpym.net • WhatsApp: +58 414-214-5202
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
