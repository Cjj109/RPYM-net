/**
 * RPYM - Admin Customers Management (Cuentas de Clientes)
 * Gestión de clientes y libro de cuentas desde D1 database
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { formatUSD, formatBs, formatEUR, formatQuantity, formatDateShort, formatDateDMY } from '../lib/format';

interface Customer {
  id: number;
  name: string;
  phone: string | null;
  notes: string | null;
  rateType: 'dolar_bcv' | 'euro_bcv' | 'manual';
  customRate: number | null;
  shareToken: string | null;
  isActive: boolean;
  balanceDivisas: number;
  balanceBcv: number;
  balanceEuro: number;
  createdAt: string;
  updatedAt: string;
}

interface CustomerTransaction {
  id: number;
  customerId: number;
  type: 'purchase' | 'payment';
  date: string;
  description: string;
  amountUsd: number;
  amountBs: number;
  amountUsdDivisa: number | null;
  presupuestoId: string | null;
  invoiceImageUrl: string | null;
  currencyType: 'divisas' | 'dolar_bcv' | 'euro_bcv';
  paymentMethod: string | null;
  exchangeRate: number | null;
  notes: string | null;
  isPaid: boolean;
  paidMethod: string | null;
  paidDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function AdminCustomers() {
  // Vista principal: lista o detalle
  const [view, setView] = useState<'list' | 'detail'>('list');

  // Estado lista de clientes
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Estado detalle de cliente
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [transactions, setTransactions] = useState<CustomerTransaction[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(false);
  const [expandedTxId, setExpandedTxId] = useState<number | null>(null);

  // Modal crear/editar cliente
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    name: '',
    phone: '',
    notes: '',
    rateType: 'dolar_bcv' as 'dolar_bcv' | 'euro_bcv' | 'manual',
    customRate: ''
  });

  // Modal crear/editar transaccion
  const [showTxModal, setShowTxModal] = useState(false);
  const [txModalType, setTxModalType] = useState<'purchase' | 'payment'>('purchase');
  const [editingTx, setEditingTx] = useState<CustomerTransaction | null>(null);
  const [isSavingTx, setIsSavingTx] = useState(false);
  const [txForm, setTxForm] = useState({
    date: '',
    description: '',
    amountUsd: '',
    amountBs: '',
    presupuestoId: '',
    notes: '',
    currencyType: 'divisas' as 'divisas' | 'dolar_bcv' | 'euro_bcv',
    paymentMethod: '' as string,
    exchangeRate: '',
    amountUsdDivisa: ''
  });
  const [isManualDual, setIsManualDual] = useState(false);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoicePreview, setInvoicePreview] = useState<string | null>(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const [bcvRate, setBcvRate] = useState<number | null>(null);

  // Crear presupuesto desde compra manual
  const [createPresupuestoFromTx, setCreatePresupuestoFromTx] = useState(false);
  const [presupuestoDate, setPresupuestoDate] = useState('');
  const [newPresupuestoItems, setNewPresupuestoItems] = useState<Array<{
    nombre: string;
    cantidad: number;
    unidad: string;
    precioUSD: number;
    subtotalUSD: number;
    precioUSDDivisa?: number;
    subtotalUSDDivisa?: number;
  }>>([]);
  const [presupuestoTextInput, setPresupuestoTextInput] = useState('');
  const [isParsingNewPresupuesto, setIsParsingNewPresupuesto] = useState(false);
  const [parseNewPresupuestoError, setParseNewPresupuestoError] = useState<string | null>(null);

  // Auto-fill presupuesto
  const [isFetchingPresupuesto, setIsFetchingPresupuesto] = useState(false);
  const [presupuestoNotFound, setPresupuestoNotFound] = useState(false);
  const presupuestoFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fetchedPresupuesto, setFetchedPresupuesto] = useState<{
    id: string;
    totalUSD: number;
    totalBs: number;
    totalUSDDivisa: number | null;
    items: Array<{ nombre: string; cantidad: number; unidad: string; precioUSD: number; subtotalUSD: number; precioUSDDivisa?: number; subtotalUSDDivisa?: number }>;
    customerName: string | null;
    isDual: boolean;
    isDivisasOnly?: boolean;
  } | null>(null);

  // Modal detalle transaccion
  const [showTxDetailModal, setShowTxDetailModal] = useState(false);
  const [detailTx, setDetailTx] = useState<CustomerTransaction | null>(null);

  // Modal compartir enlace
  const [showShareModal, setShowShareModal] = useState(false);
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Toggle BCV/Divisas para transacciones duales
  const [dualView, setDualView] = useState<'bcv' | 'divisas'>('bcv');

  // Filtros y paginacion de transacciones
  const [txFilter, setTxFilter] = useState<'all' | 'purchases' | 'payments' | 'usd' | 'bcv' | 'dual' | 'paid'>('all');
  const [txSearch, setTxSearch] = useState('');
  const [txPage, setTxPage] = useState(0);
  const TX_PAGE_SIZE = 20;

  // Modal ver presupuesto
  const [showPresupuestoModal, setShowPresupuestoModal] = useState(false);
  const [viewingPresupuesto, setViewingPresupuesto] = useState<any | null>(null);
  const [loadingPresupuesto, setLoadingPresupuesto] = useState(false);

  // Modal marcar pagado
  const [showPaidModal, setShowPaidModal] = useState(false);
  const [paidTx, setPaidTx] = useState<CustomerTransaction | null>(null);
  const [paidForm, setPaidForm] = useState({ paidMethod: '', paidDate: '', notes: '' });
  const [isSavingPaid, setIsSavingPaid] = useState(false);

  // IA anotaciones rapidas
  const [aiText, setAiText] = useState('');
  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiActions, setAiActions] = useState<Array<{
    customerName: string;
    customerId: number | null;
    type: 'purchase' | 'payment';
    amountUsd: number;
    amountUsdDivisa: number | null;
    description: string;
    presupuestoId: string | null;
    currencyType: 'divisas' | 'dolar_bcv' | 'euro_bcv';
    paymentMethod: string | null;
    date: string | null;
  }>>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiConfirming, setAiConfirming] = useState(false);
  const [aiExecuting, setAiExecuting] = useState(false);

  // IA con productos (modo presupuesto)
  const [aiMode, setAiMode] = useState<'simple' | 'productos'>('productos');
  const [aiPricingMode, setAiPricingMode] = useState<'bcv' | 'divisas' | 'dual'>('bcv');
  const [aiProductAction, setAiProductAction] = useState<{
    customerName: string;
    customerId: number | null;
    items: Array<{
      nombre: string;
      cantidad: number;
      unidad: string;
      precioUSD: number;
      subtotalUSD: number;
      precioUSDDivisa?: number;
      subtotalUSDDivisa?: number;
    }>;
    totalUSD: number;
    totalBs: number;
    totalUSDDivisa: number | null;
    date: string | null;
    description: string;
    pricingMode: 'bcv' | 'divisas' | 'dual';
    delivery?: number | null;
    hideRate?: boolean; // Solo divisas: ocultar Bs en print/WhatsApp
  } | null>(null);
  const [aiUnmatched, setAiUnmatched] = useState<string[]>([]);

  // ─── Helpers ───────────────────────────────────────────────────────

  const formatDate = formatDateShort;
  const formatDateFull = formatDateDMY;

  const todayStr = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const recalcTotals = (
    prev: NonNullable<typeof aiProductAction>,
    newItems: NonNullable<typeof aiProductAction>['items']
  ) => {
    const deliveryAmt = prev.delivery ?? 0;
    const itemsTotalUSD = newItems.reduce((sum, it) => sum + it.subtotalUSD, 0);
    const newTotalUSD = itemsTotalUSD + deliveryAmt;
    const newTotalBs = prev.pricingMode === 'divisas' ? 0 : Math.round(newTotalUSD * (bcvRate || 1) * 100) / 100;
    const itemsTotalDivisa = prev.pricingMode === 'dual'
      ? newItems.reduce((sum, it) => sum + (it.subtotalUSDDivisa || it.subtotalUSD), 0)
      : 0;
    const newTotalUSDDivisa = prev.pricingMode === 'dual'
      ? itemsTotalDivisa + deliveryAmt
      : null;
    return {
      ...prev,
      items: newItems,
      totalUSD: Math.round(newTotalUSD * 100) / 100,
      totalBs: Math.round(newTotalBs * 100) / 100,
      totalUSDDivisa: newTotalUSDDivisa ? Math.round(newTotalUSDDivisa * 100) / 100 : null
    };
  };

  // ─── Cargar tasa BCV ────────────────────────────────────────────────

  useEffect(() => {
    const fetchBcvRate = async () => {
      try {
        const res = await fetch('/api/config/bcv-rate', { credentials: 'include' });
        const data = await res.json();
        if (data.rate) setBcvRate(data.rate);
      } catch (err) {
        console.error('Error fetching BCV rate:', err);
      }
    };
    fetchBcvRate();
  }, []);

  // Fetch historical BCV rate for a given date
  const fetchRateForDate = async (date: string) => {
    try {
      const res = await fetch(`/api/config/bcv-rate-history?date=${date}`, { credentials: 'include' });
      const data = await res.json();
      if (data.success && data.found) {
        return { usdRate: data.usdRate, eurRate: data.eurRate, exact: data.exact, date: data.date };
      }
    } catch (err) {
      console.error('Error fetching historical rate:', err);
    }
    return null;
  };

  // Handle date change in transaction form - auto-fetch rate
  const handleTxDateChange = async (newDate: string) => {
    setTxForm(prev => ({ ...prev, date: newDate }));
    // Only auto-update rate for non-divisas (BCV-pegged) transactions
    if (txForm.currencyType === 'divisas') return;
    const today = todayStr();
    if (newDate === today) {
      // Use current rate
      if (bcvRate) setTxForm(prev => ({ ...prev, date: newDate, exchangeRate: String(bcvRate) }));
    } else {
      // Fetch historical rate
      const historical = await fetchRateForDate(newDate);
      if (historical) {
        setTxForm(prev => ({ ...prev, exchangeRate: String(historical.usdRate) }));
      }
    }
  };

  // Fetch presupuesto for auto-fill in transaction form
  const fetchPresupuestoForTx = async (presupuestoId: string) => {
    if (!presupuestoId.trim()) {
      setFetchedPresupuesto(null);
      setPresupuestoNotFound(false);
      return;
    }
    setIsFetchingPresupuesto(true);
    setPresupuestoNotFound(false);
    try {
      const res = await fetch(`/api/presupuestos/${encodeURIComponent(presupuestoId.trim())}`, {
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success && data.presupuesto) {
        const p = data.presupuesto;
        const isDual = p.modoPrecio === 'dual' || (p.modoPrecio !== 'divisa' && p.totalUSDDivisa != null && p.totalUSDDivisa > 0);
        const isDivisasOnly = p.modoPrecio === 'divisa' || (p.totalBs === 0 && !isDual);
        setFetchedPresupuesto({
          id: p.id,
          totalUSD: p.totalUSD,
          totalBs: p.totalBs,
          totalUSDDivisa: p.totalUSDDivisa,
          items: p.items,
          customerName: p.customerName,
          isDual,
          isDivisasOnly
        });
        setPresupuestoNotFound(false);
        // Auto-fill form
        const itemsSummary = p.items
          .map((it: any) => it.nombre)
          .join(', ');
        const desc = `Ppto #${p.id}: ${itemsSummary}`.substring(0, 200);
        // Determine currency type: divisas-only → divisas, dual → dolar_bcv, otherwise keep current
        const autoCurrencyType = isDivisasOnly ? 'divisas' : (isDual ? 'dolar_bcv' : undefined);
        setTxForm(prev => ({
          ...prev,
          presupuestoId: presupuestoId.trim(),
          description: desc,
          amountUsd: String(p.totalUSD),
          amountBs: isDivisasOnly ? '' : String(p.totalBs),
          currencyType: autoCurrencyType ?? prev.currencyType,
          exchangeRate: (isDual && bcvRate) ? String(bcvRate) : prev.exchangeRate,
        }));
      } else {
        setFetchedPresupuesto(null);
        setPresupuestoNotFound(true);
      }
    } catch (err) {
      console.error('Error fetching presupuesto:', err);
      setFetchedPresupuesto(null);
      setPresupuestoNotFound(true);
    } finally {
      setIsFetchingPresupuesto(false);
    }
  };

  // Debounced version for typing
  const debouncedFetchPresupuesto = (id: string) => {
    if (presupuestoFetchTimer.current) clearTimeout(presupuestoFetchTimer.current);
    presupuestoFetchTimer.current = setTimeout(() => fetchPresupuestoForTx(id), 400);
  };

  // View presupuesto details
  const handleViewPresupuesto = async (presupuestoId: string) => {
    setLoadingPresupuesto(true);
    setShowPresupuestoModal(true);
    try {
      const res = await fetch(`/api/presupuestos/${encodeURIComponent(presupuestoId)}`, {
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success && data.presupuesto) {
        setViewingPresupuesto(data.presupuesto);
      } else {
        setViewingPresupuesto(null);
        alert('No se pudo cargar el presupuesto');
        setShowPresupuestoModal(false);
      }
    } catch {
      setViewingPresupuesto(null);
      alert('Error al cargar presupuesto');
      setShowPresupuestoModal(false);
    } finally {
      setLoadingPresupuesto(false);
    }
  };

  // ─── Cargar clientes ──────────────────────────────────────────────

  const loadCustomers = useCallback(async (search?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const response = await fetch(`/api/customers${params}`, {
        credentials: 'include'
      });
      const data = await response.json();

      if (data.success) {
        setCustomers(data.customers);
      } else {
        setError(data.error || 'Error al cargar clientes');
      }
    } catch (err) {
      setError('Error de conexion');
      console.error('Error loading customers:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  // Busqueda con debounce
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      loadCustomers(value || undefined);
    }, 300);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // ─── Cargar transacciones ─────────────────────────────────────────

  const loadTransactions = useCallback(async (customerId: number) => {
    setIsLoadingTx(true);
    try {
      const response = await fetch(`/api/customers/${customerId}/transactions`, {
        credentials: 'include'
      });
      const data = await response.json();

      if (data.success) {
        setTransactions(data.transactions);
      } else {
        console.error('Error loading transactions:', data.error);
      }
    } catch (err) {
      console.error('Error loading transactions:', err);
    } finally {
      setIsLoadingTx(false);
    }
  }, []);

  // Cargar detalle de cliente (refresca datos)
  const loadCustomerDetail = useCallback(async (customerId: number) => {
    try {
      const response = await fetch(`/api/customers/${customerId}`, {
        credentials: 'include'
      });
      const data = await response.json();

      if (data.success) {
        setSelectedCustomer(data.customer);
      }
    } catch (err) {
      console.error('Error loading customer detail:', err);
    }
  }, []);

  // ─── Navegar a detalle ────────────────────────────────────────────

  const handleSelectCustomer = (customer: Customer) => {
    setSelectedCustomer(customer);
    setView('detail');
    setExpandedTxId(null);
    setDualView('bcv');
    setTxFilter('all');
    setTxSearch('');
    setTxPage(0);
    loadTransactions(customer.id);
  };

  const handleBackToList = () => {
    setView('list');
    setSelectedCustomer(null);
    setTransactions([]);
    setExpandedTxId(null);
    loadCustomers(searchTerm || undefined);
  };

  const handleDeleteCustomer = async (customerId: number, customerName: string) => {
    if (!confirm(`¿Eliminar a "${customerName}"? Se desactivara del sistema.`)) return;
    try {
      const response = await fetch(`/api/customers/${customerId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        if (selectedCustomer?.id === customerId) {
          handleBackToList();
        } else {
          loadCustomers(searchTerm || undefined);
        }
      } else {
        alert(data.error || 'Error al eliminar');
      }
    } catch {
      alert('Error de conexion');
    }
  };

  // ─── Modal Crear/Editar Cliente ───────────────────────────────────

  const handleNewCustomer = () => {
    setEditingCustomer(null);
    setCustomerForm({
      name: '',
      phone: '',
      notes: '',
      rateType: 'dolar_bcv',
      customRate: ''
    });
    setShowCustomerModal(true);
  };

  const handleEditCustomer = () => {
    if (!selectedCustomer) return;
    setEditingCustomer(selectedCustomer);
    setCustomerForm({
      name: selectedCustomer.name,
      phone: selectedCustomer.phone || '',
      notes: selectedCustomer.notes || '',
      rateType: selectedCustomer.rateType,
      customRate: selectedCustomer.customRate ? String(selectedCustomer.customRate) : ''
    });
    setShowCustomerModal(true);
  };

  const handleSaveCustomer = async () => {
    if (!customerForm.name.trim()) {
      alert('El nombre es requerido');
      return;
    }

    if (customerForm.rateType === 'manual' && !customerForm.customRate) {
      alert('Debes ingresar la tasa manual');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: customerForm.name.trim(),
        phone: customerForm.phone.trim() || null,
        notes: customerForm.notes.trim() || null,
        rateType: customerForm.rateType,
        customRate: customerForm.rateType === 'manual' ? parseFloat(customerForm.customRate) : null
      };

      let response;
      if (editingCustomer) {
        response = await fetch(`/api/customers/${editingCustomer.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'include'
        });
      } else {
        response = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'include'
        });
      }

      const data = await response.json();

      if (data.success) {
        setShowCustomerModal(false);
        if (view === 'detail' && selectedCustomer) {
          loadCustomerDetail(selectedCustomer.id);
        }
        loadCustomers(searchTerm || undefined);
      } else {
        alert(data.error || 'Error al guardar');
      }
    } catch (err) {
      console.error('Error saving customer:', err);
      alert('Error al guardar el cliente');
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Modal Crear/Editar Transaccion ───────────────────────────────

  const handleNewTransaction = (type: 'purchase' | 'payment') => {
    setEditingTx(null);
    setTxModalType(type);
    // Default currency type from customer's rate_type
    const defaultCurrency = selectedCustomer?.rateType === 'euro_bcv' ? 'euro_bcv'
      : selectedCustomer?.rateType === 'dolar_bcv' ? 'dolar_bcv' : 'divisas';
    setTxForm({
      date: todayStr(),
      description: '',
      amountUsd: '',
      amountBs: '',
      presupuestoId: '',
      notes: '',
      currencyType: defaultCurrency,
      paymentMethod: '',
      exchangeRate: bcvRate ? String(bcvRate) : '',
      amountUsdDivisa: ''
    });
    setIsManualDual(false);
    setInvoiceFile(null);
    setInvoicePreview(null);
    setRemoveExistingImage(false);
    setFetchedPresupuesto(null);
    setIsFetchingPresupuesto(false);
    setPresupuestoNotFound(false);
    // Reset crear presupuesto desde compra
    setCreatePresupuestoFromTx(false);
    setPresupuestoDate(todayStr());
    setNewPresupuestoItems([]);
    setPresupuestoTextInput('');
    setParseNewPresupuestoError(null);
    setShowTxModal(true);
  };

  const handleEditTransaction = (tx: CustomerTransaction) => {
    setEditingTx(tx);
    setTxModalType(tx.type);
    const hasDualAmount = tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0;
    setTxForm({
      date: tx.date.split('T')[0],
      description: tx.description,
      amountUsd: tx.amountUsd ? String(tx.amountUsd) : '',
      amountBs: tx.amountBs ? String(tx.amountBs) : '',
      presupuestoId: tx.presupuestoId || '',
      notes: tx.notes || '',
      currencyType: tx.currencyType || 'divisas',
      paymentMethod: tx.paymentMethod || '',
      exchangeRate: tx.exchangeRate ? String(tx.exchangeRate) : (bcvRate ? String(bcvRate) : ''),
      amountUsdDivisa: hasDualAmount ? String(tx.amountUsdDivisa) : ''
    });
    setIsManualDual(hasDualAmount);
    setInvoiceFile(null);
    setInvoicePreview(tx.invoiceImageUrl || null);
    setRemoveExistingImage(false);
    setShowTxModal(true);
    setShowTxDetailModal(false);
  };

  const handleInvoiceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setInvoiceFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setInvoicePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Parse text input to create presupuesto items using AI
  const parseNewPresupuestoText = async () => {
    if (!presupuestoTextInput.trim()) return;

    setIsParsingNewPresupuesto(true);
    setParseNewPresupuestoError(null);

    try {
      // Fetch products for the parser
      const productsRes = await fetch('/api/products');
      const productsData = await productsRes.json();

      if (!productsData.success || !productsData.products) {
        throw new Error('Error al cargar productos');
      }

      const productInfo = productsData.products.map((p: any) => ({
        id: p.id,
        nombre: p.nombre,
        unidad: p.unidad,
        precioUSD: p.precioUSD,
        precioUSDDivisa: p.precioUSDDivisa ?? null,
      }));

      const response = await fetch('/api/parse-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: presupuestoTextInput, products: productInfo }),
      });

      const result = await response.json();

      if (result.success && result.items) {
        // Convert parsed items to presupuesto format
        // Include both matched products AND custom products (unmatched with suggestedName + customPrice)
        const items: any[] = [];

        result.items.forEach((item: any) => {
          if (item.matched && item.productId) {
            // Producto del catálogo
            const product = productInfo.find((p: any) => String(p.id) === String(item.productId));
            // Detectar dollarAmount del campo AI, requestedName, o texto original
            const dollarDeRegex = /^\$?\s*(\d+(?:\.\d+)?)\s*\$?\s*(?:de\s|del\s|d\s)/i;
            const dollarRegex = /^\$\s*(\d+(?:\.\d+)?)|^(\d+(?:\.\d+)?)\s*\$/;
            let effectiveDollarAmount = item.dollarAmount && item.dollarAmount > 0 ? item.dollarAmount : null;
            let effectiveCustomPrice = item.customPrice;

            if (item.requestedName) {
              const m = item.requestedName.match(dollarDeRegex) || item.requestedName.match(dollarRegex);
              if (m) {
                effectiveDollarAmount = parseFloat(m[1] || m[2]);
                effectiveCustomPrice = null;
              }
            }

            // Buscar en texto original del usuario
            if (!effectiveDollarAmount && product) {
              const nrm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
              const txtRx = /\$\s*(\d+(?:\.\d+)?)\s*(?:de|del)\s+([^,\n$]+)/gi;
              let mx;
              while ((mx = txtRx.exec(presupuestoTextInput)) !== null) {
                const frag = nrm(mx[2].trim());
                const pn = nrm(product.nombre);
                if (pn.includes(frag) || frag.includes(pn) || pn.split(' ').some((w: string) => w.length > 3 && frag.includes(w))) {
                  effectiveDollarAmount = parseFloat(mx[1]);
                  effectiveCustomPrice = null;
                  break;
                }
              }
            }

            const precio = effectiveCustomPrice || product?.precioUSD || 0;
            const precioDivisa = item.customPriceDivisa || product?.precioUSDDivisa || precio;
            let qty = item.quantity;
            if (effectiveDollarAmount && effectiveDollarAmount > 0 && precio > 0) {
              qty = Math.round((effectiveDollarAmount / precio) * 1000) / 1000;
            }
            // Divisa subtotal: si hay dollarAmount, ambos lados = dollarAmount
            let subtotalDivisa: number;
            if (effectiveDollarAmount && effectiveDollarAmount > 0) {
              subtotalDivisa = effectiveDollarAmount;
            } else {
              subtotalDivisa = Math.round(precioDivisa * qty * 100) / 100;
            }
            items.push({
              nombre: item.productName || item.requestedName,
              cantidad: qty,
              unidad: item.unit || product?.unidad || 'kg',
              precioUSD: precio,
              subtotalUSD: Math.round(precio * qty * 100) / 100,
              precioUSDDivisa: precioDivisa,
              subtotalUSDDivisa: subtotalDivisa,
            });
          } else if (!item.matched && item.suggestedName && item.customPrice) {
            // Producto personalizado (no en catálogo pero con nombre y precio)
            const cpDiv = item.customPriceDivisa || item.customPrice;
            items.push({
              nombre: item.suggestedName,
              cantidad: item.quantity,
              unidad: item.unit || 'kg',
              precioUSD: item.customPrice,
              subtotalUSD: Math.round(item.customPrice * item.quantity * 100) / 100,
              precioUSDDivisa: cpDiv,
              subtotalUSDDivisa: Math.round(cpDiv * item.quantity * 100) / 100,
            });
          }
        });

        if (items.length > 0) {
          setNewPresupuestoItems(prev => [...prev, ...items]);
          setPresupuestoTextInput('');
          // Auto-calculate amounts for the transaction
          const total = items.reduce((sum: number, i: any) => sum + i.subtotalUSD, 0);
          if (!txForm.amountUsd || parseFloat(txForm.amountUsd) === 0) {
            const rate = bcvRate || parseFloat(txForm.exchangeRate) || 1;
            setTxForm(prev => ({
              ...prev,
              amountUsd: String(Math.round(total * 100) / 100),
              amountBs: String(Math.round(total * rate * 100) / 100),
            }));
          }
        } else {
          setParseNewPresupuestoError('No se pudieron identificar productos. Intenta con mas detalles.');
        }
      } else {
        setParseNewPresupuestoError(result.error || 'Error al procesar la lista');
      }
    } catch (error) {
      console.error('Error parsing presupuesto:', error);
      setParseNewPresupuestoError('Error de conexion. Intenta de nuevo.');
    } finally {
      setIsParsingNewPresupuesto(false);
    }
  };

  const handleSaveTransaction = async () => {
    if (!selectedCustomer) return;

    if (!txForm.date || !txForm.description.trim()) {
      alert('La fecha y descripcion son requeridas');
      return;
    }

    const usd = parseFloat(txForm.amountUsd) || 0;
    const bs = parseFloat(txForm.amountBs) || 0;

    if (usd <= 0 && bs <= 0) {
      alert('Al menos un monto debe ser mayor a 0');
      return;
    }

    setIsSavingTx(true);
    try {
      // Create presupuesto first if requested
      let createdPresupuestoId: string | null = null;
      if (createPresupuestoFromTx && newPresupuestoItems.length > 0 && txModalType === 'purchase') {
        const presTotal = newPresupuestoItems.reduce((sum, i) => sum + i.subtotalUSD, 0);
        const rate = bcvRate || parseFloat(txForm.exchangeRate) || 1;
        const presTotalBs = presTotal * rate;

        const presRes = await fetch('/api/presupuestos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: newPresupuestoItems,
            totalUSD: Math.round(presTotal * 100) / 100,
            totalBs: Math.round(presTotalBs * 100) / 100,
            customerName: selectedCustomer.name,
            status: 'pagado', // Ya está pagado si es una compra pasada
            source: 'admin',
            customDate: presupuestoDate || txForm.date, // Fecha personalizada
          }),
          credentials: 'include'
        });

        const presData = await presRes.json();
        if (presData.success && presData.id) {
          createdPresupuestoId = presData.id;
        } else {
          throw new Error(presData.error || 'Error al crear presupuesto');
        }
      }

      const payload = {
        type: txModalType,
        date: txForm.date,
        description: txForm.description.trim(),
        amountUsd: usd,
        amountBs: bs,
        presupuestoId: createdPresupuestoId || txForm.presupuestoId.trim() || null,
        notes: txForm.notes.trim() || null,
        currencyType: txForm.currencyType,
        paymentMethod: txModalType === 'payment' && txForm.paymentMethod ? txForm.paymentMethod : null,
        exchangeRate: txForm.exchangeRate ? parseFloat(txForm.exchangeRate) : null
      } as any;

      // Add dual amount: from presupuesto auto-fill or manual dual
      if (txModalType === 'purchase') {
        if (fetchedPresupuesto?.isDual) {
          payload.amountUsdDivisa = fetchedPresupuesto.totalUSDDivisa;
        } else if (isManualDual && txForm.amountUsdDivisa) {
          payload.amountUsdDivisa = parseFloat(txForm.amountUsdDivisa);
        }
      }

      let response;
      let txId: number;

      if (editingTx) {
        response = await fetch(`/api/customers/${selectedCustomer.id}/transactions/${editingTx.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'include'
        });
        const data = await response.json();
        if (!data.success) {
          alert(data.error || 'Error al guardar');
          return;
        }
        txId = editingTx.id;
      } else {
        response = await fetch(`/api/customers/${selectedCustomer.id}/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'include'
        });
        const data = await response.json();
        if (!data.success) {
          alert(data.error || 'Error al guardar');
          return;
        }
        txId = data.id;
      }

      // Actualizar customer_name del presupuesto si se asignó uno existente
      const usedPresupuestoId = createdPresupuestoId || txForm.presupuestoId.trim();
      if (usedPresupuestoId && !createdPresupuestoId && selectedCustomer) {
        // Solo si usamos un presupuesto existente (no uno recién creado)
        try {
          await fetch(`/api/presupuestos/${usedPresupuestoId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customerName: selectedCustomer.name }),
            credentials: 'include'
          });
        } catch (updateErr) {
          console.error('Error updating presupuesto customer name:', updateErr);
        }
      }

      // Eliminar imagen existente si fue marcada para borrar
      if (removeExistingImage && editingTx && txId) {
        try {
          await fetch(`/api/customers/${selectedCustomer.id}/transactions/${txId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ removeImage: true }),
            credentials: 'include'
          });
        } catch (delErr) {
          console.error('Error removing invoice image:', delErr);
        }
      }

      // Subir imagen de factura si hay nueva
      if (invoiceFile && txId) {
        const formData = new FormData();
        formData.append('image', invoiceFile);
        formData.append('transactionId', String(txId));

        try {
          await fetch('/api/customers/upload-invoice', {
            method: 'POST',
            body: formData,
            credentials: 'include'
          });
        } catch (uploadErr) {
          console.error('Error uploading invoice:', uploadErr);
        }
      }

      setShowTxModal(false);
      loadTransactions(selectedCustomer.id);
      loadCustomerDetail(selectedCustomer.id);
    } catch (err) {
      console.error('Error saving transaction:', err);
      alert('Error al guardar el movimiento');
    } finally {
      setIsSavingTx(false);
    }
  };

  // ─── Eliminar transaccion ─────────────────────────────────────────

  const handleDeleteTransaction = async (tx: CustomerTransaction) => {
    if (!selectedCustomer) return;
    if (!confirm('¿Seguro que deseas eliminar este movimiento?')) return;

    try {
      const response = await fetch(`/api/customers/${selectedCustomer.id}/transactions/${tx.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      const data = await response.json();

      if (data.success) {
        setShowTxDetailModal(false);
        setExpandedTxId(null);
        loadTransactions(selectedCustomer.id);
        loadCustomerDetail(selectedCustomer.id);
      } else {
        alert(data.error || 'Error al eliminar');
      }
    } catch (err) {
      console.error('Error deleting transaction:', err);
      alert('Error al eliminar el movimiento');
    }
  };

  // ─── Marcar Pagado / No Pagado ──────────────────────────────────

  const handleMarkTxPaid = async () => {
    if (!selectedCustomer || !paidTx) return;
    setIsSavingPaid(true);
    try {
      const response = await fetch(`/api/customers/${selectedCustomer.id}/transactions/${paidTx.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markPaid: true,
          paidMethod: paidForm.paidMethod || null,
          paidDate: paidForm.paidDate || new Date().toISOString().split('T')[0],
          paidNotes: paidForm.notes || null
        }),
        credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        setShowPaidModal(false);
        setPaidTx(null);
        loadTransactions(selectedCustomer.id);
        // Reload customer to refresh balance
        const custRes = await fetch(`/api/customers/${selectedCustomer.id}`, { credentials: 'include' });
        const custData = await custRes.json();
        if (custData.success) setSelectedCustomer(custData.customer);
        loadCustomers(searchTerm || undefined);
      } else {
        alert(data.error || 'Error');
      }
    } catch {
      alert('Error de conexion');
    } finally {
      setIsSavingPaid(false);
    }
  };

  const handleMarkTxUnpaid = async (tx: CustomerTransaction) => {
    if (!selectedCustomer || !confirm('Desmarcar esta compra como pagada?')) return;
    try {
      const response = await fetch(`/api/customers/${selectedCustomer.id}/transactions/${tx.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markUnpaid: true }),
        credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        loadTransactions(selectedCustomer.id);
        const custRes = await fetch(`/api/customers/${selectedCustomer.id}`, { credentials: 'include' });
        const custData = await custRes.json();
        if (custData.success) setSelectedCustomer(custData.customer);
        loadCustomers(searchTerm || undefined);
      }
    } catch {
      alert('Error de conexion');
    }
  };

  // ─── Modal Detalle Transaccion ────────────────────────────────────

  const handleShowTxDetail = (tx: CustomerTransaction) => {
    setDetailTx(tx);
    setShowTxDetailModal(true);
  };

  // ─── Modal Compartir ──────────────────────────────────────────────

  const handleOpenShareModal = () => {
    if (!selectedCustomer) return;
    if (selectedCustomer.shareToken) {
      setShareUrl(`${window.location.origin}/cuenta/${selectedCustomer.shareToken}`);
    } else {
      setShareUrl(null);
    }
    setCopiedLink(false);
    setShowShareModal(true);
  };

  const handleGenerateShareToken = async () => {
    if (!selectedCustomer) return;
    setIsGeneratingToken(true);
    try {
      const response = await fetch(`/api/customers/${selectedCustomer.id}/share-token`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await response.json();

      if (data.success) {
        const url = data.url || `${window.location.origin}/cuenta/${data.token}`;
        setShareUrl(url);
        loadCustomerDetail(selectedCustomer.id);
      } else {
        alert(data.error || 'Error al generar enlace');
      }
    } catch (err) {
      console.error('Error generating share token:', err);
      alert('Error al generar enlace');
    } finally {
      setIsGeneratingToken(false);
    }
  };

  const handleRevokeShareToken = async () => {
    if (!selectedCustomer) return;
    if (!confirm('¿Revocar acceso publico? El enlace dejara de funcionar.')) return;

    try {
      const response = await fetch(`/api/customers/${selectedCustomer.id}/share-token`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await response.json();

      if (data.success) {
        setShareUrl(null);
        loadCustomerDetail(selectedCustomer.id);
      } else {
        alert(data.error || 'Error al revocar');
      }
    } catch (err) {
      console.error('Error revoking share token:', err);
      alert('Error al revocar enlace');
    }
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleShareWhatsApp = () => {
    if (!shareUrl || !selectedCustomer) return;
    const message = `Hola ${selectedCustomer.name}, aqui puedes ver tu estado de cuenta:\n${shareUrl}`;
    let phone = selectedCustomer.phone?.replace(/\D/g, '') || '';
    // Ensure Venezuelan phone has country code
    if (phone && !phone.startsWith('58')) {
      if (phone.startsWith('0') && phone.length === 11) {
        // 04142145202 → 584142145202
        phone = '58' + phone.substring(1);
      } else if (phone.length === 10) {
        // 4142145202 → 584142145202
        phone = '58' + phone;
      }
    }
    // Use api.whatsapp.com/send which is more reliable across devices
    const waUrl = phone
      ? `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
    window.open(waUrl, '_blank');
  };

  // ─── AI Handlers ─────────────────────────────────────────────────

  const handleAiSubmit = async () => {
    if (!aiText.trim() || aiProcessing) return;
    setAiProcessing(true);
    setAiError(null);
    setAiActions([]);
    setAiProductAction(null);
    setAiUnmatched([]);
    setAiConfirming(false);

    try {
      if (aiMode === 'productos') {
        // Product mode: parse products and create presupuesto
        // Fetch products
        const productsRes = await fetch('/api/products');
        const productsData = await productsRes.json();
        if (!productsData.success || !productsData.products) {
          throw new Error('Error al cargar productos');
        }

        const productInfo = productsData.products.map((p: any) => ({
          id: p.id,
          nombre: p.nombre,
          unidad: p.unidad,
          precioUSD: p.precioUSD,
          precioUSDDivisa: p.precioUSDDivisa ?? null,
        }));

        // Get BCV rate if not already loaded
        let rate = bcvRate || 1;
        if (!bcvRate) {
          try {
            const rateRes = await fetch('/api/bcv-rate');
            const rateData = await rateRes.json();
            if (rateData.success && rateData.rate) {
              rate = rateData.rate;
              setBcvRate(rateData.rate);
            }
          } catch {}
        }

        const response = await fetch('/api/purchase-with-products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: aiText,
            products: productInfo,
            customers: customers.map(c => ({ id: c.id, name: c.name })),
            bcvRate: rate,
            pricingMode: aiPricingMode
          }),
          credentials: 'include'
        });

        const data = await response.json();
        if (data.success && data.action) {
          setAiProductAction(data.action);
          setAiUnmatched(data.unmatched || []);
          setAiConfirming(true);
        } else {
          setAiError(data.error || 'No se identificaron productos.');
          setAiUnmatched(data.unmatched || []);
        }
      } else {
        // Simple mode: existing behavior
        let recentPresupuestos: Array<{ id: string; fecha: string; customerName: string; totalUSD: number; totalUSDDivisa: number | null }> = [];
        try {
          const pRes = await fetch('/api/presupuestos?limit=20', { credentials: 'include' });
          const pData = await pRes.json();
          if (pData.success) {
            recentPresupuestos = pData.presupuestos.map((p: any) => ({
              id: p.id,
              fecha: p.fecha,
              customerName: p.customerName || '',
              totalUSD: p.totalUSD,
              totalUSDDivisa: p.totalUSDDivisa || null
            }));
          }
        } catch {}

        const response = await fetch('/api/customer-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: aiText,
            customers: customers.map(c => ({ id: c.id, name: c.name })),
            recentPresupuestos
          }),
          credentials: 'include'
        });

        const data = await response.json();
        if (data.success && data.actions.length > 0) {
          setAiActions(data.actions);
          setAiConfirming(true);
        } else if (data.success && data.actions.length === 0) {
          setAiError('No se detectaron acciones. Reformula tu texto.');
        } else {
          setAiError(data.error || 'Error al procesar');
        }
      }
    } catch (err) {
      setAiError('Error de conexion');
    } finally {
      setAiProcessing(false);
    }
  };

  const handleAiConfirm = async () => {
    setAiExecuting(true);
    let successCount = 0;
    let failCount = 0;

    if (aiMode === 'productos' && aiProductAction) {
      // Product mode: create presupuesto then transaction
      const action = aiProductAction;
      let customerId = action.customerId;

      try {
        // If customer doesn't exist, create them first
        if (!customerId) {
          const createCustomerRes = await fetch('/api/customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              name: action.customerName,
              phone: null,
              notes: null,
              rateType: 'dolar_bcv',
              customRate: null
            })
          });

          const customerData = await createCustomerRes.json();
          if (customerData.success && customerData.id) {
            customerId = customerData.id;
            // Refresh customer list after creating new customer
            await loadCustomers();
          } else {
            throw new Error(customerData.error || 'Error al crear cliente');
          }
        }

        const txDate = action.date || todayStr();

        // 1. Create presupuesto
        const modoPrecio = action.pricingMode === 'divisas' ? 'divisa' : action.pricingMode;
        const presRes = await fetch('/api/presupuestos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: action.items,
            totalUSD: action.totalUSD,
            totalBs: action.totalBs,
            totalUSDDivisa: action.totalUSDDivisa,
            delivery: action.delivery ?? 0,
            customerName: action.customerName,
            status: 'pendiente',
            source: 'admin',
            customDate: txDate,
            modoPrecio,
            hideRate: (action.hideRate && action.pricingMode !== 'divisas') || false,
          }),
          credentials: 'include'
        });

        const presData = await presRes.json();
        if (!presData.success || !presData.id) {
          throw new Error(presData.error || 'Error al crear presupuesto');
        }

        const presupuestoId = presData.id;

        // 2. Create transaction linked to presupuesto
        const txPayload: any = {
          type: 'purchase',
          date: txDate,
          description: `Presupuesto ${presupuestoId}`,
          amountUsd: action.totalUSD,
          amountBs: action.totalBs,
          presupuestoId: presupuestoId,
          notes: '',
          currencyType: action.pricingMode === 'divisas' ? 'divisas' : 'dolar_bcv',
          paymentMethod: '',
          exchangeRate: bcvRate || ''
        };

        // Add dual amount if applicable
        if (action.pricingMode === 'dual' && action.totalUSDDivisa) {
          txPayload.amountUsdDivisa = action.totalUSDDivisa;
        }

        const txRes = await fetch(`/api/customers/${customerId}/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(txPayload),
          credentials: 'include'
        });

        const txData = await txRes.json();
        if (txData.success) {
          successCount++;
        } else {
          throw new Error(txData.error || 'Error al crear transaccion');
        }
      } catch (err) {
        console.error('Error creating purchase with products:', err);
        failCount++;
        alert(`Error: ${err instanceof Error ? err.message : 'Error desconocido'}`);
      }
    } else {
      // Simple mode: existing behavior
      for (const action of aiActions) {
        if (!action.customerId) {
          failCount++;
          continue;
        }
        try {
          const today = new Date().toISOString().split('T')[0];
          const txDate = action.date || today;
          const txPayload: any = {
              type: action.type,
              date: txDate,
              description: action.description,
              amountUsd: action.amountUsd,
              amountBs: 0,
              presupuestoId: action.presupuestoId || '',
              notes: '',
              currencyType: action.currencyType,
              paymentMethod: action.paymentMethod || '',
              exchangeRate: ''
            };
          if (action.amountUsdDivisa && action.amountUsdDivisa > 0) {
            txPayload.amountUsdDivisa = action.amountUsdDivisa;
          }
          const response = await fetch(`/api/customers/${action.customerId}/transactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(txPayload),
            credentials: 'include'
          });
          const data = await response.json();
          if (data.success) successCount++;
          else failCount++;
        } catch {
          failCount++;
        }
      }
    }

    setAiExecuting(false);
    setAiConfirming(false);
    setAiActions([]);
    setAiProductAction(null);
    setAiUnmatched([]);
    setAiText('');

    if (failCount > 0) {
      alert(`${successCount} transaccion(es) creada(s), ${failCount} fallida(s)`);
    }

    // Refresh customer list
    loadCustomers(searchTerm || undefined);
  };

  const handleAiCancel = () => {
    setAiConfirming(false);
    setAiActions([]);
    setAiProductAction(null);
    setAiUnmatched([]);
  };

  // ─── Render: Vista Lista ──────────────────────────────────────────

  const renderListView = () => (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-ocean-100">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-ocean-900">Clientes</h2>
            <p className="text-sm text-ocean-600">
              {customers.length} cliente{customers.length !== 1 ? 's' : ''} registrado{customers.length !== 1 ? 's' : ''}
            </p>
          </div>

          <button
            onClick={handleNewCustomer}
            className="px-4 py-2 bg-ocean-600 hover:bg-ocean-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nuevo Cliente
          </button>
        </div>
      </div>

      {/* Busqueda */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-ocean-100">
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-xs text-ocean-600 mb-1">Buscar</label>
            <div className="relative">
              <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ocean-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Nombre o telefono..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
              />
            </div>
          </div>

          <div className="flex items-end">
            <button
              onClick={() => loadCustomers(searchTerm || undefined)}
              disabled={isLoading}
              className="px-4 py-2 bg-ocean-100 text-ocean-700 rounded-lg text-sm hover:bg-ocean-200 transition-colors"
            >
              {isLoading ? '...' : 'Actualizar'}
            </button>
          </div>
        </div>
      </div>

      {/* IA Anotaciones rapidas */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-purple-100">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-sm font-semibold text-purple-700">Anotacion rapida con IA</span>
          </div>
          {/* Mode toggle */}
          <div className="flex bg-purple-100 rounded-lg p-0.5">
            <button
              onClick={() => setAiMode('simple')}
              className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-all ${
                aiMode === 'simple'
                  ? 'bg-white text-purple-800 shadow-sm'
                  : 'text-purple-500 hover:text-purple-700'
              }`}
            >
              Simple
            </button>
            <button
              onClick={() => setAiMode('productos')}
              className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-all ${
                aiMode === 'productos'
                  ? 'bg-white text-purple-800 shadow-sm'
                  : 'text-purple-500 hover:text-purple-700'
              }`}
            >
              Con Productos
            </button>
          </div>
        </div>

        {/* Pricing mode selector (only for productos mode) */}
        {aiMode === 'productos' && (
          <div className="flex gap-1 mb-2">
            <button
              onClick={() => setAiPricingMode('bcv')}
              className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
                aiPricingMode === 'bcv'
                  ? 'bg-blue-100 border-blue-300 text-blue-700'
                  : 'bg-white border-ocean-200 text-ocean-500 hover:bg-ocean-50'
              }`}
            >
              BCV
            </button>
            <button
              onClick={() => setAiPricingMode('divisas')}
              className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
                aiPricingMode === 'divisas'
                  ? 'bg-green-100 border-green-300 text-green-700'
                  : 'bg-white border-ocean-200 text-ocean-500 hover:bg-ocean-50'
              }`}
            >
              Divisas
            </button>
            <button
              onClick={() => setAiPricingMode('dual')}
              className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
                aiPricingMode === 'dual'
                  ? 'bg-purple-100 border-purple-300 text-purple-700'
                  : 'bg-white border-ocean-200 text-ocean-500 hover:bg-ocean-50'
              }`}
            >
              Dual
            </button>
          </div>
        )}

        <div className="flex gap-2">
          <textarea
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            placeholder={aiMode === 'productos'
              ? 'Ej: "registra a Delcy 2kg calamar y 1kg camaron del 03 de febrero"'
              : 'Ej: "anota a Deisy $100 de mariscos, abono de Jose $50 pago movil"'
            }
            className="flex-1 px-3 py-2 border border-purple-200 rounded-lg text-sm focus:ring-1 focus:ring-purple-500 focus:border-transparent outline-none resize-none placeholder:text-ocean-400"
            rows={2}
            disabled={aiProcessing || aiExecuting}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleAiSubmit();
              }
            }}
          />
          <button
            onClick={handleAiSubmit}
            disabled={aiProcessing || !aiText.trim() || aiExecuting}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-300 text-white rounded-lg text-sm font-medium transition-colors self-end whitespace-nowrap"
          >
            {aiProcessing ? '...' : 'Procesar'}
          </button>
        </div>

        {aiError && (
          <p className="text-xs text-red-600 mt-2">{aiError}</p>
        )}
        {aiUnmatched.length > 0 && (
          <p className="text-xs text-amber-600 mt-1">No identificados: {aiUnmatched.join(', ')}</p>
        )}

        {/* Product mode preview */}
        {aiConfirming && aiProductAction && (
          <div className="mt-3 bg-purple-50 rounded-lg p-3 border border-purple-200">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-purple-700">Presupuesto a crear:</p>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                aiProductAction.pricingMode === 'dual' ? 'bg-purple-100 text-purple-700' :
                aiProductAction.pricingMode === 'divisas' ? 'bg-green-100 text-green-700' :
                'bg-blue-100 text-blue-700'
              }`}>
                {aiProductAction.pricingMode === 'dual' ? 'Dual' :
                 aiProductAction.pricingMode === 'divisas' ? 'Divisas' : 'BCV'}
              </span>
            </div>

            {/* Customer selector and date */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {aiProductAction.customerId ? (
                <span className="text-sm font-medium text-ocean-700">{aiProductAction.customerName}</span>
              ) : (
                <div className="flex items-center gap-1 flex-wrap">
                  <select
                    className="text-sm border border-amber-300 bg-amber-50 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                    value={aiProductAction.customerId || 'new'}
                    onChange={(e) => {
                      if (e.target.value === 'new') {
                        setAiProductAction(prev => prev ? {
                          ...prev,
                          customerId: null
                        } : null);
                      } else {
                        const selectedId = Number(e.target.value);
                        const selectedCustomer = customers.find(c => c.id === selectedId);
                        setAiProductAction(prev => prev ? {
                          ...prev,
                          customerId: selectedId,
                          customerName: selectedCustomer?.name || prev.customerName
                        } : null);
                      }
                    }}
                  >
                    <option value="new">➕ Crear: "{aiProductAction.customerName}"</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">
                    Nuevo cliente
                  </span>
                </div>
              )}
              {aiProductAction.date && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
                  {formatDate(aiProductAction.date)}
                </span>
              )}
            </div>

            {/* Items table */}
            <div className="bg-white rounded border border-purple-200 overflow-x-auto mb-2">
              <table className="w-full text-xs min-w-[400px]">
                <thead className="bg-purple-100">
                  <tr>
                    <th className="px-2 py-1 text-left text-purple-700">Producto</th>
                    <th className="px-2 py-1 text-center text-purple-700">Cant</th>
                    <th className="px-2 py-1 text-right text-purple-700">P.Unit</th>
                    <th className="px-2 py-1 text-right text-purple-700">Subtotal</th>
                    {aiProductAction.pricingMode === 'dual' && (
                      <>
                        <th className="px-2 py-1 text-right text-amber-700">P.Unit Div</th>
                        <th className="px-2 py-1 text-right text-amber-700">Subtotal Div</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-100">
                  {aiProductAction.items.map((item, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1 text-ocean-800">{item.nombre}</td>
                      <td className="px-2 py-1 text-center">
                        <input
                          type="number"
                          step={item.unidad === 'kg' ? '0.1' : '1'}
                          min="0"
                          value={item.cantidad}
                          onChange={(e) => {
                            const newQty = parseFloat(e.target.value) || 0;
                            setAiProductAction(prev => {
                              if (!prev) return null;
                              const newItems = [...prev.items];
                              const it = newItems[i];
                              newItems[i] = {
                                ...it,
                                cantidad: newQty,
                                subtotalUSD: Math.round(it.precioUSD * newQty * 100) / 100,
                                ...(prev.pricingMode === 'dual' ? {
                                  subtotalUSDDivisa: Math.round((it.precioUSDDivisa ?? it.precioUSD) * newQty * 100) / 100
                                } : {})
                              };
                              return recalcTotals(prev, newItems);
                            });
                          }}
                          className="w-14 px-1 py-0.5 text-center text-ocean-700 border border-ocean-200 rounded focus:outline-none focus:ring-1 focus:ring-ocean-400 text-xs"
                        />
                        <span className="ml-0.5 text-ocean-500">{item.unidad}</span>
                      </td>
                      <td className="px-2 py-1 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-ocean-400">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.precioUSD}
                            onChange={(e) => {
                              const newPrice = parseFloat(e.target.value) || 0;
                              setAiProductAction(prev => {
                                if (!prev) return null;
                                const newItems = [...prev.items];
                                newItems[i] = {
                                  ...newItems[i],
                                  precioUSD: newPrice,
                                  subtotalUSD: Math.round(newPrice * newItems[i].cantidad * 100) / 100,
                                  ...(prev.pricingMode === 'dual' ? {
                                    subtotalUSDDivisa: Math.round((newItems[i].precioUSDDivisa ?? newPrice) * newItems[i].cantidad * 100) / 100
                                  } : {})
                                };
                                return recalcTotals(prev, newItems);
                              });
                            }}
                            className="w-14 px-1 py-0.5 text-right text-ocean-700 border border-ocean-200 rounded focus:outline-none focus:ring-1 focus:ring-ocean-400 text-xs"
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1 text-right font-medium text-ocean-800">
                        {formatUSD(item.subtotalUSD)}
                      </td>
                      {aiProductAction.pricingMode === 'dual' && (
                        <>
                          <td className="px-2 py-1 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-amber-500">$</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={item.precioUSDDivisa ?? item.precioUSD}
                                onChange={(e) => {
                                  const newPriceDiv = parseFloat(e.target.value) || 0;
                                  setAiProductAction(prev => {
                                    if (!prev) return null;
                                    const newItems = [...prev.items];
                                    newItems[i] = {
                                      ...newItems[i],
                                      precioUSDDivisa: newPriceDiv,
                                      subtotalUSDDivisa: Math.round(newPriceDiv * newItems[i].cantidad * 100) / 100
                                    };
                                    return recalcTotals(prev, newItems);
                                  });
                                }}
                                className="w-14 px-1 py-0.5 text-right text-amber-700 border border-amber-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-400 text-xs"
                              />
                            </div>
                          </td>
                          <td className="px-2 py-1 text-right font-medium text-amber-700">
                            {formatUSD((item.subtotalUSDDivisa ?? item.subtotalUSD))}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                  {aiProductAction.delivery != null && aiProductAction.delivery > 0 && (
                    <tr className="bg-amber-50/50 border-t border-amber-200">
                      <td className="px-2 py-1 text-amber-700 italic">Delivery</td>
                      <td className="px-2 py-1 text-center text-amber-600">-</td>
                      <td className="px-2 py-1 text-right text-amber-600">-</td>
                      <td className="px-2 py-1 text-right font-medium text-amber-700">{formatUSD(aiProductAction.delivery)}</td>
                      {aiProductAction.pricingMode === 'dual' && (
                        <>
                          <td className="px-2 py-1 text-right text-amber-600">-</td>
                          <td className="px-2 py-1 text-right font-medium text-amber-700">{formatUSD(aiProductAction.delivery)}</td>
                        </>
                      )}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="flex flex-wrap gap-3 text-sm mb-3">
              <div>
                <span className="text-ocean-500">Total USD: </span>
                <span className="font-bold text-ocean-800">{formatUSD(aiProductAction.totalUSD)}</span>
              </div>
              {aiProductAction.pricingMode !== 'divisas' && (
                <div>
                  <span className="text-ocean-500">Total Bs: </span>
                  <span className="font-bold text-orange-600">Bs {aiProductAction.totalBs.toFixed(2)}</span>
                </div>
              )}
              {aiProductAction.totalUSDDivisa && (
                <div>
                  <span className="text-amber-500">USD Divisa: </span>
                  <span className="font-bold text-amber-700">{formatUSD(aiProductAction.totalUSDDivisa)}</span>
                </div>
              )}
            </div>

            {/* Toggle Solo divisas (ocultar Bs) - solo en BCV o Dual */}
            {aiProductAction.pricingMode !== 'divisas' && (
              <div className="flex items-center justify-between py-2 mb-2">
                <label htmlFor="ai-solo-divisas" className="text-xs text-ocean-600 cursor-pointer">Solo divisas (ocultar Bs en print/WhatsApp)</label>
                <button
                  id="ai-solo-divisas"
                  type="button"
                  onClick={() => setAiProductAction(prev => prev ? { ...prev, hideRate: !prev.hideRate } : null)}
                  className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${aiProductAction.hideRate ? 'bg-coral-500' : 'bg-ocean-200'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${aiProductAction.hideRate ? 'translate-x-4' : ''}`} />
                </button>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleAiConfirm}
                disabled={aiExecuting || (!aiProductAction.customerId && !aiProductAction.customerName)}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-green-300 text-white rounded-lg text-xs font-medium transition-colors"
              >
                {aiExecuting ? 'Creando...' : 'Crear Presupuesto + Compra'}
              </button>
              <button
                onClick={handleAiCancel}
                disabled={aiExecuting}
                className="px-3 py-1.5 bg-ocean-100 text-ocean-700 rounded-lg text-xs font-medium hover:bg-ocean-200 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Simple mode preview */}
        {aiConfirming && aiActions.length > 0 && (
          <div className="mt-3 bg-purple-50 rounded-lg p-3 border border-purple-200">
            <p className="text-xs font-semibold text-purple-700 mb-2">Acciones detectadas:</p>
            <div className="space-y-2">
              {aiActions.map((action, i) => (
                <div key={i} className="flex items-center gap-2 text-sm flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                    action.type === 'purchase'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-green-100 text-green-700'
                  }`}>
                    {action.type === 'purchase' ? 'Compra' : 'Abono'}
                  </span>
                  {action.date && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
                      {formatDate(action.date)}
                    </span>
                  )}
                  <span className="text-ocean-700 font-medium">{action.customerName}</span>
                  {!action.customerId && (
                    <span className="text-xs text-amber-600 bg-amber-50 px-1 rounded">No encontrado</span>
                  )}
                  <span className="text-ocean-600">{formatUSD(action.amountUsd)}</span>
                  {action.amountUsdDivisa != null && action.amountUsdDivisa > 0 && (
                    <span className="text-xs text-amber-600">| Div: {formatUSD(action.amountUsdDivisa)}</span>
                  )}
                  <span className="text-ocean-400 text-xs">{action.description}</span>
                  {action.presupuestoId && (
                    <span className="text-xs text-purple-600">#{action.presupuestoId}</span>
                  )}
                  {action.amountUsdDivisa != null && action.amountUsdDivisa > 0 && (
                    <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">Dual</span>
                  )}
                  {action.paymentMethod && (
                    <span className="text-xs text-ocean-400">({action.paymentMethod})</span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleAiConfirm}
                disabled={aiExecuting || aiActions.every(a => !a.customerId)}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-green-300 text-white rounded-lg text-xs font-medium transition-colors"
              >
                {aiExecuting ? 'Creando...' : 'Confirmar'}
              </button>
              <button
                onClick={handleAiCancel}
                disabled={aiExecuting}
                className="px-3 py-1.5 bg-ocean-100 text-ocean-700 rounded-lg text-xs font-medium hover:bg-ocean-200 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Lista de clientes */}
      {isLoading && customers.length === 0 ? (
        <div className="bg-white rounded-xl p-8 shadow-sm border border-ocean-100 text-center text-ocean-600">
          Cargando clientes...
        </div>
      ) : error ? (
        <div className="bg-white rounded-xl p-8 shadow-sm border border-ocean-100 text-center text-red-600">
          {error}
        </div>
      ) : customers.length === 0 ? (
        <div className="bg-white rounded-xl p-8 shadow-sm border border-ocean-100 text-center">
          <p className="text-ocean-600 mb-4">No hay clientes registrados</p>
          <button
            onClick={handleNewCustomer}
            className="px-4 py-2 bg-ocean-600 hover:bg-ocean-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Crear primer cliente
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {customers.map((customer) => (
            <button
              key={customer.id}
              onClick={() => handleSelectCustomer(customer)}
              className="w-full bg-white rounded-xl shadow-sm border border-ocean-100 p-4 text-left hover:border-ocean-300 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-ocean-900 text-base">{customer.name}</span>
                    {customer.rateType === 'euro_bcv' && (
                      <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">
                        Euro BCV
                      </span>
                    )}
                    {customer.rateType === 'manual' && (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full font-medium">
                        Manual
                      </span>
                    )}
                  </div>
                  {customer.phone && (
                    <p className="text-xs text-ocean-500 mt-0.5">{customer.phone}</p>
                  )}
                </div>

                <div className="text-right flex-shrink-0">
                  {(() => {
                    const totalBalance = customer.balanceDivisas + customer.balanceBcv + customer.balanceEuro;
                    return (
                      <>
                        <p className={`font-semibold text-sm ${totalBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {formatUSD(totalBalance)}
                        </p>
                        {customer.balanceDivisas > 0 && customer.balanceBcv > 0 && (
                          <p className="text-xs text-ocean-500">
                            Div: {formatUSD(customer.balanceDivisas)} | BCV: {formatUSD(customer.balanceBcv)}
                          </p>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // ─── Render: Vista Detalle ────────────────────────────────────────

  const renderDetailView = () => {
    if (!selectedCustomer) return null;

    // Check if this customer has dual transactions
    const hasDual = transactions.some(tx => tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0);

    // Calculate adjusted balances based on toggle
    let displayBcv = selectedCustomer.balanceBcv;
    let displayDivisas = selectedCustomer.balanceDivisas;
    const displayEuro = selectedCustomer.balanceEuro;

    if (hasDual && dualView === 'divisas') {
      const dualBcvSum = transactions
        .filter(tx => tx.type === 'purchase' && !tx.isPaid && tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0 && tx.currencyType === 'dolar_bcv')
        .reduce((sum, tx) => sum + tx.amountUsd, 0);
      const dualDivisaSum = transactions
        .filter(tx => tx.type === 'purchase' && !tx.isPaid && tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0 && tx.currencyType === 'dolar_bcv')
        .reduce((sum, tx) => sum + (tx.amountUsdDivisa || 0), 0);
      displayBcv = selectedCustomer.balanceBcv - dualBcvSum;
      displayDivisas = selectedCustomer.balanceDivisas + dualDivisaSum;
    }

    const hasDebtDivisas = displayDivisas > 0;
    const hasDebtBcv = displayBcv > 0;
    const hasDebtEuro = displayEuro > 0;
    const showDivisas = displayDivisas !== 0 || (hasDual && dualView === 'divisas');
    const showBcv = displayBcv !== 0 || (hasDual && dualView === 'bcv');
    const showEuro = displayEuro !== 0;
    const activeBalances = [showDivisas, showBcv, showEuro].filter(Boolean).length;

    return (
      <div className="space-y-4">
        {/* Header con back y acciones */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-ocean-100">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={handleBackToList}
                className="p-2 text-ocean-600 hover:bg-ocean-50 rounded-lg transition-colors flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-ocean-900 truncate">{selectedCustomer.name}</h2>
                {selectedCustomer.phone && (
                  <p className="text-xs text-ocean-500">{selectedCustomer.phone}</p>
                )}
                {selectedCustomer.notes && (
                  <p className="text-xs text-amber-600 mt-0.5 flex items-center gap-1">
                    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                    </svg>
                    <span className="truncate">{selectedCustomer.notes}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={handleEditCustomer}
                className="p-2 text-ocean-600 hover:bg-ocean-50 rounded-lg transition-colors"
                title="Editar cliente"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={handleOpenShareModal}
                className="p-2 text-ocean-600 hover:bg-ocean-50 rounded-lg transition-colors"
                title="Compartir enlace"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </button>
              <button
                onClick={() => handleDeleteCustomer(selectedCustomer.id, selectedCustomer.name)}
                className="p-2 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors"
                title="Eliminar cliente"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Toggle BCV/Divisas for dual */}
        {hasDual && (
          <div className="bg-white rounded-xl p-3 shadow-sm border border-ocean-100">
            <div className="flex bg-ocean-100 rounded-lg p-0.5">
              <button
                onClick={() => setDualView('bcv')}
                className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold transition-all duration-200 ${
                  dualView === 'bcv'
                    ? 'bg-white text-ocean-800 shadow-sm'
                    : 'text-ocean-500 hover:text-ocean-700'
                }`}
              >
                Vista BCV
              </button>
              <button
                onClick={() => setDualView('divisas')}
                className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold transition-all duration-200 ${
                  dualView === 'divisas'
                    ? 'bg-white text-amber-800 shadow-sm'
                    : 'text-ocean-500 hover:text-ocean-700'
                }`}
              >
                Vista Divisas
              </button>
            </div>
          </div>
        )}

        {/* Balance cards */}
        <div className={`grid gap-3 ${activeBalances >= 3 ? 'grid-cols-3' : activeBalances === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {(showDivisas || activeBalances === 0) && (
            <div className={`rounded-xl p-4 shadow-sm border ${hasDebtDivisas ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
              <p className={`text-xs font-medium ${hasDebtDivisas ? 'text-red-600' : 'text-green-600'}`}>Divisas</p>
              <p className="text-[10px] text-ocean-400 mt-0.5">Dolares efectivo</p>
              <p className={`text-xl font-bold mt-1 ${hasDebtDivisas ? 'text-red-700' : 'text-green-700'}`}>
                {formatUSD(displayDivisas)}
              </p>
            </div>
          )}
          {showBcv && (
            <div className={`rounded-xl p-4 shadow-sm border ${hasDebtBcv ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
              <p className={`text-xs font-medium ${hasDebtBcv ? 'text-red-600' : 'text-green-600'}`}>Dolar BCV</p>
              <p className="text-[10px] text-ocean-400 mt-0.5">Pago en bolivares</p>
              <p className={`text-xl font-bold mt-1 ${hasDebtBcv ? 'text-red-700' : 'text-green-700'}`}>
                {formatUSD(displayBcv)}
              </p>
            </div>
          )}
          {showEuro && (
            <div className={`rounded-xl p-4 shadow-sm border ${hasDebtEuro ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
              <p className={`text-xs font-medium ${hasDebtEuro ? 'text-red-600' : 'text-green-600'}`}>€ Euro BCV</p>
              <p className="text-[10px] text-ocean-400 mt-0.5">Pago en euros</p>
              <p className={`text-xl font-bold mt-1 ${hasDebtEuro ? 'text-red-700' : 'text-green-700'}`}>
                {formatEUR(displayEuro)}
              </p>
            </div>
          )}
        </div>

        {/* Botones de accion */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleNewTransaction('purchase')}
            className="px-4 py-3 bg-coral-500 hover:bg-coral-600 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
            </svg>
            Registrar Compra
          </button>
          <button
            onClick={() => handleNewTransaction('payment')}
            className="px-4 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Registrar Abono
          </button>
        </div>

        {/* Lista de transacciones */}
        <div className="bg-white rounded-xl shadow-sm border border-ocean-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-ocean-100 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-ocean-900 text-sm">Movimientos</h3>
              <span className="text-xs text-ocean-400">{transactions.length} total</span>
            </div>
            <input
              type="text"
              value={txSearch}
              onChange={(e) => { setTxSearch(e.target.value); setTxPage(0); }}
              placeholder="Buscar movimiento..."
              className="w-full px-3 py-1.5 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
            />
            <div className="flex flex-wrap gap-1.5">
              {([
                ['all', 'Todos'],
                ['purchases', 'Compras'],
                ['payments', 'Abonos'],
                ['usd', 'USD'],
                ['bcv', 'BCV'],
                ['dual', 'Dual'],
                ['paid', 'Pagados'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => { setTxFilter(key); setTxPage(0); }}
                  className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                    txFilter === key
                      ? 'bg-ocean-600 border-ocean-600 text-white'
                      : 'bg-white border-ocean-200 text-ocean-600 hover:bg-ocean-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {(() => {
            const filteredTx = transactions.filter(tx => {
              // Search filter
              if (txSearch.trim()) {
                const q = txSearch.toLowerCase();
                if (!tx.description.toLowerCase().includes(q) && !(tx.presupuestoId || '').toLowerCase().includes(q)) return false;
              }
              // Type filter
              if (txFilter === 'purchases') return tx.type === 'purchase';
              if (txFilter === 'payments') return tx.type === 'payment';
              if (txFilter === 'usd') return tx.currencyType === 'divisas';
              if (txFilter === 'bcv') return tx.currencyType === 'dolar_bcv' && !(tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0);
              if (txFilter === 'dual') return tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0;
              if (txFilter === 'paid') return tx.isPaid;
              return true;
            });

            const totalPages = Math.ceil(filteredTx.length / TX_PAGE_SIZE);
            const pagedTx = filteredTx.slice(txPage * TX_PAGE_SIZE, (txPage + 1) * TX_PAGE_SIZE);

            return isLoadingTx ? (
              <div className="p-8 text-center text-ocean-600">Cargando movimientos...</div>
            ) : filteredTx.length === 0 ? (
              <div className="p-8 text-center text-ocean-600">
                {transactions.length === 0 ? 'No hay movimientos registrados' : 'No hay resultados para este filtro'}
              </div>
            ) : (
              <>
              <div className="divide-y divide-ocean-100">
                {pagedTx.map((tx) => (
                <div key={tx.id}>
                  <button
                    onClick={() => handleShowTxDetail(tx)}
                    className="w-full px-4 py-3 text-left hover:bg-ocean-50/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs text-ocean-500 font-mono">{formatDate(tx.date)}</span>
                          {tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0 ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">Dual</span>
                          ) : tx.currencyType === 'divisas' ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">USD</span>
                          ) : tx.currencyType === 'dolar_bcv' ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">BCV</span>
                          ) : tx.currencyType === 'euro_bcv' ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-700">€ EUR</span>
                          ) : null}
                          {tx.paymentMethod && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-ocean-100 text-ocean-600">
                              {tx.paymentMethod === 'pago_movil' ? 'P.Movil' : tx.paymentMethod === 'efectivo' ? 'Efectivo' : tx.paymentMethod === 'tarjeta' ? 'Tarjeta' : tx.paymentMethod === 'transferencia' ? 'Transf.' : tx.paymentMethod === 'zelle' ? 'Zelle' : tx.paymentMethod === 'usdt' ? 'USDT' : tx.paymentMethod}
                            </span>
                          )}
                          {tx.type === 'purchase' && tx.isPaid && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0 && tx.paidMethod
                                ? (['efectivo', 'zelle'].includes(tx.paidMethod) ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700')
                                : 'bg-green-100 text-green-700'
                            }`}>
                              {tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0 && tx.paidMethod
                                ? (['efectivo', 'zelle', 'usdt'].includes(tx.paidMethod)
                                    ? `Pagado USD (${tx.paidMethod === 'zelle' ? 'Zelle' : tx.paidMethod === 'usdt' ? 'USDT' : 'Efectivo'})`
                                    : `Pagado Bs (${tx.paidMethod === 'pago_movil' ? 'P.Movil' : tx.paidMethod === 'tarjeta' ? 'Tarjeta' : tx.paidMethod === 'transferencia' ? 'Transf.' : tx.paidMethod})`)
                                : `Pagado${tx.paidMethod ? ` (${tx.paidMethod === 'pago_movil' ? 'P.Movil' : tx.paidMethod === 'efectivo' ? 'Efectivo' : tx.paidMethod === 'tarjeta' ? 'Tarjeta' : tx.paidMethod === 'transferencia' ? 'Transf.' : tx.paidMethod === 'zelle' ? 'Zelle' : tx.paidMethod === 'usdt' ? 'USDT' : tx.paidMethod})` : ''}`
                              }
                            </span>
                          )}
                          {tx.invoiceImageUrl && (
                            <svg className="w-3.5 h-3.5 text-ocean-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          )}
                        </div>
                        <p className="text-sm text-ocean-800 truncate">{tx.description}</p>
                        {tx.presupuestoId && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleViewPresupuesto(tx.presupuestoId!); }}
                              className="text-xs text-blue-600 underline hover:text-blue-800"
                            >
                              Presupuesto: {tx.presupuestoId}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(tx.presupuestoId!); }}
                              className="p-0.5 text-ocean-400 hover:text-ocean-600 rounded"
                              title="Copiar ID"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                              </svg>
                            </button>
                          </div>
                        )}
                        {tx.invoiceImageUrl && (
                          <img
                            src={tx.invoiceImageUrl}
                            alt="Factura"
                            className="mt-1.5 w-16 h-16 object-cover rounded-md border border-ocean-200"
                          />
                        )}
                      </div>

                      <div className="text-right flex-shrink-0">
                        {(() => {
                          const isDualTx = tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0;
                          const showAmt = isDualTx && dualView === 'divisas' ? tx.amountUsdDivisa! : tx.amountUsd;
                          return (
                            <>
                              {showAmt > 0 && (
                                <p className={`text-sm font-semibold ${tx.type === 'purchase' ? (tx.isPaid ? 'text-ocean-400 line-through' : 'text-red-600') : 'text-green-600'}`}>
                                  {tx.type === 'purchase' ? '+' : '-'}{formatUSD(showAmt)}
                                </p>
                              )}
                              {isDualTx && !tx.isPaid && (
                                <p className="text-[10px] text-ocean-400 mt-0.5">
                                  {dualView === 'divisas' ? 'Precio divisa' : 'Precio BCV'}
                                </p>
                              )}
                            </>
                          );
                        })()}
                        {bcvRate > 0 && tx.currencyType !== 'divisas' && !(dualView === 'divisas' && tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0) && (
                          <p className={`text-xs ${tx.type === 'purchase' ? (tx.isPaid ? 'text-ocean-400 line-through' : 'text-red-500') : 'text-green-500'}`}>
                            {tx.type === 'purchase' ? '+' : '-'}{formatBs(tx.amountUsd * bcvRate)}
                            <span className="text-ocean-400 ml-1">@{bcvRate.toFixed(2)}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-ocean-100 flex items-center justify-between">
                <button
                  onClick={() => setTxPage(p => Math.max(0, p - 1))}
                  disabled={txPage === 0}
                  className="px-3 py-1.5 text-xs font-medium text-ocean-600 hover:bg-ocean-50 disabled:text-ocean-300 disabled:hover:bg-transparent rounded-lg transition-colors"
                >
                  Anterior
                </button>
                <span className="text-xs text-ocean-500">
                  {txPage + 1} de {totalPages} ({filteredTx.length} movimientos)
                </span>
                <button
                  onClick={() => setTxPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={txPage >= totalPages - 1}
                  className="px-3 py-1.5 text-xs font-medium text-ocean-600 hover:bg-ocean-50 disabled:text-ocean-300 disabled:hover:bg-transparent rounded-lg transition-colors"
                >
                  Siguiente
                </button>
              </div>
            )}
            </>
            );
          })()}
        </div>
      </div>
    );
  };

  // ─── Render: Modal Crear/Editar Cliente ───────────────────────────

  const renderCustomerModal = () => {
    if (!showCustomerModal) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto">
        <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl my-4">
          <div className="p-4 border-b border-ocean-100 flex items-center justify-between">
            <h3 className="font-bold text-ocean-900">
              {editingCustomer ? 'Editar Cliente' : 'Nuevo Cliente'}
            </h3>
            <button
              onClick={() => setShowCustomerModal(false)}
              className="p-2 text-ocean-600 hover:bg-ocean-50 rounded-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">
                Nombre *
              </label>
              <input
                type="text"
                value={customerForm.name}
                onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                placeholder="Nombre del cliente"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">
                Telefono
              </label>
              <input
                type="text"
                value={customerForm.phone}
                onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                placeholder="0414XXXXXXX"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">
                Notas
              </label>
              <textarea
                value={customerForm.notes}
                onChange={(e) => setCustomerForm({ ...customerForm, notes: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none resize-none"
                placeholder="Notas internas sobre el cliente..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">
                Tipo de tasa
              </label>
              <select
                value={customerForm.rateType}
                onChange={(e) => setCustomerForm({ ...customerForm, rateType: e.target.value as 'dolar_bcv' | 'euro_bcv' | 'manual' })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
              >
                <option value="dolar_bcv">Dolar BCV</option>
                <option value="euro_bcv">Euro BCV</option>
                <option value="manual">Manual</option>
              </select>
            </div>

            {customerForm.rateType === 'manual' && (
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">
                  Tasa manual
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={customerForm.customRate}
                  onChange={(e) => setCustomerForm({ ...customerForm, customRate: e.target.value })}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                  placeholder="Ej: 36.50"
                />
              </div>
            )}
          </div>

          <div className="p-4 border-t border-ocean-100 flex justify-end gap-2">
            <button
              onClick={() => setShowCustomerModal(false)}
              className="px-4 py-2 text-ocean-700 hover:bg-ocean-50 rounded-lg text-sm font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSaveCustomer}
              disabled={isSaving}
              className="px-4 py-2 bg-ocean-600 hover:bg-ocean-500 disabled:bg-ocean-300 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {isSaving ? 'Guardando...' : editingCustomer ? 'Guardar Cambios' : 'Crear Cliente'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─── Render: Modal Crear/Editar Transaccion ───────────────────────

  const renderTxModal = () => {
    if (!showTxModal) return null;

    const isPurchase = txModalType === 'purchase';
    const title = editingTx
      ? (isPurchase ? 'Editar Compra' : 'Editar Abono')
      : (isPurchase ? 'Registrar Compra' : 'Registrar Abono');

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto">
        <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl my-4">
          <div className="p-4 border-b border-ocean-100 flex items-center justify-between">
            <h3 className="font-bold text-ocean-900">{title}</h3>
            <button
              onClick={() => setShowTxModal(false)}
              className="p-2 text-ocean-600 hover:bg-ocean-50 rounded-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Tipo de moneda - hidden when manual dual since it's always dolar_bcv */}
            {isManualDual || fetchedPresupuesto?.isDual ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg">
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">Dual</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">BCV</span>
                <span className="text-xs text-purple-600">Compra dual: precio BCV + precio Divisa</span>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">Tipo de moneda</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['divisas', 'dolar_bcv', 'euro_bcv'] as const).map((ct) => (
                    <button
                      key={ct}
                      type="button"
                      onClick={() => setTxForm({ ...txForm, currencyType: ct })}
                      className={`py-2 px-3 rounded-lg text-xs font-medium border transition-colors ${
                        txForm.currencyType === ct
                          ? ct === 'divisas' ? 'bg-green-100 border-green-400 text-green-800'
                            : ct === 'dolar_bcv' ? 'bg-blue-100 border-blue-400 text-blue-800'
                            : 'bg-purple-100 border-purple-400 text-purple-800'
                          : 'bg-white border-ocean-200 text-ocean-600 hover:bg-ocean-50'
                      }`}
                    >
                      {ct === 'divisas' ? 'Divisas' : ct === 'dolar_bcv' ? 'Dolar BCV' : 'Euro BCV'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">
                  Fecha *
                </label>
                <input
                  type="date"
                  value={txForm.date}
                  onChange={(e) => handleTxDateChange(e.target.value)}
                  className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                />
              </div>

              {/* Metodo de pago (solo para abonos) */}
              {!isPurchase && (
                <div>
                  <label className="block text-sm font-medium text-ocean-700 mb-1">
                    Metodo de pago
                  </label>
                  <select
                    value={txForm.paymentMethod}
                    onChange={(e) => setTxForm({ ...txForm, paymentMethod: e.target.value })}
                    className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                  >
                    <option value="">Seleccionar...</option>
                    <option value="efectivo">Efectivo</option>
                    <option value="pago_movil">Pago Movil</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="zelle">Zelle</option>
                    <option value="usdt">USDT (Cripto)</option>
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">
                Descripcion *
              </label>
              <input
                type="text"
                value={txForm.description}
                onChange={(e) => setTxForm({ ...txForm, description: e.target.value })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                placeholder={isPurchase ? 'Ej: Mariscos varios' : 'Ej: Abono pago movil'}
              />
            </div>

            {/* Montos - flujo diferente para compras vs abonos */}
            {isPurchase ? (
              /* Compras: monto USD, opcionalmente dual */
              <div className="space-y-3">
                {!fetchedPresupuesto?.isDual && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isManualDual}
                      onChange={(e) => {
                        setIsManualDual(e.target.checked);
                        if (e.target.checked) {
                          setTxForm({ ...txForm, currencyType: 'dolar_bcv' });
                        }
                      }}
                      className="w-4 h-4 rounded border-ocean-300 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-sm text-ocean-700">Dual (BCV + Divisa)</span>
                    {isManualDual && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">Dual</span>
                    )}
                  </label>
                )}
                {isManualDual || fetchedPresupuesto?.isDual ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-ocean-700 mb-1">
                        Monto USD (BCV) *
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ocean-500">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={txForm.amountUsd}
                          onChange={(e) => setTxForm({ ...txForm, amountUsd: e.target.value })}
                          className="w-full pl-7 pr-3 py-2 border border-blue-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-transparent outline-none bg-blue-50/30"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-ocean-700 mb-1">
                        Monto USD (Divisa) *
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ocean-500">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={txForm.amountUsdDivisa}
                          onChange={(e) => setTxForm({ ...txForm, amountUsdDivisa: e.target.value })}
                          className="w-full pl-7 pr-3 py-2 border border-amber-200 rounded-lg focus:ring-1 focus:ring-amber-500 focus:border-transparent outline-none bg-amber-50/30"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-ocean-700 mb-1">
                      Monto USD *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ocean-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={txForm.amountUsd}
                        onChange={(e) => setTxForm({ ...txForm, amountUsd: e.target.value })}
                        className="w-full pl-7 pr-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Abonos: Bs + tasa → USD calculado, o entrada directa USD */
              <div className="space-y-3">
                {txForm.currencyType !== 'divisas' ? (
                  <>
                    {/* Monto en Bs + tasa + conversion */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-ocean-700 mb-1">
                          Monto Bs
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ocean-500 text-xs">Bs</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={txForm.amountBs}
                            onChange={(e) => {
                              const bs = e.target.value;
                              const rate = parseFloat(txForm.exchangeRate) || 0;
                              const bsNum = parseFloat(bs) || 0;
                              const usd = rate > 0 ? (bsNum / rate) : 0;
                              setTxForm({
                                ...txForm,
                                amountBs: bs,
                                amountUsd: usd > 0 ? usd.toFixed(2) : ''
                              });
                            }}
                            className="w-full pl-8 pr-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ocean-700 mb-1">
                          Tasa {txForm.currencyType === 'euro_bcv' ? 'Euro' : 'Dolar'} BCV
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={txForm.exchangeRate}
                          onChange={(e) => {
                            const rate = e.target.value;
                            const rateNum = parseFloat(rate) || 0;
                            const bsNum = parseFloat(txForm.amountBs) || 0;
                            const usd = rateNum > 0 ? (bsNum / rateNum) : 0;
                            setTxForm({
                              ...txForm,
                              exchangeRate: rate,
                              amountUsd: usd > 0 ? usd.toFixed(2) : txForm.amountUsd
                            });
                          }}
                          className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                          placeholder={bcvRate ? String(bcvRate) : '0.00'}
                        />
                      </div>
                    </div>

                    {/* USD calculado (editable para ajuste manual) */}
                    <div>
                      <label className="block text-sm font-medium text-ocean-700 mb-1">
                        Equivalente USD
                        <span className="font-normal text-ocean-500 ml-1">(calculado, editable)</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ocean-500">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={txForm.amountUsd}
                          onChange={(e) => setTxForm({ ...txForm, amountUsd: e.target.value })}
                          className="w-full pl-7 pr-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none bg-ocean-50"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  /* Divisas: monto USD directo */
                  <div>
                    <label className="block text-sm font-medium text-ocean-700 mb-1">
                      Monto USD *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ocean-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={txForm.amountUsd}
                        onChange={(e) => setTxForm({ ...txForm, amountUsd: e.target.value })}
                        className="w-full pl-7 pr-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {isPurchase && (
              <div>
                <label className="block text-sm font-medium text-ocean-700 mb-1">
                  Presupuesto <span className="font-normal text-ocean-400 text-xs">(pega el ID para autocompletar)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={txForm.presupuestoId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTxForm({ ...txForm, presupuestoId: val });
                      setPresupuestoNotFound(false);
                      if (val.trim().length >= 5) {
                        debouncedFetchPresupuesto(val.trim());
                      } else {
                        setFetchedPresupuesto(null);
                        if (presupuestoFetchTimer.current) clearTimeout(presupuestoFetchTimer.current);
                      }
                    }}
                    onBlur={(e) => {
                      const val = e.target.value.trim();
                      if (val && val.length >= 3 && !fetchedPresupuesto) {
                        if (presupuestoFetchTimer.current) clearTimeout(presupuestoFetchTimer.current);
                        fetchPresupuestoForTx(val);
                      }
                    }}
                    className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                    placeholder="Pega el ID para autocompletar"
                  />
                  {isFetchingPresupuesto && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ocean-400 animate-pulse">
                      Buscando...
                    </span>
                  )}
                </div>
                {fetchedPresupuesto && (
                  <div className="mt-2 p-3 bg-green-50 rounded-lg border border-green-200">
                    <p className="text-sm font-semibold text-green-700">
                      Presupuesto #{fetchedPresupuesto.id} encontrado
                    </p>
                    <p className="text-xs text-green-600 mt-1">
                      {fetchedPresupuesto.items.length} productos &bull; Total: {formatUSD(fetchedPresupuesto.totalUSD)}
                      {fetchedPresupuesto.isDual && ` | Divisas: ${formatUSD(fetchedPresupuesto.totalUSDDivisa!)}`}
                    </p>
                    {fetchedPresupuesto.customerName && (
                      <p className="text-xs text-green-600">Cliente: {fetchedPresupuesto.customerName}</p>
                    )}
                    {fetchedPresupuesto.isDivisasOnly && (
                      <div className="mt-2 p-2 bg-green-50 rounded border border-green-300">
                        <p className="text-xs font-semibold text-green-700">Solo Divisas detectado</p>
                        <p className="text-xs text-green-600">
                          Este presupuesto es solo en USD (sin Bs)
                        </p>
                        <p className="text-xs text-green-500 mt-1">Tipo de cambio: Divisas</p>
                      </div>
                    )}
                    {fetchedPresupuesto.isDual && (
                      <div className="mt-2 p-2 bg-purple-50 rounded border border-purple-200">
                        <p className="text-xs font-semibold text-purple-700">Presupuesto Dual detectado</p>
                        <p className="text-xs text-purple-600">
                          BCV: {formatUSD(fetchedPresupuesto.totalUSD)} | Divisa: {formatUSD(fetchedPresupuesto.totalUSDDivisa!)}
                        </p>
                        <p className="text-xs text-purple-500 mt-1">Se guardaran ambos montos en una transaccion</p>
                      </div>
                    )}
                  </div>
                )}
                {presupuestoNotFound && !fetchedPresupuesto && !isFetchingPresupuesto && txForm.presupuestoId.trim().length >= 3 && (
                  <div className="mt-2 p-2 bg-red-50 rounded-lg border border-red-200">
                    <p className="text-xs text-red-600">Presupuesto no encontrado. Verifica el ID.</p>
                  </div>
                )}

                {/* Separator */}
                {!fetchedPresupuesto && !txForm.presupuestoId.trim() && (
                  <div className="mt-3 pt-3 border-t border-ocean-100">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createPresupuestoFromTx}
                        onChange={(e) => setCreatePresupuestoFromTx(e.target.checked)}
                        className="rounded border-ocean-300 text-coral-500 focus:ring-coral-400"
                      />
                      <span className="text-sm font-medium text-ocean-700">
                        Crear presupuesto nuevo
                      </span>
                      <span className="text-xs text-ocean-400">(para compras pasadas sin presupuesto)</span>
                    </label>

                    {createPresupuestoFromTx && (
                      <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200 space-y-3">
                        {/* Fecha del presupuesto */}
                        <div>
                          <label className="block text-xs font-medium text-amber-700 mb-1">
                            Fecha del presupuesto
                          </label>
                          <input
                            type="date"
                            value={presupuestoDate}
                            onChange={(e) => setPresupuestoDate(e.target.value)}
                            className="w-full px-3 py-1.5 text-sm border border-amber-200 rounded-lg focus:ring-1 focus:ring-amber-500 focus:border-transparent outline-none"
                          />
                        </div>

                        {/* Input para pegar lista */}
                        <div>
                          <label className="block text-xs font-medium text-amber-700 mb-1">
                            Pegar lista del cliente
                          </label>
                          <textarea
                            value={presupuestoTextInput}
                            onChange={(e) => setPresupuestoTextInput(e.target.value)}
                            placeholder="1 KL MEJILLON&#10;2 KL CALAMARES&#10;1½ DE JAIBA..."
                            rows={3}
                            className="w-full px-3 py-2 text-sm border border-amber-200 rounded-lg focus:ring-1 focus:ring-amber-500 focus:border-transparent outline-none resize-none"
                          />
                          <button
                            type="button"
                            onClick={parseNewPresupuestoText}
                            disabled={isParsingNewPresupuesto || !presupuestoTextInput.trim()}
                            className="mt-2 w-full px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white text-sm font-medium rounded-lg transition-colors"
                          >
                            {isParsingNewPresupuesto ? 'Procesando...' : 'Procesar lista con IA'}
                          </button>
                          {parseNewPresupuestoError && (
                            <p className="mt-1 text-xs text-red-600">{parseNewPresupuestoError}</p>
                          )}
                        </div>

                        {/* Items agregados */}
                        {newPresupuestoItems.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-amber-700 mb-1">
                              Items del presupuesto ({newPresupuestoItems.length})
                            </p>
                            <div className="max-h-32 overflow-y-auto space-y-1">
                              {newPresupuestoItems.map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between p-1.5 bg-white rounded border border-amber-100 text-xs">
                                  <span className="text-amber-900">
                                    {item.nombre} - {item.cantidad}{item.unidad} @ {formatUSD(item.precioUSD)} = {formatUSD(item.subtotalUSD)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setNewPresupuestoItems(prev => prev.filter((_, i) => i !== idx))}
                                    className="text-red-500 hover:text-red-700 ml-2"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                            <div className="mt-2 pt-2 border-t border-amber-200 flex justify-between text-sm font-semibold text-amber-800">
                              <span>Total:</span>
                              <span>{formatUSD(newPresupuestoItems.reduce((sum, i) => sum + i.subtotalUSD, 0))}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">
                {isPurchase ? 'Foto de factura' : 'Foto de comprobante'}
                <span className="font-normal text-ocean-500 ml-1">(opcional)</span>
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleInvoiceFileChange}
                className="w-full text-sm text-ocean-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-ocean-100 file:text-ocean-700 hover:file:bg-ocean-200 file:cursor-pointer"
              />
              {invoicePreview && (
                <div className="mt-2 relative">
                  <img
                    src={invoicePreview}
                    alt={isPurchase ? 'Preview factura' : 'Preview comprobante'}
                    className="w-full max-h-40 object-contain rounded-lg border border-ocean-200"
                  />
                  <button
                    onClick={() => { setInvoiceFile(null); setInvoicePreview(null); if (editingTx?.invoiceImageUrl) setRemoveExistingImage(true); }}
                    className="absolute top-1 right-1 p-1 bg-white/80 rounded-full text-red-600 hover:bg-white"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">
                Notas
                <span className="font-normal text-ocean-500 ml-1">(opcional)</span>
              </label>
              <textarea
                value={txForm.notes}
                onChange={(e) => setTxForm({ ...txForm, notes: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none resize-none"
                placeholder="Notas adicionales..."
              />
            </div>
          </div>

          <div className="p-4 border-t border-ocean-100 flex justify-end gap-2">
            <button
              onClick={() => setShowTxModal(false)}
              className="px-4 py-2 text-ocean-700 hover:bg-ocean-50 rounded-lg text-sm font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSaveTransaction}
              disabled={isSavingTx}
              className={`px-4 py-2 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                isPurchase
                  ? 'bg-coral-500 hover:bg-coral-600'
                  : 'bg-green-600 hover:bg-green-500'
              }`}
            >
              {isSavingTx ? 'Guardando...' : editingTx ? 'Guardar Cambios' : (isPurchase ? 'Registrar Compra' : 'Registrar Abono')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─── Render: Modal Detalle Transaccion ────────────────────────────

  const renderTxDetailModal = () => {
    if (!showTxDetailModal || !detailTx) return null;

    const isPurchase = detailTx.type === 'purchase';

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto">
        <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl my-4">
          <div className="p-4 border-b border-ocean-100 flex items-center justify-between">
            <h3 className="font-bold text-ocean-900">
              {isPurchase ? 'Detalle de Compra' : 'Detalle de Abono'}
            </h3>
            <button
              onClick={() => setShowTxDetailModal(false)}
              className="p-2 text-ocean-600 hover:bg-ocean-50 rounded-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-4 space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-ocean-500">Fecha</p>
                <p className="text-sm font-medium text-ocean-900">{formatDateFull(detailTx.date)}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {detailTx.amountUsdDivisa != null && detailTx.amountUsdDivisa > 0 ? (
                  <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">Dual</span>
                ) : detailTx.currencyType === 'divisas' ? (
                  <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">USD</span>
                ) : detailTx.currencyType === 'dolar_bcv' ? (
                  <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Dolar BCV</span>
                ) : detailTx.currencyType === 'euro_bcv' ? (
                  <span className="px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">€ Euro BCV</span>
                ) : null}
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  isPurchase ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                }`}>
                  {isPurchase ? 'Compra' : 'Abono'}
                </span>
              </div>
            </div>

            <div>
              <p className="text-xs text-ocean-500">Descripcion</p>
              <p className="text-sm text-ocean-900">{detailTx.description}</p>
            </div>

            {detailTx.amountUsd > 0 && (
              <div>
                <p className="text-xs text-ocean-500">Monto USD</p>
                <p className={`text-lg font-bold ${isPurchase ? 'text-red-600' : 'text-green-600'}`}>
                  {isPurchase ? '+' : '-'}{formatUSD(detailTx.amountUsd)}
                </p>
              </div>
            )}

            {detailTx.amountUsdDivisa && detailTx.amountUsdDivisa > 0 && (
              <div>
                <p className="text-xs text-ocean-500 flex items-center gap-1">
                  Monto USD (Divisa)
                  <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">Dual</span>
                </p>
                <p className={`text-lg font-bold ${detailTx.type === 'purchase' ? 'text-orange-500' : 'text-green-600'}`}>
                  {detailTx.type === 'purchase' ? '+' : '-'}{formatUSD(detailTx.amountUsdDivisa)}
                </p>
              </div>
            )}

            {bcvRate > 0 && detailTx.currencyType !== 'divisas' && (
              <div>
                <p className="text-xs text-ocean-500">Monto Bs</p>
                <p className={`text-lg font-bold ${isPurchase ? 'text-red-600' : 'text-green-600'}`}>
                  {isPurchase ? '+' : '-'}{formatBs(detailTx.amountUsd * bcvRate)}
                </p>
                <p className="text-xs text-ocean-500 mt-0.5">Tasa actual: {bcvRate.toFixed(2)} Bs/$</p>
              </div>
            )}

            {detailTx.paymentMethod && (
              <div>
                <p className="text-xs text-ocean-500">Metodo de pago</p>
                <p className="text-sm text-ocean-700">
                  {detailTx.paymentMethod === 'pago_movil' ? 'Pago Movil'
                    : detailTx.paymentMethod === 'efectivo' ? 'Efectivo'
                    : detailTx.paymentMethod === 'tarjeta' ? 'Tarjeta'
                    : detailTx.paymentMethod === 'transferencia' ? 'Transferencia'
                    : detailTx.paymentMethod === 'zelle' ? 'Zelle'
                    : detailTx.paymentMethod === 'usdt' ? 'USDT (Cripto)'
                    : detailTx.paymentMethod}
                </p>
              </div>
            )}

            {detailTx.presupuestoId && (
              <div>
                <p className="text-xs text-ocean-500">Presupuesto</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleViewPresupuesto(detailTx.presupuestoId!)}
                    className="text-sm text-blue-600 underline hover:text-blue-800"
                  >
                    {detailTx.presupuestoId}
                  </button>
                  <button
                    onClick={() => navigator.clipboard.writeText(detailTx.presupuestoId!)}
                    className="p-1 text-ocean-400 hover:text-ocean-600 hover:bg-ocean-50 rounded transition-colors"
                    title="Copiar ID"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                  </button>
                </div>
              </div>
            )}

            {detailTx.notes && (
              <div>
                <p className="text-xs text-ocean-500">Notas</p>
                <p className="text-sm text-ocean-700">{detailTx.notes}</p>
              </div>
            )}

            {detailTx.invoiceImageUrl && (
              <div>
                <p className="text-xs text-ocean-500 mb-1">{isPurchase ? 'Foto de factura' : 'Foto de comprobante'}</p>
                <img
                  src={detailTx.invoiceImageUrl}
                  alt={isPurchase ? 'Factura' : 'Comprobante'}
                  className="w-full max-h-80 object-contain rounded-lg border border-ocean-200 cursor-pointer"
                  onClick={() => window.open(detailTx.invoiceImageUrl!, '_blank')}
                />
                <p className="text-xs text-ocean-400 mt-1 text-center">Toca para ver completa</p>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-ocean-100 flex justify-between items-center">
            <button
              onClick={() => handleDeleteTransaction(detailTx)}
              className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors"
            >
              Eliminar
            </button>
            <div className="flex items-center gap-2">
              {detailTx.type === 'purchase' && !detailTx.isPaid && (
                <button
                  onClick={() => {
                    const today = new Date().toISOString().split('T')[0];
                    setPaidTx(detailTx);
                    setPaidForm({ paidMethod: '', paidDate: today, notes: '' });
                    setShowPaidModal(true);
                    setShowTxDetailModal(false);
                  }}
                  className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-500 flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Marcar Pagado
                </button>
              )}
              {detailTx.type === 'purchase' && detailTx.isPaid && (
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded-lg text-xs font-medium">
                    Pagado{detailTx.paidDate ? ` el ${detailTx.paidDate}` : ''}
                  </span>
                  <button
                    onClick={() => handleMarkTxUnpaid(detailTx)}
                    className="px-2 py-1 text-ocean-500 hover:text-red-600 text-xs"
                  >
                    Desmarcar
                  </button>
                </div>
              )}
              <button
                onClick={() => handleEditTransaction(detailTx)}
                className="px-4 py-2 bg-ocean-600 hover:bg-ocean-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Editar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ─── Render: Modal Compartir ──────────────────────────────────────

  const renderShareModal = () => {
    if (!showShareModal || !selectedCustomer) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto">
        <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl my-4">
          <div className="p-4 border-b border-ocean-100 flex items-center justify-between">
            <h3 className="font-bold text-ocean-900">Compartir Estado de Cuenta</h3>
            <button
              onClick={() => setShowShareModal(false)}
              className="p-2 text-ocean-600 hover:bg-ocean-50 rounded-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-4 space-y-4">
            {!shareUrl ? (
              <div className="text-center py-4">
                <p className="text-sm text-ocean-600 mb-4">
                  Genera un enlace publico para que {selectedCustomer.name} pueda ver su estado de cuenta.
                </p>
                <button
                  onClick={handleGenerateShareToken}
                  disabled={isGeneratingToken}
                  className="px-6 py-3 bg-ocean-600 hover:bg-ocean-500 disabled:bg-ocean-300 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {isGeneratingToken ? 'Generando...' : 'Generar enlace publico'}
                </button>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs text-ocean-600 mb-1">Enlace publico</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={shareUrl}
                      className="w-full px-3 py-2 border border-ocean-200 rounded-lg text-sm bg-ocean-50 text-ocean-700 outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleCopyLink}
                    className="px-4 py-2.5 bg-ocean-600 hover:bg-ocean-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {copiedLink ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      )}
                    </svg>
                    {copiedLink ? 'Copiado!' : 'Copiar enlace'}
                  </button>

                  <button
                    onClick={handleShareWhatsApp}
                    className="px-4 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                    Enviar por WhatsApp
                  </button>
                </div>

                <div className="flex gap-2 pt-2 border-t border-ocean-100">
                  <button
                    onClick={handleGenerateShareToken}
                    disabled={isGeneratingToken}
                    className="flex-1 px-4 py-2 text-ocean-700 hover:bg-ocean-50 rounded-lg text-sm font-medium transition-colors border border-ocean-200"
                  >
                    {isGeneratingToken ? 'Regenerando...' : 'Regenerar enlace'}
                  </button>
                  <button
                    onClick={handleRevokeShareToken}
                    className="flex-1 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors border border-red-200"
                  >
                    Revocar acceso
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ─── Render: Modal Marcar Pagado ─────────────────────────────────

  const renderPaidModal = () => {
    if (!showPaidModal || !paidTx) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
        <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl">
          <div className="p-4 border-b border-ocean-100 flex items-center justify-between">
            <h3 className="font-bold text-ocean-900">Marcar como Pagado</h3>
            <button onClick={() => { setShowPaidModal(false); setPaidTx(null); }} className="p-2 text-ocean-600 hover:bg-ocean-50 rounded-lg">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-4 space-y-4">
            <div className="bg-ocean-50 rounded-lg p-3">
              <p className="text-xs text-ocean-600">Compra a marcar:</p>
              <p className="text-sm font-medium text-ocean-900">{paidTx.description}</p>
              <p className="text-sm font-bold text-coral-600">{formatUSD(paidTx.amountUsd)}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">Metodo de pago</label>
              <select
                value={paidForm.paidMethod}
                onChange={(e) => setPaidForm({ ...paidForm, paidMethod: e.target.value })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
              >
                <option value="">Seleccionar...</option>
                <option value="efectivo">Efectivo</option>
                <option value="pago_movil">Pago Movil</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="zelle">Zelle</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">Fecha de pago</label>
              <input
                type="date"
                value={paidForm.paidDate}
                onChange={(e) => setPaidForm({ ...paidForm, paidDate: e.target.value })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ocean-700 mb-1">
                Notas <span className="font-normal text-ocean-500">(opcional)</span>
              </label>
              <input
                type="text"
                value={paidForm.notes}
                onChange={(e) => setPaidForm({ ...paidForm, notes: e.target.value })}
                className="w-full px-3 py-2 border border-ocean-200 rounded-lg focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
                placeholder="Ej: Ref. #12345"
              />
            </div>
          </div>
          <div className="p-4 border-t border-ocean-100 flex justify-end gap-2">
            <button
              onClick={() => { setShowPaidModal(false); setPaidTx(null); }}
              className="px-4 py-2 text-ocean-700 hover:bg-ocean-50 rounded-lg text-sm font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleMarkTxPaid}
              disabled={isSavingPaid}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-green-300 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {isSavingPaid ? 'Guardando...' : 'Confirmar Pagado'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─── Render: Modal Ver Presupuesto ──────────────────────────────

  const renderPresupuestoModal = () => {
    if (!showPresupuestoModal) return null;

    const p = viewingPresupuesto;
    const isDual = p && (p.modoPrecio === 'dual' || (p.modoPrecio !== 'divisa' && p.totalUSDDivisa != null && Number(p.totalUSDDivisa) > 0));
    const isDivisasOnly = p && (p.modoPrecio === 'divisa' || ((Number(p.totalBs) === 0 || p.totalBs == null) && !isDual));
    const fechaStr = p ? new Date(p.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: 'long', year: 'numeric' }) : '';

    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 overflow-y-auto">
        <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl my-4 max-h-[90vh] overflow-y-auto">
          <div className="p-4 border-b border-ocean-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-ocean-900">
                Presupuesto #{p?.id || '...'}
              </h3>
              {isDual && (
                <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">Dual</span>
              )}
              {p && !isDual && isDivisasOnly && (
                <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">USD</span>
              )}
              {p && !isDual && !isDivisasOnly && (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">BCV</span>
              )}
            </div>
            <button
              onClick={() => { setShowPresupuestoModal(false); setViewingPresupuesto(null); }}
              className="p-2 text-ocean-600 hover:bg-ocean-50 rounded-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {loadingPresupuesto && !p && (
            <div className="p-8 text-center text-ocean-500">Cargando presupuesto...</div>
          )}

          {p && (
            <div className="p-4 space-y-4">
              {/* Info */}
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-ocean-500">Fecha</p>
                  <p className="text-sm font-medium text-ocean-900">{fechaStr}</p>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  p.estado === 'pagado' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {p.estado === 'pagado' ? 'Pagado' : 'Pendiente'}
                </span>
              </div>

              {p.customerName && (
                <div>
                  <p className="text-xs text-ocean-500">Cliente</p>
                  <p className="text-sm text-ocean-900">{p.customerName}</p>
                  {p.customerAddress && <p className="text-xs text-ocean-500">{p.customerAddress}</p>}
                </div>
              )}

              {/* BCV Items Table */}
              <div>
                <h4 className="text-sm font-semibold text-ocean-800 mb-2 flex items-center gap-2">
                  {isDual && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">Precios BCV</span>}
                  Productos
                </h4>
                <div className="border border-ocean-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-ocean-50 text-ocean-700">
                        <th className="text-left px-3 py-2 font-medium">Producto</th>
                        <th className="text-center px-2 py-2 font-medium w-16">Cant</th>
                        <th className="text-right px-3 py-2 font-medium w-20">P.Unit</th>
                        <th className="text-right px-3 py-2 font-medium w-20">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.items.map((item: any, i: number) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-ocean-50/30'}>
                          <td className="px-3 py-1.5 text-ocean-800">{item.nombre}</td>
                          <td className="text-center px-2 py-1.5 text-ocean-600">{formatQuantity(item.cantidad)} {item.unidad}</td>
                          <td className="text-right px-3 py-1.5 text-ocean-700">{formatUSD(item.precioUSD)}</td>
                          <td className="text-right px-3 py-1.5 font-semibold text-ocean-800">{formatUSD(item.subtotalUSD)}</td>
                        </tr>
                      ))}
                      {/* Delivery row: usar p.delivery o diff si total > items */}
                      {(() => {
                        const deliveryAmt = (p.delivery ?? 0) > 0 ? p.delivery : null;
                        const itemsSum = p.items.reduce((sum: number, item: any) => sum + (item.subtotalUSD || 0), 0);
                        const diff = !deliveryAmt ? Math.round((p.totalUSD - itemsSum) * 100) / 100 : null;
                        const showDelivery = (deliveryAmt != null && deliveryAmt > 0) || (diff != null && diff > 0.01);
                        const amount = deliveryAmt ?? diff ?? 0;
                        if (showDelivery && amount > 0) {
                          return (
                            <tr className="bg-amber-50/50 border-t border-amber-200">
                              <td className="px-3 py-1.5 text-amber-700 italic">Delivery</td>
                              <td className="text-center px-2 py-1.5 text-amber-600">-</td>
                              <td className="text-right px-3 py-1.5 text-amber-600">-</td>
                              <td className="text-right px-3 py-1.5 font-semibold text-amber-700">{formatUSD(amount)}</td>
                            </tr>
                          );
                        }
                        return null;
                      })()}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-between items-center mt-2 px-1">
                  <span className="text-sm font-semibold text-ocean-700">Total USD</span>
                  <span className="text-lg font-bold text-ocean-900">{formatUSD(p.totalUSD)}</span>
                </div>
                {bcvRate > 0 && p.totalBs !== 0 && !isDivisasOnly && (
                  <div className="flex justify-between items-center px-1">
                    <span className="text-xs text-ocean-500">Total Bs @{bcvRate.toFixed(2)}</span>
                    <span className="text-sm font-semibold text-orange-600">Bs {(p.totalUSD * bcvRate).toFixed(2)}</span>
                  </div>
                )}
              </div>

              {/* Divisa Items Table (only if dual) */}
              {isDual && (
                <div>
                  <h4 className="text-sm font-semibold text-ocean-800 mb-2 flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">Precios Divisa</span>
                    Productos
                  </h4>
                  <div className="border border-amber-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-amber-50 text-amber-700">
                          <th className="text-left px-3 py-2 font-medium">Producto</th>
                          <th className="text-center px-2 py-2 font-medium w-16">Cant</th>
                          <th className="text-right px-3 py-2 font-medium w-20">P.Unit</th>
                          <th className="text-right px-3 py-2 font-medium w-20">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.items.map((item: any, i: number) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-amber-50/30'}>
                            <td className="px-3 py-1.5 text-ocean-800">{item.nombre}</td>
                            <td className="text-center px-2 py-1.5 text-ocean-600">{formatQuantity(item.cantidad)} {item.unidad}</td>
                            <td className="text-right px-3 py-1.5 text-ocean-700">{formatUSD((item.precioUSDDivisa ?? item.precioUSD))}</td>
                            <td className="text-right px-3 py-1.5 font-semibold text-ocean-800">{formatUSD((item.subtotalUSDDivisa ?? item.subtotalUSD))}</td>
                          </tr>
                        ))}
                        {/* Delivery row: usar p.delivery o diff si total > items */}
                        {(() => {
                          const deliveryAmt = (p.delivery ?? 0) > 0 ? p.delivery : null;
                          const itemsSum = p.items.reduce((sum: number, item: any) => sum + (item.subtotalUSDDivisa ?? item.subtotalUSD ?? 0), 0);
                          const diff = !deliveryAmt && p.totalUSDDivisa != null
                            ? Math.round((p.totalUSDDivisa - itemsSum) * 100) / 100
                            : null;
                          const showDelivery = (deliveryAmt != null && deliveryAmt > 0) || (diff != null && diff > 0.01);
                          const amount = deliveryAmt ?? diff ?? 0;
                          if (showDelivery && amount > 0) {
                            return (
                              <tr className="bg-amber-100/50 border-t border-amber-300">
                                <td className="px-3 py-1.5 text-amber-700 italic">Delivery</td>
                                <td className="text-center px-2 py-1.5 text-amber-600">-</td>
                                <td className="text-right px-3 py-1.5 text-amber-600">-</td>
                                <td className="text-right px-3 py-1.5 font-semibold text-amber-700">{formatUSD(amount)}</td>
                              </tr>
                            );
                          }
                          return null;
                        })()}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex justify-between items-center mt-2 px-1">
                    <span className="text-sm font-semibold text-amber-700">Total USD (Divisa)</span>
                    <span className="text-lg font-bold text-amber-900">{formatUSD(p.totalUSDDivisa)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="p-4 border-t border-ocean-100">
            <button
              onClick={() => { setShowPresupuestoModal(false); setViewingPresupuesto(null); }}
              className="w-full py-2 bg-ocean-100 text-ocean-700 rounded-lg font-medium hover:bg-ocean-200 transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─── Render Principal ─────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {view === 'list' ? renderListView() : renderDetailView()}
      {renderCustomerModal()}
      {renderTxModal()}
      {renderTxDetailModal()}
      {renderShareModal()}
      {renderPaidModal()}
      {renderPresupuestoModal()}
    </div>
  );
}
