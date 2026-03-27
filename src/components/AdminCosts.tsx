/**
 * RPYM - Admin Cost Management Module
 * Reemplaza el Excel "Precios RPYM.xlsx" con gestión de costos en la web
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
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
  costBcvEquiv: number;
  costBcvDebit: number;
  costBcvCredit: number;
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
  solo_costos: number;
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

type SubView = 'dashboard' | 'settings' | 'history' | 'simulator' | 'ganancia' | 'bags';

type PayMethod = 'pm' | 'debito' | 'credito' | 'divisas';

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
  const [liveBcvRate, setLiveBcvRate] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dashboard filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMargin, setFilterMargin] = useState<'all' | 'low' | 'medium' | 'high'>('all');
  const [filterMarginType, setFilterMarginType] = useState<'usd' | 'bsPm' | 'iva'>('usd');
  const [sortBy, setSortBy] = useState<'name' | 'marginUsd' | 'marginBs' | 'costUsd'>('name');

  // Cost edit modal
  const [editingProduct, setEditingProduct] = useState<ProductWithCost | null>(null);
  const [costForm, setCostForm] = useState({ costUsd: '', rateType: 'PARALELO', notes: '', precioUsd: '', precioUsdDivisa: '' });
  const [isSaving, setIsSaving] = useState(false);

  // Settings form
  const [settingsForm, setSettingsForm] = useState({
    bcvRate: '', parallelRate: '', ivaRate: '', debitCommission: '', creditCommission: ''
  });

  // History
  const [history, setHistory] = useState<PriceHistoryEntry[]>([]);
  const [historyProductFilter, setHistoryProductFilter] = useState<string>('');

  // Cost-only product creation
  const [showCostOnlyForm, setShowCostOnlyForm] = useState(false);
  const [costOnlyForm, setCostOnlyForm] = useState({ nombre: '', categoria: '', unidad: 'kg', costUsd: '', rateType: 'PARALELO', precioUsd: '', precioUsdDivisa: '' });

  // Simulator de tasas
  const [simBcv, setSimBcv] = useState('');
  const [simParallel, setSimParallel] = useState('');

  // Simulador de ganancia por producto
  const [simGanProductId, setSimGanProductId] = useState<string>('');
  const [simGanSalePrice, setSimGanSalePrice] = useState<string>('');
  const [simGanPayMethod, setSimGanPayMethod] = useState<PayMethod>('pm');

  // Share price list
  const shareCaptureRef = useRef<HTMLDivElement>(null);
  const [isSharing, setIsSharing] = useState(false);

  // ── Load data ──────────────────────────────────────

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [res, bcvRes] = await Promise.all([
        fetch('/api/costs', { credentials: 'include' }),
        fetch('/api/config/bcv-rate').then(r => r.json()).catch(() => null),
      ]);
      const data = await res.json();
      if (bcvRes?.rate) setLiveBcvRate(bcvRes.rate);
      if (data.success) {
        setSettings(data.settings);
        setProducts(data.products);
        setBags(data.bags);
        if (data.settings) {
          // Auto-actualizar tasa BCV si hay diferencia
          const currentBcv = data.settings.bcvRate;
          const liveBcv = bcvRes?.rate;
          if (liveBcv && Math.abs(liveBcv - currentBcv) >= 0.01) {
            fetch('/api/costs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                bcvRate: liveBcv,
                parallelRate: data.settings.parallelRate,
                ivaRate: data.settings.ivaRate,
                debitCommission: data.settings.debitCommission,
                creditCommission: data.settings.creditCommission,
              }),
            }).then(r => r.json()).then(d => {
              if (d.success) loadData();
            }).catch(() => {});
            return; // loadData se re-invocará con la tasa actualizada
          }
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
        const m = filterMarginType === 'iva' ? p.calculated.marginBsIva
          : filterMarginType === 'bsPm' ? p.calculated.marginBsPm
          : p.calculated.marginUsd;
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
    products.filter(p => p.calculated && p.calculated.marginUsd < 0.10 && !p.solo_costos),
    [products]
  );

  // Unique categories for cost-only product form
  const categories = useMemo(() =>
    [...new Set(products.map(p => p.categoria))].sort(),
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
      const precioBcv = p.precio_usd;
      const precioDivisa = p.precio_usd_divisa ?? (precioBcv * (bcv / parallel));
      const costUsd = p.cost_usd!;
      const rateType = p.purchase_rate_type!;

      // $ Real (paralelo) para margen divisa
      const realCostUsd = rateType === 'BCV' ? costUsd * (bcv / parallel) : costUsd;
      // Costo BCV equiv para margen Bs
      const costBcvEquiv = rateType === 'PARALELO' ? costUsd * (parallel / bcv) : costUsd;
      const costBcvDebit = costBcvEquiv * (1 + iva + debitComm);

      const marginUsd = realCostUsd > 0 ? (precioDivisa - realCostUsd) / realCostUsd : 0;
      const marginBsPm = costBcvEquiv > 0 ? (precioBcv - costBcvEquiv) / costBcvEquiv : 0;
      const profitBsIva = precioBcv - costBcvEquiv - precioBcv * (iva + debitComm);
      const marginBsIva = costBcvDebit > 0 ? profitBsIva / costBcvDebit : 0;

      return { ...p, simulated: { realCostUsd, costBcvEquiv, marginUsd, marginBsPm, marginBsIva } };
    });
  }, [products, settings, simBcv, simParallel]);

  // ── Simulador de ganancia por producto ────────────

  const profitSimResult = useMemo(() => {
    if (!settings || !simGanProductId || !simGanSalePrice) return null;
    const product = products.find(p => p.id === parseInt(simGanProductId));
    if (!product || product.cost_usd == null) return null;
    const salePrice = parseFloat(simGanSalePrice);
    if (isNaN(salePrice) || salePrice <= 0) return null;

    const { bcvRate, parallelRate, ivaRate, debitCommission, creditCommission } = settings;
    const costUsd = product.cost_usd;
    const rateType = product.purchase_rate_type ?? 'PARALELO';

    // Costo en $ real (paralelo) para modo divisas
    const realCostUsd = rateType === 'BCV' ? costUsd * (bcvRate / parallelRate) : costUsd;
    // Costo en $ BCV equivalente para modos Bs
    const costBcvEquiv = rateType === 'PARALELO' ? costUsd * (parallelRate / bcvRate) : costUsd;

    let profitUsd: number;
    let profitBs: number;
    let effectiveCost: number;
    let deductions: { label: string; amount: number }[] = [];

    if (simGanPayMethod === 'pm') {
      // Pago móvil: precio en $BCV, sin IVA, sin comisión
      profitUsd = salePrice - costBcvEquiv;
      profitBs = profitUsd * bcvRate;
      effectiveCost = costBcvEquiv;
    } else if (simGanPayMethod === 'debito') {
      // Punto débito: IVA + comisión débito descontados del precio
      const ivaAmt = salePrice * ivaRate;
      const commAmt = salePrice * debitCommission;
      deductions = [
        { label: `IVA (${(ivaRate * 100).toFixed(0)}%)`, amount: ivaAmt },
        { label: `Com. débito (${(debitCommission * 100).toFixed(1)}%)`, amount: commAmt },
      ];
      profitUsd = salePrice - ivaAmt - commAmt - costBcvEquiv;
      profitBs = profitUsd * bcvRate;
      effectiveCost = costBcvEquiv;
    } else if (simGanPayMethod === 'credito') {
      // Punto crédito: IVA + comisión crédito
      const ivaAmt = salePrice * ivaRate;
      const commAmt = salePrice * creditCommission;
      deductions = [
        { label: `IVA (${(ivaRate * 100).toFixed(0)}%)`, amount: ivaAmt },
        { label: `Com. crédito (${(creditCommission * 100).toFixed(1)}%)`, amount: commAmt },
      ];
      profitUsd = salePrice - ivaAmt - commAmt - costBcvEquiv;
      profitBs = profitUsd * bcvRate;
      effectiveCost = costBcvEquiv;
    } else {
      // Divisas: precio en USD real, sin IVA, sin comisión
      profitUsd = salePrice - realCostUsd;
      profitBs = profitUsd * parallelRate;
      effectiveCost = realCostUsd;
    }

    const profitPct = effectiveCost > 0 ? (profitUsd / effectiveCost) * 100 : 0;
    const isDivisas = simGanPayMethod === 'divisas';

    return {
      product,
      salePrice,
      costDisplay: isDivisas ? realCostUsd : costBcvEquiv,
      profitUsd,
      profitBs,
      profitPct,
      deductions,
      isDivisas,
      bcvRate,
      parallelRate,
    };
  }, [settings, products, simGanProductId, simGanSalePrice, simGanPayMethod]);

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
      // Si es solo_costos, también actualizar precios de venta
      if (editingProduct.solo_costos) {
        await fetch('/api/costs/cost-only-product', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            productId: editingProduct.id,
            precioUsd: parseFloat(costForm.precioUsd) || 0,
            precioUsdDivisa: costForm.precioUsdDivisa ? parseFloat(costForm.precioUsdDivisa) : null,
          })
        });
      }

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

  const deleteHistoryEntry = useCallback(async (id: number) => {
    try {
      const res = await fetch('/api/costs/history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.success) setHistory(prev => prev.filter(h => h.id !== id));
    } catch { /* ignore */ }
  }, []);

  const openEditCost = (product: ProductWithCost) => {
    setEditingProduct(product);
    setCostForm({
      costUsd: product.cost_usd != null ? String(product.cost_usd) : '',
      rateType: product.purchase_rate_type || 'PARALELO',
      notes: '',
      precioUsd: String(product.precio_usd || ''),
      precioUsdDivisa: product.precio_usd_divisa != null ? String(product.precio_usd_divisa) : '',
    });
  };

  const handleCreateCostOnly = async () => {
    if (!costOnlyForm.nombre.trim() || !costOnlyForm.costUsd) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/costs/cost-only-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          nombre: costOnlyForm.nombre,
          categoria: costOnlyForm.categoria || categories[0] || 'Otros',
          unidad: costOnlyForm.unidad,
          costUsd: parseFloat(costOnlyForm.costUsd),
          purchaseRateType: costOnlyForm.rateType,
          precioUsd: costOnlyForm.precioUsd ? parseFloat(costOnlyForm.precioUsd) : 0,
          precioUsdDivisa: costOnlyForm.precioUsdDivisa ? parseFloat(costOnlyForm.precioUsdDivisa) : null,
        })
      });
      const data = await res.json();
      if (data.success) {
        setShowCostOnlyForm(false);
        setCostOnlyForm({ nombre: '', categoria: '', unidad: 'kg', costUsd: '', rateType: 'PARALELO', precioUsd: '', precioUsdDivisa: '' });
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

  const handleDeleteCostOnly = async (id: number) => {
    if (!confirm('¿Eliminar este producto solo-costo?')) return;
    try {
      const res = await fetch('/api/costs/cost-only-product', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.success) loadData();
      else alert(data.error);
    } catch {
      alert('Error de conexión');
    }
  };

  // ── Share price list ──────────────────────────────

  const buildPriceListHTML = (): string => {
    const fechaStr = new Date().toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const bcvRate = settings?.bcvRate ?? 0;
    const baseUrl = window.location.origin;

    // Only products with sale prices (exclude solo_costos without prices)
    const shareProducts = products
      .filter(p => p.disponible && (p.precio_usd > 0 || (p.precio_usd_divisa != null && p.precio_usd_divisa > 0)))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));

    // Group by category
    const grouped = new Map<string, typeof shareProducts>();
    for (const p of shareProducts) {
      const cat = p.categoria || 'Otros';
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(p);
    }

    const categoryBlocks = [...grouped.entries()].map(([cat, prods]) => {
      const rows = prods.map(p => {
        const precioDivisa = p.precio_usd_divisa != null && p.precio_usd_divisa > 0 ? formatUSD(p.precio_usd_divisa) : '—';
        const precioBcv = p.precio_usd > 0 ? formatUSD(p.precio_usd) : '—';
        return `
          <tr>
            <td style="padding:5px 8px;font-size:13px;color:#0c4a6e;border-bottom:1px solid #e0f2fe;">${p.nombre} <span style="color:#94a3b8;font-size:11px;">/${p.unidad}</span></td>
            <td style="padding:5px 8px;font-size:13px;font-weight:600;color:#15803d;text-align:right;border-bottom:1px solid #e0f2fe;white-space:nowrap;">${precioDivisa}</td>
            <td style="padding:5px 8px;font-size:13px;font-weight:600;color:#1d4ed8;text-align:right;border-bottom:1px solid #e0f2fe;white-space:nowrap;">${precioBcv}</td>
          </tr>`;
      }).join('');

      return `
        <tr>
          <td colspan="3" style="padding:8px 8px 4px;font-size:12px;font-weight:700;color:#075985;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #0ea5e9;">${cat}</td>
        </tr>
        ${rows}`;
    }).join('');

    return `
    <div style="font-family:'Inter',-apple-system,sans-serif;width:380px;">
      <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);border:2px solid #075985;">
        <div style="text-align:center;margin-bottom:8px;">
          <img src="${baseUrl}/camaronlogo-sm.webp" alt="RPYM" style="display:block;width:140px;height:auto;object-fit:contain;margin:0 auto;" />
        </div>
        <div style="text-align:center;margin-bottom:12px;">
          <div style="font-size:15px;font-weight:700;color:#0c4a6e;">Lista de Precios</div>
          <div style="font-size:11px;color:#0ea5e9;margin-top:2px;">${fechaStr} — Tasa BCV: Bs. ${bcvRate.toFixed(2)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f0f9ff;">
              <th style="padding:6px 8px;font-size:11px;font-weight:700;color:#075985;text-align:left;">Producto</th>
              <th style="padding:6px 8px;font-size:11px;font-weight:700;color:#15803d;text-align:right;">Venta $</th>
              <th style="padding:6px 8px;font-size:11px;font-weight:700;color:#1d4ed8;text-align:right;">Venta BCV</th>
            </tr>
          </thead>
          <tbody>
            ${categoryBlocks}
          </tbody>
        </table>
        <div style="text-align:center;border-top:2px solid #075985;padding-top:8px;margin-top:8px;">
          <div style="font-size:10px;color:#0ea5e9;">WhatsApp: +58 414-214-5202</div>
          <div style="font-size:9px;color:#94a3b8;margin-top:2px;">Precios sujetos a cambio sin previo aviso</div>
        </div>
      </div>
    </div>`;
  };

  const handleSharePriceList = async (mode: 'image' | 'pdf') => {
    setIsSharing(true);
    try {
      const captureDiv = shareCaptureRef.current;
      if (!captureDiv) throw new Error('Container de captura no encontrado');

      captureDiv.innerHTML = buildPriceListHTML();
      captureDiv.style.display = 'block';

      await new Promise(resolve => setTimeout(resolve, 400));

      const canvas = await html2canvas(captureDiv.firstElementChild as HTMLElement, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: 380,
        windowWidth: 380,
      });

      captureDiv.style.display = 'none';

      if (mode === 'pdf') {
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        const imgW = canvas.width;
        const imgH = canvas.height;
        const pdfW = 120; // mm
        const pdfH = (imgH * pdfW) / imgW;
        const doc = new jsPDF({ unit: 'mm', format: [pdfW, pdfH + 10] });
        doc.addImage(imgData, 'JPEG', 5, 5, pdfW - 10, pdfH - 2);
        doc.save(`Lista-Precios-RPYM-${new Date().toISOString().slice(0, 10)}.pdf`);
      } else {
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => b ? resolve(b) : reject(new Error('Error al crear imagen')),
            'image/png'
          );
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Lista-Precios-RPYM-${new Date().toISOString().slice(0, 10)}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        alert('Error al generar lista: ' + (err?.message || 'desconocido'));
      }
    } finally {
      setIsSharing(false);
    }
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
            ['ganancia', 'Ganancia'],
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

      {/* BCV rate — auto-sync activo, no requiere banner manual */}

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
                <div className="flex gap-1">
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
                  <select
                    value={filterMarginType}
                    onChange={e => setFilterMarginType(e.target.value as any)}
                    className="px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
                  >
                    <option value="usd">$ USD</option>
                    <option value="bsPm">Bs PM</option>
                    <option value="iva">IVA</option>
                  </select>
                </div>
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
              <button
                onClick={() => setShowCostOnlyForm(true)}
                className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
              >
                + Solo costo
              </button>
              <div className="relative group">
                <button
                  disabled={isSharing}
                  onClick={() => handleSharePriceList('image')}
                  className="px-3 py-2 bg-green-600 hover:bg-green-500 disabled:bg-green-300 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  {isSharing ? 'Generando...' : 'Compartir'}
                </button>
                <div className="absolute right-0 top-full mt-1 hidden group-hover:block z-10">
                  <div className="bg-white rounded-lg shadow-lg border border-ocean-200 py-1 min-w-[140px]">
                    <button
                      onClick={() => handleSharePriceList('image')}
                      disabled={isSharing}
                      className="w-full text-left px-3 py-2 text-sm text-ocean-700 hover:bg-ocean-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Imagen PNG
                    </button>
                    <button
                      onClick={() => handleSharePriceList('pdf')}
                      disabled={isSharing}
                      className="w-full text-left px-3 py-2 text-sm text-ocean-700 hover:bg-ocean-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      PDF
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Cost-only product form */}
          {showCostOnlyForm && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <h3 className="text-sm font-bold text-amber-800 mb-3">Nuevo producto solo costo</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-amber-700 mb-1">Nombre</label>
                  <input
                    type="text"
                    placeholder="Ej: Hielo, Gasolina..."
                    value={costOnlyForm.nombre}
                    onChange={e => setCostOnlyForm(f => ({ ...f, nombre: e.target.value }))}
                    className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:ring-1 focus:ring-amber-500 outline-none"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs text-amber-700 mb-1">Categoría</label>
                  <input
                    type="text"
                    list="cost-only-categories"
                    placeholder="Ej: Insumos"
                    value={costOnlyForm.categoria}
                    onChange={e => setCostOnlyForm(f => ({ ...f, categoria: e.target.value }))}
                    className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:ring-1 focus:ring-amber-500 outline-none"
                  />
                  <datalist id="cost-only-categories">
                    {categories.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs text-amber-700 mb-1">Unidad</label>
                  <select
                    value={costOnlyForm.unidad}
                    onChange={e => setCostOnlyForm(f => ({ ...f, unidad: e.target.value }))}
                    className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:ring-1 focus:ring-amber-500 outline-none"
                  >
                    <option value="kg">kg</option>
                    <option value="unidad">unidad</option>
                    <option value="caja">caja</option>
                    <option value="paquete">paquete</option>
                    <option value="bolsa">bolsa</option>
                    <option value="litro">litro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-amber-700 mb-1">Costo USD</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={costOnlyForm.costUsd}
                    onChange={e => setCostOnlyForm(f => ({ ...f, costUsd: e.target.value }))}
                    className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:ring-1 focus:ring-amber-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-amber-700 mb-1">Tasa de compra</label>
                  <select
                    value={costOnlyForm.rateType}
                    onChange={e => setCostOnlyForm(f => ({ ...f, rateType: e.target.value }))}
                    className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:ring-1 focus:ring-amber-500 outline-none"
                  >
                    <option value="PARALELO">Paralelo</option>
                    <option value="BCV">BCV</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-amber-700 mb-1">Venta $ (BCV)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={costOnlyForm.precioUsd}
                    onChange={e => setCostOnlyForm(f => ({ ...f, precioUsd: e.target.value }))}
                    className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 outline-none bg-blue-50/50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-amber-700 mb-1">Venta $ (divisa)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={costOnlyForm.precioUsdDivisa}
                    onChange={e => setCostOnlyForm(f => ({ ...f, precioUsdDivisa: e.target.value }))}
                    className="w-full px-3 py-2 border border-green-200 rounded-lg text-sm focus:ring-1 focus:ring-green-500 outline-none bg-green-50/50"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <button
                    onClick={handleCreateCostOnly}
                    disabled={isSaving || !costOnlyForm.nombre.trim() || !costOnlyForm.costUsd}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-300 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {isSaving ? 'Creando...' : 'Crear'}
                  </button>
                  <button
                    onClick={() => setShowCostOnlyForm(false)}
                    className="px-4 py-2 text-amber-700 hover:bg-amber-100 rounded-lg text-sm transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}

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
                    <th className="px-3 py-2 text-right text-xs font-semibold text-ocean-700">Costo BCV</th>
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
                    <tr key={p.id} className={`hover:bg-ocean-50/30 ${p.solo_costos ? 'bg-amber-50/30' : ''}`}>
                      <td className="px-3 py-2 font-medium text-ocean-900 whitespace-nowrap">
                        {p.nombre}
                        <span className="text-ocean-400 text-xs ml-1">/{p.unidad}</span>
                        {p.solo_costos === 1 && (
                          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">
                            Solo costo
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-green-700">
                        {p.precio_usd_divisa != null && p.precio_usd_divisa > 0
                          ? formatUSD(p.precio_usd_divisa)
                          : <span className="text-ocean-400">—</span>
                        }
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-blue-700">
                        {p.precio_usd > 0
                          ? formatUSD(p.precio_usd)
                          : <span className="text-ocean-400">—</span>
                        }
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
                          <td className="px-3 py-2 text-right font-medium text-ocean-600">
                            {formatUSD(p.calculated.realCostUsd)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-blue-600">
                            {formatUSD(p.calculated.costBcvEquiv)}
                          </td>
                          {p.precio_usd > 0 ? (
                            <>
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
                            <td colSpan={5} className="px-3 py-2 text-center text-xs text-ocean-400 italic">Sin precio de venta</td>
                          )}
                        </>
                      ) : (
                        <td colSpan={10} className="px-3 py-2 text-center text-ocean-400 italic">
                          Sin costo asignado
                        </td>
                      )}
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center gap-1 justify-center">
                          <button
                            onClick={() => openEditCost(p)}
                            className="p-1.5 text-ocean-600 hover:bg-ocean-50 rounded-lg transition-colors"
                            title="Editar costo"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          {p.solo_costos === 1 && (
                            <button
                              onClick={() => handleDeleteCostOnly(p.id)}
                              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Eliminar"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
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
                      <th className="px-2 py-2"></th>
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
                        <td className="px-2 py-2">
                          <button
                            onClick={() => deleteHistoryEntry(h.id)}
                            className="text-red-400 hover:text-red-600 transition-colors"
                            title="Eliminar"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
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
                    <th className="px-3 py-2 text-right text-xs font-semibold text-amber-800">Costo BCV Eq.</th>
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
                        <td className="px-3 py-2 text-right font-medium text-amber-700">{formatUSD(p.simulated.costBcvEquiv)}</td>
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

      {/* ── GANANCIA POR PRODUCTO ─────────────────── */}
      {subView === 'ganancia' && settings && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-ocean-100">
            <h2 className="text-lg font-bold text-ocean-900 mb-1">Simulador de Ganancia por Producto</h2>
            <p className="text-sm text-ocean-500 mb-5">
              Selecciona un producto, ingresa el precio de venta y la forma de pago para calcular la ganancia real.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Selector de producto */}
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Producto</label>
                <select
                  value={simGanProductId}
                  onChange={e => setSimGanProductId(e.target.value)}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
                >
                  <option value="">— Selecciona un producto —</option>
                  {products
                    .filter(p => p.cost_usd != null)
                    .sort((a, b) => a.nombre.localeCompare(b.nombre))
                    .map(p => (
                      <option key={p.id} value={String(p.id)}>
                        {p.nombre} (costo: {formatUSD(p.cost_usd!)} {p.purchase_rate_type ?? ''})
                      </option>
                    ))}
                </select>
              </div>

              {/* Precio de venta */}
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">
                  Precio de venta ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={simGanSalePrice}
                  onChange={e => setSimGanSalePrice(e.target.value)}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
                />
              </div>

              {/* Forma de pago */}
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Forma de pago</label>
                <select
                  value={simGanPayMethod}
                  onChange={e => setSimGanPayMethod(e.target.value as PayMethod)}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
                >
                  <option value="pm">Pago Móvil (BCV, sin IVA)</option>
                  <option value="debito">Punto Débito (BCV + IVA + com. {(settings.debitCommission * 100).toFixed(1)}%)</option>
                  <option value="credito">Punto Crédito (BCV + IVA + com. {(settings.creditCommission * 100).toFixed(1)}%)</option>
                  <option value="divisas">Divisas / Efectivo USD</option>
                </select>
              </div>
            </div>

            {/* Tasas activas */}
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-ocean-500">
              <span>BCV: <span className="font-semibold text-ocean-700">Bs. {settings.bcvRate.toFixed(2)}</span></span>
              <span>Paralela: <span className="font-semibold text-ocean-700">Bs. {settings.parallelRate.toFixed(2)}</span></span>
              <span>IVA: <span className="font-semibold text-ocean-700">{(settings.ivaRate * 100).toFixed(0)}%</span></span>
            </div>
          </div>

          {/* Resultado */}
          {profitSimResult ? (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-ocean-100">
              <h3 className="text-base font-bold text-ocean-900 mb-4">
                Resultado: <span className="text-ocean-600">{profitSimResult.product.nombre}</span>
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {/* Costo */}
                <div className="bg-ocean-50 rounded-xl p-4">
                  <p className="text-xs text-ocean-500 mb-1">
                    Costo ({profitSimResult.isDivisas ? '$ real' : '$ BCV equiv.'})
                  </p>
                  <p className="text-xl font-bold text-ocean-800">{formatUSD(profitSimResult.costDisplay)}</p>
                  <p className="text-xs text-ocean-400 mt-0.5">
                    {profitSimResult.isDivisas
                      ? `Bs. ${(profitSimResult.costDisplay * profitSimResult.parallelRate).toFixed(2)}`
                      : `Bs. ${(profitSimResult.costDisplay * profitSimResult.bcvRate).toFixed(2)}`}
                  </p>
                </div>

                {/* Precio venta */}
                <div className="bg-blue-50 rounded-xl p-4">
                  <p className="text-xs text-blue-500 mb-1">Precio de venta</p>
                  <p className="text-xl font-bold text-blue-800">{formatUSD(profitSimResult.salePrice)}</p>
                  <p className="text-xs text-blue-400 mt-0.5">
                    Bs. {(profitSimResult.salePrice * (profitSimResult.isDivisas ? profitSimResult.parallelRate : profitSimResult.bcvRate)).toFixed(2)}
                  </p>
                </div>

                {/* Ganancia en $ */}
                <div className={`rounded-xl p-4 ${profitSimResult.profitUsd >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                  <p className={`text-xs mb-1 ${profitSimResult.profitUsd >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    Ganancia ($)
                  </p>
                  <p className={`text-xl font-bold ${profitSimResult.profitUsd >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {profitSimResult.profitUsd >= 0 ? '+' : ''}{formatUSD(profitSimResult.profitUsd)}
                  </p>
                  <p className={`text-xs mt-0.5 ${profitSimResult.profitUsd >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {profitSimResult.profitPct >= 0 ? '+' : ''}{profitSimResult.profitPct.toFixed(1)}% sobre costo
                  </p>
                </div>

                {/* Ganancia en Bs */}
                <div className={`rounded-xl p-4 ${profitSimResult.profitBs >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <p className={`text-xs mb-1 ${profitSimResult.profitBs >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    Ganancia (Bs)
                  </p>
                  <p className={`text-xl font-bold ${profitSimResult.profitBs >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {profitSimResult.profitBs >= 0 ? '+' : ''}Bs. {profitSimResult.profitBs.toFixed(2)}
                  </p>
                  <p className={`text-xs mt-0.5 ${profitSimResult.profitBs >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    Tasa {profitSimResult.isDivisas ? 'paralela' : 'BCV'}
                  </p>
                </div>
              </div>

              {/* Desglose de deducciones */}
              {(profitSimResult.deductions.length > 0 || true) && (
                <div className="mt-4 bg-ocean-50/50 rounded-xl p-4 text-sm">
                  <p className="text-xs font-semibold text-ocean-600 uppercase tracking-wide mb-3">Desglose</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-ocean-700">
                      <span>Precio de venta</span>
                      <span className="font-medium">{formatUSD(profitSimResult.salePrice)}</span>
                    </div>
                    {profitSimResult.deductions.map((d, i) => (
                      <div key={i} className="flex justify-between text-red-600">
                        <span>— {d.label}</span>
                        <span className="font-medium">-{formatUSD(d.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-red-600">
                      <span>— Costo ({profitSimResult.isDivisas ? '$ real' : '$ BCV equiv.'})</span>
                      <span className="font-medium">-{formatUSD(profitSimResult.costDisplay)}</span>
                    </div>
                    <div className={`flex justify-between font-bold pt-1.5 border-t border-ocean-200 ${profitSimResult.profitUsd >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      <span>= Ganancia neta</span>
                      <span>
                        {profitSimResult.profitUsd >= 0 ? '+' : ''}{formatUSD(profitSimResult.profitUsd)}
                        {' '}({profitSimResult.profitPct >= 0 ? '+' : ''}{profitSimResult.profitPct.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            simGanProductId && simGanSalePrice ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
                Verifica que el producto tenga costo registrado y el precio sea mayor a 0.
              </div>
            ) : (
              <div className="bg-ocean-50 border border-ocean-100 rounded-xl p-6 text-center text-ocean-400 text-sm">
                Selecciona un producto e ingresa el precio de venta para ver los resultados.
              </div>
            )
          )}
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
              {editingProduct.solo_costos ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">SOLO COSTOS</span>
                    <span className="text-xs text-ocean-500">Precios de venta editables</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-ocean-700 mb-1">Venta $ (BCV)</label>
                      <input
                        type="number" step="0.01" min="0"
                        value={costForm.precioUsd}
                        onChange={e => setCostForm(f => ({ ...f, precioUsd: e.target.value }))}
                        className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 outline-none bg-blue-50/50"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ocean-700 mb-1">Venta $ (divisa)</label>
                      <input
                        type="number" step="0.01" min="0"
                        value={costForm.precioUsdDivisa}
                        onChange={e => setCostForm(f => ({ ...f, precioUsdDivisa: e.target.value }))}
                        className="w-full px-3 py-2 border border-green-200 rounded-lg text-sm focus:ring-1 focus:ring-green-500 outline-none bg-green-50/50"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                  {editingProduct.cost_usd != null && (
                    <div className="bg-ocean-50 rounded-lg p-2 text-sm flex justify-between">
                      <span className="text-ocean-600">Costo actual:</span>
                      <span className="font-bold text-red-700">{formatUSD(editingProduct.cost_usd)} ({editingProduct.purchase_rate_type})</span>
                    </div>
                  )}
                </div>
              ) : (
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
              )}

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
                    const precioDivisa = editingProduct.solo_costos
                      ? (parseFloat(costForm.precioUsdDivisa) || parseFloat(costForm.precioUsd) || 0)
                      : (editingProduct.precio_usd_divisa ?? editingProduct.precio_usd);
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

      {/* Hidden div for html2canvas price list capture */}
      <div ref={shareCaptureRef} style={{ position: 'absolute', left: '-9999px', top: 0, display: 'none' }} />
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
