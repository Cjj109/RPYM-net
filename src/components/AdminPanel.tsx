/**
 * RPYM - Panel de Administración de Presupuestos
 */
import { useState, useEffect, useCallback } from 'react';
import {
  listPresupuestos,
  updatePresupuestoStatus,
  deletePresupuesto,
  getPresupuestoStats,
  type Presupuesto,
  type PresupuestoStats
} from '../lib/presupuesto-storage';

// Password de administrador
const ADMIN_PASSWORD = 'rpym2026';

export default function AdminPanel() {
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
              <span className="text-2xl">🦐</span>
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
        </div>
      </header>

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
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
