/**
 * RPYM - Registro de compras a proveedores informales
 * Modelo compra/abonos: cada compra puede tener múltiples pagos parciales
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { formatUSD, formatBs, formatDateShort } from '../lib/format';
import type { ProveedorInformal, CompraProveedor, AbonoProveedor, ResumenMensual, MetodoPago, CuentaPago, ModoPrecioCompra } from '../lib/pagos-proveedores-types';
import { METODO_PAGO_LABELS, METODO_PAGO_SHORT, CUENTA_LABELS, CUENTA_SHORT, MODO_PRECIO_LABELS, MODO_PRECIO_SHORT, esCuentaEnDivisas, estaPagada, tieneSaldoAFavor, sigueDebiendo } from '../lib/pagos-proveedores-types';

const MONTHS_FULL_CAP = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** El mismo tope que acepta el endpoint */
const MAX_LINEAS = 10;

/**
 * Un pago dentro de la tanda.
 *
 * A un proveedor se le paga el mismo día desde varias cuentas —algo de la de
 * PA, algo de la de Carlos, algo de Zelle— y cada transferencia trae su propio
 * comprobante. Lo que cambia de una a otra es esto; la fecha y las tasas del
 * día son las mismas para todas y viven fuera.
 */
interface LineaAbono {
  uid: number;
  modo: 'usd' | 'bs';
  montoUsd: string;
  montoBs: string;
  metodoPago: MetodoPago;
  cuenta: CuentaPago;
  notas: string;
  imagenFile: File | null;
  imagenPreview: string | null;
}

let proximoUid = 1;

const lineaVacia = (parcial: Partial<LineaAbono> = {}): LineaAbono => ({
  uid: proximoUid++,
  modo: 'usd',
  montoUsd: '',
  montoBs: '',
  metodoPago: 'pago_movil',
  cuenta: 'pa',
  notas: '',
  imagenFile: null,
  imagenPreview: null,
  ...parcial,
});

/** La tasa que convierte en esta compra: la paralela manda si la compra es a paralelo */
const tasaQueManda = (compra: CompraProveedor | null, bcv: string, paralela: string): number =>
  (compra?.modoPrecio === 'paralelo' ? Number(paralela) : Number(bcv)) || 0;

/** Lo que vale la línea en dólares */
const usdDeLinea = (linea: LineaAbono, tasa: number): number => {
  if (linea.modo === 'usd') return Number(linea.montoUsd) || 0;
  const bs = Number(linea.montoBs) || 0;
  return tasa > 0 ? bs / tasa : 0;
};

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
    modoPrecio: 'bcv' as ModoPrecioCompra,
    montoTotalBs: '',
    tasaReferencia: '',
    tasaReferenciaParalela: '',
  });
  const [notaEntregaFile, setNotaEntregaFile] = useState<File | null>(null);
  const [notaEntregaPreview, setNotaEntregaPreview] = useState<string | null>(null);
  const [removeNotaEntrega, setRemoveNotaEntrega] = useState(false);
  const [isSavingCompra, setIsSavingCompra] = useState(false);

  // Abono modal — una línea por pago
  const [showAbonoModal, setShowAbonoModal] = useState(false);
  const [abonoTargetCompra, setAbonoTargetCompra] = useState<CompraProveedor | null>(null);
  const [editingAbono, setEditingAbono] = useState<AbonoProveedor | null>(null);
  const [abonoFecha, setAbonoFecha] = useState(new Date().toISOString().split('T')[0]);
  const [lineas, setLineas] = useState<LineaAbono[]>([]);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const [isSavingAbono, setIsSavingAbono] = useState(false);

  // Tasas del día: valen para todas las líneas de la tanda
  const [tasaBcv, setTasaBcv] = useState<number | null>(null);
  const [tasaBcvInput, setTasaBcvInput] = useState('');
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

  // Merge mode
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedCompraIds, setSelectedCompraIds] = useState<Set<number>>(new Set());
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  // Trasladar saldo a favor
  const [trasladarSource, setTrasladarSource] = useState<CompraProveedor | null>(null);
  const [trasladarTargets, setTrasladarTargets] = useState<CompraProveedor[]>([]);
  const [trasladarMonto, setTrasladarMonto] = useState('');
  const [trasladarTargetId, setTrasladarTargetId] = useState<number | null>(null);
  const [isTrasladando, setIsTrasladando] = useState(false);

  // Modo precio filter
  const [modoPrecioFilter, setModoPrecioFilter] = useState<ModoPrecioCompra | ''>('');

  // Quick nota upload ref
  const notaUploadRef = useRef<HTMLInputElement>(null);
  const [uploadingNotaCompraId, setUploadingNotaCompraId] = useState<number | null>(null);

  // Pendientes de meses anteriores
  const [pendientesCount, setPendientesCount] = useState(0);
  const [pendientesList, setPendientesList] = useState<{ id: number; producto: string; proveedor: string; montoTotal: number; saldoPendiente: number; fecha: string; mes: string }[]>([]);
  const [showPendientes, setShowPendientes] = useState(false);

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
      if (data.rate) {
        setTasaBcv(data.rate);
        setTasaBcvInput(String(data.rate));
      }
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
      if (modoPrecioFilter) params.set('modo_precio', modoPrecioFilter);

      const res = await fetch(`/api/pagos-proveedores/compras?${params}`);
      const data = await res.json();
      if (data.success) setCompras(data.compras);
    } catch {
      console.error('Error loading compras');
    }
  }, [mesSeleccionado, proveedorFilter, cuentaFilter, facturaFilter, searchTerm, estadoFilter, modoPrecioFilter]);

  const loadResumen = useCallback(async () => {
    try {
      const res = await fetch(`/api/pagos-proveedores/resumen?mes=${mesSeleccionado}`);
      const data = await res.json();
      if (data.success) setResumen(data.resumen);
    } catch {
      console.error('Error loading resumen');
    }
  }, [mesSeleccionado]);

  const loadPendientes = useCallback(async () => {
    try {
      const res = await fetch(`/api/pagos-proveedores/pendientes?antes_de=${mesSeleccionado}`);
      const data = await res.json();
      if (data.success) {
        setPendientesCount(data.count);
        setPendientesList(data.pendientes);
      }
    } catch {
      console.error('Error loading pendientes');
    }
  }, [mesSeleccionado]);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await Promise.all([loadProveedores(), loadCompras(), loadResumen(), loadBcvRate(), loadPendientes()]);
    } catch {
      setError('Error al cargar datos');
    } finally {
      setIsLoading(false);
    }
  }, [loadProveedores, loadCompras, loadResumen, loadBcvRate, loadPendientes]);

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
        modoPrecio: compra.modoPrecio || 'bcv',
        montoTotalBs: compra.montoTotalBs ? String(compra.montoTotalBs) : '',
        tasaReferencia: compra.tasaReferencia ? String(compra.tasaReferencia) : '',
        tasaReferenciaParalela: compra.tasaReferenciaParalela ? String(compra.tasaReferenciaParalela) : '',
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
        modoPrecio: 'bcv',
        montoTotalBs: '',
        tasaReferencia: '',
        tasaReferenciaParalela: '',
      });
      setProveedorSearchTerm('');
      setNotaEntregaPreview(null);
    }
    setNotaEntregaFile(null);
    setRemoveNotaEntrega(false);
    setShowCompraModal(true);
  };

  const handleSaveCompra = async () => {
    if (!compraForm.proveedorId || !compraForm.producto.trim() || !compraForm.fecha) {
      alert('Completa proveedor, monto total, producto y fecha');
      return;
    }

    // Validate monto based on mode
    if (compraForm.modoPrecio === 'bs') {
      if (!compraForm.montoTotalBs) {
        alert('Completa el monto en Bs');
        return;
      }
    } else {
      if (!compraForm.montoTotal) {
        alert('Completa el monto total');
        return;
      }
    }

    setIsSavingCompra(true);
    try {
      const method = editingCompra ? 'PUT' : 'POST';
      const url = editingCompra
        ? `/api/pagos-proveedores/compras/${editingCompra.id}`
        : '/api/pagos-proveedores/compras';

      const payload: Record<string, unknown> = {
        ...compraForm,
        removeNotaEntrega,
        modoPrecio: compraForm.modoPrecio,
      };

      if (compraForm.modoPrecio === 'bs') {
        payload.montoTotalBs = compraForm.montoTotalBs;
        payload.tasaReferencia = compraForm.tasaReferencia;
        payload.tasaReferenciaParalela = compraForm.tasaReferenciaParalela || null;
      }

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
    setTasaBcvInput(tasaBcv ? String(tasaBcv) : '');
    setTasaParalela('');

    if (abono) {
      setEditingAbono(abono);
      setAbonoFecha(abono.fecha);
      if (abono.tasaCambio) setTasaBcvInput(String(abono.tasaCambio));
      if (abono.tasaParalela) setTasaParalela(String(abono.tasaParalela));
      setLineas([lineaVacia({
        modo: abono.montoBs ? 'bs' : 'usd',
        montoUsd: String(abono.montoUsd),
        montoBs: abono.montoBs ? String(abono.montoBs) : '',
        metodoPago: abono.metodoPago,
        cuenta: abono.cuenta,
        notas: abono.notas || '',
        imagenPreview: abono.imagenUrl,
      })]);
    } else {
      setEditingAbono(null);
      setAbonoFecha(new Date().toISOString().split('T')[0]);
      // Las compras a paralelo se pagan en bolívares: arrancan en ese modo
      const enBs = compra.modoPrecio === 'paralelo';
      setLineas([lineaVacia({
        modo: enBs ? 'bs' : 'usd',
        montoUsd: !enBs && compra.saldoPendiente > 0 ? compra.saldoPendiente.toFixed(2) : '',
      })]);
    }
    setRemoveExistingImage(false);
    setShowAbonoModal(true);
  };

  // ── Líneas de la tanda ────────────────────────────────

  const cambiarLinea = (uid: number, cambios: Partial<LineaAbono>) =>
    setLineas(prev => prev.map(l => (l.uid === uid ? { ...l, ...cambios } : l)));

  /** Nunca deja la tanda sin líneas: sin ninguna no habría nada que rellenar */
  const quitarLinea = (uid: number) =>
    setLineas(prev => (prev.length > 1 ? prev.filter(l => l.uid !== uid) : prev));

  const anadirLinea = () =>
    setLineas(prev => {
      if (prev.length >= MAX_LINEAS) return prev;
      const ultima = prev[prev.length - 1];
      /* Hereda método y moneda de la anterior: cuando se reparte un pago, eso
         suele repetirse y lo que cambia es la cuenta. */
      return [...prev, lineaVacia({ metodoPago: ultima?.metodoPago, modo: ultima?.modo })];
    });

  const seleccionarImagen = (uid: number, file: File | null) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('La imagen es demasiado grande. Maximo 5MB.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () =>
      cambiarLinea(uid, { imagenFile: file, imagenPreview: reader.result as string });
    reader.readAsDataURL(file);
  };

  /** Sube un comprobante. Devuelve si llegó. */
  const subirComprobante = async (abonoId: number, file: File): Promise<boolean> => {
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('abonoId', String(abonoId));
      const res = await fetch('/api/pagos-proveedores/upload-imagen', { method: 'POST', body: formData });
      const data = await res.json();
      return Boolean(data.success);
    } catch {
      return false;
    }
  };

  const cuerpoDeLinea = (linea: LineaAbono, tasa: number) => ({
    montoUsd: usdDeLinea(linea, tasa).toFixed(2),
    fecha: abonoFecha,
    metodoPago: linea.metodoPago,
    cuenta: linea.cuenta,
    notas: linea.notas,
    montoBs: linea.modo === 'bs' ? Number(linea.montoBs) || null : null,
    tasaCambio: linea.modo === 'bs' && tasaBcvInput ? Number(tasaBcvInput) : null,
    tasaParalela: linea.modo === 'bs' && tasaParalela ? Number(tasaParalela) : null,
  });

  const handleSaveAbono = async () => {
    if (!abonoTargetCompra || !abonoFecha) {
      alert('Completa la fecha');
      return;
    }

    const tasa = tasaQueManda(abonoTargetCompra, tasaBcvInput, tasaParalela);

    if (lineas.some(l => l.modo === 'bs') && !tasa) {
      alert(abonoTargetCompra.modoPrecio === 'paralelo'
        ? 'Falta la tasa paralela: es la que convierte los bolívares en esta compra'
        : 'Falta la tasa BCV para convertir los bolívares');
      return;
    }

    const conMonto = lineas.filter(l => usdDeLinea(l, tasa) !== 0);

    if (conMonto.length === 0) {
      alert('Ningún pago tiene monto');
      return;
    }

    /* Una línea sin monto se descarta sola, pero si trae comprobante adjunto
       hay que avisar: perder el soporte de un pago en silencio es lo peor que
       puede hacer este formulario. */
    if (lineas.some(l => usdDeLinea(l, tasa) === 0 && l.imagenFile)) {
      alert('Hay un comprobante adjunto en un pago sin monto');
      return;
    }

    setIsSavingAbono(true);
    try {
      const base = `/api/pagos-proveedores/compras/${abonoTargetCompra.id}/abonos`;
      let pendientesDeImagen: [number, File][] = [];

      if (editingAbono) {
        const linea = conMonto[0];
        const res = await fetch(`${base}/${editingAbono.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...cuerpoDeLinea(linea, tasa), removeImage: removeExistingImage }),
        });
        const data = await res.json();
        if (!data.success) {
          alert(data.error || 'Error al guardar');
          return;
        }
        if (linea.imagenFile) pendientesDeImagen = [[editingAbono.id, linea.imagenFile]];
      } else {
        const res = await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ abonos: conMonto.map(l => cuerpoDeLinea(l, tasa)) }),
        });
        const data = await res.json();
        if (!data.success) {
          alert(data.error || 'Error al guardar');
          return;
        }
        const ids: number[] = data.ids || [];
        pendientesDeImagen = conMonto
          .map((l, i): [number, File] | null => (l.imagenFile && ids[i] ? [ids[i], l.imagenFile] : null))
          .filter((p): p is [number, File] => p !== null);
      }

      const subidas = await Promise.all(pendientesDeImagen.map(([id, file]) => subirComprobante(id, file)));
      const fallaron = subidas.filter(ok => !ok).length;

      /* Los abonos ya están guardados: que falle una imagen no los deshace,
         pero callarlo dejaría un pago sin soporte sin que nadie se entere. */
      if (fallaron > 0) {
        alert(fallaron === 1
          ? 'Se guardaron los pagos, pero un comprobante no subió. Adjúntalo editando ese abono.'
          : `Se guardaron los pagos, pero ${fallaron} comprobantes no subieron. Adjúntalos editando esos abonos.`);
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

  // ── Merge handlers ────────────────────────────────────

  const toggleCompraSelection = (id: number) => {
    setSelectedCompraIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMerge = async () => {
    if (!mergeTargetId || selectedCompraIds.size < 2) return;
    setIsMerging(true);
    try {
      const sourceIds = [...selectedCompraIds].filter(id => id !== mergeTargetId);
      const res = await fetch('/api/pagos-proveedores/compras/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceIds, targetId: mergeTargetId }),
      });
      const data = await res.json();
      if (data.success) {
        setShowMergeModal(false);
        setMergeMode(false);
        setSelectedCompraIds(new Set());
        setMergeTargetId(null);
        setExpandedCompraId(null);
        // Force full reload to update all totals
        setIsLoading(true);
        await Promise.all([loadCompras(), loadResumen()]);
        setIsLoading(false);
      } else {
        alert(data.error || 'Error al fusionar');
      }
    } catch {
      alert('Error de conexion');
    } finally {
      setIsMerging(false);
    }
  };

  // ── Quick nota upload handler ─────────────────────────

  const handleQuickNotaUpload = async (compraId: number, file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      alert('El archivo es demasiado grande. Maximo 10MB.');
      return;
    }
    setUploadingNotaCompraId(compraId);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('compraId', String(compraId));
      const res = await fetch('/api/pagos-proveedores/upload-nota-entrega', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        await loadCompras();
      } else {
        alert(data.error || 'Error al subir nota');
      }
    } catch {
      alert('Error de conexion');
    } finally {
      setUploadingNotaCompraId(null);
    }
  };

  // ── Pagada manual ────────────────────────────────────

  const [showPagadaModal, setShowPagadaModal] = useState(false);
  const [pagadaTargetCompra, setPagadaTargetCompra] = useState<CompraProveedor | null>(null);
  const [pagadaNotaInput, setPagadaNotaInput] = useState('');

  const openPagadaModal = (compra: CompraProveedor) => {
    setPagadaTargetCompra(compra);
    setPagadaNotaInput('');
    setShowPagadaModal(true);
  };

  const handleMarcarPagada = async () => {
    if (!pagadaTargetCompra) return;
    try {
      const res = await fetch(`/api/pagos-proveedores/compras/${pagadaTargetCompra.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pagadaManual: true, notaPagada: pagadaNotaInput.trim() || null }),
      });
      const data = await res.json();
      if (data.success) {
        setShowPagadaModal(false);
        await Promise.all([loadCompras(), loadResumen()]);
      }
    } catch {
      alert('Error de conexion');
    }
  };

  const handleDesmarcarPagada = async (compra: CompraProveedor) => {
    try {
      const res = await fetch(`/api/pagos-proveedores/compras/${compra.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pagadaManual: false, notaPagada: null }),
      });
      const data = await res.json();
      if (data.success) {
        await Promise.all([loadCompras(), loadResumen()]);
      }
    } catch {
      alert('Error de conexion');
    }
  };

  // ── Trasladar saldo a favor ──────────────────────────

  const openTrasladarModal = async (compra: CompraProveedor) => {
    setTrasladarSource(compra);
    setTrasladarMonto(Math.abs(compra.saldoPendiente).toFixed(2));
    setTrasladarTargetId(null);
    setIsTrasladando(false);
    // Cargar todas las compras del mismo proveedor (sin filtro de mes)
    try {
      const params = new URLSearchParams({ proveedor_id: String(compra.proveedorId), estado: 'pendiente' });
      const res = await fetch(`/api/pagos-proveedores/compras?${params}`);
      const data = await res.json();
      if (data.success) {
        setTrasladarTargets((data.compras as CompraProveedor[]).filter(c => c.id !== compra.id && c.saldoPendiente > 0 && !c.pagadaManual));
      }
    } catch {
      setTrasladarTargets([]);
    }
  };

  const handleTrasladarSaldo = async () => {
    if (!trasladarSource || !trasladarTargetId || !trasladarMonto) return;
    const monto = parseFloat(trasladarMonto);
    if (isNaN(monto) || monto <= 0) { alert('Monto inválido'); return; }
    const saldoDisponible = Math.abs(trasladarSource.saldoPendiente);
    if (monto > saldoDisponible + 0.01) { alert(`Máximo disponible: ${formatUSD(saldoDisponible)}`); return; }

    setIsTrasladando(true);
    try {
      // 1. Abono negativo en compra origen (reduce saldo a favor)
      const resOrigen = await fetch(`/api/pagos-proveedores/compras/${trasladarSource.id}/abonos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          montoUsd: String(-monto),
          fecha: new Date().toISOString().split('T')[0],
          metodoPago: 'transferencia',
          cuenta: 'pa',
          notas: `Saldo trasladado a compra #${trasladarTargetId}`,
        }),
      });
      const dataOrigen = await resOrigen.json();
      if (!dataOrigen.success) throw new Error(dataOrigen.error || 'Error al ajustar origen');

      // 2. Abono positivo en compra destino
      const resDestino = await fetch(`/api/pagos-proveedores/compras/${trasladarTargetId}/abonos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          montoUsd: String(monto),
          fecha: new Date().toISOString().split('T')[0],
          metodoPago: 'transferencia',
          cuenta: 'pa',
          notas: `Saldo a favor de compra #${trasladarSource.id}`,
        }),
      });
      const dataDestino = await resDestino.json();
      if (!dataDestino.success) throw new Error(dataDestino.error || 'Error al abonar destino');

      setTrasladarSource(null);
      await Promise.all([loadCompras(), loadResumen()]);
    } catch (err: any) {
      alert(err.message || 'Error al trasladar saldo');
    } finally {
      setIsTrasladando(false);
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
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-ocean-900">{formatMonthLabel(mesSeleccionado)}</h2>
            {pendientesCount > 0 && (
              <button
                onClick={() => setShowPendientes(prev => !prev)}
                className="relative p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                title={`${pendientesCount} pendiente${pendientesCount !== 1 ? 's' : ''} de meses anteriores`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-red-500">
                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {pendientesCount}
                </span>
              </button>
            )}
          </div>
          <button
            onClick={() => setMesSeleccionado(prev => shiftMonth(prev, 1))}
            className="p-2 hover:bg-ocean-50 rounded-lg text-ocean-600"
          >
            &rarr;
          </button>
        </div>

        {/* Panel de pendientes anteriores */}
        {showPendientes && pendientesList.length > 0 && (
          <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-xs font-bold text-red-700 mb-2">Pendientes de meses anteriores</p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {pendientesList.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setMesSeleccionado(p.mes); setShowPendientes(false); }}
                  className="w-full flex items-center justify-between bg-white rounded-lg px-3 py-2 text-left hover:bg-red-100 transition-colors"
                >
                  <div>
                    <span className="text-sm font-medium text-ocean-800">{p.proveedor}</span>
                    <span className="text-xs text-ocean-400 ml-1.5">— {p.producto}</span>
                    <p className="text-[10px] text-ocean-400">{formatMonthLabel(p.mes)}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-red-600">{formatUSD(p.saldoPendiente)}</span>
                    <p className="text-[10px] text-ocean-400">de {formatUSD(p.montoTotal)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Total principal */}
        {(() => {
          const hasFilters = facturaFilter || cuentaFilter || proveedorFilter || searchTerm || estadoFilter || modoPrecioFilter;
          const filteredTotal = hasFilters
            ? compras.reduce((sum, c) => sum + c.totalAbonado, 0)
            : resumen?.totalUsd || 0;
          const filteredCount = hasFilters
            ? compras.reduce((sum, c) => sum + c.abonos.length, 0)
            : resumen?.cantidadTotal || 0;

          const filterParts: string[] = [];
          if (facturaFilter === '0') filterParts.push('sin factura');
          if (facturaFilter === '1') filterParts.push('con factura');
          if (cuentaFilter) filterParts.push(CUENTA_LABELS[cuentaFilter]);
          if (estadoFilter === 'pendiente') filterParts.push('pendientes');
          if (estadoFilter === 'pagada') filterParts.push('pagadas');
          if (proveedorFilter) {
            const prov = resumen?.porProveedor.find(p => p.proveedorId === proveedorFilter);
            if (prov) filterParts.push(prov.proveedorNombre);
          }
          if (searchTerm) filterParts.push(`"${searchTerm}"`);
          if (modoPrecioFilter) filterParts.push(MODO_PRECIO_LABELS[modoPrecioFilter]);

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
        {resumen && resumen.totalUsd > 0 && !facturaFilter && !cuentaFilter && !proveedorFilter && !searchTerm && !estadoFilter && !modoPrecioFilter && (
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
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs mt-1.5 text-ocean-500">
              <span>Cuenta PA: {formatUSD(resumen.totalCuentaPa)}</span>
              <span>Cuenta Carlos: {formatUSD(resumen.totalCuentaCarlos)}</span>
              <span>Cuenta Vzla: {formatUSD(resumen.totalCuentaVenezuela)}</span>
              {/* Solo cuando hubo: los meses sin Zelle se ven como siempre */}
              {resumen.totalCuentaZelle > 0 && (
                <span className="text-emerald-600 font-medium">Zelle: {formatUSD(resumen.totalCuentaZelle)}</span>
              )}
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

          {(Object.entries(CUENTA_LABELS) as [CuentaPago, string][]).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setCuentaFilter(c => c === val ? '' : val)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                cuentaFilter === val
                  ? 'bg-ocean-600 text-white'
                  : 'bg-ocean-50 text-ocean-700 hover:bg-ocean-100'
              }`}
            >
              {label}
            </button>
          ))}

          <span className="w-px bg-ocean-200 mx-1" />

          <button
            onClick={() => setModoPrecioFilter(m => m === 'bcv' ? '' : 'bcv')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              modoPrecioFilter === 'bcv'
                ? 'bg-violet-600 text-white'
                : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
            }`}
          >
            BCV
          </button>
          <button
            onClick={() => setModoPrecioFilter(m => m === 'paralelo' ? '' : 'paralelo')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              modoPrecioFilter === 'paralelo'
                ? 'bg-violet-600 text-white'
                : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
            }`}
          >
            Paralelo
          </button>
          <button
            onClick={() => setModoPrecioFilter(m => m === 'bs' ? '' : 'bs')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              modoPrecioFilter === 'bs'
                ? 'bg-violet-600 text-white'
                : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
            }`}
          >
            Bs
          </button>
          <button
            onClick={() => setModoPrecioFilter(m => m === 'efectivo_usd' ? '' : 'efectivo_usd')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              modoPrecioFilter === 'efectivo_usd'
                ? 'bg-violet-600 text-white'
                : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
            }`}
          >
            Efectivo USD
          </button>

          {(facturaFilter || cuentaFilter || searchTerm || proveedorFilter || estadoFilter || modoPrecioFilter) && (
            <>
              <span className="w-px bg-ocean-200 mx-1" />
              <button
                onClick={() => {
                  setFacturaFilter('');
                  setCuentaFilter('');
                  setEstadoFilter('');
                  setSearchTerm('');
                  setProveedorFilter(null);
                  setModoPrecioFilter('');
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
          <button
            onClick={() => {
              if (mergeMode) {
                setMergeMode(false);
                setSelectedCompraIds(new Set());
              } else {
                setMergeMode(true);
              }
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              mergeMode
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            {mergeMode ? 'Cancelar Fusion' : 'Fusionar'}
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
            const isPagada = estaPagada(compra);
            const isSaldoFavor = tieneSaldoAFavor(compra);

            return (
              <div key={compra.id} className="bg-white rounded-xl shadow-sm border border-ocean-100 overflow-hidden">
                {/* Compra header */}
                <div
                  className="p-4 cursor-pointer hover:bg-ocean-50/50"
                  onClick={() => {
                    if (mergeMode) {
                      toggleCompraSelection(compra.id);
                    } else {
                      setExpandedCompraId(isExpanded ? null : compra.id);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    {mergeMode && (
                      <div className="flex items-center pt-1 shrink-0">
                        <input
                          type="checkbox"
                          checked={selectedCompraIds.has(compra.id)}
                          onChange={() => toggleCompraSelection(compra.id)}
                          onClick={e => e.stopPropagation()}
                          className="w-5 h-5 rounded border-ocean-300 text-amber-500 focus:ring-amber-400"
                        />
                      </div>
                    )}
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
                      <div className="flex items-center gap-1.5 justify-end">
                        <span className="font-bold text-ocean-900">{formatUSD(compra.montoTotal)}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-100 text-violet-700 font-medium">
                          {MODO_PRECIO_SHORT[compra.modoPrecio]}
                        </span>
                      </div>
                      {compra.modoPrecio === 'bs' && compra.montoTotalBs && (
                        <span className="text-xs text-ocean-400">{formatBs(compra.montoTotalBs)}</span>
                      )}
                      {compra.montoTotalUsdParalelo != null && (
                        <span className="text-xs text-ocean-400">~{formatUSD(compra.montoTotalUsdParalelo)} paral.</span>
                      )}
                      {isSaldoFavor ? (
                        <span className="text-xs text-blue-600 font-medium">
                          A favor: {formatUSD(Math.abs(compra.saldoPendiente))}
                        </span>
                      ) : isPagada ? (
                        <>
                          <span className="text-xs text-emerald-600 font-medium">
                            Pagada{compra.pagadaManual && compra.saldoPendiente > 0 ? ' (manual)' : ''}
                          </span>
                          {compra.pagadaManual && compra.notaPagada && (
                            <span className="block text-[10px] text-ocean-400 mt-0.5">{compra.notaPagada}</span>
                          )}
                        </>
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
                        className={`h-full rounded-full transition-all ${isSaldoFavor ? 'bg-blue-500' : isPagada ? 'bg-emerald-500' : 'bg-amber-400'}`}
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
                      {!compra.pagadaManual && (
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

                      {/* Marcar como pagada */}
                      {sigueDebiendo(compra) && (
                        <button
                          onClick={() => openPagadaModal(compra)}
                          className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-100"
                        >
                          Marcar como pagada
                        </button>
                      )}
                      {compra.pagadaManual && (
                        <button
                          onClick={() => handleDesmarcarPagada(compra)}
                          className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-200"
                        >
                          Desmarcar pagada
                        </button>
                      )}

                      {/* Trasladar saldo a favor */}
                      {isSaldoFavor && (
                        <button
                          onClick={() => openTrasladarModal(compra)}
                          className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100"
                        >
                          Trasladar saldo
                        </button>
                      )}

                      {/* Quick nota upload */}
                      {!compra.notaEntregaUrl ? (
                        <>
                          <button
                            onClick={() => {
                              if (notaUploadRef.current) {
                                notaUploadRef.current.dataset.compraId = String(compra.id);
                                notaUploadRef.current.click();
                              }
                            }}
                            disabled={uploadingNotaCompraId === compra.id}
                            className="px-3 py-1.5 bg-violet-50 text-violet-700 rounded-lg text-xs font-medium hover:bg-violet-100 disabled:opacity-50"
                          >
                            {uploadingNotaCompraId === compra.id ? 'Subiendo...' : 'Adjuntar Nota/Factura'}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setImagenAmpliada(compra.notaEntregaUrl)}
                            className="px-3 py-1.5 bg-violet-50 text-violet-700 rounded-lg text-xs font-medium hover:bg-violet-100"
                          >
                            Ver Nota
                          </button>
                          <button
                            onClick={() => {
                              if (notaUploadRef.current) {
                                notaUploadRef.current.dataset.compraId = String(compra.id);
                                notaUploadRef.current.click();
                              }
                            }}
                            disabled={uploadingNotaCompraId === compra.id}
                            className="px-3 py-1.5 bg-violet-50 text-violet-600 rounded-lg text-xs font-medium hover:bg-violet-100 disabled:opacity-50"
                          >
                            {uploadingNotaCompraId === compra.id ? 'Subiendo...' : 'Cambiar Nota'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Hidden file input for quick nota uploads */}
      <input
        ref={notaUploadRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const compraId = notaUploadRef.current?.dataset.compraId;
          if (file && compraId) {
            handleQuickNotaUpload(Number(compraId), file);
          }
          e.target.value = '';
        }}
      />

      {/* ── Merge floating bar ────────────────────────────── */}
      {mergeMode && selectedCompraIds.size >= 2 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-ocean-200 shadow-lg p-4 z-40">
          <div className="max-w-lg mx-auto flex items-center justify-between">
            <span className="text-sm text-ocean-700 font-medium">
              {selectedCompraIds.size} compras seleccionadas
            </span>
            <button
              onClick={() => { setMergeTargetId(null); setShowMergeModal(true); }}
              className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600"
            >
              Fusionar en...
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: Merge ──────────────────────────────────── */}
      {showMergeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
            <div className="px-6 py-4 border-b border-ocean-100">
              <h3 className="text-lg font-semibold text-ocean-900">Fusionar compras</h3>
              <p className="text-sm text-ocean-500 mt-1">
                Selecciona la compra destino. Los abonos de las demas se moveran a esta.
              </p>
            </div>
            <div className="p-6 space-y-2 max-h-[50vh] overflow-y-auto">
              {compras
                .filter(c => selectedCompraIds.has(c.id))
                .map(c => (
                  <label
                    key={c.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      mergeTargetId === c.id
                        ? 'border-amber-400 bg-amber-50'
                        : 'border-ocean-200 hover:bg-ocean-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="mergeTarget"
                      checked={mergeTargetId === c.id}
                      onChange={() => setMergeTargetId(c.id)}
                      className="w-4 h-4 text-amber-500 focus:ring-amber-400"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ocean-900">{c.proveedorNombre}</div>
                      <div className="text-xs text-ocean-500">
                        {c.producto} — {formatUSD(c.montoTotal)} — {c.abonos.length} abono{c.abonos.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </label>
                ))}
            </div>
            <div className="px-6 py-4 border-t border-ocean-100 flex gap-3 justify-end">
              <button
                onClick={() => setShowMergeModal(false)}
                className="px-4 py-2 text-sm text-ocean-600 hover:bg-ocean-50 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleMerge}
                disabled={!mergeTargetId || isMerging}
                className="px-6 py-2 text-sm bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 disabled:opacity-50"
              >
                {isMerging ? 'Fusionando...' : 'Confirmar Fusion'}
              </button>
            </div>
          </div>
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

              {/* Modo precio */}
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Modo de precio</label>
                <div className="flex flex-wrap gap-2">
                  {(Object.entries(MODO_PRECIO_LABELS) as [ModoPrecioCompra, string][]).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setCompraForm(prev => ({ ...prev, modoPrecio: val }))}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        compraForm.modoPrecio === val
                          ? 'bg-ocean-600 text-white'
                          : 'bg-ocean-50 text-ocean-700 hover:bg-ocean-100'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Monto total — conditional based on modoPrecio */}
              {compraForm.modoPrecio === 'bs' ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-ocean-700 mb-1">Monto en Bs</label>
                    <input
                      type="number"
                      step="0.01"
                      value={compraForm.montoTotalBs}
                      onChange={e => {
                        const bs = e.target.value;
                        setCompraForm(prev => {
                          const updated = { ...prev, montoTotalBs: bs };
                          // Auto-calculate USD equivalent if we have a reference rate
                          if (prev.tasaReferencia && Number(bs) && Number(prev.tasaReferencia)) {
                            updated.montoTotal = (Number(bs) / Number(prev.tasaReferencia)).toFixed(2);
                          }
                          return updated;
                        });
                      }}
                      placeholder="0.00"
                      className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-ocean-700 mb-1">Tasa BCV</label>
                      <input
                        type="number"
                        step="0.01"
                        value={compraForm.tasaReferencia}
                        onChange={e => {
                          const tasa = e.target.value;
                          setCompraForm(prev => {
                            const updated = { ...prev, tasaReferencia: tasa };
                            if (Number(prev.montoTotalBs) && Number(tasa)) {
                              updated.montoTotal = (Number(prev.montoTotalBs) / Number(tasa)).toFixed(2);
                            }
                            return updated;
                          });
                        }}
                        placeholder={tasaBcv ? `${tasaBcv.toFixed(2)}` : 'Ej: 80.00'}
                        className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-ocean-700 mb-1">Tasa Paralelo</label>
                      <input
                        type="number"
                        step="0.01"
                        value={compraForm.tasaReferenciaParalela}
                        onChange={e => setCompraForm(prev => ({ ...prev, tasaReferenciaParalela: e.target.value }))}
                        placeholder="Opcional"
                        className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                  {compraForm.montoTotalBs && Number(compraForm.montoTotalBs) > 0 && (compraForm.tasaReferencia || compraForm.tasaReferenciaParalela) && (
                    <div className="bg-ocean-50 rounded-lg p-3 text-sm space-y-1">
                      {compraForm.tasaReferencia && Number(compraForm.tasaReferencia) > 0 && (
                        <div className="flex justify-between text-ocean-700 font-medium">
                          <span>BCV ({Number(compraForm.tasaReferencia).toFixed(2)})</span>
                          <span className="text-ocean-900">
                            {formatUSD(Number(compraForm.montoTotalBs) / Number(compraForm.tasaReferencia))}
                          </span>
                        </div>
                      )}
                      {compraForm.tasaReferenciaParalela && Number(compraForm.tasaReferenciaParalela) > 0 && (
                        <div className="flex justify-between text-ocean-500">
                          <span>Paralelo ({Number(compraForm.tasaReferenciaParalela).toFixed(2)})</span>
                          <span>
                            {formatUSD(Number(compraForm.montoTotalBs) / Number(compraForm.tasaReferenciaParalela))}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
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
              )}

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
      {showAbonoModal && abonoTargetCompra && (() => {
        const esParalelo = abonoTargetCompra.modoPrecio === 'paralelo';
        const tasa = tasaQueManda(abonoTargetCompra, tasaBcvInput, tasaParalela);
        const hayBs = lineas.some(l => l.modo === 'bs');
        const totalTanda = lineas.reduce((sum, l) => sum + usdDeLinea(l, tasa), 0);
        // Redondeado al centavo, igual que el saldo que llega del servidor
        const restante = Math.round((abonoTargetCompra.saldoPendiente - totalTanda) * 100) / 100;
        const sinNada = lineas.every(l => !l.montoUsd && !l.montoBs);

        return (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-lg my-8 shadow-xl">
            <div className="px-6 py-4 border-b border-ocean-100">
              <h3 className="text-lg font-semibold text-ocean-900">
                {editingAbono
                  ? 'Editar Abono'
                  : lineas.length > 1
                    ? `Agregar ${lineas.length} Pagos`
                    : 'Agregar Abono'}
              </h3>
              <div className="mt-1 text-sm text-ocean-500">
                {abonoTargetCompra.proveedorNombre} — {abonoTargetCompra.producto}
                <span className="ml-2 font-medium text-ocean-700">
                  Total: {formatUSD(abonoTargetCompra.montoTotal)}
                </span>
                {sigueDebiendo(abonoTargetCompra) && (
                  <span className="ml-2 text-amber-600">
                    Pendiente: {formatUSD(abonoTargetCompra.saldoPendiente)}
                  </span>
                )}
                {tieneSaldoAFavor(abonoTargetCompra) && (
                  <span className="ml-2 text-blue-600 font-medium">
                    Saldo a favor: {formatUSD(Math.abs(abonoTargetCompra.saldoPendiente))}
                  </span>
                )}
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* Fecha — la misma para toda la tanda */}
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Fecha</label>
                <input
                  type="date"
                  value={abonoFecha}
                  onChange={e => setAbonoFecha(e.target.value)}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                />
                {lineas.length > 1 && (
                  <p className="mt-1 text-xs text-ocean-400">La misma para los {lineas.length} pagos</p>
                )}
              </div>

              {/* Tasas del día — solo si algún pago va en bolívares */}
              {hayBs && (
                <div>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <label className="text-sm font-medium text-ocean-700">Tasas del día</label>
                    {esParalelo && (
                      <span className="text-[11px] text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5">
                        Compra a paralelo: convierte la paralela
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-ocean-500 mb-1">
                        Tasa BCV{esParalelo ? ' (ref.)' : ''}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={tasaBcvInput}
                        onChange={e => setTasaBcvInput(e.target.value)}
                        placeholder={tasaBcv ? `Auto: ${tasaBcv.toFixed(2)}` : 'Ej: 80.00'}
                        className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-ocean-500 mb-1">
                        Tasa Paralelo{esParalelo ? '' : ' (ref.)'}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={tasaParalela}
                        onChange={e => setTasaParalela(e.target.value)}
                        placeholder={esParalelo ? 'Requerido' : 'Opcional'}
                        className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Un bloque por pago */}
              <div className="space-y-3">
                {lineas.map((linea, i) => {
                  const enDivisas = esCuentaEnDivisas(linea.cuenta);
                  const usd = usdDeLinea(linea, tasa);

                  return (
                    <div key={linea.uid} className="border border-ocean-200 rounded-xl p-3 space-y-3">
                      {lineas.length > 1 && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-ocean-500">Pago {i + 1}</span>
                          <button
                            type="button"
                            onClick={() => quitarLinea(linea.uid)}
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            Quitar
                          </button>
                        </div>
                      )}

                      {/* Monto y en qué moneda */}
                      <div className="flex gap-2">
                        <input
                          type="number"
                          step="0.01"
                          value={linea.modo === 'usd' ? linea.montoUsd : linea.montoBs}
                          onChange={e => cambiarLinea(linea.uid, linea.modo === 'usd'
                            ? { montoUsd: e.target.value }
                            : { montoBs: e.target.value })}
                          placeholder={linea.modo === 'usd' ? '0.00' : 'Monto en Bs'}
                          className="flex-1 min-w-0 px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                        />
                        {/* Zelle son dólares: ahí no hay nada que elegir */}
                        {!enDivisas && (
                          <div className="flex bg-ocean-100 rounded-lg p-0.5 text-xs shrink-0">
                            {(['usd', 'bs'] as const).map(m => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => cambiarLinea(linea.uid, { modo: m })}
                                className={`px-3 py-1 rounded-md transition-colors ${
                                  linea.modo === m ? 'bg-white text-ocean-900 shadow-sm font-medium' : 'text-ocean-600'
                                }`}
                              >
                                {m === 'usd' ? 'USD' : 'Bs'}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {linea.modo === 'bs' && usd > 0 && (
                        <p className="text-xs text-ocean-500">
                          ≈ <span className="font-medium text-ocean-800">{formatUSD(usd)}</span>
                          {' '}a {esParalelo ? 'paralelo' : 'BCV'} {tasa.toFixed(2)}
                        </p>
                      )}

                      {/* De dónde salió */}
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={linea.metodoPago}
                          onChange={e => cambiarLinea(linea.uid, { metodoPago: e.target.value as MetodoPago })}
                          className="w-full px-2 py-2 border border-ocean-200 rounded-lg text-sm"
                        >
                          {(Object.entries(METODO_PAGO_LABELS) as [MetodoPago, string][]).map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                        </select>
                        <select
                          value={linea.cuenta}
                          onChange={e => {
                            const cuenta = e.target.value as CuentaPago;
                            /* Al pasar a Zelle el monto vuelve a dólares y los
                               bolívares escritos se van: no se convierte nada. */
                            cambiarLinea(linea.uid, esCuentaEnDivisas(cuenta)
                              ? { cuenta, modo: 'usd', montoBs: '' }
                              : { cuenta });
                          }}
                          className="w-full px-2 py-2 border border-ocean-200 rounded-lg text-sm"
                        >
                          {(Object.entries(CUENTA_LABELS) as [CuentaPago, string][]).map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                        </select>
                      </div>

                      <input
                        type="text"
                        value={linea.notas}
                        onChange={e => cambiarLinea(linea.uid, { notas: e.target.value })}
                        placeholder="Nota (opcional)"
                        className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm"
                      />

                      {/* Su propio comprobante */}
                      <div>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={e => {
                            seleccionarImagen(linea.uid, e.target.files?.[0] ?? null);
                            e.target.value = '';
                          }}
                          className="w-full text-xs text-ocean-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-ocean-50 file:text-ocean-700 hover:file:bg-ocean-100"
                        />
                        {linea.imagenPreview && (
                          <div className="mt-2 relative inline-block">
                            <img
                              src={linea.imagenPreview}
                              alt="Comprobante"
                              className="max-h-28 rounded-lg border border-ocean-200 cursor-pointer"
                              onClick={() => setImagenAmpliada(linea.imagenPreview)}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (linea.imagenFile) {
                                  // Quita solo lo recién elegido; lo ya guardado sigue
                                  cambiarLinea(linea.uid, {
                                    imagenFile: null,
                                    imagenPreview: editingAbono?.imagenUrl || null,
                                  });
                                } else {
                                  setRemoveExistingImage(true);
                                  cambiarLinea(linea.uid, { imagenPreview: null });
                                }
                              }}
                              className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow text-xs hover:bg-red-600"
                            >
                              &times;
                            </button>
                          </div>
                        )}
                        {editingAbono && removeExistingImage && (
                          <p className="mt-2 text-xs text-orange-600">
                            El comprobante se eliminara al guardar.{' '}
                            <button
                              type="button"
                              onClick={() => {
                                setRemoveExistingImage(false);
                                cambiarLinea(linea.uid, { imagenPreview: editingAbono.imagenUrl });
                              }}
                              className="underline hover:text-orange-800"
                            >
                              Deshacer
                            </button>
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Editar es de a uno: ahí no se añaden pagos */}
              {!editingAbono && (
                <button
                  type="button"
                  onClick={anadirLinea}
                  disabled={lineas.length >= MAX_LINEAS}
                  className="w-full py-2 border-2 border-dashed border-ocean-200 rounded-xl text-sm font-medium text-ocean-600 hover:border-ocean-300 hover:bg-ocean-50 disabled:opacity-50"
                >
                  + Otro pago
                </button>
              )}

              {lineas.length > 1 && (
                <div className="bg-ocean-50 rounded-lg p-3 text-sm space-y-1">
                  <div className="flex justify-between font-medium text-ocean-800">
                    <span>Total de los {lineas.length} pagos</span>
                    <span>{formatUSD(totalTanda)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-ocean-500">
                      {restante < 0 ? 'Quedaria a favor' : 'Quedaria pendiente'}
                    </span>
                    <span className={restante < 0 ? 'text-blue-600 font-medium' : 'text-ocean-500'}>
                      {formatUSD(Math.abs(restante))}
                    </span>
                  </div>
                </div>
              )}
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
                disabled={isSavingAbono || sinNada}
                className="px-6 py-2 text-sm bg-ocean-600 text-white rounded-lg font-medium hover:bg-ocean-700 disabled:opacity-50"
              >
                {isSavingAbono
                  ? 'Guardando...'
                  : editingAbono
                    ? 'Actualizar'
                    : lineas.length > 1
                      ? `Registrar ${lineas.length} pagos`
                      : 'Registrar Abono'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

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

      {/* ── Modal: Marcar como pagada ────────────────────── */}
      {showPagadaModal && pagadaTargetCompra && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-xl">
            <div className="px-6 py-4 border-b border-ocean-100">
              <h3 className="text-lg font-semibold text-ocean-900">Marcar como pagada</h3>
              <p className="text-sm text-ocean-500 mt-1">
                {pagadaTargetCompra.proveedorNombre} — {formatUSD(pagadaTargetCompra.montoTotal)}
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                Diferencia: {formatUSD(pagadaTargetCompra.saldoPendiente)}
              </p>
            </div>
            <div className="p-6">
              <label className="block text-sm font-medium text-ocean-700 mb-1">
                Nota explicativa (opcional)
              </label>
              <textarea
                value={pagadaNotaInput}
                onChange={e => setPagadaNotaInput(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm resize-none"
                placeholder="Ej: Retención ISLR 2%, diferencia de centavos..."
                autoFocus
              />
            </div>
            <div className="px-6 py-4 border-t border-ocean-100 flex gap-3 justify-end">
              <button
                onClick={() => setShowPagadaModal(false)}
                className="px-4 py-2 text-sm text-ocean-600 hover:bg-ocean-50 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleMarcarPagada}
                className="px-6 py-2 text-sm bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700"
              >
                Marcar pagada
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
      {/* Modal trasladar saldo a favor */}
      {trasladarSource && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setTrasladarSource(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-blue-600 px-4 py-3 flex items-center justify-between">
              <span className="font-semibold text-white">Trasladar saldo a favor</span>
              <button onClick={() => setTrasladarSource(null)} className="text-white/80 hover:text-white p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-4">
              {/* Origen */}
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="text-xs text-blue-600 font-medium">Origen</p>
                <p className="text-sm font-semibold text-ocean-900">{trasladarSource.proveedorNombre} — {trasladarSource.producto}</p>
                <p className="text-xs text-ocean-500">{formatDateShort(trasladarSource.fecha)} · Compra #{trasladarSource.id}</p>
                <p className="text-sm font-bold text-blue-700 mt-1">Saldo a favor: {formatUSD(Math.abs(trasladarSource.saldoPendiente))}</p>
              </div>

              {/* Monto */}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1.5 block">Monto a trasladar</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={trasladarMonto}
                  onChange={e => setTrasladarMonto(e.target.value)}
                  className="w-full px-4 py-2.5 text-lg border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-center"
                />
              </div>

              {/* Destino */}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1.5 block">Aplicar a compra</label>
                {trasladarTargets.length === 0 ? (
                  <p className="text-sm text-ocean-400 italic">No hay compras pendientes de {trasladarSource.proveedorNombre}</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {trasladarTargets.map(c => (
                      <label
                        key={c.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                          trasladarTargetId === c.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-200'
                        }`}
                      >
                        <input
                          type="radio"
                          name="trasladar-target"
                          checked={trasladarTargetId === c.id}
                          onChange={() => setTrasladarTargetId(c.id)}
                          className="text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-ocean-900 truncate">{c.producto}</p>
                          <p className="text-xs text-ocean-400">{formatDateShort(c.fecha)} · #{c.id}</p>
                        </div>
                        <span className="text-xs font-semibold text-amber-600 shrink-0">
                          Pend: {formatUSD(c.saldoPendiente)}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Botón */}
              <button
                onClick={handleTrasladarSaldo}
                disabled={isTrasladando || !trasladarTargetId || !trasladarMonto}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold transition-colors hover:bg-blue-500 disabled:bg-blue-300 flex items-center justify-center gap-2"
              >
                {isTrasladando ? 'Trasladando...' : 'Trasladar saldo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
