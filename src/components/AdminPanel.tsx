/**
 * RPYM - Panel de Administración de Presupuestos
 */
import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import html2canvas from 'html2canvas';

const AdminBudgetBuilder = lazy(() => import('./AdminBudgetBuilder'));
const AdminSettings = lazy(() => import('./AdminSettings'));
const AdminProducts = lazy(() => import('./AdminProducts'));
const AdminCustomers = lazy(() => import('./AdminCustomers'));
const AdminFiscal = lazy(() => import('./AdminFiscal'));
const AdminCalculator = lazy(() => import('./AdminCalculator'));

import {
  listPresupuestos,
  updatePresupuestoStatus,
  updatePresupuesto,
  deletePresupuesto,
  getPresupuestoStats,
  getPresupuesto,
  type Presupuesto,
  type PresupuestoItem,
  type PresupuestoStats
} from '../lib/presupuesto-storage';
import { printDeliveryNote, type PrintPresupuesto } from '../lib/print-delivery-note';
import { openWhatsAppCardWindow, renderWhatsAppCardHTML, type WhatsAppCardData } from '../lib/presupuesto-whatsapp-card';
import { formatUSD, formatBs, formatDateWithTime } from '../lib/format';
import { formatPhoneDisplay, isValidVenezuelanPhone } from '../lib/phone-ve';
import { inferModoPrecio } from '../lib/presupuesto-utils';

interface Category {
  name: string;
  products: any[];
}

interface BCVRateData {
  rate: number;
  date: string;
  source: string;
}

interface AdminUser {
  username: string;
  displayName: string;
  role: 'admin' | 'viewer';
}

interface AdminPanelProps {
  categories?: Category[];
  bcvRate?: BCVRateData;
}

export default function AdminPanel({ categories, bcvRate }: AdminPanelProps = {}) {
  const [activeTab, setActiveTab] = useState<'ver' | 'crear' | 'productos' | 'clientes' | 'config' | 'fiscal' | 'calc'>('ver');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [currentUser, setCurrentUser] = useState<AdminUser | null>(null);
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [stats, setStats] = useState<PresupuestoStats | null>(null);
  const [filter, setFilter] = useState<'all' | 'pendiente' | 'pagado'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPresupuesto, setSelectedPresupuesto] = useState<Presupuesto | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Estado para edición de precios en el modal
  const [editedItems, setEditedItems] = useState<PresupuestoItem[] | null>(null);
  const [editingPrices, setEditingPrices] = useState<Map<number, string>>(new Map());

  // Estado para editar presupuesto existente
  const [editingPresupuesto, setEditingPresupuesto] = useState<Presupuesto | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Estado para envío por WhatsApp
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [whatsappSending, setWhatsappSending] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<'idle' | 'capturing' | 'uploading' | 'sent' | 'error'>('idle');
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  const whatsappCaptureRef = useRef<HTMLDivElement>(null);
  const [whatsappPopoverId, setWhatsappPopoverId] = useState<string | null>(null);
  const [rowWhatsappPhone, setRowWhatsappPhone] = useState('');
  const [whatsappType, setWhatsappType] = useState<'presupuesto' | 'factura' | 'manual'>('presupuesto');

  // Estado para copiar ID
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Función para copiar ID al portapapeles
  const copyIdToClipboard = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Error copying to clipboard:', err);
    }
  };

  // Verificar autenticación al cargar via API
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // First check sessionStorage for cached auth
        const cachedAuth = sessionStorage.getItem('rpym_admin_auth');
        const cachedUser = sessionStorage.getItem('rpym_admin_user');

        if (cachedAuth === 'true' && cachedUser) {
          setCurrentUser(JSON.parse(cachedUser));
          setIsAuthenticated(true);
          setIsCheckingAuth(false);

          // Verify with server in background
          const response = await fetch('/api/auth/me');
          const data = await response.json();

          if (!data.authenticated) {
            // Session expired, redirect to login
            sessionStorage.removeItem('rpym_admin_auth');
            sessionStorage.removeItem('rpym_admin_user');
            window.location.href = '/admin';
          }
          return;
        }

        // No cached auth, check with server
        const response = await fetch('/api/auth/me');
        const data = await response.json();

        if (data.authenticated) {
          setCurrentUser(data.user);
          setIsAuthenticated(true);
          sessionStorage.setItem('rpym_admin_auth', 'true');
          sessionStorage.setItem('rpym_admin_user', JSON.stringify(data.user));
        } else {
          // Redirect to login page
          window.location.href = '/admin';
        }
      } catch (error) {
        console.error('Auth check error:', error);
        window.location.href = '/admin';
      } finally {
        setIsCheckingAuth(false);
      }
    };

    checkAuth();
  }, []);

  // Logout function
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      // Continue with logout even if API fails
    }
    sessionStorage.removeItem('rpym_admin_auth');
    sessionStorage.removeItem('rpym_admin_user');
    window.location.href = '/admin';
  };

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Cargar datos
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [presupuestosData, statsData] = await Promise.all([
        listPresupuestos(filter === 'all' ? undefined : filter, debouncedSearch || undefined),
        getPresupuestoStats()
      ]);
      setPresupuestos(presupuestosData);
      setStats(statsData);
    } catch (error) {
      console.error('Error cargando datos:', error);
    } finally {
      setIsLoading(false);
    }
  }, [filter, debouncedSearch]);

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
  const handleDelete = async (id: string, isLinked?: boolean) => {
    if (isLinked) {
      alert('No se puede eliminar: este presupuesto está vinculado a una cuenta de cliente');
      return;
    }
    if (!confirm('¿Estás seguro de ELIMINAR este presupuesto? Esta acción no se puede deshacer.')) return;

    setActionLoading(id);
    const result = await deletePresupuesto(id);
    if (result.success) {
      loadData();
      if (selectedPresupuesto?.id === id) {
        setSelectedPresupuesto(null);
      }
    } else {
      alert(result.error || 'Error al eliminar');
    }
    setActionLoading(null);
  };

  // Obtener tasa BCV para recalcular Bs
  const bcvRateValue = bcvRate?.rate || 1;

  // Items actuales del modal (editados o originales)
  const currentItems = editedItems || selectedPresupuesto?.items || [];
  const currentTotalUSD = currentItems.reduce((sum, item) => sum + item.subtotalUSD, 0);
  const currentTotalBs = currentTotalUSD * bcvRateValue;
  const hasEdits = editedItems !== null;

  // Guardar cambios de precios
  const handleSaveEdits = async () => {
    if (!selectedPresupuesto || !editedItems) return;

    setIsSavingEdit(true);
    const success = await updatePresupuesto(
      selectedPresupuesto.id,
      editedItems,
      currentTotalUSD,
      currentTotalBs
    );

    if (success) {
      // Actualizar el presupuesto local
      const updated = {
        ...selectedPresupuesto,
        items: editedItems,
        totalUSD: currentTotalUSD,
        totalBs: currentTotalBs
      };
      setSelectedPresupuesto(updated);
      setEditedItems(null);
      setEditingPrices(new Map());
      loadData();
    } else {
      alert('Error al guardar los cambios');
    }
    setIsSavingEdit(false);
  };

  // Actualizar precio de un item
  const updateItemPrice = (idx: number, newPrice: number) => {
    const items = [...(editedItems || selectedPresupuesto?.items || [])];
    const item = { ...items[idx] };
    item.precioUSD = newPrice;
    item.subtotalUSD = newPrice * item.cantidad;
    item.precioBs = newPrice * bcvRateValue;
    item.subtotalBs = item.subtotalUSD * bcvRateValue;
    items[idx] = item;
    setEditedItems(items);
  };

  const formatDate = formatDateWithTime;
  const isValidPhone = isValidVenezuelanPhone;

  // Imprimir nota de entrega - usa utilidad compartida print-delivery-note.ts
  const printNote = (presupuesto: Presupuesto) => {
    const modo = inferModoPrecio(presupuesto);

    const printData: PrintPresupuesto = {
      id: presupuesto.id,
      fecha: presupuesto.fecha,
      items: presupuesto.items.map(item => ({
        nombre: item.nombre,
        cantidad: item.cantidad,
        unidad: item.unidad,
        precioUSD: item.precioUSD,
        subtotalUSD: item.subtotalUSD,
        precioUSDDivisa: item.precioUSDDivisa,
        subtotalUSDDivisa: item.subtotalUSDDivisa,
      })),
      totalUSD: presupuesto.totalUSD,
      totalBs: presupuesto.totalBs,
      totalUSDDivisa: presupuesto.totalUSDDivisa,
      hideRate: presupuesto.hideRate,
      delivery: presupuesto.delivery,
      modoPrecio: modo,
      estado: presupuesto.estado,
      customerName: presupuesto.customerName,
      customerAddress: presupuesto.customerAddress,
    };

    printDeliveryNote(printData, bcvRateValue);
  };

  // Mapeo Presupuesto -> WhatsAppCardData (legacy modoPrecio inference)
  const mapToWhatsAppCard = (presupuesto: Presupuesto): WhatsAppCardData => {
    const modo = inferModoPrecio(presupuesto);
    return {
      id: presupuesto.id,
      fecha: presupuesto.fecha,
      items: presupuesto.items.map(item => ({
        nombre: item.nombre,
        cantidad: item.cantidad,
        unidad: item.unidad,
        subtotalUSD: item.subtotalUSD,
        subtotalUSDDivisa: item.subtotalUSDDivisa,
      })),
      totalUSD: presupuesto.totalUSD,
      totalUSDDivisa: presupuesto.totalUSDDivisa,
      hideRate: presupuesto.hideRate,
      delivery: presupuesto.delivery,
      modoPrecio: modo,
      estado: presupuesto.estado,
      customerName: presupuesto.customerName,
    };
  };

  // Vista WhatsApp compacta del presupuesto (estilo card limpio)
  const handleWhatsAppView = (presupuesto: Presupuesto) => {
    openWhatsAppCardWindow(mapToWhatsAppCard(presupuesto), { bcvRate: bcvRateValue });
  };

  // Generar HTML para captura de WhatsApp (para html2canvas)
  const buildWhatsAppHTML = (presupuesto: Presupuesto): string => {
    return renderWhatsAppCardHTML(mapToWhatsAppCard(presupuesto), { bcvRate: bcvRateValue, baseUrl: window.location.origin });
  };

  // Enviar presupuesto por WhatsApp Cloud API
  const sendWhatsApp = async (presupuesto: Presupuesto, phoneOverride?: string) => {
    // Usar el teléfono pasado directamente o el del estado
    const phone = phoneOverride || whatsappPhone;

    // Validar teléfono
    if (!isValidPhone(phone)) {
      setWhatsappError('Número inválido. Usa formato: 0414XXXXXXX');
      setWhatsappStatus('error');
      return;
    }

    // Guardar el teléfono en el estado para uso posterior
    if (phoneOverride) setWhatsappPhone(phoneOverride);

    setWhatsappSending(true);
    setWhatsappStatus('capturing');
    setWhatsappError(null);

    try {
      // 1. Renderizar HTML en div oculto
      const captureDiv = whatsappCaptureRef.current;
      if (!captureDiv) throw new Error('Container de captura no encontrado');

      captureDiv.innerHTML = buildWhatsAppHTML(presupuesto);
      captureDiv.style.display = 'block';

      // 2. Esperar a que carguen las imágenes
      await new Promise(resolve => setTimeout(resolve, 400));

      // 3. Capturar con html2canvas
      const canvas = await html2canvas(captureDiv.firstElementChild as HTMLElement, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: 380,
        windowWidth: 380,
      });

      // Ocultar div de captura
      captureDiv.style.display = 'none';

      // 4. Convertir a JPEG blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => b ? resolve(b) : reject(new Error('Error al crear imagen')),
          'image/jpeg',
          0.85
        );
      });

      // 5. Verificar tamaño
      if (blob.size > 5 * 1024 * 1024) {
        throw new Error('La imagen es demasiado grande');
      }

      setWhatsappStatus('uploading');

      // 6. Enviar a API
      const formData = new FormData();
      formData.append('image', blob, 'presupuesto.jpg');
      formData.append('phone', phone.replace(/\D/g, ''));
      formData.append('customerName', presupuesto.customerName || 'Cliente');
      formData.append('totalUSD', presupuesto.totalUSD.toFixed(2));
      formData.append('presupuestoId', presupuesto.id);

      const response = await fetch('/api/send-whatsapp', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        setWhatsappStatus('sent');
      } else {
        throw new Error(result.error || 'Error desconocido');
      }

    } catch (err: any) {
      console.error('WhatsApp send error:', err);
      setWhatsappStatus('error');
      setWhatsappError(err.message || 'Error al enviar por WhatsApp');
    } finally {
      setWhatsappSending(false);
    }
  };

  // Enviar factura PDF por WhatsApp Cloud API
  const sendWhatsAppFactura = async (presupuesto: Presupuesto, phoneOverride?: string) => {
    const phone = phoneOverride || whatsappPhone;

    if (!isValidPhone(phone)) {
      setWhatsappError('Número inválido. Usa formato: 0414XXXXXXX');
      setWhatsappStatus('error');
      return;
    }

    if (phoneOverride) setWhatsappPhone(phoneOverride);

    setWhatsappSending(true);
    setWhatsappStatus('uploading');
    setWhatsappError(null);

    try {
      // Preparar items para la factura (incluyendo precios divisa si aplica)
      const facturaItems = presupuesto.items.map(item => ({
        producto: item.nombre,
        cantidad: item.cantidad,
        unidad: item.unidad,
        precioUnit: item.precioUSD,
        subtotal: item.subtotalUSD,
        precioUnitDivisa: item.precioUSDDivisa,
        subtotalDivisa: item.subtotalUSDDivisa
      }));

      // Determine totalBs based on modoPrecio - only for BCV or dual modes
      const modo = presupuesto.modoPrecio || 'bcv';
      const shouldIncludeBs = modo === 'bcv' || modo === 'dual';

      const response = await fetch('/api/send-whatsapp-factura', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.replace(/\D/g, ''),
          facturaId: presupuesto.id,
          customerName: presupuesto.customerName || 'Cliente',
          customerAddress: presupuesto.customerAddress,
          items: facturaItems,
          subtotal: presupuesto.totalUSD,
          total: presupuesto.totalUSD,
          totalBs: shouldIncludeBs ? presupuesto.totalUSD * bcvRateValue : 0,
          totalUSDDivisa: presupuesto.totalUSDDivisa,
          exchangeRate: bcvRateValue,
          date: new Date(presupuesto.fecha).toLocaleDateString('es-VE'),
          isPaid: presupuesto.estado === 'pagado',
          delivery: presupuesto.delivery || 0,
          modoPrecio: modo,
          hideRate: presupuesto.hideRate || false
        }),
      });

      const result = await response.json();

      if (result.success) {
        setWhatsappStatus('sent');
      } else {
        throw new Error(result.error || 'Error desconocido');
      }

    } catch (err: any) {
      console.error('WhatsApp factura send error:', err);
      setWhatsappStatus('error');
      setWhatsappError(err.message || 'Error al enviar factura por WhatsApp');
    } finally {
      setWhatsappSending(false);
    }
  };

  // Enviar por WhatsApp manual (abre enlace web)
  const sendWhatsAppManual = (presupuesto: Presupuesto, phoneOverride?: string) => {
    const phone = phoneOverride || whatsappPhone;
    if (!isValidPhone(phone)) {
      setWhatsappError('Número inválido. Usa formato: 0414XXXXXXX');
      return;
    }

    // Format phone for WhatsApp (58 + number without leading 0)
    let formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.startsWith('0') && formattedPhone.length === 11) {
      formattedPhone = '58' + formattedPhone.substring(1);
    } else if (formattedPhone.length === 10) {
      formattedPhone = '58' + formattedPhone;
    }

    // Build message with presupuesto details
    const isDual = presupuesto.modoPrecio === 'dual' || (presupuesto.modoPrecio !== 'divisa' && presupuesto.totalUSDDivisa != null && Number(presupuesto.totalUSDDivisa) > 0);
    const isDivisasOnly = presupuesto.modoPrecio === 'divisa' || (presupuesto.totalBs === 0 && !presupuesto.hideRate && !isDual);
    const hideRateOnly = presupuesto.hideRate === true;
    let message = `*Presupuesto RPYM #${presupuesto.id}*\n`;
    if (presupuesto.customerName) message += `Cliente: ${presupuesto.customerName}\n`;
    message += `\n`;

    // Items
    presupuesto.items.forEach(item => {
      message += `• ${item.nombre} ${item.cantidad}${item.unidad} - ${formatUSD(item.subtotalUSD)}\n`;
    });

    message += `\n*Total USD:* ${formatUSD(presupuesto.totalUSD)}`;
    if (isDual && presupuesto.totalUSDDivisa) {
      message += ` (BCV) / ${formatUSD(presupuesto.totalUSDDivisa)} (Divisa)`;
    }
    if (!isDivisasOnly && !hideRateOnly && bcvRateValue > 0) {
      message += `\n*Total Bs:* Bs. ${(presupuesto.totalUSD * bcvRateValue).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    // Open WhatsApp link
    const waUrl = `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(message)}`;
    window.open(waUrl, '_blank');
    setWhatsappStatus('sent');
  };

  // Función wrapper para enviar según el tipo seleccionado
  const handleWhatsAppSend = (presupuesto: Presupuesto, phoneOverride?: string) => {
    if (whatsappType === 'factura') {
      sendWhatsAppFactura(presupuesto, phoneOverride);
    } else if (whatsappType === 'manual') {
      sendWhatsAppManual(presupuesto, phoneOverride);
    } else {
      sendWhatsApp(presupuesto, phoneOverride);
    }
  };

  if (isCheckingAuth || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-ocean-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ocean-600 mx-auto mb-3"></div>
          <div className="text-ocean-600">Verificando acceso...</div>
        </div>
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
                <p className="text-xs text-ocean-300">
                  {currentUser ? `Hola, ${currentUser.displayName}` : 'Gestion de Presupuestos'}
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="text-sm text-ocean-300 hover:text-white flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Cerrar sesion
            </button>
          </div>

          {/* Tabs - grid 2x2 on mobile, flex row on desktop */}
          <div className="grid grid-cols-4 sm:flex gap-1 mt-3 bg-ocean-900/50 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('ver')}
              className={`py-2 px-3 sm:flex-1 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                activeTab === 'ver'
                  ? 'bg-white text-ocean-900'
                  : 'text-ocean-200 hover:text-white'
              }`}
            >
              Ver
            </button>
            <button
              onClick={() => setActiveTab('crear')}
              className={`py-2 px-3 sm:flex-1 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                activeTab === 'crear'
                  ? 'bg-white text-ocean-900'
                  : 'text-ocean-200 hover:text-white'
              }`}
            >
              Crear
            </button>
            <button
              onClick={() => setActiveTab('productos')}
              className={`py-2 px-3 sm:flex-1 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                activeTab === 'productos'
                  ? 'bg-white text-ocean-900'
                  : 'text-ocean-200 hover:text-white'
              }`}
            >
              Productos
            </button>
            <button
              onClick={() => setActiveTab('clientes')}
              className={`py-2 px-3 sm:flex-1 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                activeTab === 'clientes'
                  ? 'bg-white text-ocean-900'
                  : 'text-ocean-200 hover:text-white'
              }`}
            >
              Clientes
            </button>
            <button
              onClick={() => setActiveTab('config')}
              className={`py-2 px-3 sm:flex-1 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                activeTab === 'config'
                  ? 'bg-white text-ocean-900'
                  : 'text-ocean-200 hover:text-white'
              }`}
            >
              Config
            </button>
            <button
              onClick={() => setActiveTab('fiscal')}
              className={`py-2 px-3 sm:flex-1 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                activeTab === 'fiscal'
                  ? 'bg-white text-ocean-900'
                  : 'text-ocean-200 hover:text-white'
              }`}
            >
              Fiscal
            </button>
            <button
              onClick={() => setActiveTab('calc')}
              className={`py-2 px-3 sm:flex-1 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                activeTab === 'calc'
                  ? 'bg-white text-ocean-900'
                  : 'text-ocean-200 hover:text-white'
              }`}
            >
              Calc
            </button>
          </div>
        </div>
      </header>

      {activeTab === 'calc' ? (
        <main className="max-w-7xl mx-auto flex flex-col" style={{ height: 'calc(100dvh - 120px)' }}>
          <Suspense fallback={<div className="text-center py-12 text-ocean-700">Cargando...</div>}>
            <AdminCalculator bcvRate={bcvRate} />
          </Suspense>
        </main>
      ) : activeTab === 'fiscal' ? (
        <main className="max-w-7xl mx-auto p-4">
          <Suspense fallback={<div className="text-center py-12 text-ocean-700">Cargando...</div>}>
            <AdminFiscal bcvRate={bcvRate} />
          </Suspense>
        </main>
      ) : activeTab === 'clientes' ? (
        <main className="max-w-7xl mx-auto p-4">
          <Suspense fallback={<div className="text-center py-12 text-ocean-700">Cargando...</div>}>
            <AdminCustomers />
          </Suspense>
        </main>
      ) : activeTab === 'productos' ? (
        <main className="max-w-7xl mx-auto p-4">
          <Suspense fallback={<div className="text-center py-12 text-ocean-700">Cargando...</div>}>
            <AdminProducts />
          </Suspense>
        </main>
      ) : activeTab === 'config' && bcvRate ? (
        <main className="max-w-7xl mx-auto p-4">
          <Suspense fallback={<div className="text-center py-12 text-ocean-700">Cargando...</div>}>
            <AdminSettings currentBcvRate={bcvRate} />
          </Suspense>
        </main>
      ) : activeTab === 'crear' && categories && bcvRate ? (
        <main className="max-w-7xl mx-auto p-4">
          <Suspense fallback={<div className="text-center py-12 text-ocean-700">Cargando...</div>}>
            <AdminBudgetBuilder
              categories={categories}
              bcvRate={bcvRate}
              editingPresupuesto={editingPresupuesto}
              onEditComplete={() => {
                // Solo refrescar la lista; no limpiar editingPresupuesto para permitir múltiples actualizaciones
                loadData();
              }}
              onSaveComplete={async (newId) => {
                const p = await getPresupuesto(newId);
                if (p) setEditingPresupuesto(p);
                loadData();
              }}
              onClearEdit={() => setEditingPresupuesto(null)}
            />
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

        {/* Buscador (mobile-first) */}
        <div className="mb-3">
          <div className="relative">
            <input
              type="text"
              placeholder="Buscar por ID o cliente..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-3 text-base border border-ocean-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:border-transparent bg-white"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-ocean-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-ocean-400 hover:text-ocean-600 rounded-full hover:bg-ocean-100"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2 mb-4">
          {(['all', 'pendiente', 'pagado'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-ocean-600 text-white'
                  : 'bg-white text-ocean-700 border border-ocean-200 hover:bg-ocean-50'
              }`}
            >
              {f === 'all' ? 'Todos' : f === 'pendiente' ? '⏳' : '✅'}
            </button>
          ))}
          <button
            onClick={loadData}
            disabled={isLoading}
            className="ml-auto px-3 py-1.5 bg-ocean-100 text-ocean-700 rounded-lg text-sm hover:bg-ocean-200 transition-colors"
          >
            {isLoading ? '...' : '🔄'}
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
                        <button
                          onClick={() => copyIdToClipboard(p.id)}
                          className="font-mono text-sm text-ocean-900 hover:text-ocean-600 active:scale-95 transition-all flex items-center gap-1 group"
                          title="Tocar para copiar ID"
                        >
                          {p.id}
                          {copiedId === p.id ? (
                            <span className="text-green-600 text-xs">✓</span>
                          ) : (
                            <svg className="w-3.5 h-3.5 text-ocean-400 opacity-0 group-hover:opacity-100 md:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          )}
                        </button>
                        {p.isLinked && (
                          <span className="ml-1 text-[10px] bg-blue-100 text-blue-600 px-1 py-0.5 rounded font-medium" title="Vinculado a cuenta de cliente">
                            🔗
                          </span>
                        )}
                        {p.customerName && (
                          <span className="ml-1 text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full font-medium truncate max-w-[80px] inline-block align-middle" title={p.customerName}>
                            {p.customerName.length > 12 ? p.customerName.substring(0, 12) + '...' : p.customerName}
                          </span>
                        )}
                        {p.source === 'admin' && !p.customerName && (
                          <span className="ml-1.5 text-[10px] bg-ocean-100 text-ocean-600 px-1.5 py-0.5 rounded-full font-medium">Admin</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-ocean-700">
                        {formatDate(p.fecha)}
                      </td>
                      <td className="px-4 py-3 text-sm text-ocean-700 hidden md:table-cell">
                        {p.customerName || '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-semibold text-coral-600">{formatUSD(p.totalUSD)}</span>
                        {bcvRateValue > 0 && p.totalBs !== 0 && !p.hideRate && (
                          <span className="block text-xs text-ocean-500">{formatBs(p.totalUSD * bcvRateValue)}</span>
                        )}
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
                      <td className="px-4 py-3 relative">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => printNote(p)}
                            className="p-1.5 text-ocean-600 hover:bg-ocean-50 rounded-lg transition-colors"
                            title={p.estado === 'pagado' ? 'Imprimir (con sello pagado)' : 'Imprimir presupuesto'}
                          >
                            🖨️
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (whatsappPopoverId === p.id) {
                                setWhatsappPopoverId(null);
                              } else {
                                setWhatsappPopoverId(p.id);
                                setRowWhatsappPhone('');
                                setWhatsappStatus('idle');
                                setWhatsappError(null);
                              }
                            }}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="Enviar por WhatsApp"
                          >
                            📱
                          </button>
                          <button
                            onClick={() => {
                              setEditingPresupuesto(p);
                              setActiveTab('crear');
                            }}
                            className="p-1.5 text-coral-500 hover:bg-coral-50 rounded-lg transition-colors"
                            title="Editar presupuesto"
                          >
                            ✏️
                          </button>
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
                          <button
                            onClick={() => handleDelete(p.id, p.isLinked)}
                            disabled={actionLoading === p.id || p.isLinked}
                            className={`p-1.5 rounded-lg transition-colors ${
                              p.isLinked
                                ? 'text-gray-300 cursor-not-allowed'
                                : 'text-red-600 hover:bg-red-50'
                            }`}
                            title={p.isLinked ? 'No se puede eliminar (vinculado a cuenta)' : 'Eliminar'}
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
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-ocean-900">Presupuesto {selectedPresupuesto.id}</h3>
                  {(() => {
                    const isDual = selectedPresupuesto.modoPrecio === 'dual' || (selectedPresupuesto.modoPrecio !== 'divisa' && selectedPresupuesto.totalUSDDivisa != null && Number(selectedPresupuesto.totalUSDDivisa) > 0);
                    const isDivisasOnly = selectedPresupuesto.modoPrecio === 'divisa' || ((Number(selectedPresupuesto.totalBs) === 0 || selectedPresupuesto.totalBs == null) && !selectedPresupuesto.hideRate && !isDual);
                    if (isDual) {
                      return <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-medium">Dual</span>;
                    } else if (isDivisasOnly) {
                      return <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">USD</span>;
                    } else {
                      return <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">BCV</span>;
                    }
                  })()}
                </div>
                <p className="text-xs text-ocean-600">{formatDate(selectedPresupuesto.fecha)}</p>
              </div>
              <button
                onClick={() => {
                  setSelectedPresupuesto(null);
                  setEditedItems(null);
                  setEditingPrices(new Map());
                  // Reset WhatsApp state
                  setWhatsappPhone('');
                  setWhatsappStatus('idle');
                  setWhatsappError(null);
                }}
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

              {/* Items con precios editables */}
              <div>
                <p className="text-xs text-ocean-600 mb-2">Productos</p>
                <div className="space-y-2">
                  {currentItems.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center py-2 border-b border-ocean-100 gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ocean-900">{item.nombre}</p>
                        <p className="text-xs text-ocean-600">{Math.round(item.cantidad * 1000) / 1000} {item.unidad}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="relative">
                          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-ocean-400">$</span>
                          <input
                            type="number"
                            value={editingPrices.has(idx) ? editingPrices.get(idx) : item.precioUSD}
                            onFocus={() => {
                              setEditingPrices(prev => {
                                const next = new Map(prev);
                                next.set(idx, String(item.precioUSD));
                                return next;
                              });
                            }}
                            onChange={(e) => {
                              setEditingPrices(prev => {
                                const next = new Map(prev);
                                next.set(idx, e.target.value);
                                return next;
                              });
                            }}
                            onBlur={() => {
                              const val = parseFloat(editingPrices.get(idx) || '0') || 0;
                              updateItemPrice(idx, val);
                              setEditingPrices(prev => {
                                const next = new Map(prev);
                                next.delete(idx);
                                return next;
                              });
                            }}
                            step="0.01"
                            min="0"
                            className="w-20 pl-4 pr-1 py-1 text-xs text-right border border-ocean-200 rounded-md
                              focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none
                              [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
                              text-ocean-900 bg-ocean-50"
                          />
                        </div>
                        <p className="font-semibold text-coral-600 w-20 text-right text-sm">{formatUSD(item.subtotalUSD)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totales */}
              <div className="bg-coral-50 rounded-lg p-3">
                <div className="flex justify-between items-center">
                  <span className="text-ocean-700">Total USD:</span>
                  <span className="text-xl font-bold text-coral-600">{formatUSD(currentTotalUSD)}</span>
                </div>
                {/* Mostrar Bs solo si no es modo divisas y tenemos tasa BCV */}
                {bcvRateValue > 0 && selectedPresupuesto.totalBs !== 0 && !selectedPresupuesto.hideRate && (
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-ocean-700">Total Bs:</span>
                    <span className="font-semibold text-ocean-900">{formatBs(currentTotalBs)}</span>
                  </div>
                )}
                {(selectedPresupuesto.totalBs === 0 || bcvRateValue === 0) && !selectedPresupuesto.hideRate && (
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-ocean-500 text-sm italic">Solo precios en USD (divisas)</span>
                  </div>
                )}
              </div>

              {/* Guardar cambios de precios */}
              {hasEdits && (
                <button
                  onClick={handleSaveEdits}
                  disabled={isSavingEdit}
                  className="w-full py-2.5 bg-ocean-600 hover:bg-ocean-500 disabled:bg-ocean-300 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {isSavingEdit ? 'Guardando...' : 'Guardar cambios de precios'}
                </button>
              )}

              {/* Estado */}
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium ${
                  selectedPresupuesto.estado === 'pagado'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {selectedPresupuesto.estado === 'pagado' ? '✅ Pagado' : '⏳ Pendiente'}
                </span>

                <div className="flex flex-wrap gap-2">
                  {selectedPresupuesto.estado === 'pendiente' && (
                    <button
                      onClick={async () => {
                        await handleMarkPaid(selectedPresupuesto.id);
                        setSelectedPresupuesto({ ...selectedPresupuesto, estado: 'pagado', fechaPago: new Date().toISOString() });
                        loadData();
                      }}
                      className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-500"
                    >
                      Marcar Pagado
                    </button>
                  )}
                  <button
                    onClick={() => printNote(selectedPresupuesto)}
                    className="px-3 py-1.5 bg-ocean-600 text-white rounded-lg text-xs font-medium hover:bg-ocean-500 flex items-center gap-1"
                  >
                    🖨️ Imprimir
                  </button>
                  <button
                    onClick={() => handleWhatsAppView(selectedPresupuesto)}
                    className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-500 flex items-center gap-1"
                  >
                    📱 Vista
                  </button>
                  <button
                    onClick={() => {
                      setEditingPresupuesto(selectedPresupuesto);
                      setSelectedPresupuesto(null);
                      setActiveTab('crear');
                    }}
                    className="px-3 py-1.5 bg-coral-500 text-white rounded-lg text-xs font-medium hover:bg-coral-600 flex items-center gap-1"
                  >
                    ✏️ Editar
                  </button>
                </div>
              </div>

              {/* Enviar por WhatsApp */}
              <div className="border-t border-ocean-100 pt-4 mt-4">
                <p className="text-xs font-semibold text-ocean-700 mb-2 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/>
                  </svg>
                  Enviar al cliente por WhatsApp
                </p>

                {/* Tipo toggle */}
                <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg mb-3">
                  <button
                    onClick={() => setWhatsappType('presupuesto')}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      whatsappType === 'presupuesto'
                        ? 'bg-white text-green-700 shadow-sm'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    📸 Imagen
                  </button>
                  <button
                    onClick={() => setWhatsappType('factura')}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      whatsappType === 'factura'
                        ? 'bg-white text-purple-700 shadow-sm'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    📄 PDF
                  </button>
                  <button
                    onClick={() => setWhatsappType('manual')}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      whatsappType === 'manual'
                        ? 'bg-white text-blue-700 shadow-sm'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    💬 Texto
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    type="tel"
                    placeholder="0414-XXX-XXXX"
                    value={formatPhoneDisplay(whatsappPhone)}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '');
                      setWhatsappPhone(digits.slice(0, 11));
                      setWhatsappStatus('idle');
                      setWhatsappError(null);
                    }}
                    className="flex-1 px-3 py-2 text-sm border border-ocean-200 rounded-lg
                      focus:ring-1 focus:ring-green-500 focus:border-transparent outline-none
                      placeholder:text-ocean-400"
                    disabled={whatsappSending}
                  />
                  <button
                    onClick={() => handleWhatsAppSend(selectedPresupuesto)}
                    disabled={whatsappSending || whatsappPhone.replace(/\D/g, '').length < 11}
                    className={`px-4 py-2 text-white rounded-lg text-sm font-medium transition-colors
                      flex items-center gap-1.5 whitespace-nowrap ${
                        whatsappType === 'factura'
                          ? 'bg-purple-600 hover:bg-purple-500 disabled:bg-purple-300'
                          : whatsappType === 'manual'
                          ? 'bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300'
                          : 'bg-green-600 hover:bg-green-500 disabled:bg-green-300'
                      }`}
                  >
                    {whatsappStatus === 'capturing' ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                        </svg>
                        Capturando...
                      </>
                    ) : whatsappStatus === 'uploading' ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                        </svg>
                        Enviando...
                      </>
                    ) : (
                      <>{whatsappType === 'factura' ? 'Enviar PDF' : 'Enviar'}</>
                    )}
                  </button>
                </div>

                {/* Status messages */}
                {whatsappStatus === 'sent' && (
                  <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {whatsappType === 'factura' ? 'Factura PDF enviada' : 'Mensaje enviado exitosamente'}
                  </p>
                )}
                {whatsappStatus === 'error' && whatsappError && (
                  <p className="text-xs text-red-600 mt-2">
                    ⚠️ {whatsappError}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de envío por WhatsApp */}
      {whatsappPopoverId && (() => {
        const targetPresupuesto = presupuestos.find(p => p.id === whatsappPopoverId);
        if (!targetPresupuesto) return null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={() => {
              setWhatsappPopoverId(null);
              setRowWhatsappPhone('');
              setWhatsappStatus('idle');
              setWhatsappError(null);
            }}
          >
            <div
              className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="bg-green-600 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-white">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/>
                  </svg>
                  <span className="font-semibold">Enviar por WhatsApp</span>
                </div>
                <button
                  onClick={() => {
                    setWhatsappPopoverId(null);
                    setRowWhatsappPhone('');
                    setWhatsappStatus('idle');
                    setWhatsappError(null);
                  }}
                  className="text-white/80 hover:text-white p-1"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4">
                {/* Info del presupuesto */}
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-sm font-medium text-gray-700">Presupuesto #{targetPresupuesto.id}</p>
                  <p className="text-xs text-gray-500">{targetPresupuesto.customerName || 'Cliente'}</p>
                  <p className="text-lg font-bold text-green-600 mt-1">{formatUSD(targetPresupuesto.totalUSD)}</p>
                </div>

                {/* Tipo de envío */}
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1.5 block">Formato de envío</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setWhatsappType('presupuesto')}
                      className={`flex-1 py-2 px-2 rounded-lg border-2 transition-all text-xs font-medium flex items-center justify-center gap-1 ${
                        whatsappType === 'presupuesto'
                          ? 'border-green-500 bg-green-50 text-green-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      📸 Imagen
                    </button>
                    <button
                      onClick={() => setWhatsappType('factura')}
                      className={`flex-1 py-2 px-2 rounded-lg border-2 transition-all text-xs font-medium flex items-center justify-center gap-1 ${
                        whatsappType === 'factura'
                          ? 'border-purple-500 bg-purple-50 text-purple-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      📄 PDF
                    </button>
                    <button
                      onClick={() => setWhatsappType('manual')}
                      className={`flex-1 py-2 px-2 rounded-lg border-2 transition-all text-xs font-medium flex items-center justify-center gap-1 ${
                        whatsappType === 'manual'
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      💬 Texto
                    </button>
                  </div>
                </div>

                {/* Número de teléfono */}
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1.5 block">Número de WhatsApp</label>
                  <input
                    type="tel"
                    placeholder="0414-123-4567"
                    value={formatPhoneDisplay(rowWhatsappPhone)}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '');
                      setRowWhatsappPhone(digits.slice(0, 11));
                      setWhatsappStatus('idle');
                      setWhatsappError(null);
                    }}
                    className="w-full px-4 py-3 text-lg border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none placeholder:text-gray-400 font-mono text-center"
                    disabled={whatsappSending}
                    autoFocus
                  />
                </div>

                {/* Status messages */}
                {whatsappStatus === 'sent' && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                    <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-green-700 font-medium">
                      {whatsappType === 'factura' ? 'Factura PDF enviada' : 'Presupuesto enviado'}
                    </span>
                  </div>
                )}
                {whatsappStatus === 'error' && whatsappError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                    <span className="text-red-500 flex-shrink-0">⚠️</span>
                    <span className="text-sm text-red-700">{whatsappError}</span>
                  </div>
                )}

                {/* Botón de enviar */}
                <button
                  onClick={() => {
                    handleWhatsAppSend(targetPresupuesto, rowWhatsappPhone);
                  }}
                  disabled={whatsappSending || !isValidPhone(rowWhatsappPhone)}
                  className={`w-full py-3 text-white rounded-xl font-semibold transition-colors flex items-center justify-center gap-2 ${
                    whatsappType === 'factura'
                      ? 'bg-purple-600 hover:bg-purple-500 disabled:bg-purple-300'
                      : whatsappType === 'manual'
                      ? 'bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300'
                      : 'bg-green-600 hover:bg-green-500 disabled:bg-green-300'
                  }`}
                >
                  {whatsappStatus === 'capturing' ? (
                    <>
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                      </svg>
                      Capturando imagen...
                    </>
                  ) : whatsappStatus === 'uploading' ? (
                    <>
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                      </svg>
                      Enviando...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/>
                      </svg>
                      {whatsappType === 'factura' ? 'Enviar Factura PDF' : 'Enviar Presupuesto'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Hidden div for html2canvas capture */}
      <div
        ref={whatsappCaptureRef}
        style={{
          position: 'fixed',
          left: '-9999px',
          top: 0,
          width: '380px',
          display: 'none',
          zIndex: -1,
        }}
      />
    </div>
  );
}
