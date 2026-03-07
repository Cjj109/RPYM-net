/**
 * RPYM - Registro de pagos a proveedores informales (sin factura)
 * Pagos móviles, transferencias y efectivo con comprobante
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { formatUSD, formatBs, formatDateShort, formatDateDMY } from '../lib/format';
import type { ProveedorInformal, PagoProveedor, ResumenMensual, MetodoPago, CuentaPago } from '../lib/pagos-proveedores-types';
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
  const [pagos, setPagos] = useState<PagoProveedor[]>([]);
  const [proveedores, setProveedores] = useState<ProveedorInformal[]>([]);
  const [resumen, setResumen] = useState<ResumenMensual | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [mesSeleccionado, setMesSeleccionado] = useState(getCurrentMonth);
  const [proveedorFilter, setProveedorFilter] = useState<number | null>(null);
  const [cuentaFilter, setCuentaFilter] = useState<CuentaPago | ''>('');
  const [facturaFilter, setFacturaFilter] = useState<'' | '1' | '0'>('');
  const [searchTerm, setSearchTerm] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Payment modal
  const [showPagoModal, setShowPagoModal] = useState(false);
  const [editingPago, setEditingPago] = useState<PagoProveedor | null>(null);
  const [pagoForm, setPagoForm] = useState({
    proveedorId: '' as string,
    montoUsd: '',
    producto: '',
    fecha: new Date().toISOString().split('T')[0],
    metodoPago: 'pago_movil' as MetodoPago,
    cuenta: 'pa' as CuentaPago,
    tieneFactura: false,
    notas: '',
  });
  const [imagenFile, setImagenFile] = useState<File | null>(null);
  const [imagenPreview, setImagenPreview] = useState<string | null>(null);
  const [isSavingPago, setIsSavingPago] = useState(false);

  // Bs conversion mode
  const [montoMode, setMontoMode] = useState<'usd' | 'bs'>('usd');
  const [montoBsInput, setMontoBsInput] = useState('');
  const [tasaBcv, setTasaBcv] = useState<number | null>(null);
  const [tasaParalela, setTasaParalela] = useState('');

  const [removeExistingImage, setRemoveExistingImage] = useState(false);

  // Supplier search within payment modal
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

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

  const loadPagos = useCallback(async () => {
    try {
      const params = new URLSearchParams({ mes: mesSeleccionado });
      if (proveedorFilter) params.set('proveedor_id', String(proveedorFilter));
      if (cuentaFilter) params.set('cuenta', cuentaFilter);
      if (facturaFilter) params.set('factura', facturaFilter);
      if (searchTerm) params.set('search', searchTerm);

      const res = await fetch(`/api/pagos-proveedores?${params}`);
      const data = await res.json();
      if (data.success) setPagos(data.pagos);
    } catch {
      console.error('Error loading pagos');
    }
  }, [mesSeleccionado, proveedorFilter, cuentaFilter, facturaFilter, searchTerm]);

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
      await Promise.all([loadProveedores(), loadPagos(), loadResumen(), loadBcvRate()]);
    } catch {
      setError('Error al cargar datos');
    } finally {
      setIsLoading(false);
    }
  }, [loadProveedores, loadPagos, loadResumen, loadBcvRate]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Debounce search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => { loadPagos(); }, 300);
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

  // ── Payment CRUD ──────────────────────────────────────

  const openPagoModal = (pago?: PagoProveedor) => {
    if (pago) {
      setEditingPago(pago);
      setPagoForm({
        proveedorId: String(pago.proveedorId),
        montoUsd: String(pago.montoUsd),
        producto: pago.producto,
        fecha: pago.fecha,
        metodoPago: pago.metodoPago,
        cuenta: pago.cuenta,
        tieneFactura: pago.tieneFactura,
        notas: pago.notas || '',
      });
      setProveedorSearchTerm(pago.proveedorNombre);
      setImagenPreview(pago.imagenUrl);
      // Restore Bs mode if pago had montoBs
      if (pago.montoBs) {
        setMontoMode('bs');
        setMontoBsInput(String(pago.montoBs));
        setTasaParalela(pago.tasaParalela ? String(pago.tasaParalela) : '');
      } else {
        setMontoMode('usd');
        setMontoBsInput('');
        setTasaParalela('');
      }
    } else {
      setEditingPago(null);
      setPagoForm({
        proveedorId: '',
        montoUsd: '',
        producto: '',
        fecha: new Date().toISOString().split('T')[0],
        metodoPago: 'pago_movil',
        cuenta: 'pa',
        tieneFactura: false,
        notas: '',
      });
      setProveedorSearchTerm('');
      setImagenPreview(null);
    }
    setImagenFile(null);
    setRemoveExistingImage(false);
    if (!pago) {
      setMontoMode('usd');
      setMontoBsInput('');
      setTasaParalela('');
    }
    setShowPagoModal(true);
  };

  const handleSavePago = async () => {
    if (!pagoForm.proveedorId || !pagoForm.montoUsd || !pagoForm.producto.trim() || !pagoForm.fecha) {
      alert('Completa proveedor, monto, producto y fecha');
      return;
    }

    setIsSavingPago(true);
    try {
      const method = editingPago ? 'PUT' : 'POST';
      const url = editingPago
        ? `/api/pagos-proveedores/${editingPago.id}`
        : '/api/pagos-proveedores';

      const payload = {
        ...pagoForm,
        tieneFactura: pagoForm.tieneFactura,
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

      const pagoId = editingPago ? editingPago.id : data.id;

      // Upload image if selected
      if (imagenFile && pagoId) {
        const formData = new FormData();
        formData.append('image', imagenFile);
        formData.append('pagoId', String(pagoId));
        await fetch('/api/pagos-proveedores/upload-imagen', {
          method: 'POST',
          body: formData,
        });
      }

      setShowPagoModal(false);
      await Promise.all([loadPagos(), loadResumen()]);
    } catch {
      alert('Error de conexion');
    } finally {
      setIsSavingPago(false);
    }
  };

  const handleDeletePago = async (id: number) => {
    try {
      const res = await fetch(`/api/pagos-proveedores/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setConfirmDeleteId(null);
        await Promise.all([loadPagos(), loadResumen()]);
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
        setPagoForm(prev => ({ ...prev, proveedorId: String(data.id) }));
        setShowProveedorDropdown(false);
      }
    } catch {
      alert('Error al crear proveedor');
    } finally {
      setIsSavingProveedor(false);
    }
  };

  const selectProveedor = (p: ProveedorInformal) => {
    setPagoForm(prev => ({ ...prev, proveedorId: String(p.id) }));
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
        await Promise.all([loadProveedores(), loadPagos(), loadResumen()]);
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

        <div className="text-center mb-3">
          <span className="text-2xl font-bold text-ocean-900">
            {formatUSD(resumen?.totalUsd || 0)}
          </span>
          <span className="text-sm text-ocean-500 ml-2">
            total del mes
          </span>
        </div>

        {resumen && resumen.porProveedor.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-center">
            {proveedorFilter && (
              <button
                onClick={() => setProveedorFilter(null)}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-ocean-100 text-ocean-700 hover:bg-ocean-200"
              >
                Todos
              </button>
            )}
            {resumen.porProveedor.map(p => (
              <button
                key={p.proveedorId}
                onClick={() => setProveedorFilter(
                  proveedorFilter === p.proveedorId ? null : p.proveedorId
                )}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  proveedorFilter === p.proveedorId
                    ? 'bg-ocean-600 text-white'
                    : 'bg-ocean-50 text-ocean-700 hover:bg-ocean-100'
                }`}
              >
                {p.proveedorNombre} {formatUSD(p.totalUsd)}
                <span className="ml-1 opacity-60">({p.cantidadPagos})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Buscador y Filtros ────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-ocean-100 p-4 space-y-3">
        {/* Search bar */}
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

          {(facturaFilter || cuentaFilter || searchTerm || proveedorFilter) && (
            <>
              <span className="w-px bg-ocean-200 mx-1" />
              <button
                onClick={() => {
                  setFacturaFilter('');
                  setCuentaFilter('');
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
            onClick={() => openPagoModal()}
            className="px-4 py-2 bg-ocean-600 text-white rounded-lg text-sm font-medium hover:bg-ocean-700"
          >
            + Registrar Pago
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

      {/* ── Lista de Pagos ─────────────────────────────── */}
      {pagos.length === 0 ? (
        <div className="text-center py-12 text-ocean-400">
          No hay pagos registrados{mesSeleccionado ? ` en ${formatMonthLabel(mesSeleccionado)}` : ''}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-ocean-100 overflow-hidden">
          {/* Mobile: cards; Desktop: table */}
          <div className="hidden sm:block">
            <table className="w-full text-sm">
              <thead className="bg-ocean-50 text-ocean-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Fecha</th>
                  <th className="px-4 py-3 text-left font-medium">Proveedor</th>
                  <th className="px-4 py-3 text-left font-medium">Producto</th>
                  <th className="px-4 py-3 text-right font-medium">Monto</th>
                  <th className="px-4 py-3 text-center font-medium">Pago</th>
                  <th className="px-4 py-3 text-center font-medium">Fact.</th>
                  <th className="px-4 py-3 text-center font-medium">Img</th>
                  <th className="px-4 py-3 text-center font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ocean-50">
                {pagos.map(pago => (
                  <tr key={pago.id} className="hover:bg-ocean-50/50">
                    <td className="px-4 py-3 text-ocean-600">{formatDateShort(pago.fecha)}</td>
                    <td className="px-4 py-3 font-medium text-ocean-900">{pago.proveedorNombre}</td>
                    <td className="px-4 py-3 text-ocean-700">{pago.producto}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold text-ocean-900">{formatUSD(pago.montoUsd)}</span>
                      {pago.montoUsdParalelo != null && (
                        <span className="block text-xs text-ocean-400" title="USD a tasa paralela">
                          ~{formatUSD(pago.montoUsdParalelo)} paral.
                        </span>
                      )}
                      {pago.montoBs && (
                        <span className="block text-xs text-ocean-400">{formatBs(pago.montoBs)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-ocean-50 text-ocean-600">
                        {METODO_PAGO_SHORT[pago.metodoPago]}-{CUENTA_SHORT[pago.cuenta]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {pago.tieneFactura ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-green-100 text-green-700 font-medium">Si</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-orange-100 text-orange-600">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {pago.imagenUrl ? (
                        <button
                          onClick={() => setImagenAmpliada(pago.imagenUrl)}
                          className="text-ocean-500 hover:text-ocean-700"
                          title="Ver comprobante"
                        >
                          <svg className="w-5 h-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </button>
                      ) : (
                        <span className="text-ocean-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex gap-1 justify-center">
                        <button
                          onClick={() => openPagoModal(pago)}
                          className="p-1 text-ocean-400 hover:text-ocean-600"
                          title="Editar"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        {confirmDeleteId === pago.id ? (
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleDeletePago(pago.id)}
                              className="px-2 py-0.5 bg-red-500 text-white rounded text-xs"
                            >
                              Si
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-0.5 bg-ocean-200 text-ocean-700 rounded text-xs"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(pago.id)}
                            className="p-1 text-ocean-400 hover:text-red-500"
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

          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-ocean-50">
            {pagos.map(pago => (
              <div key={pago.id} className="p-4">
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <span className="font-semibold text-ocean-900">{pago.proveedorNombre}</span>
                    <span className="text-ocean-500 text-xs ml-2">{formatDateShort(pago.fecha)}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-ocean-900">{formatUSD(pago.montoUsd)}</span>
                    {pago.montoUsdParalelo != null && (
                      <span className="block text-xs text-ocean-400">~{formatUSD(pago.montoUsdParalelo)} paral.</span>
                    )}
                    {pago.montoBs && (
                      <span className="block text-xs text-ocean-400">{formatBs(pago.montoBs)}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ocean-600">{pago.producto}</span>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-xs bg-ocean-50 text-ocean-600">
                      {METODO_PAGO_SHORT[pago.metodoPago]}-{CUENTA_SHORT[pago.cuenta]}
                    </span>
                    {pago.tieneFactura ? (
                      <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700 font-medium">Fact.</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs bg-orange-100 text-orange-600">S/F</span>
                    )}
                    {pago.imagenUrl && (
                      <button
                        onClick={() => setImagenAmpliada(pago.imagenUrl)}
                        className="text-ocean-500"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </button>
                    )}
                    <button onClick={() => openPagoModal(pago)} className="text-ocean-400 hover:text-ocean-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    {confirmDeleteId === pago.id ? (
                      <div className="flex gap-1">
                        <button onClick={() => handleDeletePago(pago.id)} className="px-2 py-0.5 bg-red-500 text-white rounded text-xs">Si</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="px-2 py-0.5 bg-ocean-200 text-ocean-700 rounded text-xs">No</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(pago.id)} className="text-ocean-400 hover:text-red-500">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                {pago.notas && <p className="text-xs text-ocean-400 mt-1">{pago.notas}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Modal: Registrar/Editar Pago ───────────────── */}
      {showPagoModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-lg my-8 shadow-xl">
            <div className="px-6 py-4 border-b border-ocean-100">
              <h3 className="text-lg font-semibold text-ocean-900">
                {editingPago ? 'Editar Pago' : 'Registrar Pago'}
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
                    // Auto-seleccionar si hay match exacto
                    const match = proveedores.find(p => p.nombre.toLowerCase() === value.trim().toLowerCase());
                    setPagoForm(prev => ({ ...prev, proveedorId: match ? String(match.id) : '' }));
                    setShowProveedorDropdown(true);
                  }}
                  onFocus={() => setShowProveedorDropdown(true)}
                  placeholder="Buscar o crear proveedor..."
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-2 focus:ring-ocean-300 focus:border-ocean-400"
                />
                {pagoForm.proveedorId && (
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
                    value={pagoForm.montoUsd}
                    onChange={e => setPagoForm(prev => ({ ...prev, montoUsd: e.target.value }))}
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
                        // Siempre usar BCV para monto_usd principal
                        if (tasaBcv && Number(bs)) {
                          setPagoForm(prev => ({ ...prev, montoUsd: (Number(bs) / tasaBcv).toFixed(2) }));
                        } else {
                          setPagoForm(prev => ({ ...prev, montoUsd: '' }));
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

                    {/* Conversion preview */}
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

              {/* Producto */}
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Producto</label>
                <input
                  type="text"
                  value={pagoForm.producto}
                  onChange={e => setPagoForm(prev => ({ ...prev, producto: e.target.value }))}
                  placeholder="Ej: Pescado, Camarones, Pulpo..."
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                />
              </div>

              {/* Fecha */}
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Fecha</label>
                <input
                  type="date"
                  value={pagoForm.fecha}
                  onChange={e => setPagoForm(prev => ({ ...prev, fecha: e.target.value }))}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                />
              </div>

              {/* Metodo de pago + Cuenta */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-ocean-700 mb-1">Metodo de pago</label>
                  <select
                    value={pagoForm.metodoPago}
                    onChange={e => setPagoForm(prev => ({ ...prev, metodoPago: e.target.value as MetodoPago }))}
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
                    value={pagoForm.cuenta}
                    onChange={e => setPagoForm(prev => ({ ...prev, cuenta: e.target.value as CuentaPago }))}
                    className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                  >
                    {(Object.entries(CUENTA_LABELS) as [CuentaPago, string][]).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Factura */}
              <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pagoForm.tieneFactura}
                    onChange={e => setPagoForm(prev => ({ ...prev, tieneFactura: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-ocean-200 peer-focus:ring-2 peer-focus:ring-ocean-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:border-ocean-300 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500" />
                </label>
                <span className="text-sm font-medium text-ocean-700">
                  {pagoForm.tieneFactura ? 'Con factura' : 'Sin factura'}
                </span>
              </div>

              {/* Notas */}
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Notas (opcional)</label>
                <textarea
                  value={pagoForm.notas}
                  onChange={e => setPagoForm(prev => ({ ...prev, notas: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm resize-none"
                  placeholder="Detalle adicional..."
                />
              </div>

              {/* Imagen */}
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
                          setImagenPreview(editingPago?.imagenUrl || null);
                        } else {
                          setRemoveExistingImage(true);
                          setImagenPreview(null);
                        }
                      }}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow text-xs hover:bg-red-600"
                      title="Quitar imagen"
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
                        setImagenPreview(editingPago?.imagenUrl || null);
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
                onClick={() => setShowPagoModal(false)}
                className="px-4 py-2 text-sm text-ocean-600 hover:bg-ocean-50 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleSavePago}
                disabled={isSavingPago || !pagoForm.proveedorId}
                className="px-6 py-2 text-sm bg-ocean-600 text-white rounded-lg font-medium hover:bg-ocean-700 disabled:opacity-50"
              >
                {isSavingPago ? 'Guardando...' : editingPago ? 'Actualizar' : 'Registrar'}
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
                proveedores.map(prov => (
                  <div key={prov.id} className="px-6 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-ocean-900 text-sm">{prov.nombre}</span>
                      {prov.notas && <p className="text-xs text-ocean-400 truncate">{prov.notas}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
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
            <img
              src={imagenAmpliada}
              alt="Comprobante de pago"
              className="max-h-[85vh] rounded-lg"
            />
          </div>
        </div>
      )}
    </div>
  );
}
