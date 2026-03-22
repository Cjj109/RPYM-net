import { useState, useRef, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react';
import { evalMathExpr } from '../../lib/safe-math';
import { formatUSD, formatBs } from '../../lib/format';
import { DISPATCHERS } from './constants';
import type { QuickOpEntry, QuickQueueItem, SavedSession } from './types';
import { PlusIcon, CloseIcon, TrashIcon, PencilIcon } from './icons';

interface QuickOpsProps {
  activeRate: number;
  queue: QuickQueueItem[];
  onQueueChange: Dispatch<SetStateAction<QuickQueueItem[]>>;
  onAddSession: (session: SavedSession) => void;
  onRemoveSession?: (sessionId: string) => void;
  displayMode?: 'carlos' | 'vero';
}

const DISP_HEX: Record<string, string> = {
  Carlos: '#ef4444',
  Luis:   '#f59e0b',
  Pedro:  '#14b8a6',
  Johan:  '#8b5cf6',
  Pa:     '#3b82f6',
};

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function QuickOps({ activeRate, queue, onQueueChange, onAddSession, onRemoveSession, displayMode = 'carlos' }: QuickOpsProps) {
  const [selectedDispatcher, setSelectedDispatcher] = useState(DISPATCHERS[0].name);
  const [inputAmount, setInputAmount] = useState('');
  const [inputCurrency, setInputCurrency] = useState<'USD' | 'Bs'>('USD');
  const [currentEntries, setCurrentEntries] = useState<QuickOpEntry[]>([]);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [editingCurrency, setEditingCurrency] = useState<'USD' | 'Bs'>('Bs');
  const [noteInput, setNoteInput] = useState('');

  // Queue item editing state
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null);

  // Queue item inline total editing
  const [editingQueueTotalId, setEditingQueueTotalId] = useState<string | null>(null);
  const [editingQueueTotalValue, setEditingQueueTotalValue] = useState('');
  const [editingQueueTotalCurrency, setEditingQueueTotalCurrency] = useState<'USD' | 'Bs'>('Bs');

  // Queue item inline note editing
  const [editingQueueNoteId, setEditingQueueNoteId] = useState<string | null>(null);
  const [editingQueueNoteValue, setEditingQueueNoteValue] = useState('');

  // Drag & drop state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const touchDragIndex = useRef<number | null>(null);

  // Discard toast state
  const [lastDiscarded, setLastDiscarded] = useState<QuickQueueItem | null>(null);
  const discardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDiscardedRef = useRef<QuickQueueItem | null>(null);

  // Paid toast state
  const [lastPaid, setLastPaid] = useState<{ queueItem: QuickQueueItem; sessionId: string } | null>(null);
  const paidTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPaidRef = useRef<{ queueItem: QuickQueueItem; sessionId: string } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const queueAreaRef = useRef<HTMLDivElement>(null);

  // Refs para evitar closures obsoletos en el handler global
  const queueRef = useRef(queue);
  const selectedDispatcherRef = useRef(selectedDispatcher);
  const editingQueueIdRef = useRef(editingQueueId);
  const markAsPaidRef = useRef<(id: string) => void>(() => {});
  const handleDispatcherChangeRef = useRef<(name: string, isEditing?: boolean) => void>(() => {});
  const onQueueChangeRef = useRef(onQueueChange);
  const onRemoveSessionRef = useRef(onRemoveSession);

  const dispatcherInfo = DISPATCHERS.find(d => d.name === selectedDispatcher);

  const currentTotal = currentEntries.reduce(
    (sum, e) => ({ usd: sum.usd + e.amountUSD, bs: sum.bs + e.amountBs }),
    { usd: 0, bs: 0 }
  );

  const handleDispatcherChange = useCallback((name: string, isEditing = false) => {
    setSelectedDispatcher(name);
    inputRef.current?.focus();
  }, []);

  // Load a queue item into the edit area on double-tap/click
  const startEditingQueueItem = useCallback((item: QuickQueueItem) => {
    setEditingQueueId(item.id);
    setSelectedDispatcher(item.dispatcher);
    setCurrentEntries([...item.entries]);
    setNoteInput(item.note ?? '');
    setInputAmount('');
    inputRef.current?.focus();
  }, []);

  const cancelEditingQueue = useCallback(() => {
    setEditingQueueId(null);
    setCurrentEntries([]);
    setInputAmount('');
    setNoteInput('');
    inputRef.current?.focus();
  }, []);

  const startEditingEntry = useCallback((entry: QuickOpEntry, forCurrency: 'USD' | 'Bs') => {
    setEditingEntryId(entry.id);
    setEditingCurrency(forCurrency);
    setEditingValue(
      forCurrency === 'USD'
        ? String(Math.round(entry.amountUSD * 100) / 100)
        : (entry.currency === 'Bs' ? entry.amountInput : String(Math.round(entry.amountBs * 100) / 100))
    );
  }, []);

  const confirmEditEntry = useCallback((entryId: string) => {
    const parsed = evalMathExpr(editingValue);
    setEditingEntryId(null);
    if (parsed === 0 || !activeRate) return;
    setCurrentEntries(prev => prev.map(e => {
      if (e.id !== entryId) return e;
      let usd: number, bs: number;
      if (editingCurrency === 'USD') {
        usd = parsed; bs = parsed * activeRate;
      } else {
        bs = parsed; usd = parsed / activeRate;
      }
      const hasExpression = /[+\-*/]/.test(editingValue.replace(/^-/, ''));
      return {
        ...e,
        amountInput: editingValue.trim(),
        currency: editingCurrency,
        amountUSD: usd,
        amountBs: bs,
        expression: hasExpression ? editingValue.trim() : undefined,
      };
    }));
  }, [editingValue, editingCurrency, activeRate]);

  const startEditingQueueTotal = useCallback((item: QuickQueueItem, currency: 'USD' | 'Bs') => {
    setEditingQueueTotalId(item.id);
    setEditingQueueTotalCurrency(currency);
    setEditingQueueTotalValue(
      currency === 'Bs'
        ? String(Math.round(item.totalBs * 100) / 100)
        : String(Math.round(item.totalUSD * 100) / 100)
    );
  }, []);

  const confirmQueueTotalEdit = useCallback((itemId: string) => {
    const parsed = evalMathExpr(editingQueueTotalValue);
    setEditingQueueTotalId(null);
    if (parsed === 0 || !activeRate) return;
    onQueueChange(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const newTotalBs = editingQueueTotalCurrency === 'Bs' ? parsed : parsed * activeRate;
      const newTotalUSD = editingQueueTotalCurrency === 'Bs' ? parsed / activeRate : parsed;
      return { ...item, totalBs: newTotalBs, totalUSD: newTotalUSD };
    }));
  }, [editingQueueTotalValue, editingQueueTotalCurrency, activeRate, onQueueChange]);

  const startEditingQueueNote = useCallback((item: QuickQueueItem) => {
    setEditingQueueNoteId(item.id);
    setEditingQueueNoteValue(item.note ?? '');
  }, []);

  const confirmQueueNoteEdit = useCallback((itemId: string) => {
    setEditingQueueNoteId(null);
    onQueueChange(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      return { ...item, note: editingQueueNoteValue.trim() || undefined };
    }));
  }, [editingQueueNoteValue, onQueueChange]);

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

    if (editingQueueId) {
      // Update existing item in-place
      onQueueChange(prev => prev.map(item => {
        if (item.id !== editingQueueId) return item;
        return {
          ...item,
          dispatcher: selectedDispatcher,
          entries: [...currentEntries],
          totalUSD: currentTotal.usd,
          totalBs: currentTotal.bs,
          rate: activeRate,
          note: noteInput.trim() || undefined,
        };
      }));
      setEditingQueueId(null);
    } else {
      const item: QuickQueueItem = {
        id: crypto.randomUUID(),
        dispatcher: selectedDispatcher,
        entries: [...currentEntries],
        totalUSD: currentTotal.usd,
        totalBs: currentTotal.bs,
        rate: activeRate,
        timestamp: Date.now(),
        note: noteInput.trim() || undefined,
      };
      onQueueChange(prev => [...prev, item]);
    }

    setCurrentEntries([]);
    setInputAmount('');
    setNoteInput('');
    inputRef.current?.focus();
  }, [currentEntries, selectedDispatcher, currentTotal, activeRate, onQueueChange, noteInput, editingQueueId]);

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

    const sessionId = crypto.randomUUID();
    const session: SavedSession = {
      id: sessionId,
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

    lastPaidRef.current = { queueItem: item, sessionId };
    setLastPaid({ queueItem: item, sessionId });
    if (paidTimerRef.current) clearTimeout(paidTimerRef.current);
    paidTimerRef.current = setTimeout(() => {
      setLastPaid(null);
      lastPaidRef.current = null;
    }, 5000);
  }, [queue, onAddSession, onQueueChange]);

  // --- Discard (tecla \) con toast de deshacer ---
  const dismissDiscard = useCallback(() => {
    if (discardTimerRef.current) clearTimeout(discardTimerRef.current);
    setLastDiscarded(null);
    lastDiscardedRef.current = null;
  }, []);

  const undoDiscard = useCallback(() => {
    if (discardTimerRef.current) clearTimeout(discardTimerRef.current);
    const item = lastDiscardedRef.current;
    if (!item) return;
    onQueueChangeRef.current(prev => [item, ...prev]);
    setLastDiscarded(null);
    lastDiscardedRef.current = null;
  }, []);

  const discardFirstInQueue = useCallback(() => {
    const q = queueRef.current;
    if (q.length === 0) return;
    const item = q[0];
    onQueueChangeRef.current(prev => prev.slice(1));
    lastDiscardedRef.current = item;
    setLastDiscarded(item);
    if (discardTimerRef.current) clearTimeout(discardTimerRef.current);
    discardTimerRef.current = setTimeout(() => {
      setLastDiscarded(null);
      lastDiscardedRef.current = null;
    }, 5000);
  }, []);

  const dismissPaid = useCallback(() => {
    if (paidTimerRef.current) clearTimeout(paidTimerRef.current);
    setLastPaid(null);
    lastPaidRef.current = null;
  }, []);

  const undoPaid = useCallback(() => {
    if (paidTimerRef.current) clearTimeout(paidTimerRef.current);
    const entry = lastPaidRef.current;
    if (!entry) return;
    onQueueChangeRef.current(prev => [entry.queueItem, ...prev]);
    onRemoveSessionRef.current?.(entry.sessionId);
    setLastPaid(null);
    lastPaidRef.current = null;
  }, []);

  const discardFirstInQueueRef = useRef(discardFirstInQueue);

  // --- Drag & drop (desktop) ---
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    onQueueChange(prev => {
      const next = [...prev];
      const [removed] = next.splice(dragIndex, 1);
      next.splice(index, 0, removed);
      return next;
    });
    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragIndex, onQueueChange]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  // --- Drag & drop (touch / mobile) ---
  const handleTouchStart = useCallback((e: React.TouchEvent, index: number) => {
    touchDragIndex.current = index;
    setDragIndex(index);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const elements = document.elementsFromPoint(touch.clientX, touch.clientY);
    const target = elements.find(el => el.hasAttribute('data-queue-index'));
    if (target) {
      const idx = parseInt(target.getAttribute('data-queue-index') ?? '-1', 10);
      if (idx >= 0) setDragOverIndex(idx);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (touchDragIndex.current !== null && dragOverIndex !== null && touchDragIndex.current !== dragOverIndex) {
      const from = touchDragIndex.current;
      onQueueChange(prev => {
        const next = [...prev];
        const [removed] = next.splice(from, 1);
        next.splice(dragOverIndex, 0, removed);
        return next;
      });
    }
    touchDragIndex.current = null;
    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragOverIndex, onQueueChange]);

  // Sincronizar refs con estado/callbacks actuales
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { selectedDispatcherRef.current = selectedDispatcher; }, [selectedDispatcher]);
  useEffect(() => { editingQueueIdRef.current = editingQueueId; }, [editingQueueId]);
  useEffect(() => { markAsPaidRef.current = markAsPaid; }, [markAsPaid]);
  useEffect(() => { handleDispatcherChangeRef.current = handleDispatcherChange; }, [handleDispatcherChange]);
  useEffect(() => { onQueueChangeRef.current = onQueueChange; }, [onQueueChange]);
  useEffect(() => { onRemoveSessionRef.current = onRemoveSession; }, [onRemoveSession]);
  useEffect(() => { discardFirstInQueueRef.current = discardFirstInQueue; }, [discardFirstInQueue]);

  // Handler global de teclado — funciona sin importar qué elemento tenga el foco
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tagName = target.tagName;
      // Si el foco está en cualquier input/textarea, el handler del input se encarga
      if (tagName === 'INPUT' || tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const currentIdx = DISPATCHERS.findIndex(d => d.name === selectedDispatcherRef.current);
        const nextIdx = e.key === 'ArrowRight'
          ? (currentIdx + 1) % DISPATCHERS.length
          : (currentIdx - 1 + DISPATCHERS.length) % DISPATCHERS.length;
        handleDispatcherChangeRef.current(DISPATCHERS[nextIdx].name, !!editingQueueIdRef.current);
      } else if (e.key === '/') {
        e.preventDefault();
        const q = queueRef.current;
        if (q.length > 0) markAsPaidRef.current(q[0].id);
      } else if (e.key === '|') {
        e.preventDefault();
        setCurrentEntries(prev => prev.slice(0, -1));
      } else if (e.key === '\\') {
        e.preventDefault();
        discardFirstInQueueRef.current();
      } else if (e.key === "'" || e.key === '"') {
        e.preventDefault();
        setInputCurrency(prev => prev === 'USD' ? 'Bs' : 'USD');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        queueAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        inputAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

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
      <div ref={inputAreaRef} className="flex flex-wrap gap-1.5">
        {DISPATCHERS.map((d) => (
          <button
            key={d.name}
            onClick={() => handleDispatcherChange(d.name, !!editingQueueId)}
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

      {/* Indicador visual de edición de cuenta en cola */}
      {editingQueueId && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="text-xs font-semibold text-amber-700">Editando cuenta en cola</span>
          <button
            onClick={cancelEditingQueue}
            className="text-xs text-amber-500 hover:text-amber-700 font-medium"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Área de entrada */}
      <div className={`rounded-xl p-3 transition-all ${dispatcherInfo?.bg ?? 'bg-ocean-50'} ${editingQueueId ? 'ring-2 ring-amber-300' : ''}`}>
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
              else if (e.key === 'Escape') {
                if (editingQueueId) { cancelEditingQueue(); }
                else { setInputAmount(''); }
              }
              else if (e.key === "'" || e.key === '"') { e.preventDefault(); setInputCurrency(prev => prev === 'USD' ? 'Bs' : 'USD'); }
              else if (e.key === '/') { e.preventDefault(); if (queue.length > 0) markAsPaid(queue[0].id); }
              else if (e.key === '|') { e.preventDefault(); setCurrentEntries(prev => prev.slice(0, -1)); }
              else if (e.key === '\\') { e.preventDefault(); discardFirstInQueue(); }
              // Fix #3: Tab cicla entre despachadores (Shift+Tab hacia atrás)
              else if (e.key === 'Tab') {
                e.preventDefault();
                const currentIdx = DISPATCHERS.findIndex(d => d.name === selectedDispatcher);
                const nextIdx = e.shiftKey
                  ? (currentIdx - 1 + DISPATCHERS.length) % DISPATCHERS.length
                  : (currentIdx + 1) % DISPATCHERS.length;
                handleDispatcherChange(DISPATCHERS[nextIdx].name, !!editingQueueId);
              }
              // Flechas izquierda/derecha ciclan despachadores siempre
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const currentIdx = DISPATCHERS.findIndex(d => d.name === selectedDispatcher);
                const nextIdx = e.key === 'ArrowRight'
                  ? (currentIdx + 1) % DISPATCHERS.length
                  : (currentIdx - 1 + DISPATCHERS.length) % DISPATCHERS.length;
                handleDispatcherChange(DISPATCHERS[nextIdx].name, !!editingQueueId);
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
              <span className={`font-bold ${dispatcherInfo?.text ?? 'text-ocean-400'}`}>
                = {inputCurrency === 'USD' ? formatUSD(previewUSD) : formatBs(previewBs)}
                {' · '}
              </span>
            )}
            <span className={`text-xl font-bold ${dispatcherInfo?.text ?? 'text-ocean-400'}`}>
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
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span
                      className={`text-sm font-semibold font-mono ${dispatcherInfo?.text ?? 'text-ocean-700'} hover:underline cursor-pointer`}
                      onClick={() => startEditingEntry(entry, 'USD')}
                      title="Editar en USD"
                    >
                      {formatUSD(entry.amountUSD)}
                    </span>
                    {entry.expression && (
                      <span className="text-[10px] text-ocean-300">({entry.expression})</span>
                    )}
                    <button
                      type="button"
                      className="text-[11px] text-ocean-400 font-mono hover:underline cursor-pointer ml-auto shrink-0 px-1 py-0.5"
                      onClick={() => startEditingEntry(entry, 'Bs')}
                      title="Editar en Bs"
                    >
                      {formatBs(entry.amountBs)}
                    </button>
                  </div>
                )}
                {editingEntryId !== entry.id && (
                  <button
                    onClick={() => setCurrentEntries(prev => prev.filter(e => e.id !== entry.id))}
                    className="text-ocean-200 hover:text-red-400 transition-colors shrink-0 p-0.5"
                  >
                    <CloseIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Nota - siempre visible */}
        <div className="mt-2">
          <input
            type="text"
            value={noteInput}
            onChange={e => setNoteInput(e.target.value)}
            placeholder="Nota opcional..."
            className="w-full bg-white/70 rounded-lg px-2.5 py-1.5 text-xs border border-ocean-100 focus:border-ocean-300 focus:outline-none text-ocean-600 placeholder-ocean-300"
          />
        </div>

        {/* Total acumulado + botón agregar/actualizar */}
        {currentEntries.length > 0 && (
          <div className="mt-1.5">
            <div className="flex items-center justify-between bg-white/90 rounded-xl px-3 py-2.5 shadow-sm">
              <div>
                <div className={`text-xl font-bold font-mono ${dispatcherInfo?.text ?? 'text-ocean-800'}`}>
                  {formatBs(currentTotal.bs)}
                </div>
                <div className="text-xs text-ocean-400 font-mono">{formatUSD(currentTotal.usd)}</div>
              </div>
              <button
                onClick={addToQueue}
                className={`px-5 py-2.5 rounded-xl text-sm font-bold text-white shadow-sm transition-all active:scale-95 ${
                  editingQueueId
                    ? 'bg-amber-500 hover:bg-amber-400'
                    : 'bg-ocean-600 hover:bg-ocean-500'
                }`}
              >
                {editingQueueId ? 'Actualizar' : 'Agregar a cola'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cola de pendientes */}
      {queue.length > 0 && (
        <div ref={queueAreaRef} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ocean-500 uppercase tracking-wide">
              En cola
            </span>
            <span className="bg-ocean-100 text-ocean-600 text-[10px] font-bold rounded-full px-1.5 py-0.5">
              {queue.length}
            </span>
            <span className="text-[9px] text-ocean-300 ml-1">doble tap para editar · arrastra para reordenar</span>
          </div>
          {queue.map((item, idx) => {
            const disp = DISPATCHERS.find(d => d.name === item.dispatcher);
            const isDragging = dragIndex === idx;
            const isDragOver = dragOverIndex === idx && dragIndex !== idx;
            const isBeingEdited = editingQueueId === item.id;
            return (
              <div
                key={item.id}
                data-queue-index={idx}
                draggable
                onDragStart={e => handleDragStart(e, idx)}
                onDragOver={e => handleDragOver(e, idx)}
                onDrop={e => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
                onTouchStart={e => handleTouchStart(e, idx)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onDoubleClick={() => startEditingQueueItem(item)}
                className={`rounded-xl overflow-hidden select-none cursor-grab active:cursor-grabbing transition-all duration-150 ${
                  displayMode === 'vero' ? `shadow-md ${disp?.bg ?? 'bg-emerald-100'}` : 'border bg-white'
                } ${
                  isBeingEdited
                    ? displayMode === 'vero' ? 'ring-2 ring-amber-300 shadow-amber-200 shadow-md' : 'border-amber-300 ring-2 ring-amber-200 shadow-amber-100 shadow-md'
                    : displayMode === 'vero' ? '' : 'border-ocean-100 shadow-sm'
                } ${isDragging ? 'opacity-40 scale-[0.97] shadow-lg' : ''} ${isDragOver ? displayMode === 'vero' ? 'shadow-lg -translate-y-0.5' : 'border-ocean-400 shadow-md -translate-y-0.5' : ''}`}
              >
                <div className="flex">
                  {/* Strip lateral del color del despachador (solo modo Carlos) */}
                  {displayMode !== 'vero' && (
                    <div className={`w-1.5 shrink-0 ${disp?.strip ?? 'bg-ocean-200'}`} />
                  )}

                  {/* Contenido */}
                  <div className="flex-1 min-w-0">
                    {/* Línea compacta única */}
                    <div className="flex items-center gap-1.5 px-2 py-1 min-h-[42px]">
                      {/* Drag handle */}
                      <span className={`text-xs leading-none cursor-grab select-none shrink-0 ${displayMode === 'vero' ? `${disp?.text ?? 'text-emerald-700'} opacity-40` : 'text-ocean-200'}`} title="Arrastrar">⠿</span>

                      {/* Badge despachador — pill con nombre completo */}
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 flex items-center justify-center rounded-full shrink-0 ${displayMode === 'vero' ? `bg-black/10 ${disp?.text ?? 'text-emerald-700'}` : (disp?.badge ?? 'bg-ocean-100 text-ocean-600')}`}
                      >
                        {item.dispatcher}
                      </span>

                      {isBeingEdited && (
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full shrink-0 ${displayMode === 'vero' ? 'text-amber-700 bg-amber-100' : 'text-amber-600 bg-amber-100'}`}>✎</span>
                      )}

                      {/* Totales */}
                      <div className="flex items-baseline gap-1.5 flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                        {editingQueueTotalId === item.id && editingQueueTotalCurrency === 'Bs' ? (
                          <input
                            autoFocus
                            type="text"
                            inputMode="decimal"
                            value={editingQueueTotalValue}
                            onChange={e => setEditingQueueTotalValue(e.target.value)}
                            onBlur={() => confirmQueueTotalEdit(item.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); confirmQueueTotalEdit(item.id); }
                              if (e.key === 'Escape') { e.preventDefault(); setEditingQueueTotalId(null); }
                            }}
                            className="text-xl font-bold font-mono w-32 border border-ocean-300 rounded-lg px-2 py-0.5 focus:outline-none focus:border-ocean-500 text-ocean-800"
                          />
                        ) : (
                          <span
                            className={`text-xl font-bold font-mono leading-tight cursor-pointer hover:underline shrink-0 ${displayMode === 'vero' ? (disp?.text ?? 'text-emerald-700') : (disp?.text ?? 'text-ocean-800')}`}
                            onClick={() => startEditingQueueTotal(item, 'Bs')}
                            title="Editar total en Bs"
                          >
                            {formatBs(item.totalBs)}
                          </span>
                        )}
                        {editingQueueTotalId === item.id && editingQueueTotalCurrency === 'USD' ? (
                          <input
                            autoFocus
                            type="text"
                            inputMode="decimal"
                            value={editingQueueTotalValue}
                            onChange={e => setEditingQueueTotalValue(e.target.value)}
                            onBlur={() => confirmQueueTotalEdit(item.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); confirmQueueTotalEdit(item.id); }
                              if (e.key === 'Escape') { e.preventDefault(); setEditingQueueTotalId(null); }
                            }}
                            className="text-xs font-mono w-24 border border-ocean-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-ocean-500 text-ocean-600"
                          />
                        ) : (
                          <span
                            className={`text-xs font-bold font-mono cursor-pointer hover:underline shrink-0 ${displayMode === 'vero' ? `${disp?.text ?? 'text-emerald-700'} opacity-70` : (disp?.text ?? 'text-ocean-800')}`}
                            onClick={() => startEditingQueueTotal(item, 'USD')}
                            title="Editar total en USD"
                          >
                            {formatUSD(item.totalUSD)}
                          </span>
                        )}
                      </div>

                      {/* Nota inline — texto o input según estado */}
                      {editingQueueNoteId === item.id ? (
                        <div className="flex items-center gap-1 shrink min-w-0" onClick={e => e.stopPropagation()}>
                          <input
                            autoFocus
                            type="text"
                            value={editingQueueNoteValue}
                            onChange={e => setEditingQueueNoteValue(e.target.value)}
                            onBlur={() => confirmQueueNoteEdit(item.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); confirmQueueNoteEdit(item.id); }
                              if (e.key === 'Escape') { e.preventDefault(); setEditingQueueNoteId(null); }
                            }}
                            placeholder="Nota..."
                            className="text-[11px] bg-white border border-ocean-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-ocean-400 text-ocean-700 w-24"
                          />
                        </div>
                      ) : item.note ? (
                        <span
                          className={`shrink min-w-0 text-[11px] italic truncate cursor-pointer text-right ${displayMode === 'vero' ? `${disp?.text ?? 'text-emerald-700'} opacity-70` : 'text-ocean-400'}`}
                          onClick={e => { e.stopPropagation(); startEditingQueueNote(item); }}
                          title={item.note}
                        >
                          {item.note}
                        </span>
                      ) : null}

                      {/* Ya pasé */}
                      {(() => {
                        const btnColor = DISP_HEX[item.dispatcher] ?? '#10b981';
                        return (
                          <button
                            onClick={e => { e.stopPropagation(); markAsPaid(item.id); }}
                            className={`flex-shrink-0 px-2 py-0.5 text-white text-xs font-bold rounded-lg shadow transition-all active:scale-95 ${displayMode === 'vero' ? (disp?.strip ?? 'bg-emerald-400') : ''}`}
                            style={displayMode !== 'vero' ? { backgroundColor: btnColor } : undefined}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(0.88)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.filter = ''; }}
                            onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(0.75)'; }}
                            onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.filter = ''; }}
                          >
                            Ya pasé ✓
                          </button>
                        );
                      })()}

                      {/* Trash */}
                      <button
                        onClick={e => { e.stopPropagation(); onQueueChange(prev => prev.filter(q => q.id !== item.id)); }}
                        className={`transition-colors p-0.5 shrink-0 ${displayMode === 'vero' ? `${disp?.text ?? 'text-emerald-700'} opacity-40 hover:opacity-90` : 'text-ocean-300 hover:text-red-400'}`}
                        title="Eliminar"
                      >
                        <TrashIcon className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Chips de montos — solo visibles al editar (doble tap) */}
                    {isBeingEdited && item.entries.length > 0 && (
                      <div
                        className={`px-2 pb-2 flex flex-wrap gap-1 border-t ${displayMode === 'vero' ? 'border-black/10' : 'border-amber-100'}`}
                        onClick={e => e.stopPropagation()}
                        onDoubleClick={e => e.stopPropagation()}
                        onTouchStart={e => e.stopPropagation()}
                        onTouchMove={e => e.stopPropagation()}
                        onTouchEnd={e => e.stopPropagation()}
                      >
                        {item.entries.map(e => {
                          const liveEntry = currentEntries.find(ce => ce.id === e.id) ?? e;
                          return editingEntryId === liveEntry.id ? (
                            <input
                              key={e.id}
                              autoFocus
                              type="text"
                              inputMode="decimal"
                              value={editingValue}
                              onChange={ev => setEditingValue(ev.target.value)}
                              onBlur={() => confirmEditEntry(liveEntry.id)}
                              onKeyDown={ev => {
                                if (ev.key === 'Enter') { ev.preventDefault(); confirmEditEntry(liveEntry.id); }
                                if (ev.key === 'Escape') { ev.preventDefault(); setEditingEntryId(null); }
                              }}
                              className="text-[10px] font-mono w-24 border border-ocean-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-ocean-500"
                            />
                          ) : (
                            <div
                              key={e.id}
                              className={`flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-md ${displayMode === 'vero' ? `bg-black/10 ${disp?.text ?? 'text-emerald-700'}` : `${disp?.bg ?? 'bg-ocean-50'} ${disp?.text ?? 'text-ocean-600'}`}`}
                            >
                              <span
                                className="cursor-pointer hover:underline"
                                onClick={() => startEditingEntry(liveEntry, 'USD')}
                                title="Editar en USD"
                              >
                                {formatUSD(liveEntry.amountUSD)}
                              </span>
                              <span className="opacity-40">·</span>
                              <span
                                className="cursor-pointer hover:underline"
                                onClick={() => startEditingEntry(liveEntry, 'Bs')}
                                title="Editar en Bs"
                              >
                                {formatBs(liveEntry.amountBs)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
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
          <div className="text-xs mt-1 text-ocean-200">Enter o espacio para agregar · Tab o ← → para cambiar · ' para USD/Bs · / para Ya pasé</div>
        </div>
      )}

      {/* Toast de cuenta pagada */}
      {lastPaid && (() => {
        const disp = DISPATCHERS.find(d => d.name === lastPaid.queueItem.dispatcher);
        return (
          <div className={`fixed bottom-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-3 animate-slide-up ${disp?.bg ?? 'bg-ocean-100'} ${disp?.text ?? 'text-ocean-800'}`}>
            <span className="text-sm font-medium">Cuenta de {lastPaid.queueItem.dispatcher} pagada</span>
            <button
              onClick={undoPaid}
              className="flex items-center gap-1 text-sm font-bold underline underline-offset-2 hover:opacity-70 transition-opacity"
            >
              Deshacer
            </button>
            <button
              onClick={dismissPaid}
              className="opacity-50 hover:opacity-100 transition-opacity ml-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })()}

      {/* Toast de cuenta descartada */}
      {lastDiscarded && (() => {
        const disp = DISPATCHERS.find(d => d.name === lastDiscarded.dispatcher);
        return (
          <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-3 animate-slide-up ${disp?.bg ?? 'bg-ocean-100'} ${disp?.text ?? 'text-ocean-800'}`}>
            <span className="text-sm font-medium">Cuenta de {lastDiscarded.dispatcher} descartada</span>
            <button
              onClick={undoDiscard}
              className="flex items-center gap-1 text-sm font-bold underline underline-offset-2 hover:opacity-70 transition-opacity"
            >
              Deshacer
            </button>
            <button
              onClick={dismissDiscard}
              className="opacity-50 hover:opacity-100 transition-opacity ml-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })()}
    </div>
  );
}
