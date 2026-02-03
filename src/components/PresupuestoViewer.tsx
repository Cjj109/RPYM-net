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
              </tbody>
            </table>
          </div>

          {/* Totales */}
          <div className="mx-4 mt-4 bg-orange-50 rounded-lg p-4">
            <div className="flex justify-between items-center mb-1">
              <span className="text-ocean-600">Total USD:</span>
              <span className="text-xl font-bold text-coral-600">{formatUSD(presupuesto.totalUSD)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-ocean-600 text-sm">Total Bolívares:</span>
              <span className="text-sm font-semibold text-ocean-900">{formatBs(presupuesto.totalBs)}</span>
            </div>
          </div>

          {/* Aviso no fiscal */}
          <div className="mx-4 mt-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-[10px] text-amber-700 text-center font-medium">
              ESTE DOCUMENTO NO TIENE VALIDEZ FISCAL - Solo para referencia
            </p>
          </div>

          {/* Acciones */}
          <div className="p-4 flex gap-3">
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
              Confirmar por WhatsApp
            </a>
            <a
              href="/presupuesto"
              className="flex-1 py-3 border border-ocean-200 text-ocean-700 font-medium
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
