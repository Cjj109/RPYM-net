/**
 * RPYM - Panel de Administración de Presupuestos
 */
import { useState, useEffect, useCallback, lazy, Suspense } from 'react';

const AdminBudgetBuilder = lazy(() => import('./AdminBudgetBuilder'));

import {
  listPresupuestos,
  updatePresupuestoStatus,
  deletePresupuesto,
  getPresupuestoStats,
  type Presupuesto,
  type PresupuestoStats
} from '../lib/presupuesto-storage';

// Password de administrador (cambiar por una más segura en producción)
const ADMIN_PASSWORD = 'Rpym@Admin2026!';

interface Category {
  name: string;
  products: any[];
}

interface BCVRateData {
  rate: number;
  date: string;
  source: string;
}

interface AdminPanelProps {
  categories?: Category[];
  bcvRate?: BCVRateData;
}

export default function AdminPanel({ categories, bcvRate }: AdminPanelProps = {}) {
  const [activeTab, setActiveTab] = useState<'ver' | 'crear'>('ver');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [stats, setStats] = useState<PresupuestoStats | null>(null);
  const [filter, setFilter] = useState<'all' | 'pendiente' | 'pagado'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPresupuesto, setSelectedPresupuesto] = useState<Presupuesto | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Verificar autenticación al cargar
  useEffect(() => {
    const auth = sessionStorage.getItem('rpym_admin_auth');
    if (auth === 'true') {
      setIsAuthenticated(true);
    } else {
      const password = prompt('Ingresa la contraseña de administrador:');
      if (password === ADMIN_PASSWORD) {
        setIsAuthenticated(true);
        sessionStorage.setItem('rpym_admin_auth', 'true');
      } else {
        alert('Contraseña incorrecta');
        window.location.href = '/';
      }
    }
  }, []);

  // Cargar datos
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [presupuestosData, statsData] = await Promise.all([
        listPresupuestos(filter === 'all' ? undefined : filter),
        getPresupuestoStats()
      ]);
      setPresupuestos(presupuestosData);
      setStats(statsData);
    } catch (error) {
      console.error('Error cargando datos:', error);
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  // Cargar datos iniciales y configurar auto-refresh
  useEffect(() => {
    if (isAuthenticated) {
      loadData();
      const interval = setInterval(loadData, 30000); // Refresh cada 30 segundos
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, loadData]);

  // Marcar como pagado
  const handleMarkPaid = async (id: string) => {
    if (!confirm('¿Marcar este presupuesto como PAGADO?')) return;

    setActionLoading(id);
    const success = await updatePresupuestoStatus(id, 'pagado');
    if (success) {
      loadData();
    } else {
      alert('Error al actualizar el estado');
    }
    setActionLoading(null);
  };

  // Eliminar presupuesto
  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de ELIMINAR este presupuesto? Esta acción no se puede deshacer.')) return;

    setActionLoading(id);
    const success = await deletePresupuesto(id);
    if (success) {
      loadData();
      if (selectedPresupuesto?.id === id) {
        setSelectedPresupuesto(null);
      }
    } else {
      alert('Error al eliminar');
    }
    setActionLoading(null);
  };

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

  // Imprimir nota de entrega pagada
  const printPaidNote = (presupuesto: Presupuesto) => {
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) return;

    const itemsHtml = presupuesto.items.map(item => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e0f2fe;">${item.nombre}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e0f2fe; text-align: center;">${item.cantidad} ${item.unidad}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e0f2fe; text-align: right;">${formatUSD(item.precioUSD)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e0f2fe; text-align: right; font-weight: 600; color: #ea580c;">${formatUSD(item.subtotalUSD)}</td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Nota de Entrega - ${presupuesto.id}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            padding: 1cm;
            background: white;
            color: #0c4a6e;
            font-size: 12px;
            position: relative;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid #075985;
          }
          .logo-section {
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .logo {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            border: 2px solid #7dd3fc;
            overflow: hidden;
            flex-shrink: 0;
            background: white;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .logo img {
            width: 140%;
            height: 140%;
            object-fit: contain;
          }
          .company-name {
            font-size: 24px;
            font-weight: 700;
            color: #0c4a6e;
          }
          .doc-info {
            text-align: right;
          }
          .doc-number {
            font-family: monospace;
            font-size: 14px;
            font-weight: 700;
            color: #0c4a6e;
          }
          .doc-date {
            font-size: 11px;
            color: #0369a1;
          }
          .client-section {
            background: #f0f9ff;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
          }
          .client-label {
            font-size: 10px;
            color: #0369a1;
            margin-bottom: 4px;
          }
          .client-name {
            font-weight: 600;
            color: #0c4a6e;
          }
          .client-address {
            font-size: 11px;
            color: #0369a1;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
          }
          th {
            background: #e0f2fe;
            padding: 10px 8px;
            text-align: left;
            font-size: 11px;
            font-weight: 600;
            color: #0c4a6e;
            border-bottom: 2px solid #075985;
          }
          .totals {
            background: #fff7ed;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
          }
          .total-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
          }
          .total-label {
            color: #0369a1;
          }
          .total-usd {
            font-size: 20px;
            font-weight: 700;
            color: #ea580c;
          }
          .total-bs {
            font-size: 14px;
            font-weight: 600;
            color: #0c4a6e;
          }
          .footer {
            text-align: center;
            padding-top: 15px;
            border-top: 1px solid #e0f2fe;
            font-size: 10px;
            color: #0369a1;
          }
          .paid-stamp {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-15deg);
            border: 6px solid #16a34a;
            border-radius: 12px;
            padding: 15px 40px;
            color: #16a34a;
            font-size: 36px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 3px;
            opacity: 0.35;
            pointer-events: none;
          }
          .paid-date {
            font-size: 12px;
            font-weight: 500;
            letter-spacing: 1px;
          }
          .thank-you {
            background: #dcfce7;
            color: #166534;
            padding: 12px;
            border-radius: 8px;
            text-align: center;
            margin-bottom: 15px;
            font-weight: 600;
          }
          .non-fiscal {
            background: #fef3c7;
            color: #92400e;
            padding: 8px;
            border-radius: 6px;
            text-align: center;
            font-size: 10px;
            font-weight: 500;
            margin-bottom: 15px;
          }
          @media print {
            body { padding: 0.5cm; }
            @page { size: A4; margin: 0.5cm; }
          }
        </style>
      </head>
      <body>
        <!-- Sello de PAGADO -->
        <div class="paid-stamp">
          PAGADO
          <div class="paid-date">${presupuesto.fechaPago ? formatDate(presupuesto.fechaPago) : formatDate(new Date().toISOString())}</div>
        </div>

        <!-- Header -->
        <div class="header">
          <div class="logo-section">
            <div class="logo"><img src="/camaronlogo-sm.webp" alt="RPYM" /></div>
            <div class="company-name">RPYM</div>
          </div>
          <div class="doc-info">
            <div class="doc-number">${presupuesto.id}</div>
            <div class="doc-date">${formatDate(presupuesto.fecha)}</div>
          </div>
        </div>

        <!-- Cliente -->
        ${presupuesto.customerName || presupuesto.customerAddress ? `
          <div class="client-section">
            <div class="client-label">CLIENTE</div>
            ${presupuesto.customerName ? `<div class="client-name">${presupuesto.customerName}</div>` : ''}
            ${presupuesto.customerAddress ? `<div class="client-address">${presupuesto.customerAddress}</div>` : ''}
          </div>
        ` : ''}

        <!-- Productos -->
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th style="text-align: center;">Cantidad</th>
              <th style="text-align: right;">Precio Unit.</th>
              <th style="text-align: right;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <!-- Totales -->
        <div class="totals">
          <div class="total-row">
            <span class="total-label">Total USD:</span>
            <span class="total-usd">${formatUSD(presupuesto.totalUSD)}</span>
          </div>
          <div class="total-row">
            <span class="total-label">Total Bolívares:</span>
            <span class="total-bs">${formatBs(presupuesto.totalBs)}</span>
          </div>
        </div>

        <!-- Mensaje de agradecimiento (solo en nota pagada) -->
        <div class="thank-you">
          ¡Gracias por su compra! 🦐
        </div>

        <!-- Aviso no fiscal -->
        <div class="non-fiscal">
          📋 ESTE DOCUMENTO NO TIENE VALIDEZ FISCAL - Solo para control interno
        </div>

        <!-- Footer -->
        <div class="footer">
          <p><a href="https://www.google.com/maps/search/?api=1&query=Mercado+El+Mosquero%2C+Maiquet%C3%ADa" target="_blank" style="text-decoration:underline">Muelle Pesquero "El Mosquero"</a> • Puesto 3 y 4, Maiquetía</p>
          <p>www.rpym.net • WhatsApp: +58 414-214-5202</p>
        </div>
      </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-ocean-50 flex items-center justify-center">
        <div className="text-ocean-600">Verificando acceso...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ocean-50">
      {/* Header */}
      <header className="bg-ocean-800 text-white py-4 px-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/camaronlogo-sm.webp" alt="RPYM" className="w-8 h-8 object-contain" />
              <div>
                <h1 className="text-lg font-bold">RPYM Admin</h1>
                <p className="text-xs text-ocean-300">Gestión de Presupuestos</p>
              </div>
            </div>
            <button
              onClick={() => {
                sessionStorage.removeItem('rpym_admin_auth');
                window.location.href = '/';
              }}
              className="text-sm text-ocean-300 hover:text-white"
            >
              Cerrar sesión
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-3 bg-ocean-900/50 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('ver')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'ver'
                  ? 'bg-white text-ocean-900'
                  : 'text-ocean-200 hover:text-white'
              }`}
            >
              Ver Presupuestos
            </button>
            <button
              onClick={() => setActiveTab('crear')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'crear'
                  ? 'bg-white text-ocean-900'
                  : 'text-ocean-200 hover:text-white'
              }`}
            >
              Crear Presupuesto
            </button>
          </div>
        </div>
      </header>

      {activeTab === 'crear' && categories && bcvRate ? (
        <main className="max-w-7xl mx-auto p-4">
          <Suspense fallback={<div className="text-center py-12 text-ocean-700">Cargando...</div>}>
            <AdminBudgetBuilder categories={categories} bcvRate={bcvRate} />
          </Suspense>
        </main>
      ) : (

      <main className="max-w-7xl mx-auto p-4">
        {/* Estadísticas */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-ocean-100">
              <p className="text-xs text-ocean-600">Presupuestos Hoy</p>
              <p className="text-2xl font-bold text-ocean-900">{stats.totalHoy}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-ocean-100">
              <p className="text-xs text-ocean-600">Vendido Hoy</p>
              <p className="text-xl font-bold text-green-600">{formatUSD(parseFloat(stats.vendidoHoyUSD))}</p>
              <p className="text-xs text-ocean-500">{formatBs(parseFloat(stats.vendidoHoyBs))}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-ocean-100">
              <p className="text-xs text-ocean-600">Pendientes</p>
              <p className="text-2xl font-bold text-yellow-600">{stats.pendientes}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-ocean-100">
              <p className="text-xs text-ocean-600">Total General</p>
              <p className="text-2xl font-bold text-ocean-900">{stats.totalGeneral}</p>
            </div>
          </div>
        )}

        {/* Filtros */}
        <div className="flex gap-2 mb-4">
          {(['all', 'pendiente', 'pagado'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-ocean-600 text-white'
                  : 'bg-white text-ocean-700 border border-ocean-200 hover:bg-ocean-50'
              }`}
            >
              {f === 'all' ? 'Todos' : f === 'pendiente' ? '⏳ Pendientes' : '✅ Pagados'}
            </button>
          ))}
          <button
            onClick={loadData}
            disabled={isLoading}
            className="ml-auto px-4 py-2 bg-ocean-100 text-ocean-700 rounded-lg text-sm hover:bg-ocean-200 transition-colors"
          >
            {isLoading ? '...' : '🔄 Actualizar'}
          </button>
        </div>

        {/* Lista de presupuestos */}
        <div className="bg-white rounded-xl shadow-sm border border-ocean-100 overflow-hidden">
          {isLoading && presupuestos.length === 0 ? (
            <div className="p-8 text-center text-ocean-600">Cargando...</div>
          ) : presupuestos.length === 0 ? (
            <div className="p-8 text-center text-ocean-600">No hay presupuestos</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-ocean-50 border-b border-ocean-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-ocean-700">ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-ocean-700">Fecha</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-ocean-700 hidden md:table-cell">Cliente</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-ocean-700">Total</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-ocean-700">Estado</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-ocean-700">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ocean-100">
                  {presupuestos.map((p) => (
                    <tr key={p.id} className="hover:bg-ocean-50/50">
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm text-ocean-900">{p.id}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-ocean-700">
                        {formatDate(p.fecha)}
                      </td>
                      <td className="px-4 py-3 text-sm text-ocean-700 hidden md:table-cell">
                        {p.customerName || '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-semibold text-coral-600">{formatUSD(p.totalUSD)}</span>
                        <span className="block text-xs text-ocean-500">{formatBs(p.totalBs)}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                          p.estado === 'pagado'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {p.estado === 'pagado' ? '✅' : '⏳'}
                          {p.estado === 'pagado' ? 'Pagado' : 'Pendiente'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          {p.estado === 'pendiente' && (
                            <button
                              onClick={() => handleMarkPaid(p.id)}
                              disabled={actionLoading === p.id}
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                              title="Marcar como pagado"
                            >
                              {actionLoading === p.id ? '...' : '✅'}
                            </button>
                          )}
                          {p.estado === 'pagado' && (
                            <button
                              onClick={() => printPaidNote(p)}
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                              title="Imprimir nota pagada"
                            >
                              🖨️
                            </button>
                          )}
                          <button
                            onClick={() => setSelectedPresupuesto(p)}
                            className="p-1.5 text-ocean-600 hover:bg-ocean-50 rounded-lg transition-colors"
                            title="Ver detalle"
                          >
                            👁️
                          </button>
                          <a
                            href={`/presupuesto/ver?id=${p.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Abrir vista pública"
                          >
                            🔗
                          </a>
                          <button
                            onClick={() => handleDelete(p.id)}
                            disabled={actionLoading === p.id}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Eliminar"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Auto-refresh indicator */}
        <p className="text-xs text-ocean-500 mt-4 text-center">
          Se actualiza automáticamente cada 30 segundos
        </p>
      </main>
      )}

      {/* Modal de detalle */}
      {selectedPresupuesto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[80vh] overflow-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-ocean-100 p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-ocean-900">Presupuesto {selectedPresupuesto.id}</h3>
                <p className="text-xs text-ocean-600">{formatDate(selectedPresupuesto.fecha)}</p>
              </div>
              <button
                onClick={() => setSelectedPresupuesto(null)}
                className="p-2 text-ocean-600 hover:bg-ocean-50 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Cliente */}
              {(selectedPresupuesto.customerName || selectedPresupuesto.customerAddress) && (
                <div className="bg-ocean-50 rounded-lg p-3">
                  <p className="text-xs text-ocean-600 mb-1">Cliente</p>
                  {selectedPresupuesto.customerName && (
                    <p className="font-medium text-ocean-900">{selectedPresupuesto.customerName}</p>
                  )}
                  {selectedPresupuesto.customerAddress && (
                    <p className="text-sm text-ocean-700">{selectedPresupuesto.customerAddress}</p>
                  )}
                </div>
              )}

              {/* Items */}
              <div>
                <p className="text-xs text-ocean-600 mb-2">Productos</p>
                <div className="space-y-2">
                  {selectedPresupuesto.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center py-2 border-b border-ocean-100">
                      <div>
                        <p className="text-sm font-medium text-ocean-900">{item.nombre}</p>
                        <p className="text-xs text-ocean-600">{item.cantidad} {item.unidad}</p>
                      </div>
                      <p className="font-semibold text-coral-600">{formatUSD(item.subtotalUSD)}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totales */}
              <div className="bg-coral-50 rounded-lg p-3">
                <div className="flex justify-between items-center">
                  <span className="text-ocean-700">Total USD:</span>
                  <span className="text-xl font-bold text-coral-600">{formatUSD(selectedPresupuesto.totalUSD)}</span>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-ocean-700">Total Bs:</span>
                  <span className="font-semibold text-ocean-900">{formatBs(selectedPresupuesto.totalBs)}</span>
                </div>
              </div>

              {/* Estado */}
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium ${
                  selectedPresupuesto.estado === 'pagado'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {selectedPresupuesto.estado === 'pagado' ? '✅ Pagado' : '⏳ Pendiente'}
                </span>

                {selectedPresupuesto.estado === 'pendiente' && (
                  <button
                    onClick={() => {
                      handleMarkPaid(selectedPresupuesto.id);
                      setSelectedPresupuesto(null);
                    }}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-500"
                  >
                    Marcar como Pagado
                  </button>
                )}

                {selectedPresupuesto.estado === 'pagado' && (
                  <button
                    onClick={() => printPaidNote(selectedPresupuesto)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-500 flex items-center gap-2"
                  >
                    🖨️ Imprimir Nota Pagada
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
