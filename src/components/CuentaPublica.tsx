/**
 * RPYM - Vista publica de estado de cuenta del cliente
 * Accesible sin autenticacion via token unico
 */
import { useState, useEffect, useMemo } from 'react';
import { formatUSD, formatEUR, formatQuantity, formatDateMonthShort, formatMonthYear } from '../lib/format';

interface PublicTransaction {
  id: number;
  type: 'purchase' | 'payment';
  date: string;
  description: string;
  amountUsd: number;
  amountBs: number;
  presupuestoId: string | null;
  invoiceImageUrl: string | null;
  currencyType: string;
  paymentMethod: string | null;
  exchangeRate: number | null;
  amountUsdDivisa: number | null;
  isPaid: boolean;
  paidMethod: string | null;
  paidDate: string | null;
  notes: string | null;
  createdAt: string;
}

interface PublicCustomer {
  name: string;
  rateType: string;
  balanceDivisas: number;
  balanceBcv: number;
  balanceEuro: number;
}

export default function CuentaPublica() {
  const [customer, setCustomer] = useState<PublicCustomer | null>(null);
  const [transactions, setTransactions] = useState<PublicTransaction[]>([]);
  const [bcvRate, setBcvRate] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPresupuestoModal, setShowPresupuestoModal] = useState(false);
  const [viewingPresupuesto, setViewingPresupuesto] = useState<any | null>(null);
  const [loadingPresupuesto, setLoadingPresupuesto] = useState(false);
  const [dualView, setDualView] = useState<'bcv' | 'divisas'>('bcv');
  const [txFilter, setTxFilter] = useState<'all' | 'purchases' | 'payments' | 'paid'>('all');
  const [txSearch, setTxSearch] = useState('');
  const [txPage, setTxPage] = useState(0);
  const TX_PAGE_SIZE = 20;

  useEffect(() => {
    const loadData = async () => {
      try {
        const pathParts = window.location.pathname.split('/');
        const token = pathParts[pathParts.length - 1];

        if (!token) {
          setError('Enlace no valido');
          setIsLoading(false);
          return;
        }

        const res = await fetch(`/api/cuenta/${token}`);
        const data = await res.json();

        if (!data.success) {
          setError(data.error || 'Enlace no valido o expirado');
          setIsLoading(false);
          return;
        }

        setCustomer(data.customer);
        setTransactions(data.transactions || []);
        if (data.bcvRate) setBcvRate(data.bcvRate);
      } catch (err) {
        console.error('Error loading cuenta:', err);
        setError('Error al cargar los datos. Intenta de nuevo.');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  const handleViewPresupuesto = async (presupuestoId: string) => {
    const pathParts = window.location.pathname.split('/');
    const urlToken = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

    setLoadingPresupuesto(true);
    setShowPresupuestoModal(true);
    try {
      const res = await fetch(`/api/cuenta/presupuesto/${encodeURIComponent(presupuestoId)}?token=${encodeURIComponent(urlToken)}`);
      const data = await res.json();
      if (data.success && data.presupuesto) {
        setViewingPresupuesto(data.presupuesto);
      } else {
        setViewingPresupuesto(null);
        setShowPresupuestoModal(false);
      }
    } catch {
      setViewingPresupuesto(null);
      setShowPresupuestoModal(false);
    } finally {
      setLoadingPresupuesto(false);
    }
  };

  const formatDate = formatDateMonthShort;

  // Check if customer has dual transactions
  const hasDualTransactions = useMemo(() => {
    return transactions.some(tx => tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0);
  }, [transactions]);

  // Calculate adjusted balances based on toggle
  const adjustedBalances = useMemo(() => {
    if (!customer) return { divisas: 0, bcv: 0, euro: 0 };

    if (!hasDualTransactions || dualView === 'bcv') {
      return {
        divisas: customer.balanceDivisas,
        bcv: customer.balanceBcv,
        euro: customer.balanceEuro,
      };
    }

    // Divisas view: move dual purchases from BCV to Divisas
    const dualBcvSum = transactions
      .filter(tx => tx.type === 'purchase' && !tx.isPaid && tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0 && tx.currencyType === 'dolar_bcv')
      .reduce((sum, tx) => sum + tx.amountUsd, 0);

    const dualDivisaSum = transactions
      .filter(tx => tx.type === 'purchase' && !tx.isPaid && tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0 && tx.currencyType === 'dolar_bcv')
      .reduce((sum, tx) => sum + (tx.amountUsdDivisa || 0), 0);

    return {
      divisas: customer.balanceDivisas + dualDivisaSum,
      bcv: customer.balanceBcv - dualBcvSum,
      euro: customer.balanceEuro,
    };
  }, [customer, transactions, dualView, hasDualTransactions]);

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      if (txSearch.trim()) {
        const q = txSearch.toLowerCase();
        if (!tx.description.toLowerCase().includes(q) && !(tx.presupuestoId || '').toLowerCase().includes(q)) return false;
      }
      if (txFilter === 'purchases') return tx.type === 'purchase';
      if (txFilter === 'payments') return tx.type === 'payment';
      if (txFilter === 'paid') return tx.isPaid;
      return true;
    });
  }, [transactions, txFilter, txSearch]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / TX_PAGE_SIZE));
  const paginatedTransactions = useMemo(() => {
    const start = txPage * TX_PAGE_SIZE;
    return filteredTransactions.slice(start, start + TX_PAGE_SIZE);
  }, [filteredTransactions, txPage]);

  // Group transactions by month
  const groupedTransactions = useMemo(() => {
    const groups: { month: string; transactions: PublicTransaction[] }[] = [];
    let currentMonth = '';

    for (const tx of paginatedTransactions) {
      const monthKey = tx.date.substring(0, 7); // YYYY-MM
      if (monthKey !== currentMonth) {
        currentMonth = monthKey;
        groups.push({ month: tx.date, transactions: [tx] });
      } else {
        groups[groups.length - 1].transactions.push(tx);
      }
    }

    return groups;
  }, [paginatedTransactions]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-ocean-50 to-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-ocean-200 border-t-ocean-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-ocean-600 text-sm font-medium">Cargando estado de cuenta...</p>
        </div>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-ocean-50 to-white flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg border border-ocean-100 p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-ocean-900 mb-2">Enlace no valido</h2>
          <p className="text-ocean-600 text-sm">{error || 'Este enlace no existe o ha sido revocado.'}</p>
        </div>
      </div>
    );
  }

  // Get the display amount for a transaction based on current view
  const getDisplayAmount = (tx: PublicTransaction) => {
    if (dualView === 'divisas' && tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0) {
      return tx.amountUsdDivisa;
    }
    return tx.amountUsd;
  };

  const isDualTx = (tx: PublicTransaction) => tx.amountUsdDivisa != null && tx.amountUsdDivisa > 0;

  const renderPresupuestoModal = () => {
    if (!showPresupuestoModal) return null;

    const p = viewingPresupuesto;
    const isDual = p && (p.modoPrecio === 'dual' || (p.modoPrecio !== 'divisa' && p.totalUSDDivisa != null && p.totalUSDDivisa > 0));
    const isDivisasOnly = p && (p.modoPrecio === 'divisa' || (p.totalBs === 0 && !isDual));
    const fechaStr = p ? new Date(p.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: 'long', year: 'numeric' }) : '';

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto" onClick={() => { setShowPresupuestoModal(false); setViewingPresupuesto(null); }}>
        <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl my-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="p-4 border-b border-ocean-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-ocean-100 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-ocean-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-ocean-900 text-sm">
                  Presupuesto #{p?.id || '...'}
                </h3>
                <div className="flex gap-1 mt-0.5">
                  {isDivisasOnly && (
                    <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">USD</span>
                  )}
                  {isDual && (
                    <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-medium">Dual</span>
                  )}
                  {p && p.estado === 'pagado' && (
                    <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">Pagado</span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={() => { setShowPresupuestoModal(false); setViewingPresupuesto(null); }}
              className="p-1.5 text-ocean-400 hover:text-ocean-600 hover:bg-ocean-50 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {loadingPresupuesto && !p && (
            <div className="p-12 text-center">
              <div className="w-8 h-8 border-2 border-ocean-200 border-t-ocean-600 rounded-full animate-spin mx-auto mb-3"></div>
              <p className="text-ocean-500 text-sm">Cargando...</p>
            </div>
          )}

          {p && (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-ocean-500">{fechaStr}</p>
                {p.customerName && (
                  <p className="text-xs text-ocean-600 font-medium">{p.customerName}</p>
                )}
              </div>

              {/* Items */}
              <div className="rounded-xl border border-ocean-200 overflow-hidden">
                {isDivisasOnly && (
                  <div className="bg-green-50 px-3 py-2 border-b border-green-100">
                    <p className="text-xs font-semibold text-green-700 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      Precios USD (Dolares efectivo)
                    </p>
                  </div>
                )}
                {isDual && (
                  <div className="bg-blue-50 px-3 py-2 border-b border-blue-100">
                    <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Precios BCV (Bolivares)
                    </p>
                  </div>
                )}
                <div className="divide-y divide-ocean-50">
                  {p.items.map((item: any, i: number) => (
                    <div key={i} className="px-3 py-2 flex justify-between items-baseline">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ocean-800 font-medium">{item.nombre}</p>
                        <p className="text-xs text-ocean-400">{formatQuantity(item.cantidad)} {item.unidad} x {formatUSD(item.precioUSD)}</p>
                      </div>
                      <p className="font-semibold text-ocean-800 text-sm ml-2">{formatUSD(item.subtotalUSD)}</p>
                    </div>
                  ))}
                  {/* Delivery row if total > sum of items */}
                  {(() => {
                    const itemsSum = p.items.reduce((sum: number, item: any) => sum + (item.subtotalUSD || 0), 0);
                    const diff = Math.round((p.totalUSD - itemsSum) * 100) / 100;
                    if (diff > 0.01) {
                      return (
                        <div className="px-3 py-2 flex justify-between items-baseline bg-amber-50/50">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-amber-700 font-medium italic">Delivery</p>
                          </div>
                          <p className="font-semibold text-amber-700 text-sm ml-2">{formatUSD(diff)}</p>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
                <div className="bg-ocean-50 px-3 py-2.5 flex justify-between items-center border-t border-ocean-200">
                  <span className="font-semibold text-ocean-700 text-sm">Total</span>
                  <div className="text-right">
                    <span className="text-lg font-bold text-ocean-900">{formatUSD(p.totalUSD)}</span>
                    {bcvRate > 0 && !isDivisasOnly && (
                      <p className="text-xs text-ocean-500">Bs {(p.totalUSD * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Divisa Items (only if dual) */}
              {isDual && (
                <div className="rounded-xl border border-amber-200 overflow-hidden">
                  <div className="bg-amber-50 px-3 py-2 border-b border-amber-100">
                    <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      Precios Divisa (Dolares efectivo)
                    </p>
                  </div>
                  <div className="divide-y divide-amber-50">
                    {p.items.map((item: any, i: number) => (
                      <div key={i} className="px-3 py-2 flex justify-between items-baseline">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-ocean-800 font-medium">{item.nombre}</p>
                          <p className="text-xs text-ocean-400">{formatQuantity(item.cantidadDivisa ?? item.cantidad)} {item.unidad} x {formatUSD((item.precioUSDDivisa ?? item.precioUSD))}</p>
                        </div>
                        <p className="font-semibold text-amber-800 text-sm ml-2">{formatUSD((item.subtotalUSDDivisa ?? item.subtotalUSD))}</p>
                      </div>
                    ))}
                    {/* Delivery row if total > sum of items */}
                    {(() => {
                      const itemsSum = p.items.reduce((sum: number, item: any) => sum + (item.subtotalUSDDivisa ?? item.subtotalUSD ?? 0), 0);
                      const diff = Math.round((p.totalUSDDivisa - itemsSum) * 100) / 100;
                      if (diff > 0.01) {
                        return (
                          <div className="px-3 py-2 flex justify-between items-baseline bg-amber-100/50">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-amber-700 font-medium italic">Delivery</p>
                            </div>
                            <p className="font-semibold text-amber-700 text-sm ml-2">{formatUSD(diff)}</p>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                  <div className="bg-amber-50 px-3 py-2.5 flex justify-between items-center border-t border-amber-200">
                    <span className="font-semibold text-amber-700 text-sm">Total Divisa</span>
                    <span className="text-lg font-bold text-amber-900">{formatUSD(p.totalUSDDivisa)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="p-4 border-t border-ocean-100">
            <button
              onClick={() => { setShowPresupuestoModal(false); setViewingPresupuesto(null); }}
              className="w-full py-2.5 bg-ocean-600 text-white rounded-xl font-medium hover:bg-ocean-700 transition-colors text-sm"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Calculate displayed balances
  const displayBcv = adjustedBalances.bcv;
  const displayDivisas = adjustedBalances.divisas;
  const displayEuro = adjustedBalances.euro;

  const showDivisas = displayDivisas !== 0 || (hasDualTransactions && dualView === 'divisas');
  const showBcv = displayBcv !== 0 || (hasDualTransactions && dualView === 'bcv');
  const showEuro = displayEuro !== 0;
  const activeBalances = [showDivisas, showBcv, showEuro].filter(Boolean).length;
  const totalBalance = displayDivisas + displayBcv + displayEuro;
  const allClear = totalBalance <= 0 && activeBalances === 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-ocean-50 via-white to-ocean-50/30">
      {/* Header */}
      <header className="bg-gradient-to-br from-ocean-700 via-ocean-600 to-ocean-700 text-white">
        <div className="max-w-lg mx-auto px-4 pt-6 pb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 bg-white/15 backdrop-blur rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">RPYM Mariscos</h1>
              <p className="text-ocean-200 text-xs">Estado de Cuenta</p>
            </div>
          </div>
          <p className="text-ocean-200 text-sm">
            Hola, <span className="font-semibold text-white">{customer.name}</span>
          </p>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 -mt-4 pb-6 space-y-4">
        {/* Dual toggle */}
        {hasDualTransactions && (
          <div className="bg-white rounded-xl shadow-sm border border-ocean-100 p-3">
            <p className="text-xs text-ocean-500 mb-2 text-center">Tu pedido tiene precios en ambas monedas</p>
            <div className="flex bg-ocean-100 rounded-lg p-0.5">
              <button
                onClick={() => setDualView('bcv')}
                className={`flex-1 py-2 px-3 rounded-md text-xs font-semibold transition-all duration-200 ${
                  dualView === 'bcv'
                    ? 'bg-white text-ocean-800 shadow-sm'
                    : 'text-ocean-500 hover:text-ocean-700'
                }`}
              >
                <span className="block">Dolar BCV</span>
                <span className="block text-[10px] font-normal mt-0.5 opacity-70">Pago en bolivares</span>
              </button>
              <button
                onClick={() => setDualView('divisas')}
                className={`flex-1 py-2 px-3 rounded-md text-xs font-semibold transition-all duration-200 ${
                  dualView === 'divisas'
                    ? 'bg-white text-amber-800 shadow-sm'
                    : 'text-ocean-500 hover:text-ocean-700'
                }`}
              >
                <span className="block">Divisas</span>
                <span className="block text-[10px] font-normal mt-0.5 opacity-70">Dolares efectivo</span>
              </button>
            </div>
          </div>
        )}

        {/* Balance Section */}
        <div className="bg-white rounded-xl shadow-sm border border-ocean-100 overflow-hidden">
          {allClear ? (
            <div className="p-6 text-center">
              <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-7 h-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-lg font-bold text-green-600">$0.00</p>
              <p className="text-sm text-green-500 mt-1">Estas al dia</p>
            </div>
          ) : (
            <>
              {/* Main balance display */}
              <div className="p-4 text-center">
                <p className="text-xs text-ocean-400 mb-1">Balance pendiente</p>
                <p className={`text-3xl font-bold tracking-tight ${totalBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {formatUSD(Math.abs(totalBalance))}
                </p>
                {/* Show Bs equivalent when balance has BCV component */}
                {bcvRate > 0 && displayBcv !== 0 && dualView === 'bcv' && (
                  <p className={`text-sm font-medium mt-0.5 ${totalBalance > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    Bs {(Math.abs(displayBcv) * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                )}
                {totalBalance > 0 && (
                  <p className="text-xs text-red-400 mt-1">Por pagar</p>
                )}
                {totalBalance <= 0 && (
                  <p className="text-xs text-green-500 mt-1">A favor</p>
                )}
              </div>

              {/* Balance breakdown */}
              {activeBalances > 0 && (
                <div className={`grid border-t border-ocean-100 divide-x divide-ocean-100 ${
                  activeBalances >= 3 ? 'grid-cols-3' : activeBalances === 2 ? 'grid-cols-2' : 'grid-cols-1'
                }`}>
                  {showBcv && (
                    <div className="p-3 text-center">
                      <p className="text-[10px] text-ocean-400 font-medium uppercase tracking-wider">BCV</p>
                      <p className={`text-base font-bold mt-0.5 ${displayBcv > 0 ? 'text-red-600' : displayBcv < 0 ? 'text-green-600' : 'text-ocean-400'}`}>
                        {formatUSD(Math.abs(displayBcv))}
                      </p>
                      {bcvRate > 0 && displayBcv !== 0 && (
                        <p className="text-[10px] text-ocean-500 font-medium">
                          Bs {(Math.abs(displayBcv) * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      )}
                      <p className="text-[10px] text-ocean-400 mt-0.5">Pago en Bs</p>
                    </div>
                  )}
                  {showDivisas && (
                    <div className="p-3 text-center">
                      <p className="text-[10px] text-ocean-400 font-medium uppercase tracking-wider">Divisas</p>
                      <p className={`text-base font-bold mt-0.5 ${displayDivisas > 0 ? 'text-red-600' : displayDivisas < 0 ? 'text-green-600' : 'text-ocean-400'}`}>
                        {formatUSD(Math.abs(displayDivisas))}
                      </p>
                      <p className="text-[10px] text-ocean-400 mt-0.5">USD efectivo</p>
                    </div>
                  )}
                  {showEuro && (
                    <div className="p-3 text-center">
                      <p className="text-[10px] text-ocean-400 font-medium uppercase tracking-wider">€ Euro</p>
                      <p className={`text-base font-bold mt-0.5 ${displayEuro > 0 ? 'text-red-600' : displayEuro < 0 ? 'text-green-600' : 'text-ocean-400'}`}>
                        {formatEUR(Math.abs(displayEuro))}
                      </p>
                      <p className="text-[10px] text-ocean-400 mt-0.5">Pago en EUR</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Transactions */}
        <div className="bg-white rounded-xl shadow-sm border border-ocean-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-ocean-100 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-ocean-900 text-sm">Movimientos</h2>
              <span className="text-xs text-ocean-400">{filteredTransactions.length} de {transactions.length}</span>
            </div>
            <input
              type="text"
              value={txSearch}
              onChange={(e) => { setTxSearch(e.target.value); setTxPage(0); }}
              placeholder="Buscar..."
              className="w-full px-3 py-1.5 border border-ocean-200 rounded-lg text-sm focus:ring-1 focus:ring-ocean-500 focus:border-transparent outline-none"
            />
            <div className="flex flex-wrap gap-1.5">
              {([
                ['all', 'Todos'],
                ['purchases', 'Compras'],
                ['payments', 'Abonos'],
                ['paid', 'Pagados'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => { setTxFilter(key); setTxPage(0); }}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                    txFilter === key
                      ? 'bg-ocean-600 text-white'
                      : 'bg-ocean-50 text-ocean-500 hover:bg-ocean-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {filteredTransactions.length === 0 ? (
            <div className="p-8 text-center">
              <div className="w-12 h-12 bg-ocean-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-ocean-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p className="text-ocean-400 text-sm">
                {transactions.length === 0 ? 'No hay movimientos registrados' : 'No hay resultados para este filtro'}
              </p>
            </div>
          ) : (
            <div>
              {groupedTransactions.map((group, gi) => (
                <div key={gi}>
                  {/* Month separator */}
                  <div className="px-4 py-1.5 bg-ocean-50/50 border-b border-ocean-50">
                    <p className="text-[10px] font-semibold text-ocean-400 uppercase tracking-wider">{formatMonthYear(group.month)}</p>
                  </div>

                  <div className="divide-y divide-ocean-50">
                    {group.transactions.map((tx) => {
                      const displayAmt = getDisplayAmount(tx);
                      const isDual = isDualTx(tx);
                      const showingDivisa = dualView === 'divisas' && isDual;

                      return (
                        <div key={tx.id} className={`px-4 py-3 flex items-start gap-3 ${tx.isPaid ? 'opacity-50' : ''}`}>
                          {/* Icon */}
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                            tx.isPaid ? 'bg-ocean-50' :
                            tx.type === 'purchase' ? 'bg-red-50' : 'bg-green-50'
                          }`}>
                            {tx.type === 'purchase' ? (
                              <svg className={`w-4 h-4 ${tx.isPaid ? 'text-ocean-300' : 'text-red-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                              </svg>
                            ) : (
                              <svg className={`w-4 h-4 ${tx.isPaid ? 'text-ocean-300' : 'text-green-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${tx.isPaid ? 'text-ocean-400 line-through' : 'text-ocean-900'}`}>
                              {tx.description}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <p className="text-xs text-ocean-400">{formatDate(tx.date)}</p>
                              {tx.isPaid && (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  isDual && tx.paidMethod
                                    ? (['efectivo', 'zelle', 'usdt'].includes(tx.paidMethod) ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700')
                                    : 'bg-green-100 text-green-700'
                                }`}>
                                  {isDual && tx.paidMethod
                                    ? (['efectivo', 'zelle', 'usdt'].includes(tx.paidMethod)
                                        ? `Pagado USD (${tx.paidMethod === 'zelle' ? 'Zelle' : tx.paidMethod === 'usdt' ? 'USDT' : 'Efectivo'})`
                                        : `Pagado Bs (${tx.paidMethod === 'pago_movil' ? 'P.Movil' : tx.paidMethod === 'transferencia' ? 'Transf.' : tx.paidMethod})`)
                                    : `Pagado${tx.paidMethod ? ` (${tx.paidMethod === 'pago_movil' ? 'P.Movil' : tx.paidMethod === 'efectivo' ? 'Efectivo' : tx.paidMethod === 'zelle' ? 'Zelle' : tx.paidMethod === 'usdt' ? 'USDT' : tx.paidMethod === 'transferencia' ? 'Transf.' : tx.paidMethod === 'tarjeta' ? 'Tarjeta' : tx.paidMethod})` : ''}`}
                                </span>
                              )}
                              {isDual && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-600">Dual</span>
                              )}
                              {!isDual && tx.currencyType === 'divisas' && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-600">USD</span>
                              )}
                              {!isDual && tx.currencyType === 'dolar_bcv' && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600">BCV</span>
                              )}
                              {!isDual && tx.currencyType === 'euro_bcv' && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-600">€ EUR</span>
                              )}
                              {tx.paymentMethod && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                                  {tx.paymentMethod === 'pago_movil' ? 'P.Movil' : tx.paymentMethod === 'efectivo' ? 'Efectivo' : tx.paymentMethod === 'tarjeta' ? 'Tarjeta' : tx.paymentMethod === 'transferencia' ? 'Transf.' : tx.paymentMethod === 'zelle' ? 'Zelle' : tx.paymentMethod === 'usdt' ? 'USDT' : tx.paymentMethod}
                                </span>
                              )}
                            </div>
                            {tx.notes && (
                              <p className="text-xs text-ocean-500 italic mt-0.5">
                                Nota: {tx.notes}
                              </p>
                            )}
                            {tx.presupuestoId && (
                              <button
                                onClick={() => handleViewPresupuesto(tx.presupuestoId!)}
                                className="text-xs text-blue-600 hover:text-blue-800 mt-1 flex items-center gap-1 group"
                              >
                                <svg className="w-3 h-3 text-blue-400 group-hover:text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <span className="underline">Ver presupuesto</span>
                              </button>
                            )}
                            {tx.invoiceImageUrl && (
                              <button
                                onClick={() => window.open(tx.invoiceImageUrl!, '_blank')}
                                className="text-xs text-ocean-500 hover:text-ocean-700 mt-1 flex items-center gap-1 group"
                              >
                                <svg className="w-3 h-3 text-ocean-400 group-hover:text-ocean-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                <span className="underline">Ver factura</span>
                              </button>
                            )}
                          </div>

                          {/* Amount */}
                          <div className="text-right flex-shrink-0">
                            <p className={`text-sm font-bold ${
                              tx.isPaid ? 'text-ocean-300 line-through' :
                              tx.type === 'purchase' ? 'text-red-600' : 'text-green-600'
                            }`}>
                              {tx.type === 'purchase' ? '+' : '-'}{formatUSD(displayAmt)}
                            </p>
                            {isDual && !tx.isPaid && (
                              <p className="text-[10px] text-ocean-400 mt-0.5">
                                {showingDivisa ? 'Precio divisa' : 'Precio BCV'}
                              </p>
                            )}
                            {bcvRate > 0 && !tx.isPaid && tx.currencyType !== 'divisas' && !showingDivisa && (
                              <p className={`text-[10px] ${tx.type === 'purchase' ? 'text-red-400' : 'text-green-400'}`}>
                                Bs {(displayAmt * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-ocean-100 flex items-center justify-between">
                  <button
                    onClick={() => setTxPage(p => Math.max(0, p - 1))}
                    disabled={txPage === 0}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed bg-ocean-50 text-ocean-600 hover:bg-ocean-100"
                  >
                    Anterior
                  </button>
                  <span className="text-xs text-ocean-400">
                    {txPage + 1} de {totalPages} ({filteredTransactions.length} mov.)
                  </span>
                  <button
                    onClick={() => setTxPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={txPage >= totalPages - 1}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed bg-ocean-50 text-ocean-600 hover:bg-ocean-100"
                  >
                    Siguiente
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center py-6 space-y-2">
          <div className="w-10 h-0.5 bg-ocean-200 rounded mx-auto mb-3"></div>
          <p className="text-ocean-800 font-bold text-sm tracking-tight">RPYM Mariscos</p>
          <p className="text-ocean-400 text-xs">Muelle El Mosquero, Maiquetía</p>
          <a
            href="https://wa.me/584142145202"
            className="inline-flex items-center gap-1.5 text-green-600 text-xs hover:text-green-700 transition-colors bg-green-50 px-3 py-1.5 rounded-full"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
            </svg>
            +58 414-214-5202
          </a>
        </div>
      </div>

      {renderPresupuestoModal()}
    </div>
  );
}
