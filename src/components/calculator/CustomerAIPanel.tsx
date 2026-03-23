import { useState, useEffect } from 'react';
import { formatUSD, formatDateShort } from '../../lib/format';

interface SimpleCustomer {
  id: number;
  name: string;
}

interface AIAction {
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
}

interface AIProductAction {
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
  hideRate?: boolean;
}

interface CustomerAIPanelProps {
  bcvRate?: number;
  onSuccess?: () => void;
}

export function CustomerAIPanel({ bcvRate: initialBcvRate, onSuccess }: CustomerAIPanelProps) {
  const [customers, setCustomers] = useState<SimpleCustomer[]>([]);
  const [bcvRate, setBcvRate] = useState<number | null>(initialBcvRate ?? null);

  const [aiText, setAiText] = useState('');
  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiActions, setAiActions] = useState<AIAction[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiConfirming, setAiConfirming] = useState(false);
  const [aiExecuting, setAiExecuting] = useState(false);
  const [aiMode, setAiMode] = useState<'simple' | 'productos'>('productos');
  const [aiPricingMode, setAiPricingMode] = useState<'bcv' | 'divisas' | 'dual'>('bcv');
  const [aiProductAction, setAiProductAction] = useState<AIProductAction | null>(null);
  const [aiUnmatched, setAiUnmatched] = useState<string[]>([]);

  const formatDate = formatDateShort;

  const todayStr = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  useEffect(() => {
    fetch('/api/customers', { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (data.success) setCustomers(data.customers); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (initialBcvRate) { setBcvRate(initialBcvRate); return; }
    fetch('/api/config/bcv-rate', { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (data.rate) setBcvRate(data.rate); })
      .catch(() => {});
  }, [initialBcvRate]);

  const recalcTotals = (
    prev: AIProductAction,
    newItems: AIProductAction['items']
  ): AIProductAction => {
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
    } catch {
      setAiError('Error de conexion');
    } finally {
      setAiProcessing(false);
    }
  };

  const handleAiConfirm = async (budgetOnly = false) => {
    setAiExecuting(true);
    let successCount = 0;
    let failCount = 0;

    if (aiMode === 'productos' && aiProductAction) {
      const action = aiProductAction;
      let customerId = action.customerId;

      try {
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
            fetch('/api/customers', { credentials: 'include' })
              .then(r => r.json())
              .then(data => { if (data.success) setCustomers(data.customers); })
              .catch(() => {});
          } else {
            throw new Error(customerData.error || 'Error al crear cliente');
          }
        }

        const txDate = action.date || todayStr();
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
            ...(budgetOnly && { skipLink: true }),
          }),
          credentials: 'include'
        });

        const presData = await presRes.json();
        if (!presData.success || !presData.id) {
          throw new Error(presData.error || 'Error al crear presupuesto');
        }

        const presupuestoId = presData.id;

        if (!budgetOnly) {
          const alreadyLinked = presData.linked && presData.linkedCustomerId === customerId;
          if (!alreadyLinked) {
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
            if (!txData.success) {
              throw new Error(txData.error || 'Error al crear transaccion');
            }
          }
        }
        successCount++;
      } catch (err) {
        console.error('Error creating purchase with products:', err);
        failCount++;
        alert(`Error: ${err instanceof Error ? err.message : 'Error desconocido'}`);
      }
    } else {
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

    onSuccess?.();
  };

  const handleAiCancel = () => {
    setAiConfirming(false);
    setAiActions([]);
    setAiProductAction(null);
    setAiUnmatched([]);
  };

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-purple-100">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="text-sm font-semibold text-purple-700">Anotacion rapida con IA</span>
        </div>
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
                      setAiProductAction(prev => prev ? { ...prev, customerId: null } : null);
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

          {aiProductAction.pricingMode !== 'divisas' && (
            <div className="flex items-center justify-between py-2 mb-2">
              <label htmlFor="ai-solo-divisas-panel" className="text-xs text-ocean-600 cursor-pointer">Solo divisas (ocultar Bs en print/WhatsApp)</label>
              <button
                id="ai-solo-divisas-panel"
                type="button"
                onClick={() => setAiProductAction(prev => prev ? { ...prev, hideRate: !prev.hideRate } : null)}
                className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${aiProductAction.hideRate ? 'bg-coral-500' : 'bg-ocean-200'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${aiProductAction.hideRate ? 'translate-x-4' : ''}`} />
              </button>
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => handleAiConfirm(false)}
              disabled={aiExecuting || (!aiProductAction.customerId && !aiProductAction.customerName)}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-green-300 text-white rounded-lg text-xs font-medium transition-colors"
            >
              {aiExecuting ? 'Creando...' : 'Presupuesto + Compra'}
            </button>
            <button
              onClick={() => handleAiConfirm(true)}
              disabled={aiExecuting || (!aiProductAction.customerId && !aiProductAction.customerName)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300 text-white rounded-lg text-xs font-medium transition-colors"
            >
              {aiExecuting ? 'Creando...' : 'Solo Presupuesto'}
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
              onClick={() => handleAiConfirm()}
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
  );
}
