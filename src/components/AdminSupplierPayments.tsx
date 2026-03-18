/**
 * RPYM - Registro de compras a proveedores informales
 * Modelo compra/abonos: cada compra puede tener múltiples pagos parciales
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { formatUSD, formatBs, formatDateShort } from '../lib/format';
import type { ProveedorInformal, CompraProveedor, AbonoProveedor, ResumenMensual, MetodoPago, CuentaPago } from '../lib/pagos-proveedores-types';
import { METODO_PAGO_LABELS, METODO_PAGO_SHORT, CUENTA_LABELS, CUENTA_SHORT } from '../lib/pagos-proveedores-types';

const MONTHS_FULL_CAP = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(mes: string): string {
  const [year, month] = mes.split('-');
  const monthIdx = parseInt(month, 10) - 1;
  return `${MONTHS_FULL_CAP[monthIdx]} ${year}`;
}

function shiftMonth(mes: string, delta: number): string {
  const [year, month] = mes.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function AdminSupplierPayments() {
  // Data
  const [compras, setCompras] = useState<CompraProveedor[]>([]);
  const [proveedores, setProveedores] = useState<ProveedorInformal[]>([]);
  const [resumen, setResumen] = useState<ResumenMensual | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [mesSeleccionado, setMesSeleccionado] = useState(getCurrentMonth);
  const [proveedorFilter, setProveedorFilter] = useState<number | null>(null);
  const [cuentaFilter, setCuentaFilter] = useState<CuentaPago | ''>('');
  const [facturaFilter, setFacturaFilter] = useState<'' | '1' | '0'>('');
  const [estadoFilter, setEstadoFilter] = useState<'' | 'pendiente' | 'pagada'>('');
  const [searchTerm, setSearchTerm] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Expanded compra (to show abonos)
  const [expandedCompraId, setExpandedCompraId] = useState<number | null>(null);

  // Compra modal
  const [showCompraModal, setShowCompraModal] = useState(false);
  const [editingCompra, setEditingCompra] = useState<CompraProveedor | null>(null);
  const [compraForm, setCompraForm] = useState({
    proveedorId: '' as string,
    producto: '',
    montoTotal: '',
    fecha: new Date().toISOString().split('T')[0],
    tieneFactura: false,
    notas: '',
  });
  const [notaEntregaFile, setNotaEntregaFile] = useState<File | null>(null);
  const [notaEntregaPreview, setNotaEntregaPreview] = useState<string | null>(null);
  const [removeNotaEntrega, setRemoveNotaEntrega] = useState(false);
  const [isSavingCompra, setIsSavingCompra] = useState(false);

  // Abono modal
  const [showAbonoModal, setShowAbonoModal] = useState(false);
  const [abonoTargetCompra, setAbonoTargetCompra] = useState<CompraProveedor | null>(null);
  const [editingAbono, setEditingAbono] = useState<AbonoProveedor | null>(null);
  const [abonoForm, setAbonoForm] = useState({
    montoUsd: '',
    fecha: new Date().toISOString().split('T')[0],
    metodoPago: 'pago_movil' as MetodoPago,
    cuenta: 'pa' as CuentaPago,
    notas: '',
  });
  const [imagenFile, setImagenFile] = useState<File | null>(null);
  const [imagenPreview, setImagenPreview] = useState<string | null>(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const [isSavingAbono, setIsSavingAbono] = useState(false);

  // Bs conversion mode for abono
  const [montoMode, setMontoMode] = useState<'usd' | 'bs'>('usd');
  const [montoBsInput, setMontoBsInput] = useState('');
  const [tasaBcv, setTasaBcv] = useState<number | null>(null);
  const [tasaParalela, setTasaParalela] = useState('');

  // Supplier search within compra modal
  const [proveedorSearchTerm, setProveedorSearchTerm] = useState('');
  const [showProveedorDropdown, setShowProveedorDropdown] = useState(false);
  const proveedorInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Supplier modal (standalone create/edit)
  const [showProveedorModal, setShowProveedorModal] = useState(false);
  const [editingProveedor, setEditingProveedor] = useState<ProveedorInformal | null>(null);
  const [proveedorForm, setProveedorForm] = useState({ nombre: '', notas: '' });
  const [isSavingProveedor, setIsSavingProveedor] = useState(false);

  // Image viewer
  const [imagenAmpliada, setImagenAmpliada] = useState<string | null>(null);

  // Confirm delete
  const [confirmDeleteCompraId, setConfirmDeleteCompraId] = useState<number | null>(null);
  const [confirmDeleteAbonoId, setConfirmDeleteAbonoId] = useState<number | null>(null);

  // Proveedores list panel
  const [showProveedoresList, setShowProveedoresList] = useState(false);
  const [confirmDeleteProveedorId, setConfirmDeleteProveedorId] = useState<number | null>(null);
  const [isDeletingProveedor, setIsDeletingProveedor] = useState(false);

  // ── Data Loading ──────────────────────────────────────

  const loadProveedores = useCallback(async () => {
    try {
      const res = await fetch('/api/pagos-proveedores/proveedores');
      const data = await res.json();
      if (data.success) setProveedores(data.proveedores);
    } catch {
      console.error('Error loading proveedores');
    }
  }, []);

  const loadBcvRate = useCallback(async () => {
    try {
      const res = await fetch('/api/config/bcv-rate');
      const data = await res.json();
      if (data.rate) setTasaBcv(data.rate);
    } catch {
      console.error('Error loading BCV rate');
    }
  }, []);

  const loadCompras = useCallback(async () => {
    try {
      const params = new URLSearchParams({ mes: mesSeleccionado });
      if (proveedorFilter) params.set('proveedor_id', String(proveedorFilter));
      if (cuentaFilter) params.set('cuenta', cuentaFilter);
      if (facturaFilter) params.set('factura', facturaFilter);
      if (searchTerm) params.set('search', searchTerm);
      if (estadoFilter) params.set('estado', estadoFilter);

      const res = await fetch(`/api/pagos-proveedores/compras?${params}`);
      const data = await res.json();
      if (data.success) setCompras(data.compras);
    } catch {
      console.error('Error loading compras');
    }
  }, [mesSeleccionado, proveedorFilter, cuentaFilter, facturaFilter, searchTerm, estadoFilter]);

  const loadResumen = useCallback(async () => {
    try {
      const res = await fetch(`/api/pagos-proveedores/resumen?mes=${mesSeleccionado}`);
      const data = await res.json();
      if (data.success) setResumen(data.resumen);
    } catch {
      console.error('Error loading resumen');
    }
  }, [mesSeleccionado]);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await Promise.all([loadProveedores(), loadCompras(), loadResumen(), loadBcvRate()]);
    } catch {
      setError('Error al cargar datos');
    } finally {
      setIsLoading(false);
    }
  }, [loadProveedores, loadCompras, loadResumen, loadBcvRate]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Debounce search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => { loadCompras(); }, 300);
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, [searchTerm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowProveedorDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ── Compra CRUD ──────────────────────────────────────

  const openCompraModal = (compra?: CompraProveedor) => {
    if (compra) {
      setEditingCompra(compra);
      setCompraForm({
        proveedorId: String(compra.proveedorId),
        producto: compra.producto,
        montoTotal: String(compra.montoTotal),
        fecha: compra.fecha,
        tieneFactura: compra.tieneFactura,
        notas: compra.notas || '',
      });
      setProveedorSearchTerm(compra.proveedorNombre);
      setNotaEntregaPreview(compra.notaEntregaUrl);
    } else {
      setEditingCompra(null);
      setCompraForm({
        proveedorId: '',
        producto: '',
        montoTotal: '',
        fecha: new Date().toISOString().split('T')[0],
        tieneFactura: false,
        notas: '',
      });
      setProveedorSearchTerm('');
      setNotaEntregaPreview(null);
    }
    setNotaEntregaFile(null);
    setRemoveNotaEntrega(false);
    setShowCompraModal(true);
  };

  const handleSaveCompra = async () => {
    if (!compraForm.proveedorId || !compraForm.montoTotal || !compraForm.producto.trim() || !compraForm.fecha) {
      alert('Completa proveedor, monto total, producto y fecha');
      return;
    }

    setIsSavingCompra(true);
    try {
      const method = editingCompra ? 'PUT' : 'POST';
      const url = editingCompra
        ? `/api/pagos-proveedores/compras/${editingCompra.id}`
        : '/api/pagos-proveedores/compras';

      const payload = {
        ...compraForm,
        removeNotaEntrega,
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!data.success) {
        alert(data.error || 'Error al guardar');
        return;
      }

      const compraId = editingCompra ? editingCompra.id : data.id;

      // Upload nota de entrega if selected
      if (notaEntregaFile && compraId) {
        const formData = new FormData();
        formData.append('file', notaEntregaFile);
        formData.append('compraId', String(compraId));
        await fetch('/api/pagos-proveedores/upload-nota-entrega', {
          method: 'POST',
          body: formData,
        });
      }

      setShowCompraModal(false);
      await Promise.all([loadCompras(), loadResumen()]);
    } catch {
      alert('Error de conexion');
    } finally {
      setIsSavingCompra(false);
    }
  };

  const handleDeleteCompra = async (id: number) => {
    try {
      const res = await fetch(`/api/pagos-proveedores/compras/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setConfirmDeleteCompraId(null);
        if (expandedCompraId === id) setExpandedCompraId(null);
        await Promise.all([loadCompras(), loadResumen()]);
      }
    } catch {
      alert('Error al eliminar');
    }
  };

  // ── Abono CRUD ──────────────────────────────────────

  const openAbonoModal = (compra: CompraProveedor, abono?: AbonoProveedor) => {
    setAbonoTargetCompra(compra);
    if (abono) {
      setEditingAbono(abono);
      setAbonoForm({
        montoUsd: String(abono.montoUsd),
        fecha: abono.fecha,
        metodoPago: abono.metodoPago,
        cuenta: abono.cuenta,
        notas: abono.notas || '',
      });
      setImagenPreview(abono.imagenUrl);
      if (abono.montoBs) {
        setMontoMode('bs');
        setMontoBsInput(String(abono.montoBs));
        setTasaParalela(abono.tasaParalela ? String(abono.tasaParalela) : '');
      } else {
        setMontoMode('usd');
        setMontoBsInput('');
        setTasaParalela('');
      }
    } else {
      setEditingAbono(null);
      setAbonoForm({
        montoUsd: compra.saldoPendiente > 0 ? String(compra.saldoPendiente.toFixed(2)) : '',
        fecha: new Date().toISOString().split('T')[0],
        metodoPago: 'pago_movil',
        cuenta: 'pa',
        notas: '',
      });
      setImagenPreview(null);
      setMontoMode('usd');
      setMontoBsInput('');
      setTasaParalela('');
    }
    setImagenFile(null);
    setRemoveExistingImage(false);
    setShowAbonoModal(true);
  };

  const handleSaveAbono = async () => {
    if (!abonoTargetCompra || !abonoForm.montoUsd || !abonoForm.fecha) {
      alert('Completa monto y fecha');
      return;
    }

    setIsSavingAbono(true);
    try {
      const method = editingAbono ? 'PUT' : 'POST';
      const url = editingAbono
        ? `/api/pagos-proveedores/compras/${abonoTargetCompra.id}/abonos/${editingAbono.id}`
        : `/api/pagos-proveedores/compras/${abonoTargetCompra.id}/abonos`;

      const payload = {
        ...abonoForm,
        removeImage: removeExistingImage,
        montoBs: montoMode === 'bs' ? Number(montoBsInput) || null : null,
        tasaCambio: montoMode === 'bs' && tasaBcv ? tasaBcv : null,
        tasaParalela: montoMode === 'bs' && tasaParalela ? Number(tasaParalela) : null,
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!data.success) {
        alert(data.error || 'Error al guardar');
        return;
      }

      const abonoId = editingAbono ? editingAbono.id : data.id;

      // Upload image if selected
      if (imagenFile && abonoId) {
        const formData = new FormData();
        formData.append('image', imagenFile);
        formData.append('abonoId', String(abonoId));
        await fetch('/api/pagos-proveedores/upload-imagen', {
          method: 'POST',
          body: formData,
        });
      }

      setShowAbonoModal(false);
      await Promise.all([loadCompras(), loadResumen()]);
    } catch {
      alert('Error de conexion');
    } finally {
      setIsSavingAbono(false);
    }
  };

  const handleDeleteAbono = async (compraId: number, abonoId: number) => {
    try {
      const res = await fetch(`/api/pagos-proveedores/compras/${compraId}/abonos/${abonoId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setConfirmDeleteAbonoId(null);
        await Promise.all([loadCompras(), loadResumen()]);
      }
    } catch {
      alert('Error al eliminar');
    }
  };

  // ── Supplier inline create ────────────────────────────

  const filteredProveedores = proveedorSearchTerm.trim()
    ? proveedores.filter(p => p.nombre.toLowerCase().includes(proveedorSearchTerm.toLowerCase()))
    : proveedores;

  const exactMatch = proveedores.some(
    p => p.nombre.toLowerCase() === proveedorSearchTerm.trim().toLowerCase()
  );

  const handleCreateProveedorInline = async () => {
    if (!proveedorSearchTerm.trim()) return;
    setIsSavingProveedor(true);
    try {
      const res = await fetch('/api/pagos-proveedores/proveedores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: proveedorSearchTerm.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        await loadProveedores();
        setCompraForm(prev => ({ ...prev, proveedorId: String(data.id) }));
        setShowProveedorDropdown(false);
      }
    } catch {
      alert('Error al crear proveedor');
    } finally {
      setIsSavingProveedor(false);
    }
  };

  const selectProveedor = (p: ProveedorInformal) => {
    setCompraForm(prev => ({ ...prev, proveedorId: String(p.id) }));
    setProveedorSearchTerm(p.nombre);
    setShowProveedorDropdown(false);
  };

  // ── Supplier standalone CRUD ──────────────────────────

  const openProveedorModal = (prov?: ProveedorInformal) => {
    if (prov) {
      setEditingProveedor(prov);
      setProveedorForm({ nombre: prov.nombre, notas: prov.notas || '' });
    } else {
      setEditingProveedor(null);
      setProveedorForm({ nombre: '', notas: '' });
    }
    setShowProveedorModal(true);
  };

  const handleSaveProveedor = async () => {
    if (!proveedorForm.nombre.trim()) {
      alert('El nombre es requerido');
      return;
    }
    setIsSavingProveedor(true);
    try {
      const method = editingProveedor ? 'PUT' : 'POST';
      const url = editingProveedor
        ? `/api/pagos-proveedores/proveedores/${editingProveedor.id}`
        : '/api/pagos-proveedores/proveedores';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proveedorForm),
      });
      const data = await res.json();
      if (data.success) {
        setShowProveedorModal(false);
        await loadProveedores();
      } else {
        alert(data.error);
      }
    } catch {
      alert('Error de conexion');
    } finally {
      setIsSavingProveedor(false);
    }
  };

  const handleDeleteProveedor = async (id: number) => {
    setIsDeletingProveedor(true);
    try {
      const res = await fetch(`/api/pagos-proveedores/proveedores/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setConfirmDeleteProveedorId(null);
        await Promise.all([loadProveedores(), loadCompras(), loadResumen()]);
      } else {
        alert(data.error || 'Error al eliminar');
      }
    } catch {
      alert('Error de conexion');
    } finally {
      setIsDeletingProveedor(false);
    }
  };

  // ── Image handling ────────────────────────────────────

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('La imagen es demasiado grande. Maximo 5MB.');
      return;
    }
    setImagenFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setImagenPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleNotaEntregaSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert('El archivo es demasiado grande. Maximo 10MB.');
      return;
    }
    setNotaEntregaFile(file);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => setNotaEntregaPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setNotaEntregaPreview(null); // PDF — no preview
    }
  };

  // ── Helper: progress bar percentage ───────────────────

  const progressPercent = (compra: CompraProveedor) => {
    if (compra.montoTotal <= 0) return 100;
    return Math.min(100, (compra.totalAbonado / compra.montoTotal) * 100);
  };

  // ── Render ────────────────────────────────────────────

  if (isLoading) {
    return <div className="text-center py-12 text-ocean-700">Cargando gastos...</div>;
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 mb-4">{error}</p>
        <button onClick={loadAll} className="px-4 py-2 bg-ocean-600 text-white rounded-lg">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Resumen Mensual ─────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-ocean-100 p-4">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setMesSeleccionado(prev => shiftMonth(prev, -1))}
            className="p-2 hover:bg-ocean-50 rounded-lg text-ocean-600"
          >
            &larr;
          </button>
          <h2 className="text-lg font-semibold text-ocean-900">{formatMonthLabel(mesSeleccionado)}</h2>
          <button
            onClick={() => setMesSeleccionado(prev => shiftMonth(prev, 1))}
            className="p-2 hover:bg-ocean-50 rounded-lg text-ocean-600"
          >
            &rarr;
          </button>
        </div>

        {/* Total principal */}
        {(() => {
          const hasFilters = facturaFilter || cuentaFilter || proveedorFilter || searchTerm || estadoFilter;
          const filteredTotal = hasFilters
            ? compras.reduce((sum, c) => sum + c.totalAbonado, 0)
            : resumen?.totalUsd || 0;
          const filteredCount = hasFilters
            ? compras.reduce((sum, c) => sum + c.abonos.length, 0)
            : resumen?.cantidadTotal || 0;

          const filterParts: string[] = [];
          if (facturaFilter === '0') filterParts.push('sin factura');
          if (facturaFilter === '1') filterParts.push('con factura');
          if (cuentaFilter === 'pa') filterParts.push('Cuenta PA');
          if (cuentaFilter === 'carlos') filterParts.push('Cuenta Carlos');
          if (cuentaFilter === 'venezuela') filterParts.push('Cuenta Venezuela');
          if (estadoFilter === 'pendiente') filterParts.push('pendientes');
          if (estadoFilter === 'pagada') filterParts.push('pagadas');
          if (proveedorFilter) {
            const prov = resumen?.porProveedor.find(p => p.proveedorId === proveedorFilter);
            if (prov) filterParts.push(prov.proveedorNombre);
          }
          if (searchTerm) filterParts.push(`"${searchTerm}"`);

          return (
            <div className="text-center mb-3">
              <span className="text-2xl font-bold text-ocean-900">
                {formatUSD(filteredTotal)}
              </span>
              <span className="text-sm text-ocean-500 ml-2">
                {hasFilters ? (
                  <>
                    de {filteredCount} abono{filteredCount !== 1 ? 's' : ''} en {compras.length} compra{compras.length !== 1 ? 's' : ''}
                    {filterParts.length > 0 && (
                      <span className="block text-xs text-ocean-400 mt-0.5">
                        Filtro: {filterParts.join(' + ')}
                      </span>
                    )}
                  </>
                ) : (
                  `total del mes (${filteredCount} abonos)`
                )}
              </span>
            </div>
          );
        })()}

        {/* Desglose fiscal */}
        {resumen && resumen.totalUsd > 0 && !facturaFilter && !cuentaFilter && !proveedorFilter && !searchTerm && !estadoFilter && (
          <div className="mb-3 mx-auto max-w-sm">
            <div className="flex rounded-full overflow-hidden h-2 mb-2">
              {resumen.totalConFactura > 0 && (
                <div
                  className="bg-green-500 transition-all"
                  style={{ width: `${(resumen.totalConFactura / resumen.totalUsd) * 100}%` }}
                />
              )}
              {resumen.totalSinFactura > 0 && (
                <div
                  className="bg-orange-400 transition-all"
                  style={{ width: `${(resumen.totalSinFactura / resumen.totalUsd) * 100}%` }}
                />
              )}
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-green-700">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />
                Con factura: {formatUSD(resumen.totalConFactura)} ({resumen.cantidadConFactura})
              </span>
              <span className="text-orange-600">
                <span className="inline-block w-2 h-2 rounded-full bg-orange-400 mr-1" />
                Sin factura: {formatUSD(resumen.totalSinFactura)} ({resumen.cantidadSinFactura})
              </span>
            </div>
            <div className="flex justify-between text-xs mt-1.5 text-ocean-500">
              <span>Cuenta PA: {formatUSD(resumen.totalCuentaPa)}</span>
              <span>Cuenta Carlos: {formatUSD(resumen.totalCuentaCarlos)}</span>
              <span>Cuenta Vzla: {formatUSD(resumen.totalCuentaVenezuela)}</span>
            </div>
          </div>
        )}

        {/* Indicador de filtro por proveedor activo */}
        {proveedorFilter && resumen && (
          <div className="flex items-center justify-center gap-2">
            <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-ocean-600 text-white">
              {resumen.porProveedor.find(p => p.proveedorId === proveedorFilter)?.proveedorNombre ?? 'Proveedor'}
            </span>
            <button
              onClick={() => setProveedorFilter(null)}
              className="px-3 py-1.5 rounded-full text-xs font-medium bg-ocean-100 text-ocean-700 hover:bg-ocean-200"
            >
              Ver todos
            </button>
          </div>
        )}
      </div>

      {/* ── Buscador y Filtros ────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-ocean-100 p-4 space-y-3">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-ocean-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Buscar por producto o proveedor..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-ocean-200 rounded-xl text-sm focus:ring-2 focus:ring-ocean-300 focus:border-ocean-400"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ocean-400 hover:text-ocean-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFacturaFilter(f => f === '0' ? '' : '0')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              facturaFilter === '0'
                ? 'bg-orange-500 text-white'
                : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
            }`}
          >
            Sin factura
          </button>
          <button
            onClick={() => setFacturaFilter(f => f === '1' ? '' : '1')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              facturaFilter === '1'
                ? 'bg-green-600 text-white'
                : 'bg-green-50 text-green-700 hover:bg-green-100'
            }`}
          >
            Con factura
          </button>

          <span className="w-px bg-ocean-200 mx-1" />

          <button
            onClick={() => setEstadoFilter(e => e === 'pendiente' ? '' : 'pendiente')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              estadoFilter === 'pendiente'
                ? 'bg-amber-500 text-white'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            Pendientes
          </button>
          <button
            onClick={() => setEstadoFilter(e => e === 'pagada' ? '' : 'pagada')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              estadoFilter === 'pagada'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            Pagadas
          </button>

          <span className="w-px bg-ocean-200 mx-1" />

          <button
            onClick={() => setCuentaFilter(c => c === 'pa' ? '' : 'pa')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              cuentaFilter === 'pa'
                ? 'bg-ocean-600 text-white'
                : 'bg-ocean-50 text-ocean-700 hover:bg-ocean-100'
            }`}
          >
            Cuenta PA
          </button>
          <button
            onClick={() => setCuentaFilter(c => c === 'carlos' ? '' : 'carlos')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              cuentaFilter === 'carlos'
                ? 'bg-ocean-600 text-white'
                : 'bg-ocean-50 text-ocean-700 hover:bg-ocean-100'
            }`}
          >
            Cuenta Carlos
          </button>
          <button
            onClick={() => setCuentaFilter(c => c === 'venezuela' ? '' : 'venezuela')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              cuentaFilter === 'venezuela'
                ? 'bg-ocean-600 text-white'
                : 'bg-ocean-50 text-ocean-700 hover:bg-ocean-100'
            }`}
          >
            Cuenta Venezuela
          </button>

          {(facturaFilter || cuentaFilter || searchTerm || proveedorFilter || estadoFilter) && (
            <>
              <span className="w-px bg-ocean-200 mx-1" />
              <button
                onClick={() => {
                  setFacturaFilter('');
                  setCuentaFilter('');
                  setEstadoFilter('');
                  setSearchTerm('');
                  setProveedorFilter(null);
                }}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100"
              >
                Limpiar filtros
              </button>
            </>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => openCompraModal()}
            className="px-4 py-2 bg-ocean-600 text-white rounded-lg text-sm font-medium hover:bg-ocean-700"
          >
            + Nueva Compra
          </button>
          <button
            onClick={() => openProveedorModal()}
            className="px-4 py-2 bg-ocean-100 text-ocean-700 rounded-lg text-sm font-medium hover:bg-ocean-200"
          >
            + Proveedor
          </button>
          <button
            onClick={() => setShowProveedoresList(true)}
            className="px-4 py-2 bg-ocean-50 text-ocean-600 rounded-lg text-sm font-medium hover:bg-ocean-100"
          >
            Ver Proveedores
          </button>
        </div>
      </div>

      {/* ── Lista de Compras ─────────────────────────────── */}
      {compras.length === 0 ? (
        <div className="text-center py-12 text-ocean-400">
          No hay compras registradas{mesSeleccionado ? ` en ${formatMonthLabel(mesSeleccionado)}` : ''}
        </div>
      ) : (
        <div className="space-y-3">
          {compras.map(compra => {
            const isExpanded = expandedCompraId === compra.id;
            const isPagada = compra.saldoPendiente <= 0;

            return (
              <div key={compra.id} className="bg-white rounded-xl shadow-sm border border-ocean-100 overflow-hidden">
                {/* Compra header */}
                <div
                  className="p-4 cursor-pointer hover:bg-ocean-50/50"
                  onClick={() => setExpandedCompraId(isExpanded ? null : compra.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-ocean-900">{compra.proveedorNombre}</span>
                        <span className="text-ocean-400 text-xs">{formatDateShort(compra.fecha)}</span>
                        {compra.tieneFactura ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-100 text-green-700 font-medium">Fact.</span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-100 text-orange-600">S/F</span>
                        )}
                        {compra.notaEntregaUrl && (
                          <button
                            onClick={e => { e.stopPropagation(); setImagenAmpliada(compra.notaEntregaUrl); }}
                            className="text-ocean-400 hover:text-ocean-600"
                            title="Ver nota de entrega"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </button>
                        )}
                      </div>
                      <span className="text-sm text-ocean-600">{compra.producto}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-ocean-900">{formatUSD(compra.montoTotal)}</div>
                      {isPagada ? (
                        <span className="text-xs text-emerald-600 font-medium">Pagada</span>
                      ) : (
                        <span className="text-xs text-amber-600 font-medium">
                          Pendiente: {formatUSD(compra.saldoPendiente)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 bg-ocean-100 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${isPagada ? 'bg-emerald-500' : 'bg-amber-400'}`}
                        style={{ width: `${progressPercent(compra)}%` }}
                      />
                    </div>
                    <span className="text-xs text-ocean-400 shrink-0">
                      {compra.abonos.length} abono{compra.abonos.length !== 1 ? 's' : ''}
                    </span>
                    <svg className={`w-4 h-4 text-ocean-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* Expanded: abonos list */}
                {isExpanded && (
                  <div className="border-t border-ocean-100">
                    {/* Abonos */}
                    {compra.abonos.length > 0 ? (
                      <div className="divide-y divide-ocean-50">
                        {compra.abonos.map(abono => (
                          <div key={abono.id} className="px-4 py-3 bg-ocean-50/30">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-ocean-900">{formatUSD(abono.montoUsd)}</span>
                                  {abono.montoUsdParalelo != null && (
                                    <span className="text-xs text-ocean-400">~{formatUSD(abono.montoUsdParalelo)} paral.</span>
                                  )}
                                  {abono.montoBs && (
                                    <span className="text-xs text-ocean-400">{formatBs(abono.montoBs)}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs text-ocean-500">{formatDateShort(abono.fecha)}</span>
                                  <span className="px-2 py-0.5 rounded text-xs bg-ocean-100 text-ocean-600">
                                    {METODO_PAGO_SHORT[abono.metodoPago]}-{CUENTA_SHORT[abono.cuenta]}
                                  </span>
                                  {abono.notas && <span className="text-xs text-ocean-400 truncate">{abono.notas}</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {abono.imagenUrl && (
                                  <button
                                    onClick={() => setImagenAmpliada(abono.imagenUrl)}
                                    className="p-1 text-ocean-400 hover:text-ocean-600"
                                    title="Ver comprobante"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                  </button>
                                )}
                                <button
                                  onClick={() => openAbonoModal(compra, abono)}
                                  className="p-1 text-ocean-400 hover:text-ocean-600"
                                  title="Editar abono"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                  </svg>
                                </button>
                                {confirmDeleteAbonoId === abono.id ? (
                                  <div className="flex gap-1">
                                    <button onClick={() => handleDeleteAbono(compra.id, abono.id)} className="px-2 py-0.5 bg-red-500 text-white rounded text-xs">Si</button>
                                    <button onClick={() => setConfirmDeleteAbonoId(null)} className="px-2 py-0.5 bg-ocean-200 text-ocean-700 rounded text-xs">No</button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setConfirmDeleteAbonoId(abono.id)}
                                    className="p-1 text-ocean-400 hover:text-red-500"
                                    title="Eliminar abono"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="px-4 py-3 text-sm text-ocean-400">Sin abonos registrados</div>
                    )}

                    {/* Actions row */}
                    <div className="px-4 py-3 bg-ocean-50/50 flex gap-2 flex-wrap">
                      {!isPagada && (
                        <button
                          onClick={() => openAbonoModal(compra)}
                          className="px-3 py-1.5 bg-ocean-600 text-white rounded-lg text-xs font-medium hover:bg-ocean-700"
                        >
                          + Agregar Abono
                        </button>
                      )}
                      <button
                        onClick={() => openCompraModal(compra)}
                        className="px-3 py-1.5 bg-ocean-100 text-ocean-700 rounded-lg text-xs font-medium hover:bg-ocean-200"
                      >
                        Editar Compra
                      </button>
                      {confirmDeleteCompraId === compra.id ? (
                        <div className="flex gap-1 items-center">
                          <span className="text-xs text-red-600">Eliminar compra y abonos?</span>
                          <button onClick={() => handleDeleteCompra(compra.id)} className="px-2 py-1 bg-red-500 text-white rounded text-xs">Si</button>
                          <button onClick={() => setConfirmDeleteCompraId(null)} className="px-2 py-1 bg-ocean-200 text-ocean-700 rounded text-xs">No</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteCompraId(compra.id)}
                          className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal: Nueva/Editar Compra ───────────────────── */}
      {showCompraModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-lg my-8 shadow-xl">
            <div className="px-6 py-4 border-b border-ocean-100">
              <h3 className="text-lg font-semibold text-ocean-900">
                {editingCompra ? 'Editar Compra' : 'Nueva Compra'}
              </h3>
            </div>

            <div className="p-6 space-y-4">
              {/* Proveedor search/create */}
              <div ref={dropdownRef} className="relative">
                <label className="block text-sm font-medium text-ocean-700 mb-1">Proveedor</label>
                <input
                  ref={proveedorInputRef}
                  type="text"
                  value={proveedorSearchTerm}
                  onChange={e => {
                    const value = e.target.value;
                    setProveedorSearchTerm(value);
                    const match = proveedores.find(p => p.nombre.toLowerCase() === value.trim().toLowerCase());
                    setCompraForm(prev => ({ ...prev, proveedorId: match ? String(match.id) : '' }));
                    setShowProveedorDropdown(true);
                  }}
                  onFocus={() => setShowProveedorDropdown(true)}
                  placeholder="Buscar o crear proveedor..."
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-2 focus:ring-ocean-300 focus:border-ocean-400"
                />
                {compraForm.proveedorId && (
                  <span className="absolute right-3 top-8 text-green-500">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </span>
                )}

                {showProveedorDropdown && proveedorSearchTerm.trim() && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-ocean-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredProveedores.map(p => (
                      <button
                        key={p.id}
                        onClick={() => selectProveedor(p)}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-ocean-50 text-ocean-800"
                      >
                        {p.nombre}
                      </button>
                    ))}
                    {!exactMatch && proveedorSearchTerm.trim() && (
                      <button
                        onClick={handleCreateProveedorInline}
                        disabled={isSavingProveedor}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-green-50 text-green-700 border-t border-ocean-100 font-medium"
                      >
                        {isSavingProveedor ? 'Creando...' : `+ Crear "${proveedorSearchTerm.trim()}"`}
                      </button>
                    )}
                    {filteredProveedores.length === 0 && exactMatch && (
                      <div className="px-4 py-2 text-sm text-ocean-400">Sin resultados</div>
                    )}
                  </div>
                )}
              </div>

              {/* Producto */}
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Producto</label>
                <input
                  type="text"
                  value={compraForm.producto}
                  onChange={e => setCompraForm(prev => ({ ...prev, producto: e.target.value }))}
                  placeholder="Ej: Pescado, Camarones, Pulpo..."
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                />
              </div>

              {/* Monto total */}
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Monto Total (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  value={compraForm.montoTotal}
                  onChange={e => setCompraForm(prev => ({ ...prev, montoTotal: e.target.value }))}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                />
              </div>

              {/* Fecha */}
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Fecha</label>
                <input
                  type="date"
                  value={compraForm.fecha}
                  onChange={e => setCompraForm(prev => ({ ...prev, fecha: e.target.value }))}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                />
              </div>

              {/* Factura */}
              <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={compraForm.tieneFactura}
                    onChange={e => setCompraForm(prev => ({ ...prev, tieneFactura: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-ocean-200 peer-focus:ring-2 peer-focus:ring-ocean-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:border-ocean-300 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500" />
                </label>
                <span className="text-sm font-medium text-ocean-700">
                  {compraForm.tieneFactura ? 'Con factura' : 'Sin factura'}
                </span>
              </div>

              {/* Nota de entrega */}
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Nota de entrega / Factura proveedor</label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleNotaEntregaSelect}
                  className="w-full text-sm text-ocean-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-ocean-50 file:text-ocean-700 hover:file:bg-ocean-100"
                />
                {notaEntregaPreview && !removeNotaEntrega && (
                  <div className="mt-2 relative inline-block">
                    <img
                      src={notaEntregaPreview}
                      alt="Nota de entrega"
                      className="max-h-40 rounded-lg border border-ocean-200 cursor-pointer"
                      onClick={() => setImagenAmpliada(notaEntregaPreview)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (notaEntregaFile) {
                          setNotaEntregaFile(null);
                          setNotaEntregaPreview(editingCompra?.notaEntregaUrl || null);
                        } else {
                          setRemoveNotaEntrega(true);
                          setNotaEntregaPreview(null);
                        }
                      }}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow text-xs hover:bg-red-600"
                    >
                      &times;
                    </button>
                  </div>
                )}
                {removeNotaEntrega && (
                  <p className="mt-2 text-sm text-orange-600">
                    La nota sera eliminada al guardar.{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setRemoveNotaEntrega(false);
                        setNotaEntregaPreview(editingCompra?.notaEntregaUrl || null);
                      }}
                      className="underline hover:text-orange-800"
                    >
                      Deshacer
                    </button>
                  </p>
                )}
              </div>

              {/* Notas */}
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Notas (opcional)</label>
                <textarea
                  value={compraForm.notas}
                  onChange={e => setCompraForm(prev => ({ ...prev, notas: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm resize-none"
                  placeholder="Detalle adicional..."
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-ocean-100 flex gap-3 justify-end">
              <button
                onClick={() => setShowCompraModal(false)}
                className="px-4 py-2 text-sm text-ocean-600 hover:bg-ocean-50 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveCompra}
                disabled={isSavingCompra || !compraForm.proveedorId}
                className="px-6 py-2 text-sm bg-ocean-600 text-white rounded-lg font-medium hover:bg-ocean-700 disabled:opacity-50"
              >
                {isSavingCompra ? 'Guardando...' : editingCompra ? 'Actualizar' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Agregar/Editar Abono ──────────────────── */}
      {showAbonoModal && abonoTargetCompra && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-lg my-8 shadow-xl">
            <div className="px-6 py-4 border-b border-ocean-100">
              <h3 className="text-lg font-semibold text-ocean-900">
                {editingAbono ? 'Editar Abono' : 'Agregar Abono'}
              </h3>
              <div className="mt-1 text-sm text-ocean-500">
                {abonoTargetCompra.proveedorNombre} — {abonoTargetCompra.producto}
                <span className="ml-2 font-medium text-ocean-700">
                  Total: {formatUSD(abonoTargetCompra.montoTotal)}
                </span>
                {abonoTargetCompra.saldoPendiente > 0 && (
                  <span className="ml-2 text-amber-600">
                    Pendiente: {formatUSD(abonoTargetCompra.saldoPendiente)}
                  </span>
                )}
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* Monto — toggle USD / Bs */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-ocean-700">Monto</label>
                  <div className="flex bg-ocean-100 rounded-lg p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setMontoMode('usd');
                        setMontoBsInput('');
                        setTasaParalela('');
                      }}
                      className={`px-3 py-1 rounded-md transition-colors ${montoMode === 'usd' ? 'bg-white text-ocean-900 shadow-sm font-medium' : 'text-ocean-600'}`}
                    >
                      USD
                    </button>
                    <button
                      type="button"
                      onClick={() => setMontoMode('bs')}
                      className={`px-3 py-1 rounded-md transition-colors ${montoMode === 'bs' ? 'bg-white text-ocean-900 shadow-sm font-medium' : 'text-ocean-600'}`}
                    >
                      Bs
                    </button>
                  </div>
                </div>

                {montoMode === 'usd' ? (
                  <input
                    type="number"
                    step="0.01"
                    value={abonoForm.montoUsd}
                    onChange={e => setAbonoForm(prev => ({ ...prev, montoUsd: e.target.value }))}
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                  />
                ) : (
                  <div className="space-y-3">
                    <input
                      type="number"
                      step="0.01"
                      value={montoBsInput}
                      onChange={e => {
                        const bs = e.target.value;
                        setMontoBsInput(bs);
                        if (tasaBcv && Number(bs)) {
                          setAbonoForm(prev => ({ ...prev, montoUsd: (Number(bs) / tasaBcv).toFixed(2) }));
                        } else {
                          setAbonoForm(prev => ({ ...prev, montoUsd: '' }));
                        }
                      }}
                      placeholder="Monto en Bs"
                      className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                    />

                    <div>
                      <label className="block text-xs text-ocean-500 mb-1">
                        Tasa paralela (opcional — solo referencia)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={tasaParalela}
                        onChange={e => setTasaParalela(e.target.value)}
                        placeholder="Ej: 85.00"
                        className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                      />
                    </div>

                    {montoBsInput && Number(montoBsInput) > 0 && (
                      <div className="bg-ocean-50 rounded-lg p-3 text-sm space-y-1">
                        {tasaBcv && (
                          <div className="flex justify-between text-ocean-700 font-medium">
                            <span>BCV ({tasaBcv.toFixed(2)})</span>
                            <span className="text-ocean-900">
                              {formatUSD(Number(montoBsInput) / tasaBcv)}
                            </span>
                          </div>
                        )}
                        {tasaParalela && Number(tasaParalela) > 0 && (
                          <div className="flex justify-between text-ocean-500">
                            <span>Paralelo ({Number(tasaParalela).toFixed(2)})</span>
                            <span>
                              {formatUSD(Number(montoBsInput) / Number(tasaParalela))}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Fecha */}
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Fecha</label>
                <input
                  type="date"
                  value={abonoForm.fecha}
                  onChange={e => setAbonoForm(prev => ({ ...prev, fecha: e.target.value }))}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                />
              </div>

              {/* Metodo de pago + Cuenta */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-ocean-700 mb-1">Metodo de pago</label>
                  <select
                    value={abonoForm.metodoPago}
                    onChange={e => setAbonoForm(prev => ({ ...prev, metodoPago: e.target.value as MetodoPago }))}
                    className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                  >
                    {(Object.entries(METODO_PAGO_LABELS) as [MetodoPago, string][]).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ocean-700 mb-1">Cuenta</label>
                  <select
                    value={abonoForm.cuenta}
                    onChange={e => setAbonoForm(prev => ({ ...prev, cuenta: e.target.value as CuentaPago }))}
                    className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                  >
                    {(Object.entries(CUENTA_LABELS) as [CuentaPago, string][]).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Notas */}
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Notas (opcional)</label>
                <textarea
                  value={abonoForm.notas}
                  onChange={e => setAbonoForm(prev => ({ ...prev, notas: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm resize-none"
                  placeholder="Detalle adicional..."
                />
              </div>

              {/* Comprobante */}
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Comprobante (imagen)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="w-full text-sm text-ocean-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-ocean-50 file:text-ocean-700 hover:file:bg-ocean-100"
                />
                {imagenPreview && !removeExistingImage && (
                  <div className="mt-2 relative inline-block">
                    <img
                      src={imagenPreview}
                      alt="Preview"
                      className="max-h-40 rounded-lg border border-ocean-200 cursor-pointer"
                      onClick={() => setImagenAmpliada(imagenPreview)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (imagenFile) {
                          setImagenFile(null);
                          setImagenPreview(editingAbono?.imagenUrl || null);
                        } else {
                          setRemoveExistingImage(true);
                          setImagenPreview(null);
                        }
                      }}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow text-xs hover:bg-red-600"
                    >
                      &times;
                    </button>
                  </div>
                )}
                {removeExistingImage && (
                  <p className="mt-2 text-sm text-orange-600">
                    La imagen sera eliminada al guardar.{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setRemoveExistingImage(false);
                        setImagenPreview(editingAbono?.imagenUrl || null);
                      }}
                      className="underline hover:text-orange-800"
                    >
                      Deshacer
                    </button>
                  </p>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-ocean-100 flex gap-3 justify-end">
              <button
                onClick={() => setShowAbonoModal(false)}
                className="px-4 py-2 text-sm text-ocean-600 hover:bg-ocean-50 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveAbono}
                disabled={isSavingAbono || !abonoForm.montoUsd}
                className="px-6 py-2 text-sm bg-ocean-600 text-white rounded-lg font-medium hover:bg-ocean-700 disabled:opacity-50"
              >
                {isSavingAbono ? 'Guardando...' : editingAbono ? 'Actualizar' : 'Registrar Abono'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Crear/Editar Proveedor ──────────────── */}
      {showProveedorModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
            <div className="px-6 py-4 border-b border-ocean-100">
              <h3 className="text-lg font-semibold text-ocean-900">
                {editingProveedor ? 'Editar Proveedor' : 'Nuevo Proveedor'}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Nombre</label>
                <input
                  type="text"
                  value={proveedorForm.nombre}
                  onChange={e => setProveedorForm(prev => ({ ...prev, nombre: e.target.value }))}
                  placeholder="Ej: Vizcaino"
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Notas (opcional)</label>
                <textarea
                  value={proveedorForm.notas}
                  onChange={e => setProveedorForm(prev => ({ ...prev, notas: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm resize-none"
                  placeholder="Telefono, direccion, etc."
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-ocean-100 flex gap-3 justify-end">
              <button
                onClick={() => setShowProveedorModal(false)}
                className="px-4 py-2 text-sm text-ocean-600 hover:bg-ocean-50 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveProveedor}
                disabled={isSavingProveedor}
                className="px-6 py-2 text-sm bg-ocean-600 text-white rounded-lg font-medium hover:bg-ocean-700 disabled:opacity-50"
              >
                {isSavingProveedor ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Lista de Proveedores ─────────────────── */}
      {showProveedoresList && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-md my-8 shadow-xl">
            <div className="px-6 py-4 border-b border-ocean-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-ocean-900">
                Proveedores ({proveedores.length})
              </h3>
              <button
                onClick={() => { setShowProveedoresList(false); setConfirmDeleteProveedorId(null); }}
                className="text-ocean-400 hover:text-ocean-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-ocean-50">
              {proveedores.length === 0 ? (
                <div className="p-6 text-center text-ocean-400 text-sm">No hay proveedores registrados</div>
              ) : (
                proveedores
                  .map(prov => {
                    const stats = resumen?.porProveedor.find(p => p.proveedorId === prov.id);
                    return { prov, stats };
                  })
                  .sort((a, b) => (b.stats?.totalUsd ?? 0) - (a.stats?.totalUsd ?? 0))
                  .map(({ prov, stats }) => (
                  <div
                    key={prov.id}
                    className="px-6 py-3 flex items-center justify-between gap-3 hover:bg-ocean-50/50 cursor-pointer"
                    onClick={() => {
                      setProveedorFilter(proveedorFilter === prov.id ? null : prov.id);
                      setShowProveedoresList(false);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-ocean-900 text-sm">{prov.nombre}</span>
                      {stats ? (
                        <p className="text-xs text-ocean-500 mt-0.5">
                          <span className="font-semibold text-ocean-700">{formatUSD(stats.totalUsd)}</span>
                          <span className="ml-1 opacity-60">({stats.cantidadPagos} pago{stats.cantidadPagos !== 1 ? 's' : ''})</span>
                        </p>
                      ) : (
                        <p className="text-xs text-ocean-300 mt-0.5">Sin pagos este mes</p>
                      )}
                      {prov.notas && <p className="text-xs text-ocean-400 truncate">{prov.notas}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => { setShowProveedoresList(false); openProveedorModal(prov); }}
                        className="p-1.5 text-ocean-400 hover:text-ocean-600 rounded"
                        title="Editar"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      {confirmDeleteProveedorId === prov.id ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleDeleteProveedor(prov.id)}
                            disabled={isDeletingProveedor}
                            className="px-2 py-0.5 bg-red-500 text-white rounded text-xs disabled:opacity-50"
                          >
                            {isDeletingProveedor ? '...' : 'Si'}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteProveedorId(null)}
                            className="px-2 py-0.5 bg-ocean-200 text-ocean-700 rounded text-xs"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteProveedorId(prov.id)}
                          className="p-1.5 text-ocean-400 hover:text-red-500 rounded"
                          title="Eliminar"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="px-6 py-4 border-t border-ocean-100">
              <button
                onClick={() => { setShowProveedoresList(false); openProveedorModal(); }}
                className="w-full px-4 py-2 bg-ocean-600 text-white rounded-lg text-sm font-medium hover:bg-ocean-700"
              >
                + Nuevo Proveedor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Imagen Ampliada ─────────────────────── */}
      {imagenAmpliada && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setImagenAmpliada(null)}
        >
          <div className="relative max-w-3xl max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setImagenAmpliada(null)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg text-ocean-600 hover:text-ocean-800"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {imagenAmpliada.endsWith('.pdf') ? (
              <iframe src={imagenAmpliada} className="w-[90vw] h-[85vh] rounded-lg" title="Nota de entrega" />
            ) : (
              <img
                src={imagenAmpliada}
                alt="Comprobante"
                className="max-h-[85vh] rounded-lg"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
