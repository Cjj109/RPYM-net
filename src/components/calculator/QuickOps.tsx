import { useState, useRef, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react';
import { evalMathExpr } from '../../lib/safe-math';
import { formatUSD, formatBs } from '../../lib/format';
import { DISPATCHERS } from './constants';
import type { QuickOpEntry, QuickQueueItem, SavedSession } from './types';
import { PlusIcon, CloseIcon, TrashIcon, PencilIcon, ChatBubbleIcon } from './icons';

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

  const inputRef = useRef<HTMLInputElement>(null);

  const dispatcherInfo = DISPATCHERS.find(d => d.name === selectedDispatcher);

  const currentTotal = currentEntries.reduce(
    (sum, e) => ({ usd: sum.usd + e.amountUSD, bs: sum.bs + e.amountBs }),
    { usd: 0, bs: 0 }
  );

  const handleDispatcherChange = useCallback((name: string, isEditing = false) => {
    setSelectedDispatcher(name);
    if (!isEditing) {
      setCurrentEntries([]);
      setInputAmount('');
    }
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
    setEditingValue(forCurrency === 'USD' ? String(Math.round(entry.amountUSD * 100) / 100) : entry.amountInput);
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
        <div className="space-y-1.5">
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
                className={`rounded-xl border overflow-hidden bg-white select-none cursor-grab active:cursor-grabbing transition-all duration-150 ${
                  isBeingEdited
                    ? 'border-amber-300 ring-2 ring-amber-200 shadow-amber-100 shadow-md'
                    : 'border-ocean-100 shadow-sm'
                } ${isDragging ? 'opacity-40 scale-[0.97] shadow-lg' : ''} ${isDragOver ? 'border-ocean-400 shadow-md -translate-y-0.5' : ''}`}
              >
                {/* Encabezado del item */}
                <div className={`flex items-center gap-1.5 px-2 py-1 ${disp?.bg ?? 'bg-ocean-50'}`}>
                  <span className="text-ocean-300 text-sm leading-none cursor-grab select-none" title="Arrastrar para reordenar">⠿</span>
                  <span className="text-[10px] font-bold text-ocean-400 font-mono">#{idx + 1}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${disp?.badge ?? 'bg-ocean-100 text-ocean-600'}`}>
                    {item.dispatcher}
                  </span>
                  {isBeingEdited && (
                    <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">editando</span>
                  )}
                  <span className="text-[9px] text-ocean-400 ml-auto">
                    {formatTimeAgo(item.timestamp)}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); onQueueChange(prev => prev.filter(q => q.id !== item.id)); }}
                    className="text-ocean-300 hover:text-red-400 transition-colors p-0.5"
                    title="Eliminar de la cola"
                  >
                    <TrashIcon className="w-3 h-3" />
                  </button>
                </div>

                {/* Montos + nota + total + botón Ya pasé */}
                <div className="px-2 py-1">
                  <div className="flex flex-wrap gap-0.5 mb-0.5">
                    {item.entries.map(e => (
                      <span
                        key={e.id}
                        className={`text-[10px] font-mono px-1 py-0.5 rounded-md ${disp?.bg ?? 'bg-ocean-50'} ${disp?.text ?? 'text-ocean-600'}`}
                      >
                        {formatUSD(e.amountUSD)}
                      </span>
                    ))}
                  </div>

                  {/* Nota inline editable */}
                  {editingQueueNoteId === item.id ? (
                    <div className="mb-1.5 flex items-center gap-1" onClick={e => e.stopPropagation()}>
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
                        placeholder="Agregar nota..."
                        className="flex-1 text-[11px] bg-white border border-ocean-200 rounded px-2 py-0.5 focus:outline-none focus:border-ocean-400 text-ocean-700"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 mb-0.5">
                      {item.note && (
                        <span className="text-[10px] text-ocean-400 italic truncate flex-1">{item.note}</span>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); startEditingQueueNote(item); }}
                        className={`text-ocean-300 hover:text-ocean-500 transition-colors p-0.5 ${item.note ? '' : 'ml-auto'}`}
                        title={item.note ? 'Editar nota' : 'Agregar nota'}
                      >
                        <ChatBubbleIcon className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <div onClick={e => e.stopPropagation()}>
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
                          className="text-2xl font-bold font-mono w-36 border border-ocean-300 rounded-lg px-2 py-0.5 focus:outline-none focus:border-ocean-500 text-ocean-800"
                        />
                      ) : (
                        <div
                          className={`text-2xl font-bold font-mono leading-tight cursor-pointer hover:underline ${disp?.text ?? 'text-ocean-800'}`}
                          onClick={() => startEditingQueueTotal(item, 'Bs')}
                          title="Editar total en Bs"
                        >
                          {formatBs(item.totalBs)}
                        </div>
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
                          className="text-xs font-mono w-28 border border-ocean-300 rounded px-2 py-0.5 focus:outline-none focus:border-ocean-500 text-ocean-600"
                        />
                      ) : (
                        <div
                          className="text-xs text-ocean-400 font-mono cursor-pointer hover:underline"
                          onClick={() => startEditingQueueTotal(item, 'USD')}
                          title="Editar total en USD"
                        >
                          {formatUSD(item.totalUSD)}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); markAsPaid(item.id); }}
                      className="flex-shrink-0 px-3 py-1 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow transition-all active:scale-95"
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
          <div className="text-xs mt-1 text-ocean-200">Enter o espacio para agregar · Tab o ← → para cambiar · ' para USD/Bs · / para Ya pasé</div>
        </div>
      )}
    </div>
  );
}
