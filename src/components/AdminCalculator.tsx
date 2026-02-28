import { useState, useEffect, useCallback, useRef } from 'react';
import { formatUSD, formatBs } from '../lib/format';

interface CalcEntry {
  id: number;
  description: string;
  amountUSD: number;
  amountBs: number;
  isNegative: boolean;
}

interface SavedSession {
  id: number;
  clientName: string;
  dispatcher?: string;
  entries: CalcEntry[];
  totalUSD: number;
  totalBs: number;
  rate: number;
  timestamp: number;
}

const DISPATCHERS = [
  { name: 'Carlos', bg: 'bg-blue-100', text: 'text-blue-700', ring: 'ring-blue-300', badge: 'bg-blue-50 text-blue-600' },
  { name: 'Pa', bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-300', badge: 'bg-emerald-50 text-emerald-600' },
  { name: 'Luis', bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-300', badge: 'bg-amber-50 text-amber-600' },
  { name: 'Pedro', bg: 'bg-rose-100', text: 'text-rose-700', ring: 'ring-rose-300', badge: 'bg-rose-50 text-rose-600' },
] as const;

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
  const clearAllRef = useRef<() => void>(() => {});
  const amountRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const totalRef = useRef<HTMLDivElement>(null);
  const editNameRef = useRef<HTMLInputElement>(null);
  const [inputAmount, setInputAmount] = useState('');
  const [inputCurrency, setInputCurrency] = useState<'USD' | 'Bs'>('USD');
  const [description, setDescription] = useState('');

  // Tabs de clientes (dinámico)
  const defaultName = (i: number) => `Cliente ${i + 1}`;
  const [clientNames, setClientNames] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('rpym_calc_client_names');
      if (saved) return JSON.parse(saved);
    } catch {}
    return Array.from({ length: 5 }, (_, i) => defaultName(i));
  });
  const [editingName, setEditingName] = useState<number | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [editingEntry, setEditingEntry] = useState<number | null>(null);
  const [editEntryValue, setEditEntryValue] = useState('');
  const editEntryRef = useRef<HTMLInputElement>(null);
  const [editingTotal, setEditingTotal] = useState(false);
  const [editTotalValue, setEditTotalValue] = useState('');
  const editTotalRef = useRef<HTMLInputElement>(null);
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

  // Despachador por cliente
  const [clientDispatcher, setClientDispatcher] = useState<Record<number, string>>(() => {
    try {
      const saved = localStorage.getItem('rpym_calc_client_dispatcher');
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

  // Historial de sesiones (recibos guardados al limpiar)
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>(() => {
    try {
      const saved = localStorage.getItem('rpym_calc_sessions');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [showHistory, setShowHistory] = useState(false);
  const [expandedSession, setExpandedSession] = useState<number | null>(null);

  const activeRate = useManualRate && manualRate ? parseFloat(manualRate) : autoRate;

  // Persistir sesiones
  useEffect(() => {
    localStorage.setItem('rpym_calc_sessions', JSON.stringify(savedSessions));
  }, [savedSessions]);

  // Persistir entries, tab activo y despachador
  useEffect(() => {
    localStorage.setItem('rpym_calc_client_entries', JSON.stringify(clientEntries));
  }, [clientEntries]);

  useEffect(() => {
    localStorage.setItem('rpym_calc_client_dispatcher', JSON.stringify(clientDispatcher));
  }, [clientDispatcher]);

  useEffect(() => {
    localStorage.setItem('rpym_calc_active_client', String(activeClient));
    setConfirmingDeleteClient(false);
    // Devolver foco al input de monto al cambiar de cliente (solo si no se está editando nombre)
    if (editingName === null && editingEntry === null) {
      amountRef.current?.focus();
    }
  }, [activeClient]);

  // Navegación global con flechas (funciona sin importar dónde esté el foco)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // No interceptar si se está editando nombre, entry o total
      if (editingName !== null || editingEntry !== null || editingTotal) return;

      const len = clientNames.length;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setActiveClient(prev => (prev - 1 + len) % len);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveClient(prev => (prev + 1) % len);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        amountRef.current?.focus();
      } else if (e.key === '\\') {
        e.preventDefault();
        clearAllRef.current();
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [editingName, editingEntry, editingTotal, clientNames.length]);

  // Focalizar inputs de edición cuando se activan
  useEffect(() => {
    if (editingTotal) {
      requestAnimationFrame(() => {
        editTotalRef.current?.focus();
        editTotalRef.current?.select();
      });
    }
  }, [editingTotal]);

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

  const applyTotalAdjust = (newTotalUSD: number) => {
    if (!activeRate) return;
    const diff = newTotalUSD - totalUSD;
    if (Math.abs(diff) < 0.001) return; // sin cambio
    const entry: CalcEntry = {
      id: nextId,
      description: 'Ajuste',
      amountUSD: Math.abs(diff),
      amountBs: Math.abs(diff) * activeRate,
      isNegative: diff < 0,
    };
    setEntries(prev => [...prev, entry]);
    setNextId(prev => prev + 1);
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

  // Totales
  const totalUSD = entries.reduce((sum, e) => sum + (e.isNegative ? -e.amountUSD : e.amountUSD), 0);
  const totalBs = entries.reduce((sum, e) => sum + (e.isNegative ? -e.amountBs : e.amountBs), 0);

  const addClient = () => {
    const newName = defaultName(clientNames.length);
    setClientNames(prev => [...prev, newName]);
    setActiveClient(clientNames.length);
  };

  const removeClient = (idx: number) => {
    if (clientNames.length <= 1) return;
    setClientNames(prev => prev.filter((_, i) => i !== idx));
    setClientEntries(prev => {
      const next: Record<number, CalcEntry[]> = {};
      Object.keys(prev).forEach(k => {
        const ki = parseInt(k);
        if (ki < idx) next[ki] = prev[ki];
        else if (ki > idx) next[ki - 1] = prev[ki];
      });
      return next;
    });
    setClientDispatcher(prev => {
      const next: Record<number, string> = {};
      Object.keys(prev).forEach(k => {
        const ki = parseInt(k);
        if (ki < idx) next[ki] = prev[ki];
        else if (ki > idx) next[ki - 1] = prev[ki];
      });
      return next;
    });
    if (activeClient >= idx && activeClient > 0) {
      setActiveClient(prev => prev - 1);
    }
  };

  const clearAll = useCallback(() => {
    // Guardar sesión en historial si tiene entries
    if (entries.length > 0) {
      const session: SavedSession = {
        id: Date.now(),
        clientName: clientNames[activeClient],
        dispatcher: clientDispatcher[activeClient],
        entries: [...entries],
        totalUSD,
        totalBs,
        rate: activeRate,
        timestamp: Date.now(),
      };
      setSavedSessions(prev => [session, ...prev].slice(0, 100));
    }
    setEntries([]);
    setInputAmount('');
    setDescription('');
    // Resetear despachador
    setClientDispatcher(prev => {
      const next = { ...prev };
      delete next[activeClient];
      return next;
    });
    // Resetear nombre al default
    setClientNames(prev => {
      const next = [...prev];
      next[activeClient] = defaultName(activeClient);
      return next;
    });
  }, [entries, clientNames, activeClient, clientDispatcher, totalUSD, totalBs, activeRate]);
  clearAllRef.current = clearAll;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEntry();
    }
  };

  const clearHistory = () => setSavedSessions([]);
  const removeSession = (id: number) => setSavedSessions(prev => prev.filter(s => s.id !== id));

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

  const [showSettings, setShowSettings] = useState(false);
  const [confirmingDeleteClient, setConfirmingDeleteClient] = useState(false);

  return (
    <div className="flex flex-col h-full p-2 sm:p-4 gap-2 sm:gap-3">
      {/* ZONA FIJA: Input + Conversión + Tabs + Total */}
      <div className="shrink-0">
        {/* Tasa actual + settings toggle */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-ocean-400">Tasa:</span>
            <span className="text-sm font-bold text-ocean-700 font-mono">
              {rateLoading ? '...' : `Bs. ${activeRate.toFixed(2)}`}
            </span>
            {useManualRate && <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">Manual</span>}
          </div>
          <div className="flex items-center gap-2">
            {savedSessions.length > 0 && (
              <button
                onClick={() => { setShowHistory(prev => !prev); setExpandedSession(null); }}
                className={`p-1.5 rounded-lg transition-colors ${showHistory ? 'bg-ocean-100 text-ocean-700' : 'text-ocean-400 hover:text-ocean-600 hover:bg-ocean-50'}`}
                title="Historial"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            )}
            <button
              onClick={() => setShowSettings(prev => !prev)}
              className={`p-1.5 rounded-lg transition-colors ${showSettings ? 'bg-ocean-100 text-ocean-700' : 'text-ocean-400 hover:text-ocean-600 hover:bg-ocean-50'}`}
              title="Configurar tasa"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Settings drawer (colapsable) */}
        {showSettings && (
          <div className="mb-3 p-3 bg-ocean-50 rounded-lg border border-ocean-100">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setUseManualRate(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  !useManualRate ? 'bg-ocean-600 text-white' : 'bg-white text-ocean-600 hover:bg-ocean-100'
                }`}
              >
                Auto ({autoRate.toFixed(2)})
              </button>
              <button
                onClick={() => setUseManualRate(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  useManualRate ? 'bg-ocean-600 text-white' : 'bg-white text-ocean-600 hover:bg-ocean-100'
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
                  className="w-28 px-2 py-1.5 border border-ocean-200 rounded-lg text-xs focus:ring-2 focus:ring-ocean-500 focus:border-transparent"
                />
              )}
            </div>
          </div>
        )}

        {/* Historial de sesiones (colapsable) */}
        {showHistory && savedSessions.length > 0 && (
          <div className="mb-3 bg-white rounded-lg border border-ocean-100 overflow-hidden">
            <div className="max-h-48 sm:max-h-64 overflow-y-auto divide-y divide-ocean-50">
              {savedSessions.map(session => (
                <div key={session.id}>
                  <button
                    onClick={() => setExpandedSession(prev => prev === session.id ? null : session.id)}
                    className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-ocean-50 transition-colors text-left"
                  >
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-ocean-700">{session.clientName}</span>
                      {session.dispatcher && (() => {
                        const disp = DISPATCHERS.find(d => d.name === session.dispatcher);
                        return (
                          <span className={`text-[9px] font-semibold rounded-full px-1.5 py-0.5 ml-1.5 ${disp ? disp.badge : 'bg-gray-50 text-gray-500'}`}>{session.dispatcher}</span>
                        );
                      })()}
                      <span className="text-xs text-ocean-400 ml-2">({session.entries.length} items)</span>
                      <div className="text-xs text-ocean-400">
                        {formatHistoryDate(session.timestamp)} {formatTime(session.timestamp)}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="text-sm font-mono text-ocean-500">{formatUSD(Math.abs(session.totalUSD))}</div>
                      <div className="text-base font-bold font-mono text-green-700">{formatBs(Math.abs(session.totalBs))}</div>
                    </div>
                  </button>
                  {expandedSession === session.id && (
                    <div className="px-4 pb-3 space-y-1 bg-ocean-50/50">
                      {session.entries.map(entry => (
                        <div key={entry.id} className="flex items-center justify-between text-xs py-1">
                          <span className="text-ocean-500 truncate mr-2">{entry.description || '—'}</span>
                          <div className="text-right shrink-0">
                            <span className={`font-mono ${entry.isNegative ? 'text-red-400' : 'text-ocean-400'}`}>
                              {entry.isNegative ? '-' : ''}{formatUSD(entry.amountUSD)}
                            </span>
                            <span className={`font-mono ml-2 font-medium ${entry.isNegative ? 'text-red-600' : 'text-green-700'}`}>
                              {entry.isNegative ? '-' : ''}{formatBs(entry.amountBs)}
                            </span>
                          </div>
                        </div>
                      ))}
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-ocean-300">Tasa: Bs. {session.rate.toFixed(2)}</span>
                        <button
                          onClick={() => removeSession(session.id)}
                          className="text-[10px] text-red-400 hover:text-red-600 transition-colors"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="px-4 py-1.5 border-t border-ocean-100 bg-ocean-50/50">
              <button onClick={clearHistory} className="text-xs text-red-400 hover:text-red-600 transition-colors">
                Borrar historial
              </button>
            </div>
          </div>
        )}

        {/* Input de monto + conversión */}
        <div className="bg-white rounded-xl p-2.5 sm:p-4 shadow-sm border border-ocean-100">
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
                } else if (e.key === 'Escape') {
                  setInputAmount('');
                } else if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp') {
                  handleKeyDown(e);
                }
              }}
              className="flex-1 px-3 sm:px-4 py-2.5 sm:py-3 text-xl sm:text-2xl font-semibold border border-ocean-200 rounded-lg focus:ring-2 focus:ring-ocean-500 focus:border-transparent text-ocean-900 font-mono"
              autoFocus
            />
            <button
              onClick={() => setInputCurrency(prev => prev === 'USD' ? 'Bs' : 'USD')}
              className="px-3 sm:px-4 py-2.5 sm:py-3 bg-ocean-100 text-ocean-700 font-bold text-base sm:text-lg rounded-lg hover:bg-ocean-200 transition-colors min-w-[48px] sm:min-w-[56px]"
            >
              {inputCurrency === 'USD' ? '$' : 'Bs'}
            </button>
          </div>

          {hasExpression && parsedAmount !== 0 && (
            <div className="mt-1 px-1 text-sm text-ocean-500">
              = {inputCurrency === 'USD' ? formatUSD(parsedAmount) : formatBs(parsedAmount)}
            </div>
          )}

          {activeRate > 0 && (
            <div className="mt-1.5 sm:mt-2 p-2 sm:p-3 bg-ocean-50 rounded-lg text-center">
              <span className="text-xs text-ocean-500">
                {inputCurrency === 'USD' ? 'Bolivares' : 'Dolares'}
              </span>
              <p className="text-xl sm:text-2xl font-bold text-ocean-800">
                {inputCurrency === 'USD' ? formatBs(convertedBs) : formatUSD(convertedUSD)}
              </p>
            </div>
          )}

          <div className="mt-1.5 sm:mt-2 flex items-center gap-2">
            <button
              onClick={() => noteRef.current?.focus()}
              className={`p-1.5 rounded-lg transition-colors ${description ? 'bg-ocean-100 text-ocean-700' : 'bg-ocean-50 text-ocean-300 hover:text-ocean-500'}`}
              title="Agregar nota"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              className="flex-1 px-2 py-1 text-xs text-ocean-400 border-0 bg-transparent focus:ring-0 focus:text-ocean-600 placeholder:text-ocean-200"
            />
            <button
              onClick={addEntry}
              disabled={parsedAmount === 0 || !activeRate}
              className="px-4 py-1.5 bg-ocean-600 text-white rounded-lg text-sm font-medium hover:bg-ocean-500 disabled:bg-ocean-300 transition-colors"
            >
              Agregar
            </button>
          </div>
        </div>

        {/* Tabs de clientes */}
        <div className="mt-2 sm:mt-3 bg-white rounded-t-xl shadow-sm border border-ocean-100 border-b-0">
          <div className="flex overflow-x-auto">
            {clientNames.map((name, i) => {
              const count = (clientEntries[i] || []).length;
              const totals = getClientTotals(i);
              return (
                <div key={i} className={`flex-1 min-w-[60px] sm:min-w-[70px] relative ${
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
                    {clientDispatcher[i] && (() => {
                      const disp = DISPATCHERS.find(d => d.name === clientDispatcher[i]);
                      return (
                        <div className={`text-[8px] font-semibold rounded-full px-1.5 mx-auto mt-0.5 truncate max-w-full ${disp ? disp.badge : 'bg-gray-50 text-gray-500'}`}>
                          {clientDispatcher[i]}
                        </div>
                      );
                    })()}
                    {count > 0 ? (
                      <div className="mt-1">
                        <div className={`text-[11px] font-mono font-bold leading-tight ${activeClient === i ? 'text-green-700' : 'text-green-500'}`}>
                          {formatBs(Math.abs(totals.bs))}
                        </div>
                        <div className={`text-[9px] font-mono leading-tight ${activeClient === i ? 'text-ocean-400' : 'text-ocean-300'}`}>
                          {formatUSD(Math.abs(totals.usd))}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1 text-[9px] text-ocean-200">--</div>
                    )}
                  </button>
                  {activeClient === i && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-ocean-600" />
                  )}
                </div>
              );
            })}
            <button
              onClick={addClient}
              className="px-3 py-2 text-ocean-300 hover:text-ocean-600 hover:bg-ocean-50 transition-colors shrink-0 border-l border-ocean-100"
              title="Agregar cliente"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Nombre del cliente + Total */}
        <div className="bg-white border-x border-ocean-100 px-2.5 sm:px-4 pt-2 sm:pt-3">
          <div className="flex items-center justify-between mb-2">
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
                      next[activeClient] = editNameValue.trim() || defaultName(activeClient);
                      return next;
                    });
                    setEditingName(null);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditingName(null);
                  }}
                  className="text-sm font-semibold text-ocean-900 bg-transparent border-b-2 border-ocean-500 outline-none py-0 px-0"
                />
              ) : (
                <h2
                  onClick={() => { setEditingName(activeClient); setEditNameValue(clientNames[activeClient]); }}
                  className="text-sm font-semibold text-ocean-900 cursor-pointer hover:text-ocean-600 transition-colors"
                  title="Click para renombrar"
                >
                  {clientNames[activeClient]}
                  <svg className="w-3 h-3 inline-block ml-1 text-ocean-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </h2>
              )}
              {/* Selector de despachador */}
              <div className="flex items-center gap-1">
                {DISPATCHERS.map(d => {
                  const isActive = clientDispatcher[activeClient] === d.name;
                  return (
                    <button
                      key={d.name}
                      onClick={() => {
                        setClientDispatcher(prev => {
                          const next = { ...prev };
                          if (next[activeClient] === d.name) { delete next[activeClient]; }
                          else { next[activeClient] = d.name; }
                          return next;
                        });
                        requestAnimationFrame(() => amountRef.current?.focus());
                      }}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all ${
                        isActive
                          ? `${d.bg} ${d.text} ring-1 ${d.ring} scale-105`
                          : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
                      }`}
                    >
                      {d.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {entries.length > 0 && (
                <button
                  onClick={clearAll}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors"
                >
                  Limpiar
                </button>
              )}
              {clientNames.length > 1 && (
                confirmingDeleteClient ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-red-500">Eliminar?</span>
                    <button
                      onClick={() => { removeClient(activeClient); setConfirmingDeleteClient(false); }}
                      className="text-[10px] font-medium text-red-600 hover:text-red-800 transition-colors"
                    >
                      Si
                    </button>
                    <button
                      onClick={() => setConfirmingDeleteClient(false)}
                      className="text-[10px] font-medium text-ocean-400 hover:text-ocean-600 transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingDeleteClient(true)}
                    className="text-xs text-ocean-300 hover:text-red-500 transition-colors"
                    title="Eliminar cliente"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )
              )}
            </div>
          </div>

          {entries.length > 0 && (
            <div ref={totalRef} className={`p-2 sm:p-3 rounded-lg text-center ${totalUSD < 0 ? 'bg-red-50 border border-red-200' : 'bg-ocean-50'}`}>
              <span className={`text-xs ${totalUSD < 0 ? 'text-red-500' : 'text-ocean-500'}`}>Total</span>
              <p className={`text-xl sm:text-2xl font-bold text-ocean-800 mt-0.5 ${totalBs < 0 ? 'text-red-600' : ''}`}>
                {totalBs < 0 ? '-' : ''}{formatBs(Math.abs(totalBs))}
              </p>
              {editingTotal ? (
                <div className="flex items-center gap-1 justify-center mt-1">
                  <span className="text-xs font-mono text-ocean-400">$</span>
                  <input
                    ref={editTotalRef}
                    type="text"
                    inputMode="decimal"
                    value={editTotalValue}
                    onChange={e => setEditTotalValue(e.target.value)}
                    onBlur={() => {
                      const val = parseFloat(editTotalValue.replace(/,/g, '.'));
                      if (!isNaN(val) && val >= 0) applyTotalAdjust(val);
                      setEditingTotal(false);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setEditingTotal(false);
                    }}
                    className="w-20 text-xs font-mono bg-transparent border-b-2 border-ocean-400 outline-none py-0 text-center"
                  />
                </div>
              ) : (
                <p
                  onClick={() => { setEditingTotal(true); setEditTotalValue(Math.abs(totalUSD).toFixed(2)); }}
                  className={`text-xs font-mono cursor-pointer hover:underline mt-0.5 ${totalUSD < 0 ? 'text-red-400' : 'text-ocean-400'}`}
                  title="Click para ajustar total"
                >
                  {totalUSD < 0 ? '-' : ''}{formatUSD(Math.abs(totalUSD))}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ZONA SCROLL: Operaciones */}
      <div className="flex-1 min-h-0 bg-white rounded-b-xl border-x border-b border-ocean-100 overflow-y-auto">
        <div className="p-2.5 sm:p-4">
          {entries.length === 0 ? (
            <p className="text-sm text-ocean-400 text-center py-4">Sin operaciones</p>
          ) : (
            <div className="space-y-2">
              {entries.map(entry => (
                <div key={entry.id} className={`flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg border ${entry.isNegative ? 'border-red-100 bg-red-50/50' : 'border-ocean-100 bg-ocean-50/30'}`}>
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
                        className={`text-sm font-mono ${entry.isNegative ? 'text-red-400' : 'text-ocean-400'} cursor-pointer hover:underline`}
                        title="Click para editar"
                      >
                        {entry.isNegative ? '-' : ''}{formatUSD(entry.amountUSD)}
                      </p>
                    )}
                    <p className={`text-base sm:text-xl font-bold font-mono ${entry.isNegative ? 'text-red-600' : 'text-green-700'}`}>
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
          )}
        </div>
      </div>
    </div>
  );
}
