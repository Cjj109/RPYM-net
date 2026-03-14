/**
 * RPYM - Admin Cost Management Module
 * Reemplaza el Excel "Precios RPYM.xlsx" con gestión de costos en la web
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { formatUSD, formatBs, formatDateWithTime } from '../lib/format';

// ── Types ──────────────────────────────────────────────

interface CostSettings {
  id: number;
  bcvRate: number;
  parallelRate: number;
  ivaRate: number;
  debitCommission: number;
  creditCommission: number;
  createdAt: string;
}

interface CalculatedValues {
  precioDivisa: number;
  precioBcv: number;
  realCostUsd: number;
  saleBsPm: number;
  saleBsPunto: number;
  costBsPm: number;
  costBsDebit: number;
  costBsCredit: number;
  marginUsd: number;
  marginBsPm: number;
  marginBsIva: number;
  profitRealPm: number;
  profitRealIva: number;
}

interface ProductWithCost {
  id: number;
  nombre: string;
  categoria: string;
  precio_usd: number;
  precio_usd_divisa: number | null;
  unidad: string;
  disponible: number;
  cost_usd: number | null;
  purchase_rate_type: string | null;
  supplier: string | null;
  cost_notes: string | null;
  cost_updated_at: string | null;
  calculated: CalculatedValues | null;
}

interface BagPrice {
  id: number;
  bag_type: string;
  price_per_thousand_usd: number;
  price_per_unit_usd: number;
}

interface PriceHistoryEntry {
  id: number;
  product_id: number;
  product_name: string;
  old_cost_usd: number | null;
  new_cost_usd: number;
  old_rate_type: string | null;
  new_rate_type: string;
  bcv_rate_at_change: number;
  parallel_rate_at_change: number;
  old_real_usd: number | null;
  new_real_usd: number;
  variation_nominal: number | null;
  variation_real: number | null;
  notes: string | null;
  created_at: string;
}

type SubView = 'dashboard' | 'settings' | 'history' | 'simulator' | 'bags';

// ── Helpers ────────────────────────────────────────────

function marginColor(margin: number): string {
  if (margin >= 0.20) return 'text-green-700 bg-green-50';
  if (margin >= 0.10) return 'text-yellow-700 bg-yellow-50';
  return 'text-red-700 bg-red-50';
}

function marginBgClass(margin: number): string {
  if (margin >= 0.20) return 'bg-green-500';
  if (margin >= 0.10) return 'bg-yellow-500';
  return 'bg-red-500';
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ── Main Component ─────────────────────────────────────

export default function AdminCosts() {
  const [subView, setSubView] = useState<SubView>('dashboard');
  const [settings, setSettings] = useState<CostSettings | null>(null);
  const [products, setProducts] = useState<ProductWithCost[]>([]);
  const [bags, setBags] = useState<BagPrice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dashboard filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMargin, setFilterMargin] = useState<'all' | 'low' | 'medium' | 'high'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'marginUsd' | 'marginBs' | 'costUsd'>('name');

  // Cost edit modal
  const [editingProduct, setEditingProduct] = useState<ProductWithCost | null>(null);
  const [costForm, setCostForm] = useState({ costUsd: '', rateType: 'PARALELO', notes: '' });
  const [isSaving, setIsSaving] = useState(false);

  // Settings form
  const [settingsForm, setSettingsForm] = useState({
    bcvRate: '', parallelRate: '', ivaRate: '', debitCommission: '', creditCommission: ''
  });

  // History
  const [history, setHistory] = useState<PriceHistoryEntry[]>([]);
  const [historyProductFilter, setHistoryProductFilter] = useState<string>('');

  // Simulator
  const [simBcv, setSimBcv] = useState('');
  const [simParallel, setSimParallel] = useState('');

  // ── Load data ──────────────────────────────────────

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/costs', { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
        setProducts(data.products);
        setBags(data.bags);
        if (data.settings) {
          setSettingsForm({
            bcvRate: String(data.settings.bcvRate),
            parallelRate: String(data.settings.parallelRate),
            ivaRate: String(data.settings.ivaRate * 100),
            debitCommission: String(data.settings.debitCommission * 100),
            creditCommission: String(data.settings.creditCommission * 100),
          });
          setSimBcv(String(data.settings.bcvRate));
          setSimParallel(String(data.settings.parallelRate));
        }
      } else {
        setError(data.error);
      }
    } catch {
      setError('Error de conexión');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Filtered & sorted products ─────────────────────

  const filteredProducts = useMemo(() => {
    let list = products.filter(p => {
      if (searchTerm && !p.nombre.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (filterMargin !== 'all' && p.calculated) {
        const m = p.calculated.marginUsd;
        if (filterMargin === 'low' && m >= 0.10) return false;
        if (filterMargin === 'medium' && (m < 0.10 || m >= 0.20)) return false;
        if (filterMargin === 'high' && m < 0.20) return false;
      }
      if (filterMargin !== 'all' && !p.calculated) return false;
      return true;
    });

    list.sort((a, b) => {
      if (sortBy === 'name') return a.nombre.localeCompare(b.nombre);
      if (!a.calculated && !b.calculated) return 0;
      if (!a.calculated) return 1;
      if (!b.calculated) return -1;
      if (sortBy === 'marginUsd') return a.calculated.marginUsd - b.calculated.marginUsd;
      if (sortBy === 'marginBs') return a.calculated.marginBsPm - b.calculated.marginBsPm;
      if (sortBy === 'costUsd') return (a.cost_usd || 0) - (b.cost_usd || 0);
      return 0;
    });

    return list;
  }, [products, searchTerm, filterMargin, sortBy]);

  // Products with low margins
  const lowMarginProducts = useMemo(() =>
    products.filter(p => p.calculated && p.calculated.marginUsd < 0.10),
    [products]
  );

  // ── Simulator calculations ─────────────────────────

  const simulatedProducts = useMemo(() => {
    if (!settings) return [];
    const bcv = parseFloat(simBcv) || settings.bcvRate;
    const parallel = parseFloat(simParallel) || settings.parallelRate;
    const iva = settings.ivaRate;
    const debitComm = settings.debitCommission;

    return products.filter(p => p.cost_usd != null).map(p => {
      const precioDivisa = p.precio_usd_divisa ?? p.precio_usd;
      const costUsd = p.cost_usd!;
      const rateType = p.purchase_rate_type!;

      const realCostUsd = rateType === 'BCV' ? costUsd * (bcv / parallel) : costUsd;
      const saleBsPm = precioDivisa * parallel;
      const saleBsPunto = precioDivisa * parallel * (1 + iva);
      const costBsPm = rateType === 'BCV' ? costUsd * bcv : costUsd * parallel;
      const costBsDebit = costBsPm * (1 + iva + debitComm);

      const marginUsd = realCostUsd > 0 ? (precioDivisa - realCostUsd) / realCostUsd : 0;
      const marginBsPm = costBsPm > 0 ? (saleBsPm - costBsPm) / costBsPm : 0;
      const marginBsIva = costBsDebit > 0 ? (saleBsPunto - costBsDebit) / costBsDebit : 0;

      return { ...p, simulated: { realCostUsd, marginUsd, marginBsPm, marginBsIva } };
    });
  }, [products, settings, simBcv, simParallel]);

  // ── Handlers ───────────────────────────────────────

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          bcvRate: parseFloat(settingsForm.bcvRate),
          parallelRate: parseFloat(settingsForm.parallelRate),
          ivaRate: parseFloat(settingsForm.ivaRate) / 100,
          debitCommission: parseFloat(settingsForm.debitCommission) / 100,
          creditCommission: parseFloat(settingsForm.creditCommission) / 100,
        })
      });
      const data = await res.json();
      if (data.success) {
        loadData();
        alert('Tasas actualizadas');
      } else {
        alert(data.error);
      }
    } catch {
      alert('Error de conexión');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveCost = async () => {
    if (!editingProduct) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/costs/product', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          productId: editingProduct.id,
          costUsd: parseFloat(costForm.costUsd),
          purchaseRateType: costForm.rateType,
          notes: costForm.notes || null
        })
      });
      const data = await res.json();
      if (data.success) {
        setEditingProduct(null);
        loadData();
      } else {
        alert(data.error);
      }
    } catch {
      alert('Error de conexión');
    } finally {
      setIsSaving(false);
    }
  };

  const loadHistory = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (historyProductFilter) params.set('product_id', historyProductFilter);
      const res = await fetch(`/api/costs/history?${params}`, { credentials: 'include' });
      const data = await res.json();
      if (data.success) setHistory(data.history);
    } catch { /* ignore */ }
  }, [historyProductFilter]);

  useEffect(() => {
    if (subView === 'history') loadHistory();
  }, [subView, loadHistory]);

  const openEditCost = (product: ProductWithCost) => {
    setEditingProduct(product);
    setCostForm({
      costUsd: product.cost_usd != null ? String(product.cost_usd) : '',
      rateType: product.purchase_rate_type || 'PARALELO',
      notes: ''
    });
  };

  // ── Render ─────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin h-8 w-8 border-4 border-ocean-500 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-ocean-600">Cargando costos...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-600">
        <p>{error}</p>
        <button onClick={loadData} className="mt-2 text-ocean-600 underline">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-navigation */}
      <div className="bg-white rounded-xl shadow-sm border border-ocean-100 p-2">
        <div className="flex gap-1 overflow-x-auto">
          {([
            ['dashboard', 'Dashboard'],
            ['settings', 'Tasas'],
            ['history', 'Historial'],
            ['simulator', 'Simulador'],
            ['bags', 'Bolsas'],
          ] as [SubView, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSubView(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                subView === key
                  ? 'bg-ocean-600 text-white'
                  : 'text-ocean-600 hover:bg-ocean-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── DASHBOARD ─────────────────────────────── */}
      {subView === 'dashboard' && (
        <>
          {/* Summary cards */}
          {settings && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl p-4 shadow-sm border border-ocean-100">
                <p className="text-xs text-ocean-500">BCV</p>
                <p className="text-lg font-bold text-ocean-900">Bs. {settings.bcvRate.toFixed(2)}</p>
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm border border-ocean-100">
                <p className="text-xs text-ocean-500">Paralela</p>
                <p className="text-lg font-bold text-ocean-900">Bs. {settings.parallelRate.toFixed(2)}</p>
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm border border-ocean-100">
                <p className="text-xs text-ocean-500">Diferencia</p>
                <p className="text-lg font-bold text-ocean-900">
                  {pct((settings.parallelRate - settings.bcvRate) / settings.bcvRate)}
                </p>
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm border border-ocean-100">
                <p className="text-xs text-ocean-500">IVA</p>
                <p className="text-lg font-bold text-ocean-900">{(settings.ivaRate * 100).toFixed(0)}%</p>
              </div>
            </div>
          )}

          {/* Low margin alert */}
          {lowMarginProducts.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <h3 className="text-sm font-bold text-red-800 mb-2">
                Alerta: {lowMarginProducts.length} producto{lowMarginProducts.length > 1 ? 's' : ''} con margen bajo (&lt;10%)
              </h3>
              <div className="flex flex-wrap gap-2">
                {lowMarginProducts.map(p => (
                  <span key={p.id} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">
                    {p.nombre} ({pct(p.calculated!.marginUsd)})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="bg-white rounded-xl p-3 shadow-sm border border-ocean-100">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs text-ocean-600 mb-1">Buscar</label>
                <input
                  type="text"
                  placeholder="Producto..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-ocean-600 mb-1">Margen</label>
                <select
                  value={filterMargin}
                  onChange={e => setFilterMargin(e.target.value as any)}
                  className="px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
                >
                  <option value="all">Todos</option>
                  <option value="low">Bajo (&lt;10%)</option>
                  <option value="medium">Medio (10-20%)</option>
                  <option value="high">Alto (&gt;20%)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-ocean-600 mb-1">Ordenar</label>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as any)}
                  className="px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
                >
                  <option value="name">Nombre</option>
                  <option value="marginUsd">Margen $</option>
                  <option value="marginBs">Margen Bs</option>
                  <option value="costUsd">Costo $</option>
                </select>
              </div>
            </div>
          </div>

          {/* Product table */}
          <div className="bg-white rounded-xl shadow-sm border border-ocean-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-ocean-50 border-b border-ocean-100">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-ocean-700">Producto</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">Venta $</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">Venta BCV</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">Costo $</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-ocean-700">Tasa</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">$ Real</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-ocean-700">% Gan $</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-ocean-700">% Gan Bs</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-ocean-700">% Gan IVA</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">$ Real PM</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">$ Real IVA</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-ocean-700"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ocean-50">
                  {filteredProducts.map(p => (
                    <tr key={p.id} className="hover:bg-ocean-50/30">
                      <td className="px-3 py-2 font-medium text-ocean-900 whitespace-nowrap">
                        {p.nombre}
                        <span className="text-ocean-400 text-xs ml-1">/{p.unidad}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-green-700">
                        {formatUSD(p.precio_usd_divisa ?? p.precio_usd)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-blue-700">
                        {formatUSD(p.precio_usd)}
                      </td>
                      {p.calculated ? (
                        <>
                          <td className="px-3 py-2 text-right text-red-700 font-medium">
                            {formatUSD(p.cost_usd!)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              p.purchase_rate_type === 'BCV' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                            }`}>
                              {p.purchase_rate_type}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-ocean-800">
                            {formatUSD(p.calculated.realCostUsd)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${marginColor(p.calculated.marginUsd)}`}>
                              {pct(p.calculated.marginUsd)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${marginColor(p.calculated.marginBsPm)}`}>
                              {pct(p.calculated.marginBsPm)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${marginColor(p.calculated.marginBsIva)}`}>
                              {pct(p.calculated.marginBsIva)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-green-700 font-medium">
                            {formatUSD(p.calculated.profitRealPm)}
                          </td>
                          <td className="px-3 py-2 text-right text-green-700 font-medium">
                            {formatUSD(p.calculated.profitRealIva)}
                          </td>
                        </>
                      ) : (
                        <td colSpan={9} className="px-3 py-2 text-center text-ocean-400 italic">
                          Sin costo asignado
                        </td>
                      )}
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => openEditCost(p)}
                          className="p-1.5 text-ocean-600 hover:bg-ocean-50 rounded-lg transition-colors"
                          title="Editar costo"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── SETTINGS (Tasas) ──────────────────────── */}
      {subView === 'settings' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-ocean-100">
            <h2 className="text-lg font-bold text-ocean-900 mb-4">Tasas de Divisas y Comisiones</h2>

            {settings && (
              <div className="text-xs text-ocean-500 mb-4">
                Ultima actualización: {formatDateWithTime(settings.createdAt)}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Tasa BCV (Bs/$)</label>
                <input
                  type="number" step="0.01"
                  value={settingsForm.bcvRate}
                  onChange={e => setSettingsForm(f => ({ ...f, bcvRate: e.target.value }))}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Tasa Paralela (Bs/$)</label>
                <input
                  type="number" step="0.01"
                  value={settingsForm.parallelRate}
                  onChange={e => setSettingsForm(f => ({ ...f, parallelRate: e.target.value }))}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">IVA (%)</label>
                <input
                  type="number" step="0.1"
                  value={settingsForm.ivaRate}
                  onChange={e => setSettingsForm(f => ({ ...f, ivaRate: e.target.value }))}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Comisión Débito (%)</label>
                <input
                  type="number" step="0.1"
                  value={settingsForm.debitCommission}
                  onChange={e => setSettingsForm(f => ({ ...f, debitCommission: e.target.value }))}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Comisión Crédito (%)</label>
                <input
                  type="number" step="0.1"
                  value={settingsForm.creditCommission}
                  onChange={e => setSettingsForm(f => ({ ...f, creditCommission: e.target.value }))}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
                />
              </div>
            </div>

            {/* Derived values display */}
            {settingsForm.bcvRate && settingsForm.parallelRate && (
              <div className="mt-4 p-3 bg-ocean-50 rounded-lg text-sm text-ocean-700">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div>Diferencia: <strong>{pct((parseFloat(settingsForm.parallelRate) - parseFloat(settingsForm.bcvRate)) / parseFloat(settingsForm.bcvRate))}</strong></div>
                  <div>Promedio: <strong>Bs. {((parseFloat(settingsForm.bcvRate) + parseFloat(settingsForm.parallelRate)) / 2).toFixed(2)}</strong></div>
                  <div>Dif. Promedio: <strong>{pct(((parseFloat(settingsForm.parallelRate) - parseFloat(settingsForm.bcvRate)) / 2) / parseFloat(settingsForm.bcvRate))}</strong></div>
                </div>
              </div>
            )}

            <button
              onClick={handleSaveSettings}
              disabled={isSaving}
              className="mt-4 px-6 py-2.5 bg-ocean-600 hover:bg-ocean-500 disabled:bg-ocean-300 text-white rounded-lg font-medium transition-colors"
            >
              {isSaving ? 'Guardando...' : 'Guardar Tasas'}
            </button>
          </div>

          {/* Settings history */}
          <SettingsHistory />
        </div>
      )}

      {/* ── HISTORY ───────────────────────────────── */}
      {subView === 'history' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-ocean-100">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-ocean-600 mb-1">Filtrar por producto</label>
                <select
                  value={historyProductFilter}
                  onChange={e => setHistoryProductFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
                >
                  <option value="">Todos los productos</option>
                  {products.filter(p => p.cost_usd != null).map(p => (
                    <option key={p.id} value={String(p.id)}>{p.nombre}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={loadHistory}
                className="px-4 py-2 bg-ocean-100 text-ocean-700 rounded-lg text-sm hover:bg-ocean-200 transition-colors"
              >
                Actualizar
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-ocean-100 overflow-hidden">
            {history.length === 0 ? (
              <div className="p-8 text-center text-ocean-500">No hay historial de cambios de precio</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-ocean-50 border-b border-ocean-100">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-ocean-700">Fecha</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-ocean-700">Producto</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">Anterior</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">Nuevo</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-ocean-700">Tasa</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">$ Real Ant.</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">$ Real Nuevo</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-ocean-700">Var. Nom.</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-ocean-700">Var. Real</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-ocean-700">BCV / Par.</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-ocean-700">Nota</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ocean-50">
                    {history.map(h => (
                      <tr key={h.id} className="hover:bg-ocean-50/30">
                        <td className="px-3 py-2 text-xs text-ocean-600 whitespace-nowrap">
                          {formatDateWithTime(h.created_at)}
                        </td>
                        <td className="px-3 py-2 font-medium text-ocean-900 whitespace-nowrap">{h.product_name}</td>
                        <td className="px-3 py-2 text-right text-ocean-600">
                          {h.old_cost_usd != null ? formatUSD(h.old_cost_usd) : '-'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-ocean-900">{formatUSD(h.new_cost_usd)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            h.new_rate_type === 'BCV' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                          }`}>
                            {h.new_rate_type}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-ocean-600">
                          {h.old_real_usd != null ? formatUSD(h.old_real_usd) : '-'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{formatUSD(h.new_real_usd)}</td>
                        <td className="px-3 py-2 text-center">
                          {h.variation_nominal != null ? (
                            <span className={h.variation_nominal > 0 ? 'text-red-600' : 'text-green-600'}>
                              {h.variation_nominal > 0 ? '+' : ''}{pct(h.variation_nominal)}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {h.variation_real != null ? (
                            <span className={h.variation_real > 0 ? 'text-red-600' : 'text-green-600'}>
                              {h.variation_real > 0 ? '+' : ''}{pct(h.variation_real)}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-3 py-2 text-xs text-ocean-500 whitespace-nowrap">
                          {h.bcv_rate_at_change.toFixed(2)} / {h.parallel_rate_at_change.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-xs text-ocean-600 max-w-[150px] truncate">
                          {h.notes || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SIMULATOR ─────────────────────────────── */}
      {subView === 'simulator' && settings && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-ocean-100">
            <h2 className="text-lg font-bold text-ocean-900 mb-4">Simulador de Tasas</h2>
            <p className="text-sm text-ocean-600 mb-4">
              Cambia las tasas para ver cómo afectarían los márgenes de todos los productos.
            </p>
            <div className="grid grid-cols-2 gap-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">
                  BCV simulada (actual: {settings.bcvRate.toFixed(2)})
                </label>
                <input
                  type="number" step="0.01"
                  value={simBcv}
                  onChange={e => setSimBcv(e.target.value)}
                  className="w-full px-3 py-2 border border-amber-300 bg-amber-50 rounded-lg text-sm focus:ring-1 focus:ring-amber-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">
                  Paralela simulada (actual: {settings.parallelRate.toFixed(2)})
                </label>
                <input
                  type="number" step="0.01"
                  value={simParallel}
                  onChange={e => setSimParallel(e.target.value)}
                  className="w-full px-3 py-2 border border-amber-300 bg-amber-50 rounded-lg text-sm focus:ring-1 focus:ring-amber-500 outline-none"
                />
              </div>
            </div>
            <button
              onClick={() => { setSimBcv(String(settings.bcvRate)); setSimParallel(String(settings.parallelRate)); }}
              className="mt-3 text-sm text-ocean-600 hover:underline"
            >
              Resetear a tasas actuales
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-ocean-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-amber-50 border-b border-amber-200">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-amber-800">Producto</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-amber-800">Venta $</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-amber-800">Costo $</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-amber-800">$ Real Sim.</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-amber-800">% Gan $ Sim.</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-amber-800">% Gan Bs Sim.</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-amber-800">% Gan IVA Sim.</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-amber-800">vs Actual</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ocean-50">
                  {simulatedProducts.map(p => {
                    const currentMargin = p.calculated?.marginUsd ?? 0;
                    const simMargin = p.simulated.marginUsd;
                    const diff = simMargin - currentMargin;
                    return (
                      <tr key={p.id} className="hover:bg-ocean-50/30">
                        <td className="px-3 py-2 font-medium text-ocean-900 whitespace-nowrap">{p.nombre}</td>
                        <td className="px-3 py-2 text-right">{formatUSD(p.precio_usd)}</td>
                        <td className="px-3 py-2 text-right text-red-700">{formatUSD(p.cost_usd!)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatUSD(p.simulated.realCostUsd)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${marginColor(p.simulated.marginUsd)}`}>
                            {pct(p.simulated.marginUsd)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${marginColor(p.simulated.marginBsPm)}`}>
                            {pct(p.simulated.marginBsPm)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${marginColor(p.simulated.marginBsIva)}`}>
                            {pct(p.simulated.marginBsIva)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center text-xs">
                          <span className={diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-ocean-500'}>
                            {diff > 0 ? '+' : ''}{pct(diff)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── BAGS ──────────────────────────────────── */}
      {subView === 'bags' && <BagsManager bags={bags} onRefresh={loadData} />}

      {/* ── EDIT COST MODAL ───────────────────────── */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl">
            <div className="p-4 border-b border-ocean-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-ocean-900">Editar Costo</h3>
                <p className="text-sm text-ocean-600">{editingProduct.nombre}</p>
              </div>
              <button onClick={() => setEditingProduct(null)} className="p-2 text-ocean-600 hover:bg-ocean-50 rounded-lg">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="bg-ocean-50 rounded-lg p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-ocean-600">Venta $ (divisa):</span>
                  <span className="font-bold text-green-700">{formatUSD(editingProduct.precio_usd_divisa ?? editingProduct.precio_usd)}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-ocean-600">Venta $ (BCV):</span>
                  <span className="font-bold text-blue-700">{formatUSD(editingProduct.precio_usd)}</span>
                </div>
                {editingProduct.cost_usd != null && (
                  <div className="flex justify-between mt-1">
                    <span className="text-ocean-600">Costo actual:</span>
                    <span className="font-bold text-red-700">{formatUSD(editingProduct.cost_usd)} ({editingProduct.purchase_rate_type})</span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Costo de compra ($)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={costForm.costUsd}
                  onChange={e => setCostForm(f => ({ ...f, costUsd: e.target.value }))}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 outline-none"
                  placeholder="0.00"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Tasa de compra</label>
                <div className="flex gap-2">
                  {['PARALELO', 'BCV'].map(rt => (
                    <button
                      key={rt}
                      onClick={() => setCostForm(f => ({ ...f, rateType: rt }))}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        costForm.rateType === rt
                          ? rt === 'BCV' ? 'bg-blue-600 text-white' : 'bg-purple-600 text-white'
                          : 'bg-ocean-100 text-ocean-700 hover:bg-ocean-200'
                      }`}
                    >
                      {rt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview margin */}
              {costForm.costUsd && settings && (
                <div className="bg-green-50 rounded-lg p-3 text-sm">
                  {(() => {
                    const cost = parseFloat(costForm.costUsd);
                    const precioDivisa = editingProduct.precio_usd_divisa ?? editingProduct.precio_usd;
                    const realCost = costForm.rateType === 'BCV'
                      ? cost * (settings.bcvRate / settings.parallelRate)
                      : cost;
                    const margin = realCost > 0 ? (precioDivisa - realCost) / realCost : 0;
                    return (
                      <>
                        <div className="flex justify-between">
                          <span className="text-green-700">$ Real:</span>
                          <span className="font-bold">{formatUSD(realCost)}</span>
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="text-green-700">Margen $ (divisa):</span>
                          <span className={`font-bold ${marginColor(margin).split(' ')[0]}`}>{pct(margin)}</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Nota (opcional)</label>
                <input
                  type="text"
                  value={costForm.notes}
                  onChange={e => setCostForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
                  placeholder="Ej: Cambió proveedor, subió flete..."
                />
              </div>
            </div>
            <div className="p-4 border-t border-ocean-100 flex justify-end gap-2">
              <button
                onClick={() => setEditingProduct(null)}
                className="px-4 py-2 text-ocean-700 hover:bg-ocean-50 rounded-lg text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveCost}
                disabled={isSaving || !costForm.costUsd}
                className="px-4 py-2 bg-ocean-600 hover:bg-ocean-500 disabled:bg-ocean-300 text-white rounded-lg text-sm font-medium"
              >
                {isSaving ? 'Guardando...' : 'Guardar Costo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────

function SettingsHistory() {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/costs/settings-history', { credentials: 'include' });
        const data = await res.json();
        if (data.success) setHistory(data.history);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="text-center text-ocean-500 py-4">Cargando historial...</div>;
  if (history.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-ocean-100 overflow-hidden">
      <div className="p-4 border-b border-ocean-100">
        <h3 className="font-bold text-ocean-900">Historial de Tasas</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ocean-50 border-b border-ocean-100">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-ocean-700">Fecha</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">BCV</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">Paralela</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">IVA</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">Débito</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">Crédito</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-ocean-700">Nota</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ocean-50">
            {history.map((h: any) => (
              <tr key={h.id} className="hover:bg-ocean-50/30">
                <td className="px-3 py-2 text-xs text-ocean-600 whitespace-nowrap">{formatDateWithTime(h.created_at)}</td>
                <td className="px-3 py-2 text-right">Bs. {h.bcv_rate.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">Bs. {h.parallel_rate.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{(h.iva_rate * 100).toFixed(1)}%</td>
                <td className="px-3 py-2 text-right">{(h.debit_commission * 100).toFixed(1)}%</td>
                <td className="px-3 py-2 text-right">{(h.credit_commission * 100).toFixed(1)}%</td>
                <td className="px-3 py-2 text-xs text-ocean-600">{h.notes || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BagsManager({ bags, onRefresh }: { bags: BagPrice[]; onRefresh: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [editingBag, setEditingBag] = useState<BagPrice | null>(null);
  const [bagType, setBagType] = useState('');
  const [pricePerThousand, setPricePerThousand] = useState('');
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    setEditingBag(null);
    setBagType('');
    setPricePerThousand('');
    setShowForm(true);
  };

  const openEdit = (bag: BagPrice) => {
    setEditingBag(bag);
    setBagType(bag.bag_type);
    setPricePerThousand(String(bag.price_per_thousand_usd));
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!bagType || !pricePerThousand) return;
    setSaving(true);
    try {
      await fetch('/api/costs/bags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: editingBag?.id,
          bagType,
          pricePerThousand: parseFloat(pricePerThousand)
        })
      });
      setShowForm(false);
      onRefresh();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar esta bolsa?')) return;
    await fetch('/api/costs/bags', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id })
    });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl p-4 shadow-sm border border-ocean-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-ocean-900">Precios de Bolsas</h2>
          <button
            onClick={openNew}
            className="px-4 py-2 bg-ocean-600 hover:bg-ocean-500 text-white rounded-lg text-sm font-medium"
          >
            + Nueva Bolsa
          </button>
        </div>

        {bags.length === 0 ? (
          <p className="text-center text-ocean-500 py-4">No hay bolsas registradas</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ocean-50 border-b border-ocean-100">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-ocean-700">Tipo</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">$/millar</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">$/unidad</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-ocean-700">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ocean-50">
                {bags.map(bag => (
                  <tr key={bag.id} className="hover:bg-ocean-50/30">
                    <td className="px-3 py-2 font-medium text-ocean-900">{bag.bag_type}</td>
                    <td className="px-3 py-2 text-right">{formatUSD(bag.price_per_thousand_usd)}</td>
                    <td className="px-3 py-2 text-right text-ocean-600">${bag.price_per_unit_usd.toFixed(4)}</td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(bag)} className="p-1.5 text-ocean-600 hover:bg-ocean-50 rounded-lg" title="Editar">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button onClick={() => handleDelete(bag.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="Eliminar">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
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

      {/* Bag form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl">
            <div className="p-4 border-b border-ocean-100">
              <h3 className="font-bold text-ocean-900">{editingBag ? 'Editar' : 'Nueva'} Bolsa</h3>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Tipo</label>
                <input
                  type="text" value={bagType}
                  onChange={e => setBagType(e.target.value)}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
                  placeholder="Ej: Bolsa 2kg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Precio por millar ($)</label>
                <input
                  type="number" step="0.01" min="0" value={pricePerThousand}
                  onChange={e => setPricePerThousand(e.target.value)}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
                  placeholder="7.00"
                />
              </div>
              {pricePerThousand && (
                <p className="text-sm text-ocean-600">
                  = ${(parseFloat(pricePerThousand) / 1000).toFixed(4)} por unidad
                </p>
              )}
            </div>
            <div className="p-4 border-t border-ocean-100 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-ocean-700 hover:bg-ocean-50 rounded-lg text-sm font-medium">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-ocean-600 hover:bg-ocean-500 disabled:bg-ocean-300 text-white rounded-lg text-sm font-medium">
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
