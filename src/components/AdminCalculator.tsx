import { useState, useEffect, useCallback, useRef } from 'react';
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
  const amountRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const totalRef = useRef<HTMLDivElement>(null);
  const editNameRef = useRef<HTMLInputElement>(null);
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
  const [editingEntry, setEditingEntry] = useState<number | null>(null);
  const [editEntryValue, setEditEntryValue] = useState('');
  const editEntryRef = useRef<HTMLInputElement>(null);
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

  // Historial de cálculos por cliente
  const [clientHistory, setClientHistory] = useState<Record<number, HistoryItem[]>>(() => {
    try {
      const saved = localStorage.getItem('rpym_calc_history');
      if (!saved) return {};
      const parsed = JSON.parse(saved);
      // Migrar formato viejo (array) a nuevo (por cliente)
      if (Array.isArray(parsed)) return { 0: parsed };
      return parsed;
    } catch { return {}; }
  });
  const [showHistory, setShowHistory] = useState(false);

  // History del cliente activo
  const history = clientHistory[activeClient] || [];
  const setHistory = (updater: HistoryItem[] | ((prev: HistoryItem[]) => HistoryItem[])) => {
    setClientHistory(prev => {
      const current = prev[activeClient] || [];
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [activeClient]: next };
    });
  };

  const activeRate = useManualRate && manualRate ? parseFloat(manualRate) : autoRate;

  // Persistir historial
  useEffect(() => {
    localStorage.setItem('rpym_calc_history', JSON.stringify(clientHistory));
  }, [clientHistory]);

  // Persistir entries y tab activo
  useEffect(() => {
    localStorage.setItem('rpym_calc_client_entries', JSON.stringify(clientEntries));
  }, [clientEntries]);

  useEffect(() => {
    localStorage.setItem('rpym_calc_active_client', String(activeClient));
    // Devolver foco al input de monto al cambiar de cliente (solo si no se está editando nombre)
    if (editingName === null) {
      amountRef.current?.focus();
    }
  }, [activeClient]);

  // Focalizar inputs de edición cuando se activan
  useEffect(() => {
    if (editingEntry !== null) {
      requestAnimationFrame(() => {
        editEntryRef.current?.focus();
        editEntryRef.current?.select();
      });
    }
  }, [editingEntry]);

  useEffect(() => {
    if (editingName !== null) {
      requestAnimationFrame(() => {
        editNameRef.current?.focus();
        editNameRef.current?.select();
      });
    }
  }, [editingName]);

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

  const updateEntryAmount = (id: number, newUSD: number) => {
    if (newUSD <= 0 || !activeRate) return;
    setEntries(prev => prev.map(e => e.id === id ? { ...e, amountUSD: newUSD, amountBs: newUSD * activeRate } : e));
  };

  // Helper: calcular totales de un cliente
  const getClientTotals = (clientIdx: number) => {
    const ce = clientEntries[clientIdx] || [];
    const usd = ce.reduce((sum, e) => sum + (e.isNegative ? -e.amountUSD : e.amountUSD), 0);
    const bs = ce.reduce((sum, e) => sum + (e.isNegative ? -e.amountBs : e.amountBs), 0);
    return { usd, bs };
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
    setHistory([]);
    setInputAmount('');
    setDescription('');
    // Resetear nombre al default
    setClientNames(prev => {
      const next = [...prev];
      next[activeClient] = DEFAULT_NAMES[activeClient];
      return next;
    });
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
            ref={amountRef}
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={inputAmount}
            onChange={e => setInputAmount(e.target.value)}
            onKeyDown={e => {
              if (e.key === ' ') {
                e.preventDefault();
                setInputAmount(prev => prev + '+');
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setActiveClient(prev => (prev - 1 + 5) % 5);
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setActiveClient(prev => (prev + 1) % 5);
              } else if (e.key === 'Backspace' && !inputAmount) {
                e.preventDefault();
                clearAll();
              } else if (e.key === 'Escape') {
                setInputAmount('');
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

        {/* Agregar + nota colapsable */}
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => noteRef.current?.focus()}
            className={`p-2 rounded-lg transition-colors ${description ? 'bg-ocean-100 text-ocean-700' : 'bg-ocean-50 text-ocean-300 hover:text-ocean-500'}`}
            title="Agregar nota"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
          </button>
          <input
            ref={noteRef}
            type="text"
            placeholder="nota..."
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                amountRef.current?.focus();
              } else {
                handleKeyDown(e);
              }
            }}
            className="flex-1 px-2 py-1.5 text-xs text-ocean-400 border-0 bg-transparent focus:ring-0 focus:text-ocean-600 placeholder:text-ocean-200"
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
            const totals = getClientTotals(i);
            return (
              <div key={i} className={`flex-1 relative ${
                activeClient === i ? 'bg-white' : 'bg-ocean-50/50'
              }`}>
                <button
                  onClick={() => {
                    if (activeClient === i) {
                      setEditingName(i);
                      setEditNameValue(name);
                    } else {
                      setActiveClient(i);
                    }
                  }}
                  className={`w-full py-2 text-xs font-medium transition-colors truncate px-1 ${
                    activeClient === i
                      ? 'text-ocean-700'
                      : 'text-ocean-400 hover:text-ocean-600'
                  }`}
                  title={activeClient === i ? 'Click para renombrar' : ''}
                >
                  <div className="truncate">{name}</div>
                  {count > 0 && (
                    <div className="mt-0.5 space-y-0">
                      <div className={`text-[10px] font-mono ${activeClient === i ? 'text-ocean-500' : 'text-ocean-300'}`}>
                        {formatUSD(Math.abs(totals.usd))}
                      </div>
                      <div className={`text-[10px] font-mono font-bold ${activeClient === i ? 'text-green-600' : 'text-green-400'}`}>
                        {formatBs(Math.abs(totals.bs))}
                      </div>
                    </div>
                  )}
                </button>
                {activeClient === i && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-ocean-600" />
                )}
              </div>
            );
          })}
        </div>

        {/* Contenido del tab */}
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {editingName === activeClient ? (
                <input
                  ref={editNameRef}
                  type="text"
                  value={editNameValue}
                  onChange={e => setEditNameValue(e.target.value)}
                  onBlur={() => {
                    setClientNames(prev => {
                      const next = [...prev];
                      next[activeClient] = editNameValue.trim() || DEFAULT_NAMES[activeClient];
                      return next;
                    });
                    setEditingName(null);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditingName(null);
                  }}
                  className="text-lg font-semibold text-ocean-900 bg-transparent border-b-2 border-ocean-500 outline-none py-0 px-0"
                />
              ) : (
                <h2
                  onClick={() => { setEditingName(activeClient); setEditNameValue(clientNames[activeClient]); }}
                  className="text-lg font-semibold text-ocean-900 cursor-pointer hover:text-ocean-600 transition-colors"
                  title="Click para renombrar"
                >
                  {clientNames[activeClient]}
                  <svg className="w-3.5 h-3.5 inline-block ml-1.5 text-ocean-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </h2>
              )}
            </div>
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
            {/* Total arriba */}
            <div ref={totalRef} className={`p-4 rounded-lg mb-4 ${totalUSD < 0 ? 'bg-red-50 border border-red-200' : 'bg-ocean-600'}`}>
              <div className="flex items-center justify-between">
                <span className={`text-sm font-medium ${totalUSD < 0 ? 'text-red-700' : 'text-ocean-100'}`}>Total</span>
                <div className="text-right">
                  <p className={`text-sm font-mono ${totalUSD < 0 ? 'text-red-500' : 'text-ocean-200'}`}>
                    {totalUSD < 0 ? '-' : ''}{formatUSD(Math.abs(totalUSD))}
                  </p>
                  <p className={`text-2xl font-bold font-mono ${totalBs < 0 ? 'text-red-500' : 'text-white'}`}>
                    {totalBs < 0 ? '-' : ''}{formatBs(Math.abs(totalBs))}
                  </p>
                </div>
              </div>
            </div>

            {/* Entradas */}
            <div className="space-y-2">
              {entries.map(entry => (
                <div key={entry.id} className={`flex items-center gap-3 p-3 rounded-lg border ${entry.isNegative ? 'border-red-100 bg-red-50/50' : 'border-ocean-100 bg-ocean-50/30'}`}>
                  <div className="flex-1 min-w-0">
                    {entry.description && (
                      <p className="text-xs text-ocean-500 truncate mb-0.5">{entry.description}</p>
                    )}
                    {editingEntry === entry.id ? (
                      <div className="flex items-center gap-1">
                        <span className={`text-sm font-mono ${entry.isNegative ? 'text-red-400' : 'text-ocean-400'}`}>$</span>
                        <input
                          ref={editEntryRef}
                          type="text"
                          inputMode="decimal"
                          value={editEntryValue}
                          onChange={e => setEditEntryValue(e.target.value)}
                          onBlur={() => {
                            const val = parseFloat(editEntryValue.replace(/,/g, '.'));
                            if (val > 0) updateEntryAmount(entry.id, val);
                            setEditingEntry(null);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') setEditingEntry(null);
                          }}
                          className="w-20 text-sm font-mono bg-transparent border-b-2 border-ocean-500 outline-none py-0"
                        />
                      </div>
                    ) : (
                      <p
                        onClick={() => { setEditingEntry(entry.id); setEditEntryValue(entry.amountUSD.toFixed(2)); }}
                        className={`text-sm font-mono cursor-pointer hover:underline ${entry.isNegative ? 'text-red-400' : 'text-ocean-400'}`}
                      >
                        {entry.isNegative ? '-' : ''}{formatUSD(entry.amountUSD)}
                      </p>
                    )}
                    <p className={`text-xl font-bold font-mono ${entry.isNegative ? 'text-red-600' : 'text-green-700'}`}>
                      {entry.isNegative ? '-' : ''}{formatBs(entry.amountBs)}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => toggleSign(entry.id)}
                      className="p-1.5 text-ocean-400 hover:text-ocean-600 hover:bg-ocean-100 rounded transition-colors"
                      title={entry.isNegative ? 'Cambiar a positivo' : 'Cambiar a negativo'}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    </button>
                    <button
                      onClick={() => removeEntry(entry.id)}
                      className="p-1.5 text-red-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                      title="Eliminar"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
