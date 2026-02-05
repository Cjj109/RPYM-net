/**
 * RPYM - Panel de Administración de Presupuestos
 */
import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import html2canvas from 'html2canvas';

const AdminBudgetBuilder = lazy(() => import('./AdminBudgetBuilder'));
const AdminSettings = lazy(() => import('./AdminSettings'));
const AdminProducts = lazy(() => import('./AdminProducts'));
const AdminCustomers = lazy(() => import('./AdminCustomers'));

import {
  listPresupuestos,
  updatePresupuestoStatus,
  updatePresupuesto,
  deletePresupuesto,
  getPresupuestoStats,
  type Presupuesto,
  type PresupuestoItem,
  type PresupuestoStats
} from '../lib/presupuesto-storage';

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
  const [activeTab, setActiveTab] = useState<'ver' | 'crear' | 'productos' | 'clientes' | 'config'>('ver');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [currentUser, setCurrentUser] = useState<AdminUser | null>(null);
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [stats, setStats] = useState<PresupuestoStats | null>(null);
  const [filter, setFilter] = useState<'all' | 'pendiente' | 'pagado'>('all');
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

  // Formatear teléfono para mostrar: 0414-XXX-XXXX
  const formatPhoneDisplay = (value: string): string => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 4) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
  };

  // Validar teléfono venezolano
  const isValidPhone = (value: string): boolean => {
    const d = value.replace(/\D/g, '');
    return d.length === 11 && ['0412', '0414', '0416', '0424', '0426'].includes(d.slice(0, 4));
  };

  // Imprimir nota de entrega (con o sin sello de pagado) - Estilo profesional con bordes
  const printNote = (presupuesto: Presupuesto, showPaid: boolean) => {
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      alert('No se pudo abrir la ventana de impresion. Verifica que no esten bloqueados los popups.');
      return;
    }

    const fmtQty = (qty: number): string => {
      const rounded = Math.round(qty * 1000) / 1000;
      return rounded.toFixed(3).replace(/\.?0+$/, '');
    };

    const isDual = presupuesto.totalUSDDivisa != null;
    const dateStr = new Date(presupuesto.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const customerName = presupuesto.customerName || '';
    const customerAddress = presupuesto.customerAddress || '';

    // Filas de productos BCV
    const rows = presupuesto.items.map((item, i) => `
      <tr style="background:${i % 2 === 0 ? '#fff' : '#f0f9ff'}">
        <td style="border-right:1px solid #075985;padding:6px 10px;color:#0c4a6e;">${item.nombre}</td>
        <td style="border-right:1px solid #075985;padding:6px 10px;text-align:center;color:#0c4a6e;">${fmtQty(item.cantidad)}</td>
        <td style="border-right:1px solid #075985;padding:6px 10px;text-align:center;color:#0c4a6e;">${item.unidad}</td>
        <td style="border-right:1px solid #075985;padding:6px 10px;text-align:right;color:#0c4a6e;">${formatUSD(item.precioUSD)}</td>
        <td style="padding:6px 10px;text-align:right;font-weight:600;color:#0c4a6e;">${formatUSD(item.subtotalUSD)}</td>
      </tr>
    `).join('');

    // Filas de productos Divisa (para presupuestos duales)
    const divisaRows = isDual ? presupuesto.items.map((item, i) => `
      <tr style="background:${i % 2 === 0 ? '#fff' : '#fefce8'}">
        <td style="border-right:1px solid #92400e;padding:6px 10px;color:#713f12;">${item.nombre}</td>
        <td style="border-right:1px solid #92400e;padding:6px 10px;text-align:center;color:#713f12;">${fmtQty(item.cantidad)}</td>
        <td style="border-right:1px solid #92400e;padding:6px 10px;text-align:center;color:#713f12;">${item.unidad}</td>
        <td style="border-right:1px solid #92400e;padding:6px 10px;text-align:right;color:#713f12;">${formatUSD(item.precioUSDDivisa ?? item.precioUSD)}</td>
        <td style="padding:6px 10px;text-align:right;font-weight:600;color:#713f12;">${formatUSD(item.subtotalUSDDivisa ?? item.subtotalUSD)}</td>
      </tr>
    `).join('') : '';

    // Pagina 2 para dual
    const divisaPageHtml = isDual ? `
      <div style="page-break-before:always;"></div>
      <div class="watermark" style="color:rgba(234,179,8,0.06);">PRESUPUESTO</div>
      ${showPaid ? `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-15deg);border:6px solid #16a34a;border-radius:12px;padding:15px 40px;color:#16a34a;font-size:36px;font-weight:900;text-transform:uppercase;letter-spacing:3px;opacity:0.35;pointer-events:none;z-index:1;">PAGADO</div>` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;border:2px solid #92400e;padding:12px 16px;margin-bottom:16px;">
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <div style="width:48px;height:48px;border-radius:50%;border:2px solid #fde68a;overflow:hidden;flex-shrink:0;background:white;display:flex;align-items:center;justify-content:center;">
              <img src="/camaronlogo-sm.webp" alt="RPYM" style="width:140%;height:140%;object-fit:contain;" />
            </div>
            <div style="font-size:22px;font-weight:800;color:#713f12;">RPYM</div>
          </div>
          <div style="font-size:10px;color:#92400e;">Muelle Pesquero "El Mosquero", Puesto 3 y 4, Maiquetia</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:16px;font-weight:700;color:#713f12;border-bottom:2px solid #92400e;padding-bottom:4px;margin-bottom:6px;">PRESUPUESTO</div>
          <div style="background:#fef3c7;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;color:#92400e;margin-bottom:4px;">PRECIOS DIVISA</div>
          <div style="font-size:10px;color:#92400e;">No: <span style="font-family:monospace;font-weight:600;color:#713f12;">${presupuesto.id}</span></div>
          <div style="font-size:10px;color:#92400e;margin-top:2px;">Fecha: <span style="font-weight:600;color:#713f12;">${dateStr}</span></div>
        </div>
      </div>
      <div style="border:2px solid #92400e;padding:10px 16px;margin-bottom:16px;">
        <div style="margin-bottom:6px;"><span style="font-size:10px;font-weight:600;color:#92400e;">Cliente:</span><span style="font-size:12px;color:#713f12;margin-left:8px;">${customerName || '---'}</span></div>
        <div><span style="font-size:10px;font-weight:600;color:#92400e;">Direccion:</span><span style="font-size:12px;color:#713f12;margin-left:8px;">${customerAddress || '---'}</span></div>
      </div>
      <div style="border:2px solid #92400e;margin-bottom:16px;">
        <table>
          <thead>
            <tr style="background:#fef3c7;">
              <th style="border-bottom:2px solid #92400e;border-right:1px solid #92400e;padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#713f12;">Producto</th>
              <th style="border-bottom:2px solid #92400e;border-right:1px solid #92400e;padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#713f12;width:60px;">Cant</th>
              <th style="border-bottom:2px solid #92400e;border-right:1px solid #92400e;padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#713f12;width:60px;">Unidad</th>
              <th style="border-bottom:2px solid #92400e;border-right:1px solid #92400e;padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#713f12;width:80px;">P.Unitario</th>
              <th style="border-bottom:2px solid #92400e;padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#713f12;width:80px;">Subtotal</th>
            </tr>
          </thead>
          <tbody>${divisaRows}</tbody>
        </table>
      </div>
      <div style="border:2px solid #92400e;margin-bottom:16px;display:flex;">
        <div style="flex:1;padding:10px 16px;border-right:2px solid #92400e;">
          <div style="font-size:10px;font-weight:600;color:#92400e;margin-bottom:4px;">OBSERVACIONES:</div>
          <div style="font-size:10px;color:#92400e;">Precios en USD efectivo</div>
        </div>
        <div style="width:200px;padding:10px 16px;">
          <div style="display:flex;justify-content:space-between;font-size:13px;">
            <span style="color:#92400e;font-weight:600;">Total USD:</span>
            <span style="font-weight:800;color:#713f12;">${formatUSD(presupuesto.totalUSDDivisa!)}</span>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:40px;margin-top:40px;">
        <div style="flex:1;text-align:center;"><div style="border-top:2px solid #92400e;padding-top:6px;margin:0 30px;"><span style="font-size:10px;font-weight:600;color:#92400e;">CONFORME CLIENTE</span></div></div>
        <div style="flex:1;text-align:center;"><div style="border-top:2px solid #92400e;padding-top:6px;margin:0 30px;"><span style="font-size:10px;font-weight:600;color:#92400e;">ENTREGADO POR</span></div></div>
      </div>
      ${showPaid ? '<div style="background:#dcfce7;color:#166534;padding:12px;border-radius:8px;text-align:center;margin-top:16px;font-weight:600;font-size:13px;">Gracias por su compra!</div>' : ''}
      <div style="margin-top:${showPaid ? '8' : '20'}px;padding:6px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:4px;text-align:center;">
        <span style="font-size:10px;color:#b45309;font-weight:500;">Este documento no tiene validez fiscal - Solo para referencia</span>
      </div>
      <div style="margin-top:12px;padding-top:8px;border-top:1px solid #fde68a;text-align:center;">
        <span style="font-size:10px;color:#d97706;">www.rpym.net • WhatsApp: +58 414-214-5202</span>
      </div>
    ` : '';

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Presupuesto - ${presupuesto.id}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: white;
      color: #0c4a6e;
      padding: 12mm 15mm;
      position: relative;
    }
    table { width:100%; border-collapse:collapse; }
    @media print {
      body { padding: 0; }
      @page { size: A4; margin: 12mm 15mm; }
    }
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-30deg);
      font-size: 80px;
      font-weight: 900;
      color: rgba(14, 165, 233, 0.06);
      letter-spacing: 12px;
      pointer-events: none;
      z-index: 0;
    }
  </style>
</head>
<body>
  <div class="watermark">PRESUPUESTO</div>

  ${showPaid ? `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-15deg);border:6px solid #16a34a;border-radius:12px;padding:15px 40px;color:#16a34a;font-size:36px;font-weight:900;text-transform:uppercase;letter-spacing:3px;opacity:0.35;pointer-events:none;z-index:1;">PAGADO</div>` : ''}

  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;border:2px solid #075985;padding:12px 16px;margin-bottom:16px;">
    <div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <div style="width:48px;height:48px;border-radius:50%;border:2px solid #7dd3fc;overflow:hidden;flex-shrink:0;background:white;display:flex;align-items:center;justify-content:center;">
          <img src="/camaronlogo-sm.webp" alt="RPYM" style="width:140%;height:140%;object-fit:contain;" />
        </div>
        <div style="font-size:22px;font-weight:800;color:#0c4a6e;">RPYM</div>
      </div>
      <div style="font-size:10px;color:#0369a1;">Muelle Pesquero "El Mosquero", Puesto 3 y 4, Maiquetia</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:16px;font-weight:700;color:#0c4a6e;border-bottom:2px solid #075985;padding-bottom:4px;margin-bottom:6px;">PRESUPUESTO</div>
      ${isDual ? '<div style="background:#e0f2fe;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;color:#075985;margin-bottom:4px;">PRECIOS BCV</div>' : ''}
      <div style="font-size:10px;color:#0369a1;">No: <span style="font-family:monospace;font-weight:600;color:#0c4a6e;">${presupuesto.id}</span></div>
      <div style="font-size:10px;color:#0369a1;margin-top:2px;">Fecha: <span style="font-weight:600;color:#0c4a6e;">${dateStr}</span></div>
    </div>
  </div>

  <!-- Client info -->
  <div style="border:2px solid #075985;padding:10px 16px;margin-bottom:16px;">
    <div style="margin-bottom:6px;">
      <span style="font-size:10px;font-weight:600;color:#0369a1;">Cliente:</span>
      <span style="font-size:12px;color:#0c4a6e;margin-left:8px;">${customerName || '---'}</span>
    </div>
    <div>
      <span style="font-size:10px;font-weight:600;color:#0369a1;">Direccion:</span>
      <span style="font-size:12px;color:#0c4a6e;margin-left:8px;">${customerAddress || '---'}</span>
    </div>
  </div>

  <!-- Products table -->
  <div style="border:2px solid #075985;margin-bottom:16px;">
    <table>
      <thead>
        <tr style="background:#e0f2fe;">
          <th style="border-bottom:2px solid #075985;border-right:1px solid #075985;padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#0c4a6e;">Producto</th>
          <th style="border-bottom:2px solid #075985;border-right:1px solid #075985;padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#0c4a6e;width:60px;">Cant</th>
          <th style="border-bottom:2px solid #075985;border-right:1px solid #075985;padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#0c4a6e;width:60px;">Unidad</th>
          <th style="border-bottom:2px solid #075985;border-right:1px solid #075985;padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#0c4a6e;width:80px;">P.Unitario</th>
          <th style="border-bottom:2px solid #075985;padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#0c4a6e;width:80px;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>

  <!-- Totals -->
  <div style="border:2px solid #075985;margin-bottom:16px;display:flex;">
    <div style="flex:1;padding:10px 16px;border-right:2px solid #075985;">
      <div style="font-size:10px;font-weight:600;color:#0369a1;margin-bottom:4px;">OBSERVACIONES:</div>
      <div style="font-size:10px;color:#0369a1;">Tasa BCV aplicada al momento de pago</div>
    </div>
    <div style="width:200px;padding:10px 16px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;">
        <span style="color:#0369a1;font-weight:600;">Total USD:</span>
        <span style="font-weight:800;color:#0c4a6e;">${formatUSD(presupuesto.totalUSD)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px;border-top:1px solid #7dd3fc;padding-top:4px;">
        <span style="color:#0369a1;">Total Bs.:</span>
        <span style="font-weight:700;color:#ea580c;">${formatBs(presupuesto.totalBs)}</span>
      </div>
    </div>
  </div>

  <!-- Signatures -->
  <div style="display:flex;gap:40px;margin-top:40px;">
    <div style="flex:1;text-align:center;">
      <div style="border-top:2px solid #075985;padding-top:6px;margin:0 30px;">
        <span style="font-size:10px;font-weight:600;color:#0369a1;">CONFORME CLIENTE</span>
      </div>
    </div>
    <div style="flex:1;text-align:center;">
      <div style="border-top:2px solid #075985;padding-top:6px;margin:0 30px;">
        <span style="font-size:10px;font-weight:600;color:#0369a1;">ENTREGADO POR</span>
      </div>
    </div>
  </div>

  ${showPaid ? '<div style="background:#dcfce7;color:#166534;padding:12px;border-radius:8px;text-align:center;margin-top:16px;font-weight:600;font-size:13px;">Gracias por su compra!</div>' : ''}

  <!-- Non-fiscal notice -->
  <div style="margin-top:${showPaid ? '8' : '20'}px;padding:6px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:4px;text-align:center;">
    <span style="font-size:10px;color:#b45309;font-weight:500;">Este documento no tiene validez fiscal - Solo para referencia</span>
  </div>

  <!-- Footer -->
  <div style="margin-top:12px;padding-top:8px;border-top:1px solid #bae6fd;text-align:center;">
    <span style="font-size:10px;color:#0ea5e9;">www.rpym.net • WhatsApp: +58 414-214-5202</span>
  </div>

  ${divisaPageHtml}
</body>
</html>`);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  };

  // Vista WhatsApp compacta del presupuesto (estilo card limpio)
  const handleWhatsAppView = (presupuesto: Presupuesto) => {
    const isPaid = presupuesto.estado === 'pagado';
    const isDualWA = presupuesto.totalUSDDivisa != null;
    const fmtQty = (qty: number): string => {
      const rounded = Math.round(qty * 1000) / 1000;
      return rounded.toFixed(3).replace(/\.?0+$/, '');
    };
    const fechaStr = new Date(presupuesto.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const waWindow = window.open('', '_blank', 'width=380,height=700,scrollbars=yes');
    if (!waWindow) {
      alert('No se pudo abrir la ventana. Verifica que no estén bloqueados los popups.');
      return;
    }

    const productRows = presupuesto.items.map(item => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid #f0f9ff;">
        <div style="flex:1;font-size:13px;color:#0c4a6e;">${item.nombre}</div>
        <div style="font-size:12px;color:#0369a1;margin:0 8px;white-space:nowrap;">${fmtQty(item.cantidad)} ${item.unidad}</div>
        <div style="font-size:13px;font-weight:600;color:#0c4a6e;white-space:nowrap;">${formatUSD(item.subtotalUSD)}</div>
      </div>
    `).join('');

    const divisaBubbleHtml = isDualWA ? (() => {
      const divisaProductRows = presupuesto.items.map(item => `
        <div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid #fefce8;">
          <div style="flex:1;font-size:13px;color:#713f12;">${item.nombre}</div>
          <div style="font-size:12px;color:#92400e;margin:0 8px;white-space:nowrap;">${fmtQty(item.cantidad)} ${item.unidad}</div>
          <div style="font-size:13px;font-weight:600;color:#713f12;white-space:nowrap;">${formatUSD(item.subtotalUSDDivisa ?? item.subtotalUSD)}</div>
        </div>
      `).join('');
      return `
      <div style="width:320px;background:white;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);margin-top:16px;border:2px solid #fde68a;">
        <div style="text-align:center;margin-bottom:12px;">
          <img src="/camaronlogo-sm.webp" alt="RPYM" style="display:block;width:140px;height:auto;object-fit:contain;margin:0 auto;" />
          <div style="background:#fef3c7;display:inline-block;padding:3px 12px;border-radius:6px;font-size:12px;font-weight:700;color:#92400e;margin-top:4px;">Precios Divisa</div>
          ${isPaid ? '<div style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#166534;font-size:12px;font-weight:600;padding:3px 10px;border-radius:9999px;margin-top:6px;">PAGADO</div>' : ''}
        </div>
        ${presupuesto.customerName ? '<div style="font-size:12px;color:#92400e;text-align:center;margin-bottom:10px;">Cliente: <strong style="color:#713f12;">' + presupuesto.customerName + '</strong></div>' : ''}
        <div style="margin-bottom:12px;">
          ${divisaProductRows}
        </div>
        <div style="border-top:2px solid #92400e;padding-top:10px;margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;">
            <span style="font-size:14px;font-weight:600;color:#92400e;">Total USD (Divisa)</span>
            <span style="font-size:20px;font-weight:800;color:#713f12;">${formatUSD(presupuesto.totalUSDDivisa!)}</span>
          </div>
        </div>
        <div style="text-align:center;border-top:1px solid #fde68a;padding-top:8px;">
          <div style="font-size:10px;color:#d97706;">${fechaStr}</div>
          <div style="font-size:10px;color:#d97706;margin-top:2px;">WhatsApp: +58 414-214-5202</div>
          <div style="font-size:9px;color:#fde68a;margin-top:4px;">Ref: ${presupuesto.id}</div>
        </div>
      </div>`;
    })() : '';

    waWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Presupuesto RPYM</title>
  <meta name="viewport" content="width=320" />
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f0f9ff;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px 0;
    }
  </style>
</head>
<body>
  <div style="width:320px;background:white;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <!-- Logo -->
    <div style="text-align:center;margin-bottom:12px;">
      <img src="/camaronlogo-sm.webp" alt="RPYM" style="display:block;width:140px;height:auto;object-fit:contain;margin:0 auto;" />
      <div style="font-size:12px;color:#0369a1;margin-top:4px;">Presupuesto</div>
      ${isDualWA ? '<div style="background:#e0f2fe;display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;color:#075985;margin-top:4px;">Precios BCV</div>' : ''}
      ${isPaid ? '<div style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#166534;font-size:12px;font-weight:600;padding:3px 10px;border-radius:9999px;margin-top:6px;">PAGADO</div>' : ''}
    </div>

    ${presupuesto.customerName ? '<div style="font-size:12px;color:#0369a1;text-align:center;margin-bottom:10px;">Cliente: <strong style="color:#0c4a6e;">' + presupuesto.customerName + '</strong></div>' : ''}

    <!-- Products -->
    <div style="margin-bottom:12px;">
      ${productRows}
    </div>

    <!-- Totals -->
    <div style="border-top:2px solid #075985;padding-top:10px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:14px;font-weight:600;color:#0369a1;">Total USD</span>
        <span style="font-size:20px;font-weight:800;color:#0c4a6e;">${formatUSD(presupuesto.totalUSD)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px;">
        <span style="font-size:12px;color:#0369a1;">Total Bs.</span>
        <span style="font-size:15px;font-weight:700;color:#ea580c;">${formatBs(presupuesto.totalBs)}</span>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;border-top:1px solid #e0f2fe;padding-top:8px;">
      <div style="font-size:10px;color:#0ea5e9;">${fechaStr}</div>
      <div style="font-size:10px;color:#0ea5e9;margin-top:2px;">WhatsApp: +58 414-214-5202</div>
      <div style="font-size:9px;color:#7dd3fc;margin-top:4px;">Ref: ${presupuesto.id}</div>
    </div>
  </div>

  ${divisaBubbleHtml}
</body>
</html>`);

    waWindow.document.close();
  };

  // Generar HTML para captura de WhatsApp (para html2canvas)
  const buildWhatsAppHTML = (presupuesto: Presupuesto): string => {
    const isPaid = presupuesto.estado === 'pagado';
    const isDualCapture = presupuesto.totalUSDDivisa != null;
    const fmtQty = (qty: number): string => {
      const rounded = Math.round(qty * 1000) / 1000;
      return rounded.toFixed(3).replace(/\.?0+$/, '');
    };
    const fechaStr = new Date(presupuesto.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const itemsHtml = presupuesto.items.map(item => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #e0f2fe;">
        <div style="font-weight:600;font-size:14px;color:#0c4a6e;">${item.nombre}</div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:12px;color:#64748b;">${fmtQty(item.cantidad)} ${item.unidad}</span>
          <span style="font-weight:700;font-size:14px;color:#ea580c;">${formatUSD(item.subtotalUSD)}</span>
        </div>
      </div>
    `).join('');

    const divisaItemsHtmlCapture = isDualCapture ? presupuesto.items.map(item => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #fef3c7;">
        <div style="font-weight:600;font-size:14px;color:#0c4a6e;">${item.nombre}</div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:12px;color:#64748b;">${fmtQty(item.cantidad)} ${item.unidad}</span>
          <span style="font-weight:700;font-size:14px;color:#ea580c;">${formatUSD(item.subtotalUSDDivisa ?? item.subtotalUSD)}</span>
        </div>
      </div>
    `).join('') : '';

    const divisaSectionHtml = isDualCapture ? `
      <div style="height:3px;background:linear-gradient(90deg,#f59e0b,#eab308);border-radius:2px;margin-bottom:16px;"></div>

      <div style="background:#fef3c7;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-weight:700;font-size:14px;color:#92400e;text-align:center;">Precios Divisa</div>

      <div style="margin-bottom:16px;">
        ${divisaItemsHtmlCapture}
      </div>

      <div style="height:3px;background:linear-gradient(90deg,#f59e0b,#eab308);border-radius:2px;margin-bottom:16px;"></div>

      <div style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-weight:700;font-size:14px;color:#92400e;">Total USD (Divisa)</span>
          <span style="font-weight:700;font-size:22px;color:#ea580c;">${formatUSD(presupuesto.totalUSDDivisa!)}</span>
        </div>
      </div>
    ` : '';

    return `
      <div style="font-family:'Inter',-apple-system,sans-serif;background:white;width:380px;padding:24px 20px;">
        <div style="text-align:center;margin-bottom:20px;">
          <img src="${window.location.origin}/camaronlogo-md.webp" style="display:block;margin:0 auto;width:160px;height:auto;" />
        </div>

        <div style="text-align:center;margin-bottom:16px;">
          <div style="font-size:15px;color:#0369a1;font-weight:500;">Presupuesto</div>
          ${isPaid ? '<div style="display:inline-block;background:#fef3c7;color:#92400e;font-size:13px;font-weight:700;padding:5px 20px;border-radius:6px;margin-top:8px;border:2px solid #f59e0b;">PAGADO</div>' : ''}
        </div>

        ${isDualCapture ? '<div style="background:#e0f2fe;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-weight:700;font-size:14px;color:#075985;text-align:center;">Precios BCV</div>' : ''}

        <div style="margin-bottom:16px;">
          ${itemsHtml}
        </div>

        <div style="height:3px;background:linear-gradient(90deg,#075985,#0ea5e9);border-radius:2px;margin-bottom:16px;"></div>

        <div style="margin-bottom:20px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-weight:700;font-size:14px;color:#0c4a6e;">Total USD</span>
            <span style="font-weight:700;font-size:22px;color:#ea580c;">${formatUSD(presupuesto.totalUSD)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:13px;color:#0c4a6e;">Total Bs.</span>
            <span style="font-weight:600;font-size:15px;color:#0c4a6e;">${formatBs(presupuesto.totalBs)}</span>
          </div>
        </div>

        ${divisaSectionHtml}

        <div style="text-align:center;padding-top:12px;border-top:1px solid #e0f2fe;font-size:11px;color:#0369a1;">
          <div>${fechaStr}</div>
          <div>WhatsApp: +58 414-214-5202</div>
          <div>Ref: ${presupuesto.id}</div>
        </div>
      </div>
    `;
  };

  // Enviar presupuesto por WhatsApp Cloud API
  const sendWhatsApp = async (presupuesto: Presupuesto) => {
    // Validar teléfono
    if (!isValidPhone(whatsappPhone)) {
      setWhatsappError('Número inválido. Usa formato: 0414XXXXXXX');
      setWhatsappStatus('error');
      return;
    }

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
      formData.append('phone', whatsappPhone.replace(/\D/g, ''));
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
          <div className="grid grid-cols-3 sm:flex gap-1 mt-3 bg-ocean-900/50 rounded-lg p-1">
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
          </div>
        </div>
      </header>

      {activeTab === 'clientes' ? (
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
                setEditingPresupuesto(null);
                loadData();
              }}
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
                        {p.source === 'admin' && (
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
                      <td className="px-4 py-3 relative">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => printNote(p, p.estado === 'pagado')}
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
                            onClick={() => handleDelete(p.id)}
                            disabled={actionLoading === p.id}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Eliminar"
                          >
                            🗑️
                          </button>
                        </div>
                        {whatsappPopoverId === p.id && (
                          <div
                            className="absolute right-4 top-full mt-1 bg-white rounded-xl shadow-lg border border-ocean-200 p-3 z-40 w-72"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <p className="text-xs font-semibold text-ocean-700 mb-2 flex items-center gap-1.5">
                              <svg className="w-4 h-4 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/>
                              </svg>
                              Enviar al cliente
                            </p>
                            <div className="flex gap-2">
                              <input
                                type="tel"
                                placeholder="0414-XXX-XXXX"
                                value={formatPhoneDisplay(rowWhatsappPhone)}
                                onChange={(e) => {
                                  const digits = e.target.value.replace(/\D/g, '');
                                  setRowWhatsappPhone(digits.slice(0, 11));
                                  setWhatsappStatus('idle');
                                  setWhatsappError(null);
                                }}
                                className="flex-1 px-2.5 py-1.5 text-sm border border-ocean-200 rounded-lg focus:ring-1 focus:ring-green-500 focus:border-transparent outline-none placeholder:text-ocean-400"
                                disabled={whatsappSending}
                              />
                              <button
                                onClick={() => {
                                  setWhatsappPhone(rowWhatsappPhone);
                                  sendWhatsApp(p);
                                  // Close popover after successful send
                                  setTimeout(() => {
                                    if (whatsappStatus === 'sent') setWhatsappPopoverId(null);
                                  }, 2000);
                                }}
                                disabled={whatsappSending || rowWhatsappPhone.replace(/\D/g, '').length < 11}
                                className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-green-300 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                              >
                                {whatsappStatus === 'capturing' || whatsappStatus === 'uploading' ? '...' : 'Enviar'}
                              </button>
                            </div>
                            {whatsappStatus === 'sent' && (
                              <p className="text-xs text-green-600 mt-1.5 flex items-center gap-1">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Enviado
                              </p>
                            )}
                            {whatsappStatus === 'error' && whatsappError && (
                              <p className="text-xs text-red-600 mt-1.5">⚠️ {whatsappError}</p>
                            )}
                          </div>
                        )}
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
                <div className="flex justify-between items-center mt-1">
                  <span className="text-ocean-700">Total Bs:</span>
                  <span className="font-semibold text-ocean-900">{formatBs(currentTotalBs)}</span>
                </div>
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
                    onClick={() => printNote(selectedPresupuesto, selectedPresupuesto.estado === 'pagado')}
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
                    onClick={() => sendWhatsApp(selectedPresupuesto)}
                    disabled={whatsappSending || whatsappPhone.replace(/\D/g, '').length < 11}
                    className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-green-300
                      text-white rounded-lg text-sm font-medium transition-colors
                      flex items-center gap-1.5 whitespace-nowrap"
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
                      <>Enviar</>
                    )}
                  </button>
                </div>

                {/* Status messages */}
                {whatsappStatus === 'sent' && (
                  <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Mensaje enviado exitosamente
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
