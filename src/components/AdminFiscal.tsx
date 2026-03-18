/**
 * RPYM - Admin Fiscal Module
 * Gestión fiscal: Reportes Z, Proveedores, Facturas, Retenciones, Simulador, Consultas AI
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { formatUSD, formatBs, formatDateDMY, formatDateReadable } from '../lib/format';
import html2canvas from 'html2canvas';
import type {
  FiscalProveedor,
  FiscalFacturaCompra,
  FiscalReporteZ,
  FiscalRetencionIva,
  FiscalPagoSeniat,
  FiscalDashboardData,
  OcrZReportData,
  ProveedorFormData,
  FacturaFormData,
  ReporteZFormData,
  MarginSimulatorInput,
  MarginSimulatorResult,
  TipoPagoSeniat,
  ConceptoPago,
} from '../lib/fiscal-types';
import {
  FISCAL_CONSTANTS,
  CONCEPTO_LABELS,
  calculateRetentions,
  calculateMarginSimulation,
  validateRif,
  formatRif,
} from '../lib/fiscal-types';

type FiscalSubTab = 'dashboard' | 'reportes-z' | 'proveedores' | 'facturas' | 'retenciones' | 'pagos' | 'simulador' | 'consultas';

interface BCVRateData {
  rate: number;
  date: string;
  source?: string;
}

interface AdminFiscalProps {
  bcvRate?: BCVRateData;
}

const SUB_TAB_LABELS: Record<FiscalSubTab, string> = {
  'dashboard': 'Dashboard',
  'reportes-z': 'Reportes Z',
  'proveedores': 'Proveedores',
  'facturas': 'Facturas',
  'retenciones': 'Retenciones',
  'pagos': 'Pagos',
  'simulador': 'Simulador',
  'consultas': 'Consultas AI',
};

/**
 * Calendario SENIAT para RIF terminado en 7.
 * primeraQuincena[mes]: día límite (mismo mes) para retenciones del 1 al 15.
 * segundaQuincena[mes]: día límite (mes SIGUIENTE) para retenciones del 16 al fin.
 * Índice 0 = Enero ... 11 = Diciembre.
 */
const SENIAT_CALENDAR_RIF7 = {
  primeraQuincena:  [27, 24, 18, 17, 26, 22, 31, 20, 22, 27, 19, 18],
  segundaQuincena:  [12, 11,  2,  6, 11,  4, 15, 10,  4, 13,  3,  2],
} as const;

const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

/** Dado un período "YYYY-MM" devuelve las dos fechas de pago SENIAT del mes */
function getSeniatDueDates(periodo: string): { pago1: Date; pago2: Date; labelPago1: string; labelPago2: string } {
  const [yearStr, monthStr] = periodo.split('-');
  const year = parseInt(yearStr);
  const month = parseInt(monthStr) - 1; // 0-indexed

  // Pago 1: día de a.2 del mes actual (para retenciones 16-fin del mes ANTERIOR)
  const diaPago1 = SENIAT_CALENDAR_RIF7.segundaQuincena[month];
  const pago1 = new Date(year, month, diaPago1);

  // Pago 2: día de a.1 del mes actual (para retenciones 1-15 del mes actual)
  const diaPago2 = SENIAT_CALENDAR_RIF7.primeraQuincena[month];
  const pago2 = new Date(year, month, diaPago2);

  const prevMonth = month === 0 ? 11 : month - 1;
  const labelPago1 = `Ret. 16-fin ${MESES_ES[prevMonth]} + IVA mensual → vence ${diaPago1} ${MESES_ES[month]}`;
  const labelPago2 = `Ret. 1-15 ${MESES_ES[month]} → vence ${diaPago2} ${MESES_ES[month]}`;

  return { pago1, pago2, labelPago1, labelPago2 };
}

export default function AdminFiscal({ bcvRate }: AdminFiscalProps) {
  const [activeSubTab, setActiveSubTab] = useState<FiscalSubTab>('dashboard');

  // Dashboard state
  const [dashboardData, setDashboardData] = useState<FiscalDashboardData | null>(null);
  const [dashboardPeriod, setDashboardPeriod] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [dashboardLoading, setDashboardLoading] = useState(false);

  // Reportes Z state
  const [reportesZ, setReportesZ] = useState<FiscalReporteZ[]>([]);
  const [reportesZLoading, setReportesZLoading] = useState(false);
  const [showZModal, setShowZModal] = useState(false);
  const [editingReporteZ, setEditingReporteZ] = useState<FiscalReporteZ | null>(null);
  const [editingRateId, setEditingRateId] = useState<number | null>(null);
  const [editingRateValue, setEditingRateValue] = useState('');
  const [zFormData, setZFormData] = useState<ReporteZFormData>({
    fecha: new Date().toISOString().split('T')[0],
    subtotalExento: 0,
    subtotalGravable: 0,
    ivaCobrado: 0,
    baseImponibleIgtf: 0,
    igtfVentas: 0,
    totalVentas: 0,
    numeracionFacturas: '',
    notes: '',
  });

  // OCR state (Z reports)
  const [ocrData, setOcrData] = useState<OcrZReportData | null>(null);
  const [ocrTempKey, setOcrTempKey] = useState<string | null>(null);
  const [isProcessingOcr, setIsProcessingOcr] = useState(false);
  const [ocrStep, setOcrStep] = useState<'upload' | 'review' | 'manual'>('manual');
  const [ocrError, setOcrError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // OCR state (Facturas)
  const [facturaOcrData, setFacturaOcrData] = useState<any>(null);
  const [facturaOcrTempKey, setFacturaOcrTempKey] = useState<string | null>(null);
  const [isProcessingFacturaOcr, setIsProcessingFacturaOcr] = useState(false);
  const [facturaOcrStep, setFacturaOcrStep] = useState<'upload' | 'review' | 'manual'>('upload');
  const [facturaOcrError, setFacturaOcrError] = useState<string | null>(null);
  const facturaFileInputRef = useRef<HTMLInputElement>(null);
  const [autoGenerateRetencion, setAutoGenerateRetencion] = useState(true);

  // Proveedores state
  const [proveedores, setProveedores] = useState<FiscalProveedor[]>([]);
  const [proveedoresLoading, setProveedoresLoading] = useState(false);
  const [showProveedorModal, setShowProveedorModal] = useState(false);
  const [editingProveedor, setEditingProveedor] = useState<FiscalProveedor | null>(null);
  const [proveedorFormData, setProveedorFormData] = useState<ProveedorFormData>({
    rif: '',
    nombre: '',
    direccion: '',
    telefono: '',
    email: '',
    retencionIvaPct: 75,
    islrPct: 1.0,
  });

  // Facturas state
  const [facturas, setFacturas] = useState<FiscalFacturaCompra[]>([]);
  const [facturasLoading, setFacturasLoading] = useState(false);
  const [showFacturaModal, setShowFacturaModal] = useState(false);
  const [editingFactura, setEditingFactura] = useState<FiscalFacturaCompra | null>(null);
  const [facturaFormData, setFacturaFormData] = useState<FacturaFormData>({
    proveedorId: 0,
    numeroFactura: '',
    numeroControl: '',
    fechaFactura: new Date().toISOString().split('T')[0],
    fechaRecepcion: new Date().toISOString().split('T')[0],
    subtotalExento: 0,
    subtotalGravable: 0,
    iva: 0,
    paymentCurrency: 'bs',
    exchangeRate: bcvRate?.rate || null,
    notes: '',
  });

  // Retenciones state
  const [retenciones, setRetenciones] = useState<FiscalRetencionIva[]>([]);
  const [retencionesLoading, setRetencionesLoading] = useState(false);
  const [showRetencionModal, setShowRetencionModal] = useState(false);
  const [editingRetencion, setEditingRetencion] = useState<FiscalRetencionIva | null>(null);
  const [retencionFormData, setRetencionFormData] = useState({
    facturaId: 0,
    numeroComprobante: '',
    fechaEmision: new Date().toISOString().split('T')[0],
    periodoFiscal: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    montoRetenido: 0,
  });

  // Pagos SENIAT state
  const [showPagoForm, setShowPagoForm] = useState<{ tipoPago: TipoPagoSeniat; concepto: ConceptoPago; quincena: number | null; label: string } | null>(null);
  const [pagoForm, setPagoForm] = useState({
    fechaPago: new Date().toISOString().split('T')[0],
    monto: '',
    numeroPlanilla: '',
    referenciaBancaria: '',
    banco: '',
    notes: '',
  });
  const [pagoImage, setPagoImage] = useState<File | null>(null);
  const [savingPago, setSavingPago] = useState(false);
  const [viewingPago, setViewingPago] = useState<FiscalPagoSeniat | null>(null);
  const pagoFileInputRef = useRef<HTMLInputElement>(null);

  // Pagos tab state
  const [pagosTabYear, setPagosTabYear] = useState<string>(() => String(new Date().getFullYear()));
  const [pagosTabData, setPagosTabData] = useState<FiscalPagoSeniat[]>([]);
  const [pagosTabLoading, setPagosTabLoading] = useState(false);
  const [showNewPagoModal, setShowNewPagoModal] = useState(false);
  const [newPagoForm, setNewPagoForm] = useState({
    periodo: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    concepto: 'multa' as ConceptoPago,
    fechaPago: new Date().toISOString().split('T')[0],
    monto: '',
    numeroPlanilla: '',
    referenciaBancaria: '',
    banco: '',
    notes: '',
  });
  const [newPagoImage, setNewPagoImage] = useState<File | null>(null);
  const [savingNewPago, setSavingNewPago] = useState(false);
  const newPagoFileRef = useRef<HTMLInputElement>(null);

  // Simulador state
  const [simuladorInput, setSimuladorInput] = useState<MarginSimulatorInput>({
    costo: 0,
    precioVenta: 0,
    cantidad: 1,
    pagoEnUsd: false,
  });
  const [simuladorResult, setSimuladorResult] = useState<MarginSimulatorResult | null>(null);

  // AI Consultas state
  const [consultaQuestion, setConsultaQuestion] = useState('');
  const [consultaAnswer, setConsultaAnswer] = useState('');
  const [consultaHistory, setConsultaHistory] = useState<{ q: string; a: string }[]>([]);
  const [isConsulting, setIsConsulting] = useState(false);

  // General state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Ref for comprobante image capture
  const captureRef = useRef<HTMLDivElement>(null);

  // Clear messages after 3 seconds
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError(null);
        setSuccess(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  // =====================
  // Dashboard Functions
  // =====================

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    try {
      const response = await fetch(`/api/fiscal/dashboard?periodo=${dashboardPeriod}`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setDashboardData(data.dashboard);
      } else {
        setError('Error cargando dashboard');
      }
    } catch (err) {
      console.error('Error loading dashboard:', err);
      setError('Error de conexión');
    } finally {
      setDashboardLoading(false);
    }
  }, [dashboardPeriod]);

  // =====================
  // Pagos SENIAT Functions
  // =====================

  const openPagoForm = (tipoPago: TipoPagoSeniat, concepto: ConceptoPago, quincena: number | null, label: string, montoEstimado: number) => {
    setShowPagoForm({ tipoPago, concepto, quincena, label });
    setPagoForm({
      fechaPago: new Date().toISOString().split('T')[0],
      monto: montoEstimado > 0 ? montoEstimado.toFixed(2) : '',
      numeroPlanilla: '',
      referenciaBancaria: '',
      banco: '',
      notes: '',
    });
    setPagoImage(null);
  };

  const handleSavePago = async () => {
    if (!showPagoForm || !pagoForm.monto) return;
    setSavingPago(true);
    try {
      const formData = new FormData();
      formData.append('periodo', dashboardPeriod);
      formData.append('tipoPago', showPagoForm.tipoPago);
      formData.append('concepto', showPagoForm.concepto);
      if (showPagoForm.quincena != null) formData.append('quincena', String(showPagoForm.quincena));
      formData.append('fechaPago', pagoForm.fechaPago);
      formData.append('monto', pagoForm.monto);
      if (pagoForm.numeroPlanilla) formData.append('numeroPlanilla', pagoForm.numeroPlanilla);
      if (pagoForm.referenciaBancaria) formData.append('referenciaBancaria', pagoForm.referenciaBancaria);
      if (pagoForm.banco) formData.append('banco', pagoForm.banco);
      if (pagoForm.notes) formData.append('notes', pagoForm.notes);
      if (pagoImage) formData.append('image', pagoImage);

      const response = await fetch('/api/fiscal/pagos-seniat', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        setSuccess('Pago registrado correctamente');
        setShowPagoForm(null);
        loadDashboard();
      } else {
        setError(data.error || 'Error al registrar pago');
      }
    } catch (err) {
      console.error('Error saving pago:', err);
      setError('Error de conexión');
    } finally {
      setSavingPago(false);
    }
  };

  const handleDeletePago = async (pagoId: number) => {
    if (!confirm('¿Eliminar este registro de pago?')) return;
    try {
      const response = await fetch(`/api/fiscal/pagos-seniat/${pagoId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await response.json();
      if (data.success) {
        setSuccess('Pago eliminado');
        setViewingPago(null);
        loadDashboard();
      } else {
        setError(data.error || 'Error al eliminar');
      }
    } catch (err) {
      setError('Error de conexión');
    }
  };

  const handleMarkNA = async (tipoPago: TipoPagoSeniat, concepto: ConceptoPago, quincena: number | null, label: string) => {
    if (!confirm(`¿Marcar "${label}" como No Aplica para este período?`)) return;
    try {
      const response = await fetch('/api/fiscal/pagos-seniat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodo: dashboardPeriod,
          tipoPago,
          concepto,
          quincena,
          fechaPago: new Date().toISOString().split('T')[0],
          monto: 0,
          notes: 'No aplica',
        }),
      });
      const data = await response.json();
      if (data.success) {
        setSuccess(`${label} marcado como N/A`);
        loadDashboard();
      } else {
        setError(data.error || 'Error al marcar N/A');
      }
    } catch {
      setError('Error de conexión');
    }
  };

  const getPago = (tipoPago: TipoPagoSeniat, concepto: ConceptoPago, quincena?: number | null): FiscalPagoSeniat | undefined => {
    return dashboardData?.pagosSeniat?.find(p =>
      p.tipoPago === tipoPago && p.concepto === concepto && (quincena == null ? true : p.quincena === quincena)
    );
  };

  // =====================
  // Pagos Tab Functions
  // =====================

  const loadPagosTab = useCallback(async () => {
    setPagosTabLoading(true);
    try {
      const response = await fetch(`/api/fiscal/pagos-seniat?year=${pagosTabYear}`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setPagosTabData(data.pagos || []);
      } else {
        setError('Error cargando pagos');
      }
    } catch {
      setError('Error de conexión');
    } finally {
      setPagosTabLoading(false);
    }
  }, [pagosTabYear]);

  const handleCreateExtraPago = async () => {
    if (!newPagoForm.monto || !newPagoForm.concepto) return;
    setSavingNewPago(true);
    try {
      const formData = new FormData();
      formData.append('periodo', newPagoForm.periodo);
      formData.append('tipoPago', 'otro');
      formData.append('concepto', newPagoForm.concepto);
      formData.append('fechaPago', newPagoForm.fechaPago);
      formData.append('monto', newPagoForm.monto);
      if (newPagoForm.numeroPlanilla) formData.append('numeroPlanilla', newPagoForm.numeroPlanilla);
      if (newPagoForm.referenciaBancaria) formData.append('referenciaBancaria', newPagoForm.referenciaBancaria);
      if (newPagoForm.banco) formData.append('banco', newPagoForm.banco);
      if (newPagoForm.notes) formData.append('notes', newPagoForm.notes);
      if (newPagoImage) formData.append('image', newPagoImage);

      const response = await fetch('/api/fiscal/pagos-seniat', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const data = await response.json();
      if (data.success) {
        setSuccess('Pago registrado');
        setShowNewPagoModal(false);
        setNewPagoImage(null);
        loadPagosTab();
      } else {
        setError(data.error || 'Error al registrar pago');
      }
    } catch {
      setError('Error de conexión');
    } finally {
      setSavingNewPago(false);
    }
  };

  // =====================
  // Proveedores Functions
  // =====================

  const loadProveedores = useCallback(async () => {
    setProveedoresLoading(true);
    try {
      const response = await fetch('/api/fiscal/proveedores', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setProveedores(data.proveedores || []);
      } else {
        setError('Error cargando proveedores');
      }
    } catch (err) {
      console.error('Error loading proveedores:', err);
      setError('Error de conexión');
    } finally {
      setProveedoresLoading(false);
    }
  }, []);

  const handleSaveProveedor = async () => {
    if (!proveedorFormData.rif || !proveedorFormData.nombre) {
      setError('RIF y Nombre son requeridos');
      return;
    }

    if (!validateRif(proveedorFormData.rif)) {
      setError('RIF inválido. Formato: J-12345678-9');
      return;
    }

    try {
      const url = editingProveedor
        ? `/api/fiscal/proveedores/${editingProveedor.id}`
        : '/api/fiscal/proveedores';
      const method = editingProveedor ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...proveedorFormData,
          rif: formatRif(proveedorFormData.rif),
        }),
      });

      if (response.ok) {
        setSuccess(editingProveedor ? 'Proveedor actualizado' : 'Proveedor creado');
        setShowProveedorModal(false);
        setEditingProveedor(null);
        resetProveedorForm();
        loadProveedores();
      } else {
        const data = await response.json();
        setError(data.error || 'Error guardando proveedor');
      }
    } catch (err) {
      console.error('Error saving proveedor:', err);
      setError('Error de conexión');
    }
  };

  const handleDeleteProveedor = async (id: number) => {
    if (!confirm('¿Eliminar este proveedor?')) return;

    try {
      const response = await fetch(`/api/fiscal/proveedores/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        setSuccess('Proveedor eliminado');
        loadProveedores();
      } else {
        const data = await response.json();
        setError(data.error || 'Error eliminando proveedor');
      }
    } catch (err) {
      console.error('Error deleting proveedor:', err);
      setError('Error de conexión');
    }
  };

  const resetProveedorForm = () => {
    setProveedorFormData({
      rif: '',
      nombre: '',
      direccion: '',
      telefono: '',
      email: '',
      retencionIvaPct: 75,
      islrPct: 1.0,
    });
  };

  // =====================
  // Reportes Z Functions
  // =====================

  const handleSaveRateOverride = async (reporteId: number) => {
    const val = editingRateValue.trim();
    const override = val ? parseFloat(val) : null;
    if (val && (isNaN(override!) || override! <= 0)) {
      setError('Tasa inválida');
      return;
    }
    try {
      const res = await fetch(`/api/fiscal/reportes-z/${reporteId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bcvRateOverride: override }),
      });
      const data = await res.json();
      if (data.success) {
        setEditingRateId(null);
        loadReportesZ();
      } else {
        setError(data.error || 'Error al guardar tasa');
      }
    } catch {
      setError('Error de conexión');
    }
  };

  const loadReportesZ = useCallback(async () => {
    setReportesZLoading(true);
    try {
      const response = await fetch('/api/fiscal/reportes-z', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setReportesZ(data.reportes || []);
      } else {
        setError('Error cargando reportes Z');
      }
    } catch (err) {
      console.error('Error loading reportes Z:', err);
      setError('Error de conexión');
    } finally {
      setReportesZLoading(false);
    }
  }, []);

  // Compress image on client-side if needed (for large iPhone photos, etc.)
  const compressImage = async (file: File, maxSizeMB: number = 4, maxDimension: number = 2000): Promise<File> => {
    // If already small enough, return as-is
    if (file.size <= maxSizeMB * 1024 * 1024) {
      return file;
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      img.onload = () => {
        // Calculate new dimensions maintaining aspect ratio
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);

        // Convert to JPEG with quality reduction
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
                type: 'image/jpeg',
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            } else {
              reject(new Error('Failed to compress image'));
            }
          },
          'image/jpeg',
          0.85 // Quality
        );
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  };

  const handleOcrUpload = async (file: File) => {
    setIsProcessingOcr(true);
    setOcrError(null);
    try {
      // Compress image if too large
      const processedFile = await compressImage(file);

      const formData = new FormData();
      formData.append('image', processedFile);

      const response = await fetch('/api/fiscal/ocr', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setOcrData(data.ocrData);
        setOcrTempKey(data.tempImageKey);
        setOcrStep('review');

        // Pre-fill the form with OCR data
        if (data.ocrData) {
          setZFormData({
            fecha: data.ocrData.fecha || new Date().toISOString().split('T')[0],
            subtotalExento: data.ocrData.subtotalExento || 0,
            subtotalGravable: data.ocrData.subtotalGravable || 0,
            ivaCobrado: data.ocrData.ivaCobrado || 0,
            baseImponibleIgtf: data.ocrData.baseImponibleIgtf || 0,
            igtfVentas: data.ocrData.igtfVentas || 0,
            totalVentas: data.ocrData.totalVentas || 0,
            numeracionFacturas: data.ocrData.numeracionFacturas || '',
            notes: '',
          });
        }
      } else {
        setOcrError(data.error || 'Error procesando imagen');
        // Stay in upload mode so user can see error and retry
      }
    } catch (err) {
      console.error('Error processing OCR:', err);
      setOcrError('Error de conexión. Verifica tu internet e intenta de nuevo.');
      // Stay in upload mode so user can see error and retry
    } finally {
      setIsProcessingOcr(false);
    }
  };

  const handleSaveReporteZ = async () => {
    if (!zFormData.fecha) {
      setError('Fecha es requerida');
      return;
    }

    try {
      const url = editingReporteZ
        ? `/api/fiscal/reportes-z/${editingReporteZ.id}`
        : '/api/fiscal/reportes-z';
      const method = editingReporteZ ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...zFormData,
          imageKey: ocrTempKey,
          ocrVerified: ocrStep === 'review',
          ocrRawData: ocrData ? JSON.stringify(ocrData) : null,
        }),
      });

      if (response.ok) {
        setSuccess(editingReporteZ ? 'Reporte Z actualizado' : 'Reporte Z guardado');
        setShowZModal(false);
        setEditingReporteZ(null);
        resetZForm();
        loadReportesZ();
      } else {
        const data = await response.json();
        setError(data.error || 'Error guardando reporte Z');
      }
    } catch (err) {
      console.error('Error saving reporte Z:', err);
      setError('Error de conexión');
    }
  };

  const handleDeleteReporteZ = async (id: number) => {
    if (!confirm('¿Eliminar este reporte Z?')) return;

    try {
      const response = await fetch(`/api/fiscal/reportes-z/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        setSuccess('Reporte Z eliminado');
        loadReportesZ();
      } else {
        const data = await response.json();
        setError(data.error || 'Error eliminando reporte Z');
      }
    } catch (err) {
      console.error('Error deleting reporte Z:', err);
      setError('Error de conexión');
    }
  };

  const resetZForm = () => {
    setZFormData({
      fecha: new Date().toISOString().split('T')[0],
      subtotalExento: 0,
      subtotalGravable: 0,
      ivaCobrado: 0,
      baseImponibleIgtf: 0,
      igtfVentas: 0,
      totalVentas: 0,
      numeracionFacturas: '',
      notes: '',
    });
    setOcrData(null);
    setOcrTempKey(null);
    setOcrStep('manual');
    setOcrError(null);
  };

  // =====================
  // Facturas Functions
  // =====================

  const loadFacturas = useCallback(async () => {
    setFacturasLoading(true);
    try {
      const response = await fetch('/api/fiscal/facturas', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setFacturas(data.facturas || []);
      } else {
        setError('Error cargando facturas');
      }
    } catch (err) {
      console.error('Error loading facturas:', err);
      setError('Error de conexión');
    } finally {
      setFacturasLoading(false);
    }
  }, []);

  const handleSaveFactura = async () => {
    if (!facturaFormData.proveedorId || !facturaFormData.numeroFactura) {
      setError('Proveedor y Número de Factura son requeridos');
      return;
    }

    // Get proveedor for retention calculation
    const proveedor = proveedores.find(p => p.id === facturaFormData.proveedorId);
    if (!proveedor) {
      setError('Proveedor no encontrado');
      return;
    }

    // Calculate retentions
    const retentionCalc = calculateRetentions(
      facturaFormData.subtotalGravable,
      facturaFormData.iva,
      proveedor.retencionIvaPct,
      facturaFormData.paymentCurrency
    );

    try {
      const url = editingFactura
        ? `/api/fiscal/facturas/${editingFactura.id}`
        : '/api/fiscal/facturas';
      const method = editingFactura ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...facturaFormData,
          total: facturaFormData.subtotalExento + facturaFormData.subtotalGravable + facturaFormData.iva,
          retencionIva: retentionCalc.retencionIva,
          anticipoIslr: retentionCalc.anticipoIslr,
          igtf: retentionCalc.igtf,
          imageKey: facturaOcrTempKey,
        }),
      });

      if (response.ok) {
        const facturaData = await response.json();
        const facturaId = facturaData.id || editingFactura?.id;

        // Auto-generate retention if checkbox is checked and there's IVA to retain
        if (!editingFactura && autoGenerateRetencion && retentionCalc.retencionIva > 0 && facturaId) {
          try {
            // Generate comprobante number
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;

            // Get next sequence number (count existing retenciones for this period + 1)
            const periodoFiscal = `${year}-${String(month).padStart(2, '0')}`;
            const existingCount = retenciones.filter(r => r.periodoFiscal === periodoFiscal).length;
            const sequence = existingCount + 1;
            const numeroComprobante = `${year}${String(month).padStart(2, '0')}-${String(sequence).padStart(4, '0')}`;

            await fetch('/api/fiscal/retenciones', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                facturaId,
                numeroComprobante,
                fechaEmision: new Date().toISOString().split('T')[0],
                periodoFiscal,
                montoRetenido: retentionCalc.retencionIva,
              }),
            });
            setSuccess('Factura y retención creadas');
          } catch (retErr) {
            console.error('Error creating retention:', retErr);
            setSuccess('Factura creada (error al crear retención)');
          }
        } else {
          setSuccess(editingFactura ? 'Factura actualizada' : 'Factura registrada');
        }

        setShowFacturaModal(false);
        setEditingFactura(null);
        resetFacturaForm();
        loadFacturas();
        if (!editingFactura && autoGenerateRetencion) {
          loadRetenciones();
        }
      } else {
        const data = await response.json();
        setError(data.error || 'Error guardando factura');
      }
    } catch (err) {
      console.error('Error saving factura:', err);
      setError('Error de conexión');
    }
  };

  const handleDeleteFactura = async (id: number) => {
    if (!confirm('¿Eliminar esta factura?')) return;

    try {
      const response = await fetch(`/api/fiscal/facturas/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        setSuccess('Factura eliminada');
        loadFacturas();
      } else {
        const data = await response.json();
        setError(data.error || 'Error eliminando factura');
      }
    } catch (err) {
      console.error('Error deleting factura:', err);
      setError('Error de conexión');
    }
  };

  const resetFacturaForm = () => {
    setFacturaFormData({
      proveedorId: 0,
      numeroFactura: '',
      numeroControl: '',
      fechaFactura: new Date().toISOString().split('T')[0],
      fechaRecepcion: new Date().toISOString().split('T')[0],
      subtotalExento: 0,
      subtotalGravable: 0,
      iva: 0,
      paymentCurrency: 'bs',
      exchangeRate: bcvRate?.rate || null,
      notes: '',
    });
    setFacturaOcrData(null);
    setFacturaOcrTempKey(null);
    setFacturaOcrStep('upload');
    setFacturaOcrError(null);
  };

  // Handle factura image upload and OCR
  const handleFacturaImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingFacturaOcr(true);
    setFacturaOcrError(null);

    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch('/api/fiscal/ocr-factura', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      const data = await response.json();

      if (data.success && data.ocrData) {
        setFacturaOcrData(data.ocrData);
        setFacturaOcrTempKey(data.tempImageKey);
        setFacturaOcrStep('review');

        // Try to find matching proveedor by RIF
        let matchedProveedorId = 0;
        if (data.ocrData.proveedorRif) {
          const normalizedRif = data.ocrData.proveedorRif.replace(/[\s-]/g, '').toUpperCase();
          const match = proveedores.find(p =>
            p.rif.replace(/[\s-]/g, '').toUpperCase() === normalizedRif
          );
          if (match) {
            matchedProveedorId = match.id;
          }
        }

        // Auto-fill form with OCR data
        setFacturaFormData(prev => ({
          ...prev,
          proveedorId: matchedProveedorId,
          numeroFactura: data.ocrData.numeroFactura || '',
          numeroControl: data.ocrData.numeroControl || '',
          fechaFactura: data.ocrData.fechaFactura || prev.fechaFactura,
          subtotalExento: data.ocrData.subtotalExento || 0,
          subtotalGravable: data.ocrData.subtotalGravable || 0,
          iva: data.ocrData.iva || 0,
          paymentCurrency: data.ocrData.montoUsd ? 'usd' : 'bs',
          exchangeRate: data.ocrData.tasaBcv || bcvRate?.rate || null,
          notes: data.ocrData.proveedorRif && !matchedProveedorId
            ? `Proveedor no registrado: ${data.ocrData.proveedorNombre || ''} (${data.ocrData.proveedorRif})`
            : '',
        }));

        setSuccess(`Factura escaneada (confianza: ${Math.round((data.ocrData.confidence || 0) * 100)}%)`);
      } else {
        setFacturaOcrError(data.error || 'Error procesando imagen');
        setFacturaOcrStep('manual');
      }
    } catch (err) {
      console.error('Error processing factura OCR:', err);
      setFacturaOcrError('Error de conexión al procesar imagen');
      setFacturaOcrStep('manual');
    } finally {
      setIsProcessingFacturaOcr(false);
      // Reset file input
      if (facturaFileInputRef.current) {
        facturaFileInputRef.current.value = '';
      }
    }
  };

  // Create new proveedor from OCR data
  const handleCreateProveedorFromOcr = async () => {
    if (!facturaOcrData?.proveedorRif || !facturaOcrData?.proveedorNombre) {
      setError('Datos de proveedor incompletos');
      return;
    }

    try {
      const response = await fetch('/api/fiscal/proveedores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          rif: facturaOcrData.proveedorRif,
          nombre: facturaOcrData.proveedorNombre,
          direccion: '',
          telefono: '',
          email: '',
          retencionIvaPct: 75,
          islrPct: 1.0,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        await loadProveedores();
        setFacturaFormData(prev => ({ ...prev, proveedorId: data.id, notes: '' }));
        setSuccess('Proveedor creado');
      } else {
        const data = await response.json();
        setError(data.error || 'Error creando proveedor');
      }
    } catch (err) {
      console.error('Error creating proveedor:', err);
      setError('Error de conexión');
    }
  };

  // =====================
  // Retenciones Functions
  // =====================

  const loadRetenciones = useCallback(async () => {
    setRetencionesLoading(true);
    try {
      const response = await fetch('/api/fiscal/retenciones', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setRetenciones(data.retenciones || []);
      } else {
        setError('Error cargando retenciones');
      }
    } catch (err) {
      console.error('Error loading retenciones:', err);
      setError('Error de conexión');
    } finally {
      setRetencionesLoading(false);
    }
  }, []);

  const handleGenerateRetencionPDF = async (facturaId: number) => {
    // Open window BEFORE async call to avoid popup blocker
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Por favor permite las ventanas emergentes para ver el comprobante.');
      return;
    }
    // Show loading while fetching
    printWindow.document.write('<html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>Generando comprobante...</h2></body></html>');

    try {
      const response = await fetch(`/api/fiscal/retenciones/${facturaId}/pdf`, {
        method: 'POST',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();

        if (data.pdfData) {
          // Generate printable HTML comprobante - Formato SENIAT Venezuela
          const { comprobante, empresa, proveedor, factura, retencion } = data.pdfData;

          // Parse periodo fiscal
          const [periodoYear, periodoMonth] = comprobante.periodoFiscal.split('-');

          // Format numbers Venezuelan style
          const formatNum = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

          // Calculate alícuota from actual IVA (iva / base * 100)
          const alicuota = factura.subtotalGravable > 0
            ? Math.round((factura.iva / factura.subtotalGravable) * 100)
            : 16;
          const impuestoCausado = factura.iva;
          const impuestoRetenido = retencion.monto;

          // Format number control with leading zeros
          const formatNumControl = (num: string | null) => {
            if (!num) return '';
            // Pad to format 00-XXXXXX
            const clean = num.replace(/\D/g, '');
            if (clean.length <= 6) return `00-${clean.padStart(6, '0')}`;
            return num;
          };

          // Format RIF without dashes (V171460910 style)
          const formatRifClean = (rif: string | null) => {
            if (!rif) return '';
            return rif.replace(/-/g, '');
          };

          const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Comprobante de Retención IVA - ${comprobante.numero}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }

    body {
      font-family: Arial, sans-serif;
      font-size: 9pt;
      line-height: 1.3;
      color: #000;
      background: #fff;
    }

    /* Close button for Safari PWA */
    .close-btn {
      position: fixed;
      top: 10px;
      right: 10px;
      padding: 8px 16px;
      background: #dc2626;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      z-index: 9999;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .close-btn:hover { background: #b91c1c; }
    @media print { .no-print { display: none !important; } }

    /* Print geometry - LANDSCAPE format */
    @page { size: letter landscape; margin: 10mm 12mm 10mm 12mm; }

    .wrap {
      width: 100%;
      margin: 0 auto;
    }

    /* Header */
    .header {
      position: relative;
      text-align: center;
      margin: 0 0 4mm;
    }
    .page-num {
      position: absolute;
      right: 0;
      top: 0;
      font-size: 9pt;
    }
    .company-name {
      font-size: 14pt;
      font-weight: 700;
    }
    .company-rif {
      font-size: 10pt;
      font-weight: 700;
      margin-top: 1mm;
    }

    /* Title */
    .doc-title {
      text-align: center;
      font-size: 10pt;
      font-weight: 700;
      text-decoration: underline;
      margin: 2mm 0 2mm;
    }

    /* Legal */
    .legal {
      font-size: 7.5pt;
      line-height: 1.2;
      text-align: justify;
      margin: 0 0 3mm;
    }

    /* Meta (Ciudad / Comprobante / etc.) */
    .meta {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin: 0 0 2mm;
      font-size: 9pt;
    }
    .meta td {
      vertical-align: top;
      padding: 0.5mm 0;
      width: 50%;
    }
    .label { font-weight: 700; }

    /* Two party columns */
    .parties {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 2mm;
      font-size: 9pt;
    }
    .parties > tbody > tr > td {
      vertical-align: top;
      width: 50%;
    }
    .party-title {
      text-align: center;
      font-weight: 700;
      margin: 0 0 2mm;
      font-size: 9pt;
    }
    .kv {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5pt;
    }
    .kv td {
      vertical-align: top;
      padding: 0.3mm 0;
    }
    .kv .k {
      width: 24mm;
      font-weight: 700;
      padding-right: 2mm;
    }
    .kv .v {
      word-break: break-word;
    }

    /* Retention table */
    .ret-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8pt;
      margin-top: 1mm;
    }
    .ret-table thead tr.section-headers th {
      font-weight: 700;
      font-size: 9pt;
      padding: 2mm 1mm;
      border-bottom: none;
    }
    .ret-table thead th {
      font-weight: 700;
      font-size: 7pt;
      line-height: 1.15;
      padding: 1.5mm 1mm;
      text-align: center;
      vertical-align: bottom;
      border-bottom: 0.5pt solid #000;
    }
    .ret-table tbody td {
      padding: 1.5mm 1mm;
      text-align: center;
      vertical-align: top;
      font-size: 9pt;
    }
    .r { text-align: right !important; }

    .totals td { padding-top: 1.5mm; }
    .totline {
      border-top: 0.5pt solid #000;
      padding-top: 1mm !important;
    }

    /* Signature */
    .signature {
      margin-top: 10mm;
      text-align: center;
      font-size: 9pt;
    }
    .sig-line {
      border-top: 0.5pt solid #000;
      width: 70mm;
      margin: 0 auto;
      padding-top: 1mm;
    }

    /* Delivery date */
    .delivery {
      margin-top: 5mm;
      font-size: 9pt;
    }
    .delivery .line {
      display: inline-block;
      border-bottom: 0.5pt solid #000;
      width: 50mm;
      margin-left: 5mm;
    }

    /* Disclaimer */
    .disclaimer {
      margin-top: 5mm;
      font-size: 8pt;
      text-align: center;
    }
  </style>
</head>
<body>
  <button class="close-btn no-print" onclick="window.close()">Cerrar</button>

  <div class="wrap">
    <div class="header">
      <div class="page-num">Pág. 1</div>
      <div class="company-name">${empresa.nombre}</div>
      <div class="company-rif">R.I.F. Nº ${empresa.rif}</div>
    </div>

    <div class="doc-title">COMPROBANTE DE RETENCION DEL IMPUESTO AL VALOR AGREGADO</div>

    <div class="legal">
      (Ley IVA - Art. 11. Gaceta Oficial 6.152 Extraordinario: "La Administración Tributaria podrá designar como responsables del pago del impuesto, en calidad de agentes de retención, a quienes por sus funciones públicas o por razón de sus actividades privadas intervengan en operaciones gravadas con el impuesto establecido en este Decreto con Rango, Valor y Fuerza de Ley")
    </div>

    <table class="meta">
      <tr>
        <td><span class="label">Ciudad</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;MAIQUETIA</td>
        <td><span class="label">Nº Comprobante</span>&nbsp;&nbsp;&nbsp;&nbsp;${comprobante.numero}</td>
      </tr>
      <tr>
        <td><span class="label">Fecha de Emisión</span>&nbsp;&nbsp;&nbsp;&nbsp;${formatDateDMY(comprobante.fechaEmision || factura.fecha)}</td>
        <td><span class="label">Periodo Fiscal</span>&nbsp;&nbsp;&nbsp;&nbsp;Año :&nbsp;&nbsp;&nbsp;&nbsp;${periodoYear}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/ Mes :&nbsp;&nbsp;&nbsp;&nbsp;${periodoMonth}</td>
      </tr>
    </table>

    <table class="parties">
      <tbody>
      <tr>
        <td style="padding-right: 8mm;">
          <div class="party-title">DATOS DEL AGENTE DE RETENCION</div>
          <table class="kv">
            <tr><td class="k">Nombre<br>o Razón Social</td><td class="v">${empresa.nombre}</td></tr>
            <tr><td class="k">Nº R.I.F.</td><td class="v">${empresa.rif}</td></tr>
            <tr><td class="k">Nº N.I.T.</td><td class="v"></td></tr>
            <tr><td class="k">Dirección</td><td class="v">${empresa.direccion}</td></tr>
            <tr><td class="k">Teléfonos</td><td class="v">-</td></tr>
          </table>
        </td>
        <td style="padding-left: 8mm;">
          <div class="party-title">DATOS DEL BENEFICIARIO</div>
          <table class="kv">
            <tr><td class="k">Nombre<br>o Razón Social</td><td class="v">${proveedor.nombre || ''}</td></tr>
            <tr><td class="k">Nº R.I.F.</td><td class="v">${formatRifClean(proveedor.rif)}</td></tr>
            <tr><td class="k">Nº N.I.T.</td><td class="v"></td></tr>
            <tr><td class="k">Dirección</td><td class="v">${proveedor.direccion || ''}</td></tr>
            <tr><td class="k">Teléfonos</td><td class="v"></td></tr>
          </table>
        </td>
      </tr>
      </tbody>
    </table>

    <table class="ret-table">
      <colgroup>
        <col style="width: 2%;">
        <col style="width: 14%;">
        <col style="width: 7%;">
        <col style="width: 17%;">
        <col style="width: 6%;">
        <col style="width: 5%;">
        <col style="width: 10%;">
        <col style="width: 7%;">
        <col style="width: 9%;">
        <col style="width: 4%;">
        <col style="width: 9%;">
        <col style="width: 10%;">
      </colgroup>
      <thead>
        <tr class="section-headers">
          <th colspan="6" style="text-align:center;font-weight:700;border-bottom:none;padding-bottom:0;">DATOS DE LA RETENCIÓN</th>
          <th colspan="6" style="text-align:center;font-weight:700;border-bottom:none;padding-bottom:0;">COMPRAS INTERNAS o<br>IMPORTACIONES</th>
        </tr>
        <tr>
          <th>Nº</th>
          <th style="white-space:nowrap;">Fecha Doc. Nº Factura</th>
          <th>Nº Control</th>
          <th style="white-space:nowrap;">Nº Nota Débito Nº Nota Crédito</th>
          <th>Tipo de<br>Transacción</th>
          <th>Nº Fact.<br>Afectada</th>
          <th>Total Factura o<br>Nota Débito</th>
          <th>Sin derecho a<br>Crédito</th>
          <th>Base Imponible</th>
          <th>%<br>Alíc.</th>
          <th>Impuesto<br>Causado</th>
          <th>Impuesto<br>Retenido</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>${formatDateDMY(factura.fecha)} ${factura.numero}</td>
          <td>${formatNumControl(factura.numeroControl)}</td>
          <td></td>
          <td style="white-space:nowrap;">01 Registro</td>
          <td></td>
          <td class="r">${formatNum(factura.total)}</td>
          <td class="r">0,00</td>
          <td class="r">${formatNum(factura.subtotalGravable)}</td>
          <td class="r">${formatNum(alicuota)}</td>
          <td class="r">${formatNum(impuestoCausado)}</td>
          <td class="r">${formatNum(impuestoRetenido)}</td>
        </tr>
        <tr class="totals">
          <td colspan="6"></td>
          <td class="r totline">${formatNum(factura.total)}</td>
          <td class="r totline">0,00</td>
          <td class="r totline">${formatNum(factura.subtotalGravable)}</td>
          <td></td>
          <td class="r totline">${formatNum(impuestoCausado)}</td>
          <td class="r totline">${formatNum(impuestoRetenido)}</td>
        </tr>
      </tbody>
    </table>

    <div class="signature">
      <div class="sig-line">
        Firma Y Sello Agente De Retención<br>
        R.I.F. Nº ${empresa.rif}
      </div>
    </div>

    <div class="delivery">
      <span class="label">Fecha de Entrega</span><span class="line"></span>
    </div>

    <div class="disclaimer">
      Este comprobante se emite en función a lo establecido en el artículo 16 de la Providencia Administrativa Nº SNAT/2025/000054 de fecha 16/07/2025
    </div>
  </div>
</body>
</html>`;

          // Write HTML to the already-opened window
          printWindow.document.open();
          printWindow.document.write(html);
          printWindow.document.close();
          // Auto print after a short delay
          setTimeout(() => {
            printWindow.print();
          }, 250);
        } else {
          printWindow.close();
          setError('Error: datos del comprobante no disponibles');
        }

        setSuccess('Comprobante generado');
        loadRetenciones();
      } else {
        printWindow.close();
        const data = await response.json();
        setError(data.error || 'Error generando PDF');
      }
    } catch (err) {
      console.error('Error generating PDF:', err);
      printWindow?.close();
      setError('Error de conexión');
    }
  };

  const handleDownloadComprobanteImage = async (facturaId: number) => {
    try {
      const response = await fetch(`/api/fiscal/retenciones/${facturaId}/pdf`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Error generando imagen');
        return;
      }

      const data = await response.json();
      if (!data.pdfData) {
        setError('Error: datos del comprobante no disponibles');
        return;
      }

      const { comprobante, empresa, proveedor, factura, retencion } = data.pdfData;
      const [periodoYear, periodoMonth] = comprobante.periodoFiscal.split('-');

      const formatNum = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      const alicuota = factura.subtotalGravable > 0
        ? Math.round((factura.iva / factura.subtotalGravable) * 100)
        : 16;
      const impuestoCausado = factura.iva;
      const impuestoRetenido = retencion.monto;

      const formatNumControl = (num: string | null) => {
        if (!num) return '';
        const clean = num.replace(/\D/g, '');
        if (clean.length <= 6) return `00-${clean.padStart(6, '0')}`;
        return num;
      };

      const formatRifClean = (rif: string | null) => {
        if (!rif) return '';
        return rif.replace(/-/g, '');
      };

      // Create hidden capture container
      if (!captureRef.current) return;
      const captureDiv = captureRef.current;

      // Build HTML for image capture (same as PDF but without print styles)
      captureDiv.innerHTML = `
        <div style="width: 1056px; padding: 30px 36px; background: #fff; font-family: Arial, sans-serif; font-size: 12px; line-height: 1.3; color: #000;">
          <div style="position: relative; text-align: center; margin-bottom: 12px;">
            <div style="position: absolute; right: 0; top: 0; font-size: 12px;">Pág. 1</div>
            <div style="font-size: 18px; font-weight: 700;">${empresa.nombre}</div>
            <div style="font-size: 13px; font-weight: 700; margin-top: 3px;">R.I.F. Nº ${empresa.rif}</div>
          </div>

          <div style="text-align: center; font-size: 13px; font-weight: 700; text-decoration: underline; margin: 6px 0;">COMPROBANTE DE RETENCION DEL IMPUESTO AL VALOR AGREGADO</div>

          <div style="font-size: 10px; line-height: 1.2; text-align: justify; margin-bottom: 9px;">
            (Ley IVA - Art. 11. Gaceta Oficial 6.152 Extraordinario: "La Administración Tributaria podrá designar como responsables del pago del impuesto, en calidad de agentes de retención, a quienes por sus funciones públicas o por razón de sus actividades privadas intervengan en operaciones gravadas con el impuesto establecido en este Decreto con Rango, Valor y Fuerza de Ley")
          </div>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 12px;">
            <tr>
              <td style="width: 50%; padding: 1.5px 0;"><span style="font-weight: 700;">Ciudad</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;MAIQUETIA</td>
              <td style="width: 50%; padding: 1.5px 0;"><span style="font-weight: 700;">Nº Comprobante</span>&nbsp;&nbsp;&nbsp;&nbsp;${comprobante.numero}</td>
            </tr>
            <tr>
              <td style="padding: 1.5px 0;"><span style="font-weight: 700;">Fecha de Emisión</span>&nbsp;&nbsp;&nbsp;&nbsp;${formatDateDMY(comprobante.fechaEmision || factura.fecha)}</td>
              <td style="padding: 1.5px 0;"><span style="font-weight: 700;">Periodo Fiscal</span>&nbsp;&nbsp;&nbsp;&nbsp;Año :&nbsp;&nbsp;&nbsp;&nbsp;${periodoYear}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/ Mes :&nbsp;&nbsp;&nbsp;&nbsp;${periodoMonth}</td>
            </tr>
          </table>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 12px;">
            <tr>
              <td style="width: 50%; vertical-align: top; padding-right: 24px;">
                <div style="text-align: center; font-weight: 700; margin-bottom: 6px;">DATOS DEL AGENTE DE RETENCION</div>
                <table style="width: 100%; font-size: 11px;">
                  <tr><td style="width: 72px; font-weight: 700; padding: 1px 0;">Nombre<br>o Razón Social</td><td style="padding: 1px 0;">${empresa.nombre}</td></tr>
                  <tr><td style="font-weight: 700; padding: 1px 0;">Nº R.I.F.</td><td style="padding: 1px 0;">${empresa.rif}</td></tr>
                  <tr><td style="font-weight: 700; padding: 1px 0;">Nº N.I.T.</td><td style="padding: 1px 0;"></td></tr>
                  <tr><td style="font-weight: 700; padding: 1px 0;">Dirección</td><td style="padding: 1px 0;">${empresa.direccion}</td></tr>
                  <tr><td style="font-weight: 700; padding: 1px 0;">Teléfonos</td><td style="padding: 1px 0;">-</td></tr>
                </table>
              </td>
              <td style="width: 50%; vertical-align: top; padding-left: 24px;">
                <div style="text-align: center; font-weight: 700; margin-bottom: 6px;">DATOS DEL BENEFICIARIO</div>
                <table style="width: 100%; font-size: 11px;">
                  <tr><td style="width: 72px; font-weight: 700; padding: 1px 0;">Nombre<br>o Razón Social</td><td style="padding: 1px 0;">${proveedor.nombre || ''}</td></tr>
                  <tr><td style="font-weight: 700; padding: 1px 0;">Nº R.I.F.</td><td style="padding: 1px 0;">${formatRifClean(proveedor.rif)}</td></tr>
                  <tr><td style="font-weight: 700; padding: 1px 0;">Nº N.I.T.</td><td style="padding: 1px 0;"></td></tr>
                  <tr><td style="font-weight: 700; padding: 1px 0;">Dirección</td><td style="padding: 1px 0;">${proveedor.direccion || ''}</td></tr>
                  <tr><td style="font-weight: 700; padding: 1px 0;">Teléfonos</td><td style="padding: 1px 0;"></td></tr>
                </table>
              </td>
            </tr>
          </table>

          <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 3px;">
            <colgroup>
              <col style="width: 2%;"><col style="width: 14%;"><col style="width: 7%;"><col style="width: 17%;">
              <col style="width: 6%;"><col style="width: 5%;"><col style="width: 10%;"><col style="width: 7%;">
              <col style="width: 9%;"><col style="width: 4%;"><col style="width: 9%;"><col style="width: 10%;">
            </colgroup>
            <thead>
              <tr>
                <th colspan="6" style="text-align: center; font-weight: 700; font-size: 12px; padding: 6px 3px;">DATOS DE LA RETENCIÓN</th>
                <th colspan="6" style="text-align: center; font-weight: 700; font-size: 12px; padding: 6px 3px;">COMPRAS INTERNAS o<br>IMPORTACIONES</th>
              </tr>
              <tr>
                <th style="font-weight: 700; font-size: 9px; padding: 4.5px 3px; text-align: center; vertical-align: bottom; border-bottom: 0.5px solid #000;">Nº</th>
                <th style="font-weight: 700; font-size: 9px; padding: 4.5px 3px; text-align: center; vertical-align: bottom; border-bottom: 0.5px solid #000; white-space: nowrap;">Fecha Doc. Nº Factura</th>
                <th style="font-weight: 700; font-size: 9px; padding: 4.5px 3px; text-align: center; vertical-align: bottom; border-bottom: 0.5px solid #000;">Nº Control</th>
                <th style="font-weight: 700; font-size: 9px; padding: 4.5px 3px; text-align: center; vertical-align: bottom; border-bottom: 0.5px solid #000; white-space: nowrap;">Nº Nota Débito Nº Nota Crédito</th>
                <th style="font-weight: 700; font-size: 9px; padding: 4.5px 3px; text-align: center; vertical-align: bottom; border-bottom: 0.5px solid #000;">Tipo de<br>Transacción</th>
                <th style="font-weight: 700; font-size: 9px; padding: 4.5px 3px; text-align: center; vertical-align: bottom; border-bottom: 0.5px solid #000;">Nº Fact.<br>Afectada</th>
                <th style="font-weight: 700; font-size: 9px; padding: 4.5px 3px; text-align: center; vertical-align: bottom; border-bottom: 0.5px solid #000;">Total Factura o<br>Nota Débito</th>
                <th style="font-weight: 700; font-size: 9px; padding: 4.5px 3px; text-align: center; vertical-align: bottom; border-bottom: 0.5px solid #000;">Sin derecho a<br>Crédito</th>
                <th style="font-weight: 700; font-size: 9px; padding: 4.5px 3px; text-align: center; vertical-align: bottom; border-bottom: 0.5px solid #000;">Base Imponible</th>
                <th style="font-weight: 700; font-size: 9px; padding: 4.5px 3px; text-align: center; vertical-align: bottom; border-bottom: 0.5px solid #000;">%<br>Alíc.</th>
                <th style="font-weight: 700; font-size: 9px; padding: 4.5px 3px; text-align: center; vertical-align: bottom; border-bottom: 0.5px solid #000;">Impuesto<br>Causado</th>
                <th style="font-weight: 700; font-size: 9px; padding: 4.5px 3px; text-align: center; vertical-align: bottom; border-bottom: 0.5px solid #000;">Impuesto<br>Retenido</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding: 4.5px 3px; text-align: center; font-size: 12px;">1</td>
                <td style="padding: 4.5px 3px; text-align: center; font-size: 12px;">${formatDateDMY(factura.fecha)} ${factura.numero}</td>
                <td style="padding: 4.5px 3px; text-align: center; font-size: 12px;">${formatNumControl(factura.numeroControl)}</td>
                <td style="padding: 4.5px 3px; text-align: center; font-size: 12px;"></td>
                <td style="padding: 4.5px 3px; text-align: center; font-size: 12px; white-space: nowrap;">01 Registro</td>
                <td style="padding: 4.5px 3px; text-align: center; font-size: 12px;"></td>
                <td style="padding: 4.5px 3px; text-align: right; font-size: 12px;">${formatNum(factura.total)}</td>
                <td style="padding: 4.5px 3px; text-align: right; font-size: 12px;">0,00</td>
                <td style="padding: 4.5px 3px; text-align: right; font-size: 12px;">${formatNum(factura.subtotalGravable)}</td>
                <td style="padding: 4.5px 3px; text-align: right; font-size: 12px;">${formatNum(alicuota)}</td>
                <td style="padding: 4.5px 3px; text-align: right; font-size: 12px;">${formatNum(impuestoCausado)}</td>
                <td style="padding: 4.5px 3px; text-align: right; font-size: 12px;">${formatNum(impuestoRetenido)}</td>
              </tr>
              <tr>
                <td colspan="6" style="padding-top: 4.5px;"></td>
                <td style="padding-top: 4.5px; text-align: right; font-size: 12px; border-top: 0.5px solid #000;">${formatNum(factura.total)}</td>
                <td style="padding-top: 4.5px; text-align: right; font-size: 12px; border-top: 0.5px solid #000;">0,00</td>
                <td style="padding-top: 4.5px; text-align: right; font-size: 12px; border-top: 0.5px solid #000;">${formatNum(factura.subtotalGravable)}</td>
                <td style="padding-top: 4.5px;"></td>
                <td style="padding-top: 4.5px; text-align: right; font-size: 12px; border-top: 0.5px solid #000;">${formatNum(impuestoCausado)}</td>
                <td style="padding-top: 4.5px; text-align: right; font-size: 12px; border-top: 0.5px solid #000;">${formatNum(impuestoRetenido)}</td>
              </tr>
            </tbody>
          </table>

          <div style="margin-top: 30px; text-align: center; font-size: 12px;">
            <div style="border-top: 0.5px solid #000; width: 210px; margin: 0 auto; padding-top: 3px;">
              Firma Y Sello Agente De Retención<br>
              R.I.F. Nº ${empresa.rif}
            </div>
          </div>

          <div style="margin-top: 15px; font-size: 12px;">
            <span style="font-weight: 700;">Fecha de Entrega</span><span style="display: inline-block; border-bottom: 0.5px solid #000; width: 150px; margin-left: 15px;"></span>
          </div>

          <div style="margin-top: 15px; font-size: 10px; text-align: center;">
            Este comprobante se emite en función a lo establecido en el artículo 16 de la Providencia Administrativa Nº SNAT/2025/000054 de fecha 16/07/2025
          </div>
        </div>
      `;

      captureDiv.style.position = 'absolute';
      captureDiv.style.left = '-9999px';
      captureDiv.style.top = '0';
      captureDiv.style.display = 'block';

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 100));

      // Capture with html2canvas
      const canvas = await html2canvas(captureDiv.firstElementChild as HTMLElement, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: 1056,
        windowWidth: 1056,
      });

      // Hide capture div
      captureDiv.style.display = 'none';
      captureDiv.innerHTML = '';

      // Download as PNG
      const link = document.createElement('a');
      link.download = `comprobante-retencion-${comprobante.numero}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();

      setSuccess('Imagen descargada');
    } catch (err) {
      console.error('Error generating image:', err);
      setError('Error generando imagen');
    }
  };

  const handleSaveRetencion = async () => {
    if (!retencionFormData.numeroComprobante || !retencionFormData.fechaEmision || !retencionFormData.periodoFiscal) {
      setError('Todos los campos son requeridos');
      return;
    }

    try {
      const url = editingRetencion
        ? `/api/fiscal/retenciones/${editingRetencion.id}`
        : '/api/fiscal/retenciones';
      const method = editingRetencion ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(retencionFormData),
      });

      if (response.ok) {
        setSuccess(editingRetencion ? 'Retención actualizada' : 'Retención creada');
        setShowRetencionModal(false);
        setEditingRetencion(null);
        resetRetencionForm();
        loadRetenciones();
      } else {
        const data = await response.json();
        setError(data.error || 'Error guardando retención');
      }
    } catch (err) {
      console.error('Error saving retencion:', err);
      setError('Error de conexión');
    }
  };

  const handleDeleteRetencion = async (id: number) => {
    if (!confirm('¿Eliminar este comprobante de retención?')) return;

    try {
      const response = await fetch(`/api/fiscal/retenciones/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        setSuccess('Retención eliminada');
        loadRetenciones();
      } else {
        const data = await response.json();
        setError(data.error || 'Error eliminando retención');
      }
    } catch (err) {
      console.error('Error deleting retencion:', err);
      setError('Error de conexión');
    }
  };

  const resetRetencionForm = () => {
    setRetencionFormData({
      facturaId: 0,
      numeroComprobante: '',
      fechaEmision: new Date().toISOString().split('T')[0],
      periodoFiscal: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
      montoRetenido: 0,
    });
  };

  // =====================
  // Simulador Functions
  // =====================

  const calculateSimulation = useCallback(() => {
    if (simuladorInput.costo > 0 && simuladorInput.precioVenta > 0 && simuladorInput.cantidad > 0) {
      const result = calculateMarginSimulation(simuladorInput);
      setSimuladorResult(result);
    } else {
      setSimuladorResult(null);
    }
  }, [simuladorInput]);

  useEffect(() => {
    calculateSimulation();
  }, [calculateSimulation]);

  // =====================
  // AI Consultas Functions
  // =====================

  const handleConsulta = async () => {
    if (!consultaQuestion.trim()) {
      setError('Escribe una pregunta');
      return;
    }

    setIsConsulting(true);
    try {
      const response = await fetch('/api/fiscal/consulta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ question: consultaQuestion }),
      });

      if (response.ok) {
        const data = await response.json();
        setConsultaAnswer(data.answer);
        setConsultaHistory(prev => [...prev, { q: consultaQuestion, a: data.answer }]);
        setConsultaQuestion('');
      } else {
        const data = await response.json();
        setError(data.error || 'Error en consulta');
      }
    } catch (err) {
      console.error('Error consulting:', err);
      setError('Error de conexión');
    } finally {
      setIsConsulting(false);
    }
  };

  // =====================
  // Load data on tab change
  // =====================

  useEffect(() => {
    switch (activeSubTab) {
      case 'dashboard':
        loadDashboard();
        break;
      case 'proveedores':
        loadProveedores();
        break;
      case 'reportes-z':
        loadReportesZ();
        break;
      case 'facturas':
        loadFacturas();
        if (proveedores.length === 0) loadProveedores();
        break;
      case 'retenciones':
        loadRetenciones();
        break;
      case 'pagos':
        loadPagosTab();
        break;
    }
  }, [activeSubTab, loadDashboard, loadProveedores, loadReportesZ, loadFacturas, loadRetenciones, loadPagosTab, proveedores.length]);

  // =====================
  // Render Helpers
  // =====================

  const formatPercent = (value: number) => `${value.toFixed(1)}%`;

  // =====================
  // Render Components
  // =====================

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="text-xl font-semibold text-ocean-900">Dashboard Fiscal</h2>
        <input
          type="month"
          value={dashboardPeriod}
          onChange={(e) => setDashboardPeriod(e.target.value)}
          className="px-3 py-2 border border-ocean-200 rounded-lg text-sm"
        />
        <button
          onClick={loadDashboard}
          className="px-4 py-2 bg-ocean-600 text-white rounded-lg text-sm hover:bg-ocean-500"
        >
          Actualizar
        </button>
      </div>

      {dashboardLoading ? (
        <div className="text-center py-12 text-ocean-600">Cargando...</div>
      ) : dashboardData ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Ventas Card */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-ocean-100">
            <h3 className="text-sm font-medium text-ocean-600 mb-4">Ventas del Período</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-ocean-700">Total Ventas</span>
                <span className="font-semibold text-ocean-900">{formatBs(dashboardData.totalVentasBs)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ocean-700">IVA Cobrado</span>
                <span className="font-semibold text-green-600">{formatBs(dashboardData.ivaCobradoBs)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ocean-500">Exentas</span>
                <span className="text-ocean-600">{formatBs(dashboardData.ventasExentas)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ocean-500">Gravables</span>
                <span className="text-ocean-600">{formatBs(dashboardData.ventasGravables)}</span>
              </div>
            </div>
          </div>

          {/* Compras Card */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-ocean-100">
            <h3 className="text-sm font-medium text-ocean-600 mb-4">Compras del Período</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-ocean-700">Total Compras</span>
                <span className="font-semibold text-ocean-900">{formatBs(dashboardData.totalComprasBs)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ocean-700">IVA Pagado</span>
                <span className="font-semibold text-red-600">{formatBs(dashboardData.ivaComprasBs)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ocean-500">Exentas</span>
                <span className="text-ocean-600">{formatBs(dashboardData.comprasExentas)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ocean-500">Gravables</span>
                <span className="text-ocean-600">{formatBs(dashboardData.comprasGravables)}</span>
              </div>
            </div>
          </div>

          {/* Retenciones Card */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-ocean-100">
            <h3 className="text-sm font-medium text-ocean-600 mb-4">Retenciones e Impuestos</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-ocean-700">Retención IVA</span>
                <span className="font-semibold text-purple-600">{formatBs(dashboardData.retencionIvaTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ocean-700">Anticipo ISLR</span>
                <span className="font-semibold text-amber-600">{formatBs(dashboardData.anticipoIslrAcumulado)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ocean-700">IGTF Pagado (compras)</span>
                <span className="font-semibold text-ocean-600">{formatBs(dashboardData.igtfPagado)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ocean-700">SUMAT (2.5%)</span>
                <span className="font-semibold text-rose-600">{formatBs(dashboardData.sumatPendiente)}</span>
              </div>
            </div>
          </div>

          {/* IGTF Ventas Card */}
          <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 shadow-sm border border-green-200">
            <h3 className="text-sm font-medium text-green-700 mb-4">IGTF Ventas (Cobrado)</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-green-700">BI IGTF (Ventas en $)</span>
                <span className="font-semibold text-green-800">{formatBs(dashboardData.baseImponibleIgtfVentas || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-green-700">IGTF Cobrado (3%)</span>
                <span className="font-semibold text-green-900 text-lg">{formatBs(dashboardData.igtfVentasCobrado || 0)}</span>
              </div>
            </div>
            <p className="text-xs text-green-600 mt-3">
              Este monto se declara y paga al SENIAT
            </p>
          </div>

          {/* IVA Balance Card */}
          <div className="bg-gradient-to-br from-ocean-50 to-ocean-100 rounded-xl p-6 shadow-sm border border-ocean-200">
            <h3 className="text-sm font-medium text-ocean-700 mb-4">Balance IVA</h3>
            <div className="text-3xl font-bold text-ocean-900">
              {formatBs(dashboardData.ivaBalance)}
            </div>
            <p className="text-xs text-ocean-600 mt-2">
              IVA Cobrado - IVA Pagado + Retenciones
            </p>
          </div>

          {/* Counts Card */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-ocean-100">
            <h3 className="text-sm font-medium text-ocean-600 mb-4">Documentos</h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-ocean-900">{dashboardData.reportesZCount}</div>
                <div className="text-xs text-ocean-600">Reportes Z</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-ocean-900">{dashboardData.facturasCount}</div>
                <div className="text-xs text-ocean-600">Facturas</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-ocean-900">{dashboardData.retencionesCount}</div>
                <div className="text-xs text-ocean-600">Retenciones</div>
              </div>
            </div>
          </div>

          {/* BCV Rate Card */}
          {bcvRate && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-ocean-100">
              <h3 className="text-sm font-medium text-ocean-600 mb-4">Tasa BCV</h3>
              <div className="text-2xl font-bold text-ocean-900">
                {formatBs(bcvRate.rate)}
              </div>
              <p className="text-xs text-ocean-600 mt-2">
                Actualizado: {bcvRate.date}
              </p>
            </div>
          )}
        </div>
      ) : null}

      {/* ── Calendario SENIAT ── */}
      {(() => {
        const { pago1, pago2, labelPago1, labelPago2 } = getSeniatDueDates(dashboardPeriod);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isPago1Past = pago1 < today;
        const isPago2Past = pago2 < today;

        const retIva  = dashboardData?.retencionIvaTotal ?? 0;
        const retIslr = dashboardData?.anticipoIslrAcumulado ?? 0;
        const igtf    = (dashboardData?.igtfPagado ?? 0) + (dashboardData?.igtfVentasCobrado ?? 0);
        const ivaNet  = dashboardData?.ivaBalance ?? 0;
        const sumat   = dashboardData?.sumatPendiente ?? 0;

        const fmtDate = (d: Date) => d.toLocaleDateString('es-VE', { day: 'numeric', month: 'long', year: 'numeric' });

        const DateBadge = ({ date, isPast, label }: { date: Date; isPast: boolean; label: string }) => (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${isPast ? 'bg-gray-100 text-gray-400' : 'bg-ocean-100 text-ocean-800'}`}>
            <span className="text-base">{isPast ? '✓' : '📅'}</span>
            <div>
              <p className="font-semibold">{fmtDate(date)}</p>
              <p className="text-[11px] opacity-70">{label}</p>
            </div>
          </div>
        );

        type LineItem = { label: string; concepto: ConceptoPago; monto: number; tipoPago: TipoPagoSeniat; quincena: number | null };

        const pago1Items: LineItem[] = [
          { label: 'Ret. IVA', concepto: 'retencion_iva', monto: retIva, tipoPago: 'pago1', quincena: 2 },
          { label: 'Ret. ISLR', concepto: 'retencion_islr', monto: retIslr, tipoPago: 'pago1', quincena: 2 },
          { label: 'IGTF', concepto: 'igtf', monto: igtf, tipoPago: 'pago1', quincena: 2 },
          { label: 'IVA neto mensual', concepto: 'iva_neto', monto: ivaNet, tipoPago: 'pago1', quincena: null },
        ];
        const pago2Items: LineItem[] = [
          { label: 'Ret. IVA', concepto: 'retencion_iva', monto: retIva, tipoPago: 'pago2', quincena: 1 },
          { label: 'Ret. ISLR', concepto: 'retencion_islr', monto: retIslr, tipoPago: 'pago2', quincena: 1 },
          { label: 'IGTF', concepto: 'igtf', monto: igtf, tipoPago: 'pago2', quincena: 1 },
        ];
        const sumatItems: LineItem[] = [
          { label: 'SUMAT (2.5% ventas)', concepto: 'sumat', monto: sumat, tipoPago: 'sumat', quincena: null },
        ];

        const ObligationLine = ({ item, colorClass }: { item: LineItem; colorClass: string }) => {
          const pago = getPago(item.tipoPago, item.concepto, item.quincena);
          const isNA = pago && pago.monto === 0 && pago.notes === 'No aplica';
          return (
            <div className="flex items-center justify-between py-1">
              <span className={`text-sm ${isNA ? 'text-gray-400 line-through' : pago ? 'text-green-700' : colorClass}`}>{item.label}</span>
              <div className="flex items-center gap-2">
                {isNA ? (
                  <span className="text-[10px] text-gray-400 font-medium">N/A</span>
                ) : (
                  <span className={`font-mono text-sm font-semibold ${pago ? 'text-green-800' : colorClass.replace('text-', 'text-').replace('800', '900').replace('700', '900')}`}>
                    {formatBs(pago ? pago.monto : item.monto)}
                  </span>
                )}
                {pago ? (
                  <button
                    onClick={() => setViewingPago(pago)}
                    className={`text-xs font-bold px-1.5 py-0.5 rounded ${isNA ? 'text-gray-400 hover:text-gray-600 bg-gray-100' : 'text-green-600 hover:text-green-800 bg-green-100'}`}
                    title={isNA ? 'No aplica — click para ver/eliminar' : `Pagado ${formatDateDMY(pago.fechaPago)}${pago.banco ? ' — ' + pago.banco : ''}`}
                  >
                    {isNA ? '—' : '✓'}
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openPagoForm(item.tipoPago, item.concepto, item.quincena, item.label, item.monto)}
                      className="text-ocean-500 hover:text-ocean-700 text-[10px] font-medium bg-ocean-50 hover:bg-ocean-100 px-1.5 py-0.5 rounded transition-colors"
                    >
                      Pagar
                    </button>
                    <button
                      onClick={() => handleMarkNA(item.tipoPago, item.concepto, item.quincena, item.label)}
                      className="text-gray-400 hover:text-gray-600 text-[10px] font-medium bg-gray-50 hover:bg-gray-100 px-1 py-0.5 rounded transition-colors"
                      title="Marcar como No Aplica"
                    >
                      N/A
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        };

        const cardPaidCount = (items: LineItem[]) => items.filter(i => getPago(i.tipoPago, i.concepto, i.quincena)).length;
        const allPago1Paid = cardPaidCount(pago1Items) === pago1Items.length;
        const allPago2Paid = cardPaidCount(pago2Items) === pago2Items.length;
        const allSumatPaid = cardPaidCount(sumatItems) === sumatItems.length;

        return (
          <div className="mt-6">
            <h3 className="text-base font-semibold text-ocean-900 mb-3">
              Obligaciones SENIAT — {MESES_ES[parseInt(dashboardPeriod.split('-')[1]) - 1]} {dashboardPeriod.split('-')[0]}
              <span className="ml-2 text-xs font-normal text-ocean-500">RIF terminado en 7</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* ── 1er pago: ret. 16-fin mes anterior + IVA mensual (contable) ── */}
              <div className={`rounded-xl p-5 shadow-sm border ${allPago1Paid ? 'border-green-300 bg-green-50' : 'border-sky-200 bg-sky-50'}`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className={`text-xs font-semibold uppercase tracking-wide ${allPago1Paid ? 'text-green-700' : 'text-sky-700'}`}>
                    1er pago — Q2 (16-fin)
                  </h4>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${allPago1Paid ? 'bg-green-100 text-green-600' : 'bg-sky-100 text-sky-600'}`}>
                    {cardPaidCount(pago1Items)}/{pago1Items.length}
                  </span>
                </div>
                <div className="space-y-0.5 mb-3">
                  {pago1Items.slice(0, 3).map(item => (
                    <ObligationLine key={item.concepto} item={item} colorClass="text-sky-800" />
                  ))}
                  <div className={`border-t mt-1.5 pt-1.5 ${allPago1Paid ? 'border-green-200' : 'border-sky-200'}`}>
                    <ObligationLine item={pago1Items[3]} colorClass="text-sky-800" />
                  </div>
                </div>
                <DateBadge date={pago1} isPast={isPago1Past} label={labelPago1} />
              </div>

              {/* ── 2do pago: ret. 1-15 mes actual ── */}
              <div className={`rounded-xl p-5 shadow-sm border ${allPago2Paid ? 'border-green-300 bg-green-50' : 'border-indigo-200 bg-indigo-50'}`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className={`text-xs font-semibold uppercase tracking-wide ${allPago2Paid ? 'text-green-700' : 'text-indigo-700'}`}>
                    2do pago — Q1 (1-15)
                  </h4>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${allPago2Paid ? 'bg-green-100 text-green-600' : 'bg-indigo-100 text-indigo-600'}`}>
                    {cardPaidCount(pago2Items)}/{pago2Items.length}
                  </span>
                </div>
                <div className="space-y-0.5 mb-3">
                  {pago2Items.map(item => (
                    <ObligationLine key={item.concepto} item={item} colorClass="text-indigo-800" />
                  ))}
                </div>
                <DateBadge date={pago2} isPast={isPago2Past} label={labelPago2} />
              </div>

              {/* ── SUMAT ── */}
              <div className={`rounded-xl p-5 shadow-sm border ${allSumatPaid ? 'border-green-300 bg-green-50' : 'border-rose-200 bg-rose-50'}`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className={`text-xs font-semibold uppercase tracking-wide ${allSumatPaid ? 'text-green-700' : 'text-rose-700'}`}>
                    Mensual
                  </h4>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${allSumatPaid ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'}`}>SUMAT</span>
                </div>
                <div className="space-y-0.5 mb-3">
                  {sumatItems.map(item => (
                    <ObligationLine key={item.concepto} item={item} colorClass="text-rose-800" />
                  ))}
                </div>
                <p className="text-[10px] text-rose-500 mt-1">
                  Declaración IVA (firma personal) se hace 1 vez/mes
                </p>
              </div>
            </div>
            <p className="text-[11px] text-ocean-400 mt-2">
              * Montos estimados del período. El monto real se registra al pagar cada concepto.
            </p>
          </div>
        );
      })()}

      {/* ── Modal: Registrar Pago SENIAT ── */}
      {showPagoForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowPagoForm(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-ocean-900">Registrar pago</h3>
                  <p className="text-sm text-ocean-600">
                    {showPagoForm.label}
                    {showPagoForm.quincena ? ` — Q${showPagoForm.quincena} (${showPagoForm.quincena === 1 ? '1-15' : '16-fin'})` : ' — mensual'}
                  </p>
                </div>
                <button onClick={() => setShowPagoForm(null)} className="text-ocean-400 hover:text-ocean-600 text-xl">&times;</button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-ocean-700 mb-1">Fecha de pago</label>
                    <input type="date" value={pagoForm.fechaPago}
                      onChange={e => setPagoForm(f => ({ ...f, fechaPago: e.target.value }))}
                      className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ocean-700 mb-1">Monto (Bs)</label>
                    <input type="number" step="0.01" min="0" value={pagoForm.monto}
                      onChange={e => setPagoForm(f => ({ ...f, monto: e.target.value }))}
                      className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none font-mono" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-ocean-700 mb-1">Número de planilla</label>
                  <input type="text" value={pagoForm.numeroPlanilla}
                    onChange={e => setPagoForm(f => ({ ...f, numeroPlanilla: e.target.value }))}
                    placeholder="Ej: 0590123456"
                    className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-ocean-700 mb-1">Referencia bancaria</label>
                    <input type="text" value={pagoForm.referenciaBancaria}
                      onChange={e => setPagoForm(f => ({ ...f, referenciaBancaria: e.target.value }))}
                      className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ocean-700 mb-1">Banco</label>
                    <input type="text" value={pagoForm.banco}
                      onChange={e => setPagoForm(f => ({ ...f, banco: e.target.value }))}
                      placeholder="Ej: Banesco, Provincial..."
                      className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-ocean-700 mb-1">Nota (opcional)</label>
                  <input type="text" value={pagoForm.notes}
                    onChange={e => setPagoForm(f => ({ ...f, notes: e.target.value }))}
                    className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ocean-700 mb-1">Comprobante (imagen)</label>
                  <input
                    ref={pagoFileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={e => setPagoImage(e.target.files?.[0] || null)}
                    className="w-full text-sm text-ocean-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-ocean-100 file:text-ocean-700 hover:file:bg-ocean-200"
                  />
                  {pagoImage && (
                    <p className="text-xs text-ocean-500 mt-1">{pagoImage.name} ({(pagoImage.size / 1024).toFixed(0)} KB)</p>
                  )}
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setShowPagoForm(null)} className="flex-1 py-2 px-4 rounded-lg border border-ocean-200 text-ocean-700 text-sm hover:bg-ocean-50">
                    Cancelar
                  </button>
                  <button onClick={handleSavePago} disabled={savingPago || !pagoForm.monto}
                    className="flex-1 py-2 px-4 rounded-lg bg-ocean-600 text-white text-sm font-semibold hover:bg-ocean-700 disabled:opacity-50 disabled:cursor-not-allowed">
                    {savingPago ? 'Guardando...' : 'Guardar pago'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Ver detalle de pago ── */}
      {viewingPago && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setViewingPago(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-ocean-900">
                  Detalle — {viewingPago.concepto === 'retencion_iva' ? 'Ret. IVA' : viewingPago.concepto === 'retencion_islr' ? 'Ret. ISLR' : viewingPago.concepto === 'igtf' ? 'IGTF' : viewingPago.concepto === 'iva_neto' ? 'IVA neto' : 'SUMAT'}
                  {viewingPago.quincena ? ` Q${viewingPago.quincena}` : ''}
                </h3>
                <button onClick={() => setViewingPago(null)} className="text-ocean-400 hover:text-ocean-600 text-xl">&times;</button>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between py-2 border-b border-ocean-100">
                  <span className="text-ocean-600">Monto</span>
                  <span className="font-mono font-bold text-ocean-900">{formatBs(viewingPago.monto)}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-ocean-100">
                  <span className="text-ocean-600">Fecha de pago</span>
                  <span className="text-ocean-900">{formatDateDMY(viewingPago.fechaPago)}</span>
                </div>
                {viewingPago.numeroPlanilla && (
                  <div className="flex justify-between py-2 border-b border-ocean-100">
                    <span className="text-ocean-600">N° Planilla</span>
                    <span className="font-mono text-ocean-900">{viewingPago.numeroPlanilla}</span>
                  </div>
                )}
                {viewingPago.referenciaBancaria && (
                  <div className="flex justify-between py-2 border-b border-ocean-100">
                    <span className="text-ocean-600">Ref. bancaria</span>
                    <span className="font-mono text-ocean-900">{viewingPago.referenciaBancaria}</span>
                  </div>
                )}
                {viewingPago.banco && (
                  <div className="flex justify-between py-2 border-b border-ocean-100">
                    <span className="text-ocean-600">Banco</span>
                    <span className="text-ocean-900">{viewingPago.banco}</span>
                  </div>
                )}
                {viewingPago.notes && (
                  <div className="flex justify-between py-2 border-b border-ocean-100">
                    <span className="text-ocean-600">Nota</span>
                    <span className="text-ocean-900">{viewingPago.notes}</span>
                  </div>
                )}
                {viewingPago.imageUrl && (
                  <div className="pt-2">
                    <p className="text-xs font-medium text-ocean-700 mb-2">Comprobante:</p>
                    <img src={viewingPago.imageUrl} alt="Comprobante de pago" className="w-full rounded-lg border border-ocean-200" />
                  </div>
                )}
              </div>
              <div className="flex gap-3 mt-5 pt-3 border-t border-ocean-100">
                <button onClick={() => setViewingPago(null)} className="flex-1 py-2 px-4 rounded-lg border border-ocean-200 text-ocean-700 text-sm hover:bg-ocean-50">
                  Cerrar
                </button>
                <button onClick={() => handleDeletePago(viewingPago.id)}
                  className="py-2 px-4 rounded-lg bg-red-50 text-red-600 text-sm font-medium hover:bg-red-100 border border-red-200">
                  Eliminar pago
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!dashboardData && (
        <div className="text-center py-12 text-ocean-600">
          No hay datos para el período seleccionado
        </div>
      )}
    </div>
  );


  const renderProveedores = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-ocean-900">Proveedores</h2>
        <button
          onClick={() => {
            resetProveedorForm();
            setEditingProveedor(null);
            setShowProveedorModal(true);
          }}
          className="px-4 py-2 bg-ocean-600 text-white rounded-lg text-sm hover:bg-ocean-500"
        >
          + Nuevo Proveedor
        </button>
      </div>

      {proveedoresLoading ? (
        <div className="text-center py-12 text-ocean-600">Cargando...</div>
      ) : proveedores.length === 0 ? (
        <div className="text-center py-12 text-ocean-600">
          No hay proveedores registrados
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-ocean-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ocean-600">RIF</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ocean-600">Nombre</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ocean-600">Teléfono</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-ocean-600">Ret. IVA</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-ocean-600">ISLR</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-ocean-600">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ocean-100">
                {proveedores.map((p) => (
                  <tr key={p.id} className="hover:bg-ocean-50/50">
                    <td className="px-4 py-3 text-sm font-mono text-ocean-900">{p.rif}</td>
                    <td className="px-4 py-3 text-sm text-ocean-900">{p.nombre}</td>
                    <td className="px-4 py-3 text-sm text-ocean-600">{p.telefono || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        p.retencionIvaPct === 100
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {p.retencionIvaPct}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-ocean-600">{p.islrPct}%</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => {
                            setEditingProveedor(p);
                            setProveedorFormData({
                              rif: p.rif,
                              nombre: p.nombre,
                              direccion: p.direccion || '',
                              telefono: p.telefono || '',
                              email: p.email || '',
                              retencionIvaPct: p.retencionIvaPct,
                              islrPct: p.islrPct,
                            });
                            setShowProveedorModal(true);
                          }}
                          className="text-ocean-600 hover:text-ocean-800"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleDeleteProveedor(p.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  const renderReportesZ = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-ocean-900">Reportes Z</h2>
        <button
          onClick={() => {
            resetZForm();
            setEditingReporteZ(null);
            setShowZModal(true);
          }}
          className="px-4 py-2 bg-ocean-600 text-white rounded-lg text-sm hover:bg-ocean-500"
        >
          + Nuevo Reporte Z
        </button>
      </div>

      {reportesZLoading ? (
        <div className="text-center py-12 text-ocean-600">Cargando...</div>
      ) : reportesZ.length === 0 ? (
        <div className="text-center py-12 text-ocean-600">
          No hay reportes Z registrados
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-ocean-50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-ocean-600">Fecha</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-ocean-600">Día</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-ocean-600">Total Bs</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-ocean-600">Tasa</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-ocean-600">Total $</th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-ocean-600">vs Sem.</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-ocean-600">Gravable</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-ocean-600">IVA</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-ocean-600">IGTF</th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-ocean-600">OCR</th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-ocean-600">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ocean-100">
                {reportesZ.map((r) => (
                  <tr key={r.id} className="hover:bg-ocean-50/50">
                    <td className="px-3 py-3 text-sm font-medium text-ocean-900">{formatDateReadable(r.fecha)}</td>
                    <td className="px-3 py-3 text-xs text-ocean-500 capitalize">{r.diaSemana || '—'}</td>
                    <td className="px-3 py-3 text-sm text-right text-ocean-900 font-semibold">{formatBs(r.totalVentas)}</td>
                    <td className="px-3 py-3 text-xs text-right">
                      {editingRateId === r.id ? (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={editingRateValue}
                            onChange={e => setEditingRateValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleSaveRateOverride(r.id);
                              if (e.key === 'Escape') setEditingRateId(null);
                            }}
                            autoFocus
                            className="w-20 px-1.5 py-0.5 border border-ocean-300 rounded text-xs font-mono text-right focus:ring-1 focus:ring-ocean-500 outline-none"
                          />
                          <button onClick={() => handleSaveRateOverride(r.id)} className="text-green-600 hover:text-green-800 text-sm" title="Guardar">✓</button>
                          <button onClick={() => setEditingRateId(null)} className="text-red-500 hover:text-red-700 text-sm" title="Cancelar">✕</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingRateId(r.id);
                            setEditingRateValue(r.bcvRate ? r.bcvRate.toFixed(2) : '');
                          }}
                          className={`hover:underline cursor-pointer ${r.bcvRateOverride ? 'text-amber-600 font-semibold' : 'text-ocean-400'}`}
                          title={r.bcvRateOverride ? 'Tasa manual — click para editar' : 'Click para editar tasa'}
                        >
                          {r.bcvRate ? r.bcvRate.toFixed(2) : '—'}
                          {r.bcvRateOverride ? ' *' : ''}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-3 text-sm text-right text-green-700 font-bold">
                      {r.totalVentasUsd != null ? formatUSD(r.totalVentasUsd) : '—'}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {r.variacionSemana != null ? (
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded ${
                            r.variacionSemana >= 0
                              ? 'bg-green-50 text-green-700'
                              : 'bg-red-50 text-red-700'
                          }`}
                          title={r.fechaAnterior
                            ? `vs ${formatDateReadable(r.fechaAnterior)} (${r.totalVentasUsdAnterior != null ? formatUSD(r.totalVentasUsdAnterior) : ''})`
                            : ''
                          }
                        >
                          {r.variacionSemana >= 0 ? '+' : ''}{(r.variacionSemana * 100).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-ocean-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-sm text-right text-ocean-600">{formatBs(r.subtotalGravable)}</td>
                    <td className="px-3 py-3 text-sm text-right text-green-600 font-medium">{formatBs(r.ivaCobrado)}</td>
                    <td className="px-3 py-3 text-sm text-right text-amber-700 font-medium">{formatBs(r.igtfVentas)}</td>
                    <td className="px-3 py-3 text-center">
                      {r.ocrVerified ? (
                        <span className="text-green-600 text-xs">OK</span>
                      ) : r.imageUrl ? (
                        <span className="text-amber-600 text-xs">Pend</span>
                      ) : (
                        <span className="text-ocean-400 text-xs">Man</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => {
                            setEditingReporteZ(r);
                            setZFormData({
                              fecha: r.fecha,
                              subtotalExento: r.subtotalExento,
                              subtotalGravable: r.subtotalGravable,
                              ivaCobrado: r.ivaCobrado,
                              baseImponibleIgtf: r.baseImponibleIgtf || 0,
                              igtfVentas: r.igtfVentas || 0,
                              totalVentas: r.totalVentas,
                              numeracionFacturas: r.numeracionFacturas || '',
                              notes: r.notes || '',
                            });
                            setOcrStep('manual');
                            setShowZModal(true);
                          }}
                          className="text-ocean-600 hover:text-ocean-800"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleDeleteReporteZ(r.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  const renderFacturas = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-ocean-900">Facturas de Compra</h2>
        <button
          onClick={() => {
            resetFacturaForm();
            setEditingFactura(null);
            setShowFacturaModal(true);
          }}
          className="px-4 py-2 bg-ocean-600 text-white rounded-lg text-sm hover:bg-ocean-500"
        >
          + Nueva Factura
        </button>
      </div>

      {facturasLoading ? (
        <div className="text-center py-12 text-ocean-600">Cargando...</div>
      ) : facturas.length === 0 ? (
        <div className="text-center py-12 text-ocean-600">
          No hay facturas registradas
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-ocean-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ocean-600">Fecha</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ocean-600">Proveedor</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ocean-600">No. Factura</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ocean-600">Total</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ocean-600">Ret. IVA</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ocean-600">Ant. ISLR</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-ocean-600">Moneda</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-ocean-600">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ocean-100">
                {facturas.map((f) => (
                  <tr key={f.id} className="hover:bg-ocean-50/50">
                    <td className="px-4 py-3 text-sm text-ocean-900">{formatDateReadable(f.fechaFactura)}</td>
                    <td className="px-4 py-3 text-sm text-ocean-600">{f.proveedorNombre}</td>
                    <td className="px-4 py-3 text-sm font-mono text-ocean-900">{f.numeroFactura}</td>
                    <td className="px-4 py-3 text-sm text-right text-ocean-900 font-semibold">{formatBs(f.total)}</td>
                    <td className="px-4 py-3 text-sm text-right text-purple-600">{formatBs(f.retencionIva)}</td>
                    <td className="px-4 py-3 text-sm text-right text-amber-600">{formatBs(f.anticipoIslr)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        f.paymentCurrency === 'usd'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-ocean-100 text-ocean-700'
                      }`}>
                        {f.paymentCurrency.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => handleGenerateRetencionPDF(f.id)}
                          className="text-purple-600 hover:text-purple-800"
                          title="Generar comprobante de retención"
                        >
                          PDF
                        </button>
                        <button
                          onClick={() => {
                            setEditingFactura(f);
                            setFacturaFormData({
                              proveedorId: f.proveedorId,
                              numeroFactura: f.numeroFactura,
                              numeroControl: f.numeroControl || '',
                              fechaFactura: f.fechaFactura,
                              fechaRecepcion: f.fechaRecepcion,
                              subtotalExento: f.subtotalExento,
                              subtotalGravable: f.subtotalGravable,
                              iva: f.iva,
                              paymentCurrency: f.paymentCurrency,
                              exchangeRate: f.exchangeRate,
                              notes: f.notes || '',
                            });
                            setShowFacturaModal(true);
                          }}
                          className="text-ocean-600 hover:text-ocean-800"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleDeleteFactura(f.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  // State for retenciones period filter
  const [retencionesPeriodo, setRetencionesPeriodo] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // Filter retenciones by period
  const retencionesFiltradas = retenciones.filter(r => r.periodoFiscal === retencionesPeriodo);

  // Calculate totals for the period
  const retencionesTotals = retencionesFiltradas.reduce((acc, r) => ({
    montoRetenido: acc.montoRetenido + r.montoRetenido,
    cantidad: acc.cantidad + 1,
  }), { montoRetenido: 0, cantidad: 0 });

  // Export retenciones
  const handleExportRetenciones = async (format: 'txt' | 'csv') => {
    try {
      const response = await fetch(`/api/fiscal/retenciones/export?periodo=${retencionesPeriodo}&format=${format}`, {
        credentials: 'include',
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `retenciones_iva_${retencionesPeriodo.replace('-', '')}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        setSuccess(`Archivo ${format.toUpperCase()} descargado`);
      } else {
        const data = await response.json();
        setError(data.error || 'Error al exportar');
      }
    } catch (err) {
      console.error('Error exporting:', err);
      setError('Error de conexión');
    }
  };

  const renderRetenciones = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h2 className="text-xl font-semibold text-ocean-900">Comprobantes de Retención IVA</h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              resetRetencionForm();
              setEditingRetencion(null);
              setShowRetencionModal(true);
            }}
            className="px-4 py-2 bg-ocean-600 text-white rounded-lg text-sm hover:bg-ocean-500"
          >
            + Nueva
          </button>
        </div>
      </div>

      {/* Period selector and export buttons */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-ocean-700">Período:</label>
            <input
              type="month"
              value={retencionesPeriodo}
              onChange={(e) => setRetencionesPeriodo(e.target.value)}
              className="px-3 py-2 border border-ocean-200 rounded-lg text-sm"
            />
          </div>

          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => handleExportRetenciones('txt')}
              disabled={retencionesFiltradas.length === 0}
              className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-500 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1"
              title="Descargar formato SENIAT (TXT)"
            >
              <span>📄</span> TXT SENIAT
            </button>
            <button
              onClick={() => handleExportRetenciones('csv')}
              disabled={retencionesFiltradas.length === 0}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-500 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1"
              title="Descargar Excel/CSV"
            >
              <span>📊</span> CSV
            </button>
          </div>
        </div>

        {/* Summary for the period */}
        {retencionesFiltradas.length > 0 && (
          <div className="mt-4 pt-4 border-t border-ocean-100">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-ocean-900">{retencionesTotals.cantidad}</div>
                <div className="text-xs text-ocean-600">Retenciones</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{formatBs(retencionesTotals.montoRetenido)}</div>
                <div className="text-xs text-purple-600">Total Retenido</div>
              </div>
              <div className="text-center col-span-2 sm:col-span-2">
                <div className="text-sm text-ocean-700 bg-amber-50 rounded-lg p-2">
                  <strong>Declarar antes del:</strong> 15 de {(() => {
                    const [y, m] = retencionesPeriodo.split('-').map(Number);
                    const nextMonth = m === 12 ? 1 : m + 1;
                    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
                    return months[nextMonth - 1];
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-ocean-50 rounded-lg p-3 text-sm text-ocean-700">
        <p><strong>TXT SENIAT:</strong> Archivo para subir al portal de declaraciones. <strong>CSV:</strong> Para abrir en Excel.</p>
      </div>

      {retencionesLoading ? (
        <div className="text-center py-12 text-ocean-600">Cargando...</div>
      ) : retencionesFiltradas.length === 0 ? (
        <div className="text-center py-12 text-ocean-600">
          No hay comprobantes de retención para {retencionesPeriodo}.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-ocean-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ocean-600">No. Comprobante</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ocean-600">Fecha Emisión</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ocean-600">Período</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ocean-600">Proveedor</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ocean-600">Factura</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ocean-600">Monto Retenido</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-ocean-600">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ocean-100">
                {retencionesFiltradas.map((r) => (
                  <tr key={r.id} className="hover:bg-ocean-50/50">
                    <td className="px-4 py-3 text-sm font-mono text-ocean-900">{r.numeroComprobante}</td>
                    <td className="px-4 py-3 text-sm text-ocean-600">{formatDateReadable(r.fechaEmision)}</td>
                    <td className="px-4 py-3 text-sm text-ocean-600">{r.periodoFiscal}</td>
                    <td className="px-4 py-3 text-sm text-ocean-900">{r.proveedorNombre || '-'}</td>
                    <td className="px-4 py-3 text-sm font-mono text-ocean-600">{r.numeroFactura || '-'}</td>
                    <td className="px-4 py-3 text-sm text-right text-purple-600 font-semibold">
                      {formatBs(r.montoRetenido)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        {r.facturaId && (
                          <>
                            <button
                              onClick={() => handleGenerateRetencionPDF(r.facturaId)}
                              className="text-purple-600 hover:text-purple-800"
                              title="Imprimir comprobante de retención"
                            >
                              PDF
                            </button>
                            <button
                              onClick={() => handleDownloadComprobanteImage(r.facturaId)}
                              className="text-green-600 hover:text-green-800"
                              title="Descargar comprobante como imagen"
                            >
                              IMG
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => {
                            setEditingRetencion(r);
                            setRetencionFormData({
                              facturaId: r.facturaId,
                              numeroComprobante: r.numeroComprobante,
                              fechaEmision: r.fechaEmision,
                              periodoFiscal: r.periodoFiscal,
                              montoRetenido: r.montoRetenido,
                            });
                            setShowRetencionModal(true);
                          }}
                          className="text-ocean-600 hover:text-ocean-800"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleDeleteRetencion(r.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  const renderPagos = () => {
    // Agrupar pagos por período
    const byPeriod: Record<string, FiscalPagoSeniat[]> = {};
    for (const p of pagosTabData) {
      if (!byPeriod[p.periodo]) byPeriod[p.periodo] = [];
      byPeriod[p.periodo].push(p);
    }
    const periods = Object.keys(byPeriod).sort((a, b) => b.localeCompare(a));
    const rate = bcvRate?.rate || 1;

    // Totales del año
    const totalBsYear = pagosTabData.reduce((s, p) => s + p.monto, 0);

    // Conceptos extras (no vinculados a las tarjetas del dashboard)
    const EXTRA_CONCEPTOS: { value: ConceptoPago; label: string }[] = [
      { value: 'multa', label: 'Multa' },
      { value: 'islr_anual', label: 'ISLR anual' },
      { value: 'grandes_patrimonios', label: 'Grandes Patrimonios' },
      { value: 'retencion_iva', label: 'Ret. IVA (extra)' },
      { value: 'retencion_islr', label: 'Ret. ISLR (extra)' },
      { value: 'igtf', label: 'IGTF (extra)' },
      { value: 'iva_neto', label: 'IVA neto (extra)' },
      { value: 'sumat', label: 'SUMAT (extra)' },
      { value: 'otro', label: 'Otro' },
    ];

    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-ocean-900">Historial de Pagos</h2>
          <div className="flex items-center gap-3">
            <select
              value={pagosTabYear}
              onChange={e => setPagosTabYear(e.target.value)}
              className="px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none"
            >
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              onClick={() => {
                setShowNewPagoModal(true);
                setNewPagoForm(f => ({
                  ...f,
                  periodo: `${pagosTabYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
                  fechaPago: new Date().toISOString().split('T')[0],
                  monto: '',
                  numeroPlanilla: '',
                  referenciaBancaria: '',
                  banco: '',
                  notes: '',
                  concepto: 'multa' as ConceptoPago,
                }));
                setNewPagoImage(null);
              }}
              className="px-4 py-2 bg-ocean-600 text-white rounded-lg text-sm font-semibold hover:bg-ocean-700"
            >
              + Agregar pago
            </button>
          </div>
        </div>

        {/* Resumen año */}
        {pagosTabData.length > 0 && (
          <div className="bg-ocean-50 rounded-xl p-4 flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-ocean-500">Total {pagosTabYear} (Bs)</p>
              <p className="text-lg font-bold text-ocean-900 font-mono">{formatBs(totalBsYear)}</p>
            </div>
            <div>
              <p className="text-xs text-ocean-500">Equivalente USD (tasa {rate.toFixed(2)})</p>
              <p className="text-lg font-bold text-green-700 font-mono">{formatUSD(totalBsYear / rate)}</p>
            </div>
            <div>
              <p className="text-xs text-ocean-500">Pagos registrados</p>
              <p className="text-lg font-bold text-ocean-900">{pagosTabData.length}</p>
            </div>
          </div>
        )}

        {pagosTabLoading ? (
          <div className="text-center py-8 text-ocean-500">Cargando...</div>
        ) : periods.length === 0 ? (
          <div className="text-center py-12 text-ocean-400">No hay pagos registrados en {pagosTabYear}</div>
        ) : (
          periods.map(periodo => {
            const pagos = byPeriod[periodo];
            const totalBs = pagos.reduce((s, p) => s + p.monto, 0);
            const [y, m] = periodo.split('-');
            const mesLabel = `${MESES_ES[parseInt(m) - 1]} ${y}`;

            return (
              <div key={periodo} className="bg-white rounded-xl shadow-sm border border-ocean-100 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 bg-ocean-50 border-b border-ocean-100">
                  <h3 className="font-semibold text-ocean-900">{mesLabel}</h3>
                  <div className="flex gap-4 text-sm">
                    <span className="font-mono font-semibold text-ocean-800">{formatBs(totalBs)}</span>
                    <span className="font-mono font-semibold text-green-700">{formatUSD(totalBs / rate)}</span>
                  </div>
                </div>
                <div className="divide-y divide-ocean-50">
                  {pagos.map(p => (
                    <div key={p.id} className="flex items-center justify-between px-5 py-3 hover:bg-ocean-50/50">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                          p.tipoPago === 'otro' ? 'bg-purple-100 text-purple-700' :
                          p.tipoPago === 'pago1' ? 'bg-sky-100 text-sky-700' :
                          p.tipoPago === 'pago2' ? 'bg-indigo-100 text-indigo-700' :
                          'bg-rose-100 text-rose-700'
                        }`}>
                          {p.concepto ? (CONCEPTO_LABELS[p.concepto] || p.concepto) : p.tipoPago}
                        </span>
                        {p.quincena && <span className="text-[10px] text-ocean-400">Q{p.quincena}</span>}
                        <span className="text-xs text-ocean-500 truncate">{formatDateDMY(p.fechaPago)}</span>
                        {p.banco && <span className="text-xs text-ocean-400 hidden sm:inline">· {p.banco}</span>}
                        {p.notes && <span className="text-xs text-ocean-400 hidden md:inline truncate">· {p.notes}</span>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <p className="font-mono text-sm font-semibold text-ocean-900">{formatBs(p.monto)}</p>
                          <p className="font-mono text-xs text-green-600">{formatUSD(p.monto / rate)}</p>
                        </div>
                        <div className="flex gap-1">
                          {p.imageUrl && (
                            <button onClick={() => setViewingPago(p)} className="text-ocean-400 hover:text-ocean-600 text-xs">
                              ver
                            </button>
                          )}
                          <button onClick={() => handleDeletePago(p.id)} className="text-red-400 hover:text-red-600 text-xs">
                            ×
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}

        {/* Modal: Nuevo Pago Extra */}
        {showNewPagoModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowNewPagoModal(false)}>
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-ocean-900">Agregar pago</h3>
                  <button onClick={() => setShowNewPagoModal(false)} className="text-ocean-400 hover:text-ocean-600 text-xl">&times;</button>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-ocean-700 mb-1">Período</label>
                      <input type="month" value={newPagoForm.periodo}
                        onChange={e => setNewPagoForm(f => ({ ...f, periodo: e.target.value }))}
                        className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ocean-700 mb-1">Concepto</label>
                      <select value={newPagoForm.concepto}
                        onChange={e => setNewPagoForm(f => ({ ...f, concepto: e.target.value as ConceptoPago }))}
                        className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none">
                        {EXTRA_CONCEPTOS.map(c => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-ocean-700 mb-1">Fecha de pago</label>
                      <input type="date" value={newPagoForm.fechaPago}
                        onChange={e => setNewPagoForm(f => ({ ...f, fechaPago: e.target.value }))}
                        className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ocean-700 mb-1">Monto (Bs)</label>
                      <input type="number" step="0.01" min="0" value={newPagoForm.monto}
                        onChange={e => setNewPagoForm(f => ({ ...f, monto: e.target.value }))}
                        className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none font-mono" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ocean-700 mb-1">Número de planilla</label>
                    <input type="text" value={newPagoForm.numeroPlanilla}
                      onChange={e => setNewPagoForm(f => ({ ...f, numeroPlanilla: e.target.value }))}
                      className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-ocean-700 mb-1">Referencia bancaria</label>
                      <input type="text" value={newPagoForm.referenciaBancaria}
                        onChange={e => setNewPagoForm(f => ({ ...f, referenciaBancaria: e.target.value }))}
                        className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ocean-700 mb-1">Banco</label>
                      <input type="text" value={newPagoForm.banco}
                        onChange={e => setNewPagoForm(f => ({ ...f, banco: e.target.value }))}
                        className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ocean-700 mb-1">Nota (opcional)</label>
                    <input type="text" value={newPagoForm.notes}
                      onChange={e => setNewPagoForm(f => ({ ...f, notes: e.target.value }))}
                      className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ocean-700 mb-1">Comprobante (imagen)</label>
                    <input ref={newPagoFileRef} type="file" accept="image/*"
                      onChange={e => setNewPagoImage(e.target.files?.[0] || null)}
                      className="w-full text-sm text-ocean-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-ocean-100 file:text-ocean-700 hover:file:bg-ocean-200" />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button onClick={() => setShowNewPagoModal(false)} className="flex-1 py-2 px-4 rounded-lg border border-ocean-200 text-ocean-700 text-sm hover:bg-ocean-50">
                      Cancelar
                    </button>
                    <button onClick={handleCreateExtraPago} disabled={savingNewPago || !newPagoForm.monto}
                      className="flex-1 py-2 px-4 rounded-lg bg-ocean-600 text-white text-sm font-semibold hover:bg-ocean-700 disabled:opacity-50 disabled:cursor-not-allowed">
                      {savingNewPago ? 'Guardando...' : 'Guardar pago'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSimulador = () => (
    <div className="max-w-2xl mx-auto space-y-6">
      <h2 className="text-xl font-semibold text-ocean-900">Simulador de Margen Fiscal</h2>

      <div className="bg-white rounded-xl p-6 shadow-sm space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ocean-700 mb-1">Costo Unitario (Bs.)</label>
            <input
              type="number"
              value={simuladorInput.costo || ''}
              onChange={(e) => setSimuladorInput({ ...simuladorInput, costo: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ocean-700 mb-1">Precio Venta (Bs.)</label>
            <input
              type="number"
              value={simuladorInput.precioVenta || ''}
              onChange={(e) => setSimuladorInput({ ...simuladorInput, precioVenta: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ocean-700 mb-1">Cantidad</label>
            <input
              type="number"
              value={simuladorInput.cantidad || ''}
              onChange={(e) => setSimuladorInput({ ...simuladorInput, cantidad: parseInt(e.target.value) || 1 })}
              className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              min="1"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={simuladorInput.pagoEnUsd}
                onChange={(e) => setSimuladorInput({ ...simuladorInput, pagoEnUsd: e.target.checked })}
                className="w-4 h-4 text-ocean-600 rounded"
              />
              <span className="text-sm text-ocean-700">Pago en USD (aplica IGTF 3%)</span>
            </label>
          </div>
        </div>
      </div>

      {simuladorResult && (
        <div className="bg-gradient-to-br from-ocean-50 to-ocean-100 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-lg font-semibold text-ocean-900">Resultados</h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-lg p-4">
              <div className="text-sm text-ocean-600">Ingresos Brutos</div>
              <div className="text-xl font-bold text-ocean-900">{formatBs(simuladorResult.ingresosBrutos)}</div>
            </div>
            <div className="bg-white rounded-lg p-4">
              <div className="text-sm text-ocean-600">Costo Total</div>
              <div className="text-xl font-bold text-red-600">{formatBs(simuladorResult.costoTotal)}</div>
            </div>
          </div>

          <div className="bg-white rounded-lg p-4">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-sm text-ocean-600">Margen Bruto</div>
                <div className="text-xl font-bold text-green-600">{formatBs(simuladorResult.margenBruto)}</div>
              </div>
              <div className="text-2xl font-bold text-green-600">{formatPercent(simuladorResult.margenBrutoPct)}</div>
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 space-y-2">
            <div className="text-sm font-medium text-ocean-700">Impuestos Estimados</div>
            <div className="flex justify-between text-sm">
              <span className="text-ocean-600">IVA (8%)</span>
              <span className="text-ocean-900">{formatBs(simuladorResult.iva)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-ocean-600">ISLR Estimado (1%)</span>
              <span className="text-ocean-900">{formatBs(simuladorResult.islrEstimado)}</span>
            </div>
            {simuladorInput.pagoEnUsd && (
              <div className="flex justify-between text-sm">
                <span className="text-ocean-600">IGTF (3%)</span>
                <span className="text-ocean-900">{formatBs(simuladorResult.igtf)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-ocean-600">SUMAT (2.5%)</span>
              <span className="text-ocean-900">{formatBs(simuladorResult.sumat)}</span>
            </div>
          </div>

          <div className="bg-gradient-to-r from-ocean-600 to-ocean-700 rounded-lg p-4 text-white">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-sm text-ocean-200">Margen Neto</div>
                <div className="text-2xl font-bold">{formatBs(simuladorResult.margenNeto)}</div>
              </div>
              <div className="text-3xl font-bold">{formatPercent(simuladorResult.margenNetoPct)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderConsultas = () => (
    <div className="max-w-3xl mx-auto space-y-6">
      <h2 className="text-xl font-semibold text-ocean-900">Consultas Fiscales con IA</h2>

      <div className="bg-ocean-50 rounded-xl p-4 text-sm text-ocean-700">
        <p>Pregunta sobre IVA, ISLR, retenciones, IGTF, SUMAT, obligaciones SENIAT, y más.</p>
        <p className="mt-1 text-ocean-600">Las respuestas son orientativas. Consulta con un contador para decisiones importantes.</p>
      </div>

      {consultaHistory.length > 0 && (
        <div className="space-y-4 max-h-96 overflow-y-auto">
          {consultaHistory.map((item, idx) => (
            <div key={idx} className="space-y-2">
              <div className="bg-ocean-100 rounded-lg p-3 text-sm text-ocean-900">
                <span className="font-medium">Pregunta:</span> {item.q}
              </div>
              <div className="bg-white rounded-lg p-3 text-sm text-ocean-800 border border-ocean-100">
                <span className="font-medium text-ocean-600">Respuesta:</span>
                <div className="mt-1 whitespace-pre-wrap">{item.a}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl p-4 shadow-sm space-y-4">
        <textarea
          value={consultaQuestion}
          onChange={(e) => setConsultaQuestion(e.target.value)}
          placeholder="Escribe tu pregunta fiscal aquí..."
          className="w-full px-3 py-2 border border-ocean-200 rounded-lg resize-none"
          rows={3}
        />
        <button
          onClick={handleConsulta}
          disabled={isConsulting || !consultaQuestion.trim()}
          className="w-full px-4 py-2 bg-ocean-600 text-white rounded-lg hover:bg-ocean-500 disabled:opacity-50"
        >
          {isConsulting ? 'Consultando...' : 'Enviar Consulta'}
        </button>
      </div>

      {consultaAnswer && (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-ocean-200">
          <h3 className="text-sm font-medium text-ocean-600 mb-2">Respuesta:</h3>
          <div className="text-sm text-ocean-800 whitespace-pre-wrap">{consultaAnswer}</div>
        </div>
      )}
    </div>
  );

  // =====================
  // Modals
  // =====================

  const renderProveedorModal = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-ocean-100">
          <h3 className="text-lg font-semibold text-ocean-900">
            {editingProveedor ? 'Editar Proveedor' : 'Nuevo Proveedor'}
          </h3>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ocean-700 mb-1">RIF *</label>
            <input
              type="text"
              value={proveedorFormData.rif}
              onChange={(e) => setProveedorFormData({ ...proveedorFormData, rif: e.target.value.toUpperCase() })}
              className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              placeholder="J-12345678-9"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ocean-700 mb-1">Nombre / Razón Social *</label>
            <input
              type="text"
              value={proveedorFormData.nombre}
              onChange={(e) => setProveedorFormData({ ...proveedorFormData, nombre: e.target.value })}
              className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ocean-700 mb-1">Dirección</label>
            <input
              type="text"
              value={proveedorFormData.direccion}
              onChange={(e) => setProveedorFormData({ ...proveedorFormData, direccion: e.target.value })}
              className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">Teléfono</label>
              <input
                type="text"
                value={proveedorFormData.telefono}
                onChange={(e) => setProveedorFormData({ ...proveedorFormData, telefono: e.target.value })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">Email</label>
              <input
                type="email"
                value={proveedorFormData.email}
                onChange={(e) => setProveedorFormData({ ...proveedorFormData, email: e.target.value })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">Retención IVA (%)</label>
              <select
                value={proveedorFormData.retencionIvaPct}
                onChange={(e) => setProveedorFormData({ ...proveedorFormData, retencionIvaPct: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              >
                <option value={75}>75% (Contribuyente Ordinario)</option>
                <option value={100}>100% (Contribuyente Especial)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">ISLR (%)</label>
              <input
                type="number"
                value={proveedorFormData.islrPct}
                onChange={(e) => setProveedorFormData({ ...proveedorFormData, islrPct: parseFloat(e.target.value) || 1.0 })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
                step="0.1"
              />
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-ocean-100 flex justify-end gap-2">
          <button
            onClick={() => {
              setShowProveedorModal(false);
              setEditingProveedor(null);
              resetProveedorForm();
            }}
            className="px-4 py-2 text-ocean-600 hover:bg-ocean-50 rounded-lg"
          >
            Cancelar
          </button>
          <button
            onClick={handleSaveProveedor}
            className="px-4 py-2 bg-ocean-600 text-white rounded-lg hover:bg-ocean-500"
          >
            {editingProveedor ? 'Actualizar' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );

  const renderZModal = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-ocean-100">
          <h3 className="text-lg font-semibold text-ocean-900">
            {editingReporteZ ? 'Editar Reporte Z' : 'Nuevo Reporte Z'}
          </h3>
        </div>
        <div className="p-4 space-y-4">
          {!editingReporteZ && (
            <div className="bg-ocean-50 rounded-lg p-3">
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setOcrStep('manual')}
                  className={`px-3 py-1 rounded text-sm ${ocrStep === 'manual' ? 'bg-ocean-600 text-white' : 'bg-white text-ocean-600'}`}
                >
                  Entrada Manual
                </button>
                <button
                  onClick={() => setOcrStep('upload')}
                  className={`px-3 py-1 rounded text-sm ${ocrStep !== 'manual' ? 'bg-ocean-600 text-white' : 'bg-white text-ocean-600'}`}
                >
                  Subir Foto (OCR)
                </button>
              </div>
              {ocrStep !== 'manual' && (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setOcrError(null);
                        handleOcrUpload(file);
                      }
                    }}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessingOcr}
                    className={`w-full py-3 border-2 border-dashed rounded-lg transition-colors ${
                      isProcessingOcr
                        ? 'border-ocean-400 bg-ocean-50 text-ocean-500'
                        : 'border-ocean-300 text-ocean-600 hover:bg-ocean-50'
                    }`}
                  >
                    {isProcessingOcr ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Procesando imagen con IA...
                      </span>
                    ) : 'Seleccionar imagen del reporte Z'}
                  </button>
                  {ocrError && (
                    <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                      <div className="flex items-start gap-2">
                        <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <p className="font-medium">Error al procesar imagen</p>
                          <p className="text-xs mt-1">{ocrError}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-2 text-xs text-red-600 underline hover:text-red-800"
                      >
                        Intentar con otra imagen
                      </button>
                    </div>
                  )}
                  {ocrData && !ocrError && (
                    <div className="mt-2 p-2 bg-green-50 rounded text-sm text-green-700">
                      Datos extraídos. Verifica y ajusta los valores abajo.
                      <span className="ml-2 text-xs text-green-600">
                        (Confianza: {Math.round((ocrData.confidence || 0) * 100)}%)
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-ocean-700 mb-1">Fecha *</label>
            <input
              type="date"
              value={zFormData.fecha}
              onChange={(e) => setZFormData({ ...zFormData, fecha: e.target.value })}
              className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">Subtotal Exento (Bs.)</label>
              <input
                type="number"
                value={zFormData.subtotalExento || ''}
                onChange={(e) => setZFormData({ ...zFormData, subtotalExento: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
                step="0.01"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">Subtotal Gravable (Bs.)</label>
              <input
                type="number"
                value={zFormData.subtotalGravable || ''}
                onChange={(e) => setZFormData({ ...zFormData, subtotalGravable: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
                step="0.01"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">IVA Cobrado (Bs.)</label>
              <input
                type="number"
                value={zFormData.ivaCobrado || ''}
                onChange={(e) => setZFormData({ ...zFormData, ivaCobrado: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
                step="0.01"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">Total Ventas (Bs.)</label>
              <input
                type="number"
                value={zFormData.totalVentas || ''}
                onChange={(e) => setZFormData({ ...zFormData, totalVentas: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
                step="0.01"
              />
            </div>
          </div>

          {/* Campos IGTF */}
          <div className="bg-green-50 rounded-lg p-3 space-y-3">
            <div className="text-sm font-medium text-green-700">IGTF (Ventas en Divisas)</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-green-700 mb-1">BI IGTF (Bs.)</label>
                <input
                  type="number"
                  value={zFormData.baseImponibleIgtf || ''}
                  onChange={(e) => setZFormData({ ...zFormData, baseImponibleIgtf: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-green-200 rounded-lg text-sm"
                  step="0.01"
                  placeholder="Base imponible IGTF"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-green-700 mb-1">IGTF Ventas 3% (Bs.)</label>
                <input
                  type="number"
                  value={zFormData.igtfVentas || ''}
                  onChange={(e) => setZFormData({ ...zFormData, igtfVentas: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-green-200 rounded-lg text-sm"
                  step="0.01"
                  placeholder="IGTF cobrado"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ocean-700 mb-1">Numeración de Facturas</label>
            <input
              type="text"
              value={zFormData.numeracionFacturas}
              onChange={(e) => setZFormData({ ...zFormData, numeracionFacturas: e.target.value })}
              className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              placeholder="001-050"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ocean-700 mb-1">Notas</label>
            <textarea
              value={zFormData.notes}
              onChange={(e) => setZFormData({ ...zFormData, notes: e.target.value })}
              className="w-full px-3 py-2 border border-ocean-200 rounded-lg resize-none"
              rows={2}
            />
          </div>
        </div>
        <div className="p-4 border-t border-ocean-100 flex justify-end gap-2">
          <button
            onClick={() => {
              setShowZModal(false);
              setEditingReporteZ(null);
              resetZForm();
            }}
            className="px-4 py-2 text-ocean-600 hover:bg-ocean-50 rounded-lg"
          >
            Cancelar
          </button>
          <button
            onClick={handleSaveReporteZ}
            className="px-4 py-2 bg-ocean-600 text-white rounded-lg hover:bg-ocean-500"
          >
            {editingReporteZ ? 'Actualizar' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );

  const renderFacturaModal = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-ocean-100">
          <h3 className="text-lg font-semibold text-ocean-900">
            {editingFactura ? 'Editar Factura' : 'Nueva Factura de Compra'}
          </h3>
        </div>
        <div className="p-4 space-y-4">
          {/* OCR Upload Section - Only show for new invoices */}
          {!editingFactura && (
            <div className="bg-gradient-to-r from-ocean-50 to-blue-50 rounded-lg p-4 border border-ocean-200">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">📷</span>
                <div>
                  <div className="font-medium text-ocean-900">Escanear Factura</div>
                  <div className="text-xs text-ocean-600">Sube una foto y la IA extraerá los datos</div>
                </div>
              </div>

              <input
                ref={facturaFileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFacturaImageUpload}
                className="hidden"
              />

              {isProcessingFacturaOcr ? (
                <div className="text-center py-4">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-ocean-600"></div>
                  <p className="mt-2 text-sm text-ocean-600">Procesando imagen con IA...</p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => facturaFileInputRef.current?.click()}
                  className="w-full px-4 py-3 bg-ocean-600 text-white rounded-lg hover:bg-ocean-500 flex items-center justify-center gap-2"
                >
                  <span>📸</span>
                  <span>Tomar Foto o Subir Imagen</span>
                </button>
              )}

              {facturaOcrError && (
                <div className="mt-2 p-2 bg-red-50 text-red-700 text-sm rounded">
                  {facturaOcrError}
                </div>
              )}

              {facturaOcrData && facturaOcrStep === 'review' && (
                <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center gap-2 text-green-700 text-sm font-medium mb-2">
                    <span>✓</span>
                    <span>Datos extraídos (confianza: {Math.round((facturaOcrData.confidence || 0) * 100)}%)</span>
                  </div>
                  <div className="text-xs text-green-600 space-y-1">
                    {facturaOcrData.proveedorNombre && <div>• {facturaOcrData.proveedorNombre}</div>}
                    {facturaOcrData.numeroFactura && <div>• Factura: {facturaOcrData.numeroFactura}</div>}
                    {facturaOcrData.total && <div>• Total: Bs. {facturaOcrData.total.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>}
                  </div>
                </div>
              )}

              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={() => setFacturaOcrStep('manual')}
                  className="text-xs text-ocean-500 hover:text-ocean-700 underline"
                >
                  Omitir y llenar manualmente
                </button>
              </div>
            </div>
          )}

          {/* Proveedor selector with create option */}
          <div>
            <label className="block text-sm font-medium text-ocean-700 mb-1">Proveedor *</label>
            <select
              value={facturaFormData.proveedorId}
              onChange={(e) => setFacturaFormData({ ...facturaFormData, proveedorId: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
            >
              <option value={0}>Seleccionar proveedor...</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} ({p.rif})
                </option>
              ))}
            </select>
            {/* Show create button if OCR found unregistered proveedor */}
            {facturaOcrData && facturaOcrData.proveedorRif && facturaFormData.proveedorId === 0 && (
              <div className="mt-2 p-2 bg-amber-50 rounded-lg border border-amber-200">
                <div className="text-sm text-amber-700 mb-2">
                  Proveedor no registrado: <strong>{facturaOcrData.proveedorNombre}</strong> ({facturaOcrData.proveedorRif})
                </div>
                <button
                  type="button"
                  onClick={handleCreateProveedorFromOcr}
                  className="px-3 py-1.5 bg-amber-600 text-white text-sm rounded hover:bg-amber-500"
                >
                  + Crear Proveedor
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">No. Factura *</label>
              <input
                type="text"
                value={facturaFormData.numeroFactura}
                onChange={(e) => setFacturaFormData({ ...facturaFormData, numeroFactura: e.target.value })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">No. Control</label>
              <input
                type="text"
                value={facturaFormData.numeroControl}
                onChange={(e) => setFacturaFormData({ ...facturaFormData, numeroControl: e.target.value })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">Fecha Factura</label>
              <input
                type="date"
                value={facturaFormData.fechaFactura}
                onChange={(e) => setFacturaFormData({ ...facturaFormData, fechaFactura: e.target.value })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">Fecha Recepción</label>
              <input
                type="date"
                value={facturaFormData.fechaRecepcion}
                onChange={(e) => setFacturaFormData({ ...facturaFormData, fechaRecepcion: e.target.value })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">Subtotal Exento (Bs.)</label>
              <input
                type="number"
                value={facturaFormData.subtotalExento || ''}
                onChange={(e) => setFacturaFormData({ ...facturaFormData, subtotalExento: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
                step="0.01"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">Subtotal Gravable (Bs.)</label>
              <input
                type="number"
                value={facturaFormData.subtotalGravable || ''}
                onChange={(e) => setFacturaFormData({ ...facturaFormData, subtotalGravable: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
                step="0.01"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">IVA (Bs.)</label>
              <input
                type="number"
                value={facturaFormData.iva || ''}
                onChange={(e) => setFacturaFormData({ ...facturaFormData, iva: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
                step="0.01"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">Moneda de Pago</label>
              <select
                value={facturaFormData.paymentCurrency}
                onChange={(e) => setFacturaFormData({ ...facturaFormData, paymentCurrency: e.target.value as 'bs' | 'usd' })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              >
                <option value="bs">Bolívares (Bs.)</option>
                <option value="usd">Dólares (USD)</option>
              </select>
            </div>
          </div>

          {facturaFormData.paymentCurrency === 'usd' && (
            <div className="bg-amber-50 rounded-lg p-3">
              <div className="text-sm text-amber-700">
                Pago en USD: Se aplicará IGTF (3%)
              </div>
              <div className="mt-2">
                <label className="block text-xs font-medium text-amber-700 mb-1">Tasa de Cambio</label>
                <input
                  type="number"
                  value={facturaFormData.exchangeRate || ''}
                  onChange={(e) => setFacturaFormData({ ...facturaFormData, exchangeRate: parseFloat(e.target.value) || null })}
                  className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm"
                  step="0.01"
                  placeholder={bcvRate?.rate?.toString() || ''}
                />
              </div>
            </div>
          )}

          {/* Preview de cálculos */}
          {facturaFormData.proveedorId > 0 && facturaFormData.subtotalGravable > 0 && (
            <div className="bg-purple-50 rounded-lg p-3">
              <div className="text-sm font-medium text-purple-700 mb-2">Cálculos Automáticos</div>
              {(() => {
                const proveedor = proveedores.find(p => p.id === facturaFormData.proveedorId);
                if (!proveedor) return null;
                const calc = calculateRetentions(
                  facturaFormData.subtotalGravable,
                  facturaFormData.iva,
                  proveedor.retencionIvaPct,
                  facturaFormData.paymentCurrency
                );
                return (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-purple-600">Retención IVA ({proveedor.retencionIvaPct}%)</span>
                      <span className="text-purple-800 font-medium">{formatBs(calc.retencionIva)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-purple-600">Anticipo ISLR (1%)</span>
                      <span className="text-purple-800 font-medium">{formatBs(calc.anticipoIslr)}</span>
                    </div>
                    {calc.igtf && (
                      <div className="flex justify-between">
                        <span className="text-purple-600">IGTF (3%)</span>
                        <span className="text-purple-800 font-medium">{formatBs(calc.igtf)}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-1 border-t border-purple-200">
                      <span className="text-purple-700 font-medium">Total Factura</span>
                      <span className="text-purple-900 font-bold">{formatBs(calc.total)}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-ocean-700 mb-1">Notas</label>
            <textarea
              value={facturaFormData.notes}
              onChange={(e) => setFacturaFormData({ ...facturaFormData, notes: e.target.value })}
              className="w-full px-3 py-2 border border-ocean-200 rounded-lg resize-none"
              rows={2}
            />
          </div>

          {/* Auto-generate retention option */}
          {!editingFactura && facturaFormData.proveedorId > 0 && facturaFormData.iva > 0 && (
            <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoGenerateRetencion}
                  onChange={(e) => setAutoGenerateRetencion(e.target.checked)}
                  className="w-4 h-4 text-purple-600 rounded border-purple-300 focus:ring-purple-500"
                />
                <div>
                  <div className="text-sm font-medium text-purple-700">Generar comprobante de retención</div>
                  <div className="text-xs text-purple-600">Se creará automáticamente al guardar la factura</div>
                </div>
              </label>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-ocean-100 flex justify-end gap-2">
          <button
            onClick={() => {
              setShowFacturaModal(false);
              setEditingFactura(null);
              resetFacturaForm();
            }}
            className="px-4 py-2 text-ocean-600 hover:bg-ocean-50 rounded-lg"
          >
            Cancelar
          </button>
          <button
            onClick={handleSaveFactura}
            className="px-4 py-2 bg-ocean-600 text-white rounded-lg hover:bg-ocean-500"
          >
            {editingFactura ? 'Actualizar' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  );

  const renderRetencionModal = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-ocean-100">
          <h3 className="text-lg font-semibold text-ocean-900">
            {editingRetencion ? 'Editar Retención' : 'Nueva Retención Manual'}
          </h3>
        </div>
        <div className="p-4 space-y-4">
          {!editingRetencion && (
            <div className="bg-amber-50 rounded-lg p-3 text-sm text-amber-700">
              <p>Usa esta opción para registrar retenciones que te entrega tu contable o un agente de retención externo.</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-ocean-700 mb-1">No. Comprobante *</label>
            <input
              type="text"
              value={retencionFormData.numeroComprobante}
              onChange={(e) => setRetencionFormData({ ...retencionFormData, numeroComprobante: e.target.value })}
              className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              placeholder="Ej: 202502-0001"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">Fecha Emisión *</label>
              <input
                type="date"
                value={retencionFormData.fechaEmision}
                onChange={(e) => setRetencionFormData({ ...retencionFormData, fechaEmision: e.target.value })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">Período Fiscal *</label>
              <input
                type="month"
                value={retencionFormData.periodoFiscal}
                onChange={(e) => setRetencionFormData({ ...retencionFormData, periodoFiscal: e.target.value })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ocean-700 mb-1">Monto Retenido (Bs.) *</label>
            <input
              type="number"
              value={retencionFormData.montoRetenido || ''}
              onChange={(e) => setRetencionFormData({ ...retencionFormData, montoRetenido: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              step="0.01"
              placeholder="0.00"
            />
          </div>

          {!editingRetencion && facturas.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">Asociar a Factura (opcional)</label>
              <select
                value={retencionFormData.facturaId}
                onChange={(e) => setRetencionFormData({ ...retencionFormData, facturaId: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg"
              >
                <option value={0}>Sin factura asociada</option>
                {facturas.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.numeroFactura} - {f.proveedorNombre} ({formatBs(f.total)})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-ocean-100 flex justify-end gap-2">
          <button
            onClick={() => {
              setShowRetencionModal(false);
              setEditingRetencion(null);
              resetRetencionForm();
            }}
            className="px-4 py-2 text-ocean-600 hover:bg-ocean-50 rounded-lg"
          >
            Cancelar
          </button>
          <button
            onClick={handleSaveRetencion}
            className="px-4 py-2 bg-ocean-600 text-white rounded-lg hover:bg-ocean-500"
          >
            {editingRetencion ? 'Actualizar' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );

  // =====================
  // Main Render
  // =====================

  return (
    <div className="space-y-4">
      {/* Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
          {success}
        </div>
      )}

      {/* Sub-tab navigation */}
      <div className="flex flex-wrap gap-2 bg-white rounded-lg p-2 shadow-sm">
        {(Object.keys(SUB_TAB_LABELS) as FiscalSubTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveSubTab(tab)}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activeSubTab === tab
                ? 'bg-ocean-600 text-white'
                : 'text-ocean-700 hover:bg-ocean-100'
            }`}
          >
            {SUB_TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-[400px]">
        {activeSubTab === 'dashboard' && renderDashboard()}
        {activeSubTab === 'proveedores' && renderProveedores()}
        {activeSubTab === 'reportes-z' && renderReportesZ()}
        {activeSubTab === 'facturas' && renderFacturas()}
        {activeSubTab === 'retenciones' && renderRetenciones()}
        {activeSubTab === 'pagos' && renderPagos()}
        {activeSubTab === 'simulador' && renderSimulador()}
        {activeSubTab === 'consultas' && renderConsultas()}
      </div>

      {/* Modals */}
      {showProveedorModal && renderProveedorModal()}
      {showZModal && renderZModal()}
      {showFacturaModal && renderFacturaModal()}
      {showRetencionModal && renderRetencionModal()}

      {/* Hidden div for comprobante image capture */}
      <div ref={captureRef} style={{ display: 'none' }} />
    </div>
  );
}
