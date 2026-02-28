import { useState, useEffect, useCallback } from 'react';
import { formatUSD, formatBs } from '../lib/format';

interface CalcEntry {
  id: number;
  description: string;
  amountUSD: number;
  amountBs: number;
  isNegative: boolean;
}

interface HistoryItem {
  id: number;
  expression: string;
  currency: 'USD' | 'Bs';
  resultUSD: number;
  resultBs: number;
  rate: number;
  timestamp: number;
}

interface AdminCalculatorProps {
  bcvRate?: { rate: number; date: string; source: string };
}

export default function AdminCalculator({ bcvRate: initialBcv }: AdminCalculatorProps) {
  // Tasa local (no afecta config global)
  const [autoRate, setAutoRate] = useState(initialBcv?.rate ?? 0);
  const [manualRate, setManualRate] = useState(() => {
    try {
      const saved = localStorage.getItem('rpym_calc_rate_config');
      return saved ? JSON.parse(saved).manualRate || '' : '';
    } catch { return ''; }
  });
  const [useManualRate, setUseManualRate] = useState(() => {
    try {
      const saved = localStorage.getItem('rpym_calc_rate_config');
      return saved ? JSON.parse(saved).useManualRate || false : false;
    } catch { return false; }
  });
  const [rateLoading, setRateLoading] = useState(!initialBcv);

  // Calculadora
  const [inputAmount, setInputAmount] = useState('');
  const [inputCurrency, setInputCurrency] = useState<'USD' | 'Bs'>('USD');
  const [description, setDescription] = useState('');

  // Tabs de clientes (5 slots)
  const DEFAULT_NAMES = ['Cliente 1', 'Cliente 2', 'Cliente 3', 'Cliente 4', 'Cliente 5'];
  const [clientNames, setClientNames] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('rpym_calc_client_names');
      return saved ? JSON.parse(saved) : [...DEFAULT_NAMES];
    } catch { return [...DEFAULT_NAMES]; }
  });
  const [editingName, setEditingName] = useState<number | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [activeClient, setActiveClient] = useState(() => {
    try {
      const saved = localStorage.getItem('rpym_calc_active_client');
      return saved ? parseInt(saved) : 0;
    } catch { return 0; }
  });
  const [clientEntries, setClientEntries] = useState<Record<number, CalcEntry[]>>(() => {
    try {
      const saved = localStorage.getItem('rpym_calc_client_entries');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });

  // Entries del cliente activo
  const entries = clientEntries[activeClient] || [];
  const setEntries = (updater: CalcEntry[] | ((prev: CalcEntry[]) => CalcEntry[])) => {
    setClientEntries(prev => {
      const current = prev[activeClient] || [];
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [activeClient]: next };
    });
  };

  const [nextId, setNextId] = useState(() => {
    try {
      const saved = localStorage.getItem('rpym_calc_client_entries');
      const all: Record<number, CalcEntry[]> = saved ? JSON.parse(saved) : {};
      const allEntries = Object.values(all).flat();
      return allEntries.length > 0 ? Math.max(...allEntries.map(e => e.id)) + 1 : 1;
    } catch { return 1; }
  });

  // Historial de cálculos
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('rpym_calc_history');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [showHistory, setShowHistory] = useState(false);

  const activeRate = useManualRate && manualRate ? parseFloat(manualRate) : autoRate;

  // Persistir historial
  useEffect(() => {
    localStorage.setItem('rpym_calc_history', JSON.stringify(history));
  }, [history]);

  // Persistir entries y tab activo
  useEffect(() => {
    localStorage.setItem('rpym_calc_client_entries', JSON.stringify(clientEntries));
  }, [clientEntries]);

  useEffect(() => {
    localStorage.setItem('rpym_calc_active_client', String(activeClient));
  }, [activeClient]);

  useEffect(() => {
    localStorage.setItem('rpym_calc_client_names', JSON.stringify(clientNames));
  }, [clientNames]);

  // Persistir config de tasa manual
  useEffect(() => {
    localStorage.setItem('rpym_calc_rate_config', JSON.stringify({ useManualRate, manualRate }));
  }, [useManualRate, manualRate]);

  // Fetch tasa BCV al montar
  useEffect(() => {
    if (initialBcv?.rate) {
      setAutoRate(initialBcv.rate);
      setRateLoading(false);
      return;
    }
    fetch('/api/config/bcv-rate')
      .then(r => r.json())
      .then(data => {
        if (data.rate) setAutoRate(data.rate);
      })
      .catch(() => {})
      .finally(() => setRateLoading(false));
  }, [initialBcv]);

  // Evaluar expresión matemática (soporta +, -, *, /, comas como decimales)
  const evalExpr = (expr: string): number => {
    const sanitized = expr.replace(/,/g, '.').replace(/[^0-9+\-*/.() ]/g, '').trim();
    if (!sanitized) return 0;
    try {
      // Tokenizar y calcular de forma segura
      const tokens = sanitized.match(/(\d+\.?\d*|[+\-*/()])/g);
      if (!tokens) return 0;
      // Usar Function en vez de eval para aislamiento
      const result = new Function(`return (${tokens.join('')})`)();
      return typeof result === 'number' && isFinite(result) ? result : 0;
    } catch { return 0; }
  };

  const hasExpression = /[+\-*/]/.test(inputAmount.replace(/^-/, ''));

  // Conversión en vivo
  const parsedAmount = evalExpr(inputAmount);
  let convertedUSD: number;
  let convertedBs: number;
  if (inputCurrency === 'USD') {
    convertedUSD = parsedAmount;
    convertedBs = activeRate ? parsedAmount * activeRate : 0;
  } else {
    convertedBs = parsedAmount;
    convertedUSD = activeRate ? parsedAmount / activeRate : 0;
  }

  const addEntry = useCallback(() => {
    if (parsedAmount === 0 || !activeRate) return;
    const entry: CalcEntry = {
      id: nextId,
      description: description.trim(),
      amountUSD: convertedUSD,
      amountBs: convertedBs,
      isNegative: false,
    };
    setEntries(prev => [...prev, entry]);
    setNextId(prev => prev + 1);
    setInputAmount('');
    setDescription('');
  }, [parsedAmount, activeRate, nextId, description, convertedUSD, convertedBs]);

  const removeEntry = (id: number) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const toggleSign = (id: number) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, isNegative: !e.isNegative } : e));
  };

  const clearAll = () => {
    setEntries([]);
    setInputAmount('');
    setDescription('');
  };

  // Totales
  const totalUSD = entries.reduce((sum, e) => sum + (e.isNegative ? -e.amountUSD : e.amountUSD), 0);
  const totalBs = entries.reduce((sum, e) => sum + (e.isNegative ? -e.amountBs : e.amountBs), 0);

  // Guardar en historial
  const addToHistory = useCallback(() => {
    if (parsedAmount === 0 || !activeRate) return;
    const item: HistoryItem = {
      id: Date.now(),
      expression: inputAmount,
      currency: inputCurrency,
      resultUSD: convertedUSD,
      resultBs: convertedBs,
      rate: activeRate,
      timestamp: Date.now(),
    };
    setHistory(prev => [item, ...prev].slice(0, 50)); // máximo 50
  }, [parsedAmount, activeRate, inputAmount, inputCurrency, convertedUSD, convertedBs]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addToHistory();
      addEntry();
    }
  };

  const useFromHistory = (item: HistoryItem) => {
    setInputAmount(item.expression);
    setInputCurrency(item.currency);
    setShowHistory(false);
  };

  const clearHistory = () => setHistory([]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  };

  const formatHistoryDate = (ts: number) => {
    const d = new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Hoy';
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
    return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' });
  };

  return (
    <div className="space-y-6">
      {/* Tasa BCV */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-ocean-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-ocean-900">Tasa BCV</h2>
          {rateLoading ? (
            <span className="text-sm text-ocean-400 animate-pulse">Cargando...</span>
          ) : (
            <span className="text-2xl font-bold text-ocean-700">
              Bs. {activeRate.toFixed(2)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setUseManualRate(false)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              !useManualRate
                ? 'bg-ocean-600 text-white'
                : 'bg-ocean-50 text-ocean-600 hover:bg-ocean-100'
            }`}
          >
            Automatica ({autoRate.toFixed(2)})
          </button>
          <button
            onClick={() => setUseManualRate(true)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              useManualRate
                ? 'bg-ocean-600 text-white'
                : 'bg-ocean-50 text-ocean-600 hover:bg-ocean-100'
            }`}
          >
            Manual
          </button>
          {useManualRate && (
            <input
              type="number"
              step="0.01"
              placeholder="Ej: 419.98"
              value={manualRate}
              onChange={e => setManualRate(e.target.value)}
              className="w-32 px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-2 focus:ring-ocean-500 focus:border-transparent"
            />
          )}
        </div>
      </div>

      {/* Historial */}
      {history.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-ocean-100 overflow-hidden">
          <button
            onClick={() => setShowHistory(prev => !prev)}
            className="w-full px-5 py-3 flex items-center justify-between hover:bg-ocean-50 transition-colors"
          >
            <span className="text-sm font-medium text-ocean-700 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Historial ({history.length})
            </span>
            <svg className={`w-4 h-4 text-ocean-400 transition-transform ${showHistory ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showHistory && (
            <div className="border-t border-ocean-100">
              <div className="max-h-64 overflow-y-auto divide-y divide-ocean-50">
                {history.map(item => (
                  <button
                    key={item.id}
                    onClick={() => useFromHistory(item)}
                    className="w-full px-5 py-2.5 flex items-center justify-between hover:bg-ocean-50 transition-colors text-left"
                  >
                    <div className="min-w-0">
                      <span className="text-sm font-mono text-ocean-600">{item.expression}</span>
                      <span className="text-xs text-ocean-400 ml-2">{item.currency === 'USD' ? '$' : 'Bs'}</span>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="text-sm font-semibold text-ocean-800">
                        {item.currency === 'USD' ? formatBs(item.resultBs) : formatUSD(item.resultUSD)}
                      </div>
                      <div className="text-xs text-ocean-400">
                        {formatHistoryDate(item.timestamp)} {formatTime(item.timestamp)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="px-5 py-2 border-t border-ocean-100 bg-ocean-50/50">
                <button
                  onClick={clearHistory}
                  className="text-xs text-red-400 hover:text-red-600 transition-colors"
                >
                  Borrar historial
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Convertidor */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-ocean-100">
        {/* Monto principal grande */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={inputAmount}
            onChange={e => setInputAmount(e.target.value)}
            onKeyDown={e => {
              if (e.key === ' ') {
                e.preventDefault();
                setInputAmount(prev => prev + '+');
              } else {
                handleKeyDown(e);
              }
            }}
            className="flex-1 px-4 py-3 text-2xl font-semibold border border-ocean-200 rounded-lg focus:ring-2 focus:ring-ocean-500 focus:border-transparent text-ocean-900 font-mono"
            autoFocus
          />
          <button
            onClick={() => setInputCurrency(prev => prev === 'USD' ? 'Bs' : 'USD')}
            className="px-4 py-3 bg-ocean-100 text-ocean-700 font-bold text-lg rounded-lg hover:bg-ocean-200 transition-colors min-w-[56px]"
          >
            {inputCurrency === 'USD' ? '$' : 'Bs'}
          </button>
        </div>

        {/* Resultado de expresión cuando hay operadores */}
        {hasExpression && parsedAmount !== 0 && (
          <div className="mt-2 px-1 text-sm text-ocean-500">
            = {inputCurrency === 'USD' ? formatUSD(parsedAmount) : formatBs(parsedAmount)}
          </div>
        )}

        {/* Resultado de conversión */}
        {activeRate > 0 && (
          <div className="mt-3 p-4 bg-ocean-50 rounded-lg text-center">
            <span className="text-sm text-ocean-500">
              {inputCurrency === 'USD' ? 'Bolivares' : 'Dolares'}
            </span>
            <p className="text-3xl font-bold text-ocean-800 mt-1">
              {inputCurrency === 'USD' ? formatBs(convertedBs) : formatUSD(convertedUSD)}
            </p>
          </div>
        )}

        {/* Descripción + agregar */}
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            placeholder="Nota (opcional)"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 px-3 py-2 border border-ocean-200 rounded-lg text-sm text-ocean-600 focus:ring-2 focus:ring-ocean-500 focus:border-transparent"
          />
          <button
            onClick={addEntry}
            disabled={parsedAmount === 0 || !activeRate}
            className="px-5 py-2 bg-ocean-600 text-white rounded-lg text-sm font-medium hover:bg-ocean-500 disabled:bg-ocean-300 transition-colors"
          >
            Agregar
          </button>
        </div>
      </div>

      {/* Tabs de clientes + operaciones */}
      <div className="bg-white rounded-xl shadow-sm border border-ocean-100 overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-ocean-100">
          {clientNames.map((name, i) => {
            const count = (clientEntries[i] || []).length;
            return (
              <div key={i} className={`flex-1 relative ${
                activeClient === i ? 'bg-white' : 'bg-ocean-50/50'
              }`}>
                {editingName === i ? (
                  <input
                    type="text"
                    value={editNameValue}
                    onChange={e => setEditNameValue(e.target.value)}
                    onBlur={() => {
                      setClientNames(prev => {
                        const next = [...prev];
                        next[i] = editNameValue.trim() || DEFAULT_NAMES[i];
                        return next;
                      });
                      setEditingName(null);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') { setEditingName(null); }
                    }}
                    className="w-full py-2 px-1 text-xs font-medium text-center bg-transparent border-b-2 border-ocean-500 outline-none"
                    autoFocus
                  />
                ) : (
                  <button
                    onClick={() => setActiveClient(i)}
                    onDoubleClick={() => { setEditingName(i); setEditNameValue(name); }}
                    className={`w-full py-2.5 text-xs font-medium transition-colors truncate px-1 ${
                      activeClient === i
                        ? 'text-ocean-700'
                        : 'text-ocean-400 hover:text-ocean-600'
                    }`}
                    title={`Doble click para renombrar`}
                  >
                    {name}
                    {count > 0 && (
                      <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${
                        activeClient === i ? 'bg-ocean-600 text-white' : 'bg-ocean-200 text-ocean-600'
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                )}
                {activeClient === i && editingName !== i && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-ocean-600" />
                )}
              </div>
            );
          })}
        </div>

        {/* Contenido del tab */}
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-ocean-900">{clientNames[activeClient]}</h2>
            {entries.length > 0 && (
              <button
                onClick={clearAll}
                className="text-sm text-red-500 hover:text-red-700 transition-colors"
              >
                Limpiar
              </button>
            )}
          </div>

          {entries.length === 0 ? (
            <p className="text-sm text-ocean-400 text-center py-4">Sin operaciones</p>
          ) : (
            <>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ocean-100">
                  <th className="text-left py-2 px-2 text-ocean-500 font-medium">Desc.</th>
                  <th className="text-right py-2 px-2 text-ocean-500 font-medium">USD</th>
                  <th className="text-right py-2 px-2 text-ocean-500 font-medium">Bs</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry.id} className="border-b border-ocean-50 hover:bg-ocean-25">
                    <td className="py-2 px-2 text-ocean-700">
                      {entry.description || '-'}
                    </td>
                    <td className={`py-2 px-2 text-right font-mono ${entry.isNegative ? 'text-red-600' : 'text-ocean-800'}`}>
                      {entry.isNegative ? '-' : ''}{formatUSD(entry.amountUSD)}
                    </td>
                    <td className={`py-2 px-2 text-right font-mono ${entry.isNegative ? 'text-red-600' : 'text-ocean-800'}`}>
                      {entry.isNegative ? '-' : ''}{formatBs(entry.amountBs)}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <button
                        onClick={() => toggleSign(entry.id)}
                        className="p-1 text-ocean-400 hover:text-ocean-600 transition-colors"
                        title={entry.isNegative ? 'Cambiar a positivo' : 'Cambiar a negativo'}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                      </button>
                      <button
                        onClick={() => removeEntry(entry.id)}
                        className="p-1 text-red-300 hover:text-red-500 transition-colors"
                        title="Eliminar"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ocean-200">
                  <td className="py-3 px-2 font-semibold text-ocean-900">Total</td>
                  <td className={`py-3 px-2 text-right font-mono font-bold ${totalUSD < 0 ? 'text-red-600' : 'text-ocean-900'}`}>
                    {totalUSD < 0 ? '-' : ''}{formatUSD(Math.abs(totalUSD))}
                  </td>
                  <td className={`py-3 px-2 text-right font-mono font-bold ${totalBs < 0 ? 'text-red-600' : 'text-ocean-900'}`}>
                    {totalBs < 0 ? '-' : ''}{formatBs(Math.abs(totalBs))}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
