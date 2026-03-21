import { useState, useRef, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react';
import { evalMathExpr } from '../../lib/safe-math';
import { formatUSD, formatBs } from '../../lib/format';
import { DISPATCHERS } from './constants';
import type { QuickOpEntry, QuickQueueItem, SavedSession } from './types';
import { PlusIcon, CloseIcon, TrashIcon } from './icons';

interface QuickOpsProps {
  activeRate: number;
  queue: QuickQueueItem[];
  onQueueChange: Dispatch<SetStateAction<QuickQueueItem[]>>;
  onAddSession: (session: SavedSession) => void;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function QuickOps({ activeRate, queue, onQueueChange, onAddSession }: QuickOpsProps) {
  const [selectedDispatcher, setSelectedDispatcher] = useState(DISPATCHERS[0].name);
  const [inputAmount, setInputAmount] = useState('');
  const [inputCurrency, setInputCurrency] = useState<'USD' | 'Bs'>('USD');
  const [currentEntries, setCurrentEntries] = useState<QuickOpEntry[]>([]);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const dispatcherInfo = DISPATCHERS.find(d => d.name === selectedDispatcher);

  const currentTotal = currentEntries.reduce(
    (sum, e) => ({ usd: sum.usd + e.amountUSD, bs: sum.bs + e.amountBs }),
    { usd: 0, bs: 0 }
  );

  // Fix #2: al cambiar de despachador, resetear entradas y monto para cuenta nueva
  const handleDispatcherChange = useCallback((name: string) => {
    setSelectedDispatcher(name);
    setCurrentEntries([]);
    setInputAmount('');
    inputRef.current?.focus();
  }, []);

  const startEditingEntry = useCallback((entry: QuickOpEntry) => {
    setEditingEntryId(entry.id);
    setEditingValue(entry.amountInput);
  }, []);

  const confirmEditEntry = useCallback((entryId: string) => {
    const parsed = evalMathExpr(editingValue);
    setEditingEntryId(null);
    if (parsed === 0 || !activeRate) return;
    setCurrentEntries(prev => prev.map(e => {
      if (e.id !== entryId) return e;
      let usd: number, bs: number;
      if (e.currency === 'USD') {
        usd = parsed; bs = parsed * activeRate;
      } else {
        bs = parsed; usd = parsed / activeRate;
      }
      const hasExpression = /[+\-*/]/.test(editingValue.replace(/^-/, ''));
      return {
        ...e,
        amountInput: editingValue.trim(),
        amountUSD: usd,
        amountBs: bs,
        expression: hasExpression ? editingValue.trim() : undefined,
      };
    }));
  }, [editingValue, activeRate]);

  const addAmount = useCallback(() => {
    const parsed = evalMathExpr(inputAmount);
    if (parsed === 0 || !activeRate) return;

    let usd: number, bs: number;
    if (inputCurrency === 'USD') {
      usd = parsed; bs = parsed * activeRate;
    } else {
      bs = parsed; usd = parsed / activeRate;
    }

    const hasExpression = /[+\-*/]/.test(inputAmount.replace(/^-/, ''));
    const entry: QuickOpEntry = {
      id: crypto.randomUUID(),
      amountInput: inputAmount.trim(),
      currency: inputCurrency,
      amountUSD: usd,
      amountBs: bs,
      expression: hasExpression ? inputAmount.trim() : undefined,
    };
    setCurrentEntries(prev => [...prev, entry]);
    setInputAmount('');
    inputRef.current?.focus();
  }, [inputAmount, inputCurrency, activeRate]);

  const addToQueue = useCallback(() => {
    if (currentEntries.length === 0) return;
    const item: QuickQueueItem = {
      id: crypto.randomUUID(),
      dispatcher: selectedDispatcher,
      entries: [...currentEntries],
      totalUSD: currentTotal.usd,
      totalBs: currentTotal.bs,
      rate: activeRate,
      timestamp: Date.now(),
    };
    onQueueChange(prev => [...prev, item]);
    setCurrentEntries([]);
    setInputAmount('');
    inputRef.current?.focus();
  }, [currentEntries, selectedDispatcher, currentTotal, activeRate, onQueueChange]);

  const markAsPaid = useCallback((itemId: string) => {
    const item = queue.find(q => q.id === itemId);
    if (!item) return;

    const calcEntries = item.entries.map(e => ({
      id: e.id,
      description: e.currency === 'USD' ? `$${e.amountInput}` : `Bs ${e.amountInput}`,
      amountUSD: e.amountUSD,
      amountBs: e.amountBs,
      isNegative: false,
      expression: e.expression,
    }));

    const session: SavedSession = {
      id: crypto.randomUUID(),
      clientName: 'Op. Rápida',
      dispatcher: item.dispatcher,
      entries: calcEntries,
      totalUSD: item.totalUSD,
      totalBs: item.totalBs,
      rate: item.rate,
      timestamp: Date.now(),
    };
    onAddSession(session);
    onQueueChange(prev => prev.filter(q => q.id !== itemId));
  }, [queue, onAddSession, onQueueChange]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const parsedAmount = evalMathExpr(inputAmount);
  const hasExpression = /[+\-*/]/.test(inputAmount.replace(/^-/, ''));
  const previewUSD = inputCurrency === 'USD' ? parsedAmount : (activeRate ? parsedAmount / activeRate : 0);
  const previewBs = inputCurrency === 'USD' ? (activeRate ? parsedAmount * activeRate : 0) : parsedAmount;

  return (
    <div className="space-y-3">
      {/* Selector de repartidor */}
      <div className="flex flex-wrap gap-1.5">
        {DISPATCHERS.map((d) => (
          <button
            key={d.name}
            onClick={() => handleDispatcherChange(d.name)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              selectedDispatcher === d.name
                ? `${d.bg} ${d.text} ring-2 ${d.ring} shadow-sm`
                : 'bg-ocean-50 text-ocean-400 hover:bg-ocean-100'
            }`}
          >
            {d.name}
          </button>
        ))}
      </div>

      {/* Área de entrada */}
      <div className={`rounded-xl p-3 ${dispatcherInfo?.bg ?? 'bg-ocean-50'}`}>
        {/* Input de monto */}
        <div className="flex items-stretch gap-2">
          <button
            onClick={() => setInputCurrency(prev => prev === 'USD' ? 'Bs' : 'USD')}
            className={`shrink-0 px-3 py-2.5 rounded-lg text-sm font-bold transition-colors ${
              inputCurrency === 'USD'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-blue-100 text-blue-700'
            }`}
          >
            {inputCurrency === 'USD' ? '$' : 'Bs'}
          </button>
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={inputAmount}
            onChange={e => setInputAmount(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (inputAmount.trim() !== '') { addAmount(); }
                else if (currentEntries.length > 0) { addToQueue(); }
              }
              else if (e.key === ' ') { e.preventDefault(); setInputAmount(prev => prev + '+'); }
              else if (e.key === '[') { e.preventDefault(); setInputAmount(prev => prev + '*'); }
              else if (e.key === 'Escape') { setInputAmount(''); }
              // Fix #3: Tab cicla entre despachadores (Shift+Tab hacia atrás)
              else if (e.key === 'Tab') {
                e.preventDefault();
                const currentIdx = DISPATCHERS.findIndex(d => d.name === selectedDispatcher);
                const nextIdx = e.shiftKey
                  ? (currentIdx - 1 + DISPATCHERS.length) % DISPATCHERS.length
                  : (currentIdx + 1) % DISPATCHERS.length;
                handleDispatcherChange(DISPATCHERS[nextIdx].name);
              }
              // Flechas izquierda/derecha ciclan despachadores solo cuando el input está vacío
              else if (inputAmount === '' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                e.preventDefault();
                const currentIdx = DISPATCHERS.findIndex(d => d.name === selectedDispatcher);
                const nextIdx = e.key === 'ArrowRight'
                  ? (currentIdx + 1) % DISPATCHERS.length
                  : (currentIdx - 1 + DISPATCHERS.length) % DISPATCHERS.length;
                handleDispatcherChange(DISPATCHERS[nextIdx].name);
              }
            }}
            placeholder="0.00"
            className="flex-1 bg-white rounded-lg px-3 py-2.5 text-xl font-semibold border border-ocean-100 focus:border-ocean-300 focus:outline-none font-mono text-ocean-900"
          />
          <button
            onClick={addAmount}
            disabled={parsedAmount === 0 || !activeRate}
            className="shrink-0 px-3 py-2.5 bg-ocean-600 text-white rounded-lg disabled:opacity-40 hover:bg-ocean-500 transition-colors"
          >
            <PlusIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Preview de conversión */}
        {parsedAmount !== 0 && activeRate > 0 && (
          <div className="mt-2 px-2 py-1.5 bg-white/70 rounded-lg flex items-center gap-1 text-xs font-mono">
            {hasExpression && (
              <span className={dispatcherInfo?.text ?? 'text-ocean-500'}>
                = {inputCurrency === 'USD' ? formatUSD(previewUSD) : formatBs(previewBs)}
                {' · '}
              </span>
            )}
            <span className="text-ocean-400">
              {inputCurrency === 'USD' ? formatBs(previewBs) : formatUSD(previewUSD)}
            </span>
          </div>
        )}

        {/* Lista de montos ingresados */}
        {currentEntries.length > 0 && (
          <div className="mt-2 space-y-1">
            {currentEntries.map((entry, i) => (
              <div key={entry.id} className="flex items-center gap-2 bg-white/70 rounded-lg px-2 py-1.5">
                <span className="text-xs text-ocean-300 font-mono w-4 shrink-0">{i + 1}</span>
                {editingEntryId === entry.id ? (
                  <input
                    autoFocus
                    type="text"
                    inputMode="decimal"
                    value={editingValue}
                    onChange={e => setEditingValue(e.target.value)}
                    onBlur={() => confirmEditEntry(entry.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); confirmEditEntry(entry.id); }
                      if (e.key === 'Escape') { e.preventDefault(); setEditingEntryId(null); }
                    }}
                    className="flex-1 min-w-0 text-sm font-semibold font-mono bg-white border border-ocean-300 rounded px-2 py-0.5 focus:outline-none focus:border-ocean-500"
                  />
                ) : (
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => startEditingEntry(entry)}
                    title="Tocar para editar"
                  >
                    {/* Fix #1: Bs como monto principal */}
                    <span className={`text-sm font-semibold font-mono ${dispatcherInfo?.text ?? 'text-ocean-700'} hover:underline`}>
                      {formatBs(entry.amountBs)}
                    </span>
                    {entry.expression && (
                      <span className="text-[10px] text-ocean-300 ml-1">({entry.expression})</span>
                    )}
                  </div>
                )}
                {editingEntryId !== entry.id && (
                  <span className="text-[11px] text-ocean-400 font-mono shrink-0">
                    {formatUSD(entry.amountUSD)}
                  </span>
                )}
                <button
                  onClick={() => setCurrentEntries(prev => prev.filter(e => e.id !== entry.id))}
                  className="text-ocean-200 hover:text-red-400 transition-colors shrink-0 p-0.5"
                >
                  <CloseIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Total acumulado + botón agregar a cola */}
        {currentEntries.length > 0 && (
          <div className="mt-2 flex items-center justify-between bg-white/90 rounded-xl px-3 py-2.5 shadow-sm">
            <div>
              {/* Fix #1: Bs como total principal */}
              <div className={`text-xl font-bold font-mono ${dispatcherInfo?.text ?? 'text-ocean-800'}`}>
                {formatBs(currentTotal.bs)}
              </div>
              <div className="text-xs text-ocean-400 font-mono">{formatUSD(currentTotal.usd)}</div>
            </div>
            <button
              onClick={addToQueue}
              className="px-5 py-2.5 rounded-xl text-sm font-bold text-white shadow-sm transition-all active:scale-95 bg-ocean-600 hover:bg-ocean-500"
            >
              Agregar a cola
            </button>
          </div>
        )}
      </div>

      {/* Cola de pendientes */}
      {queue.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ocean-500 uppercase tracking-wide">
              En cola
            </span>
            <span className="bg-ocean-100 text-ocean-600 text-[10px] font-bold rounded-full px-1.5 py-0.5">
              {queue.length}
            </span>
          </div>
          {queue.map((item, idx) => {
            const disp = DISPATCHERS.find(d => d.name === item.dispatcher);
            return (
              <div key={item.id} className="rounded-xl border border-ocean-100 overflow-hidden shadow-sm bg-white">
                {/* Encabezado del item */}
                <div className={`flex items-center gap-2 px-3 py-2 ${disp?.bg ?? 'bg-ocean-50'}`}>
                  <span className="text-xs font-bold text-ocean-400 font-mono">#{idx + 1}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${disp?.badge ?? 'bg-ocean-100 text-ocean-600'}`}>
                    {item.dispatcher}
                  </span>
                  <span className="text-[10px] text-ocean-400 ml-auto">
                    {formatTimeAgo(item.timestamp)}
                  </span>
                  <button
                    onClick={() => onQueueChange(prev => prev.filter(q => q.id !== item.id))}
                    className="text-ocean-300 hover:text-red-400 transition-colors p-0.5"
                    title="Eliminar de la cola"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Montos + total + botón Ya pasé */}
                <div className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1 mb-2.5">
                    {item.entries.map(e => (
                      <span
                        key={e.id}
                        className={`text-xs font-mono px-2 py-0.5 rounded-lg ${disp?.bg ?? 'bg-ocean-50'} ${disp?.text ?? 'text-ocean-600'}`}
                      >
                        {/* Fix #1: siempre mostrar Bs en los chips de la cola */}
                        {formatBs(e.amountBs)}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      {/* Fix #1: Bs como total principal en la cola */}
                      <div className={`text-lg font-bold font-mono ${disp?.text ?? 'text-ocean-800'}`}>
                        {formatBs(item.totalBs)}
                      </div>
                      <div className="text-xs text-ocean-400 font-mono">{formatUSD(item.totalUSD)}</div>
                    </div>
                    <button
                      onClick={() => markAsPaid(item.id)}
                      className="flex-shrink-0 px-5 py-3 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow transition-all active:scale-95"
                    >
                      Ya pasé ✓
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Estado vacío */}
      {queue.length === 0 && currentEntries.length === 0 && (
        <div className="text-center py-10 text-ocean-300">
          <div className="text-3xl mb-2">⚡</div>
          <div className="text-sm">Selecciona repartidor e ingresa los montos</div>
          <div className="text-xs mt-1 text-ocean-200">Enter o espacio para agregar · Tab o ← → para cambiar repartidor</div>
        </div>
      )}
    </div>
  );
}
