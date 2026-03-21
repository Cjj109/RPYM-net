import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { evalMathExpr } from '../lib/safe-math';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { migrateToDispatchers } from './calculator/migration';
import type { DispatcherTab, SubClient, CalcEntry, SavedSession, UndoAction, RateConfig, ClientTotals, QuickQueueItem } from './calculator/types';
import { LS_KEYS, DEFAULT_SUBCLIENT_NAME, DEFAULT_SUBCLIENT_COUNT, DISPATCHERS } from './calculator/constants';
import { ClockIcon, GearIcon, QueueIcon } from './calculator/icons';
import { CalcInput } from './calculator/CalcInput';
import { ClientTabs } from './calculator/ClientTabs';
import { SubClientCards } from './calculator/SubClientCards';
import { EntryList } from './calculator/EntryList';
import { HistoryPanel } from './calculator/HistoryPanel';
import { QueuePanel } from './calculator/QueuePanel';
import { RateSettings } from './calculator/RateSettings';
import { ClientHeader } from './calculator/ClientHeader';
import { KeyboardHelp } from './calculator/KeyboardHelp';
import { UndoToast } from './calculator/UndoToast';
import { QuickOps } from './calculator/QuickOps';

interface AdminCalculatorProps {
  bcvRate?: { rate: number; date: string; source: string };
}

function makeDefaultSubClients(): SubClient[] {
  return Array.from({ length: DEFAULT_SUBCLIENT_COUNT }, (_, i) => ({
    id: crypto.randomUUID(),
    name: DEFAULT_SUBCLIENT_NAME(i),
    entries: [],
  }));
}

function makeDefaultDispatchers(): DispatcherTab[] {
  return DISPATCHERS.map(d => ({
    id: crypto.randomUUID(),
    dispatcher: d.name,
    clients: makeDefaultSubClients(),
  }));
}

export default function AdminCalculator({ bcvRate: initialBcv }: AdminCalculatorProps) {
  // Migración de formato viejo (una sola vez)
  const migrated = useRef(false);
  if (!migrated.current) {
    migrateToDispatchers();
    migrated.current = true;
  }

  // === Estado persistido ===
  const [dispatchers, setDispatchers] = useLocalStorage<DispatcherTab[]>(LS_KEYS.DISPATCHERS, makeDefaultDispatchers);
  const [activeDispatcherId, setActiveDispatcherId] = useLocalStorage<string>(LS_KEYS.ACTIVE_DISPATCHER, () => dispatchers[0]?.id ?? '');
  const [activeClientMap, setActiveClientMap] = useLocalStorage<Record<string, string>>(LS_KEYS.ACTIVE_SUBCLIENT_MAP, () => {
    const map: Record<string, string> = {};
    for (const d of dispatchers) {
      map[d.id] = d.clients[0]?.id ?? '';
    }
    return map;
  });
  const [sessions, setSessions] = useLocalStorage<SavedSession[]>(LS_KEYS.SESSIONS, []);
  const [quickQueue, setQuickQueue] = useLocalStorage<QuickQueueItem[]>(LS_KEYS.QUICK_QUEUE, []);
  const [rateConfig, setRateConfig] = useLocalStorage<RateConfig>(LS_KEYS.RATE_CONFIG, { useManualRate: false, manualRate: '' });

  // === Estado no persistido ===
  const [autoRate, setAutoRate] = useState(initialBcv?.rate ?? 0);
  const [rateLoading, setRateLoading] = useState(!initialBcv);
  const [inputAmount, setInputAmount] = useState('');
  const [inputCurrency, setInputCurrency] = useState<'USD' | 'Bs'>('USD');
  const [description, setDescription] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [activeTab, setActiveTab] = useState<'calculator' | 'quickops'>('calculator');
  const [showQueue, setShowQueue] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [navLevel, setNavLevel] = useState<'input' | 'dispatcher' | 'subclient'>('input');
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearAllRef = useRef<() => void>(() => {});
  const amountRef = useRef<HTMLInputElement>(null);

  // === Derivados ===
  const activeDispatcher = dispatchers.find(d => d.id === activeDispatcherId) ?? dispatchers[0];
  const dispatcherInfo = activeDispatcher ? DISPATCHERS.find(d => d.name === activeDispatcher.dispatcher) : undefined;
  const activeClientId = activeClientMap[activeDispatcherId] ?? activeDispatcher?.clients[0]?.id ?? '';
  const activeClient = activeDispatcher?.clients.find(c => c.id === activeClientId)
    ?? activeDispatcher?.clients[0];

  const setActiveClientId = useCallback((clientId: string) => {
    setActiveClientMap(prev => ({ ...prev, [activeDispatcherId]: clientId }));
  }, [activeDispatcherId, setActiveClientMap]);
  const activeRate = rateConfig.useManualRate && rateConfig.manualRate
    ? parseFloat(rateConfig.manualRate) : autoRate;
  const entries = activeClient?.entries ?? [];

  // === Totales memoizados por sub-cliente del dispatcher activo ===
  const subClientTotals = useMemo(() => {
    const totals = new Map<string, ClientTotals>();
    if (!activeDispatcher) return totals;
    for (const client of activeDispatcher.clients) {
      const usd = client.entries.reduce((sum, e) => sum + (e.isNegative ? -e.amountUSD : e.amountUSD), 0);
      const bs = client.entries.reduce((sum, e) => sum + (e.isNegative ? -e.amountBs : e.amountBs), 0);
      totals.set(client.id, { usd, bs });
    }
    return totals;
  }, [activeDispatcher]);

  const currentTotals = subClientTotals.get(activeClient?.id ?? '') ?? { usd: 0, bs: 0 };

  // === Helpers de mutación ===
  const updateSubClientEntries = useCallback((dispatcherId: string, clientId: string, updater: (entries: CalcEntry[]) => CalcEntry[]) => {
    setDispatchers(prev => prev.map(d =>
      d.id === dispatcherId
        ? { ...d, clients: d.clients.map(c => c.id === clientId ? { ...c, entries: updater(c.entries) } : c) }
        : d
    ));
  }, [setDispatchers]);

  const updateSubClient = useCallback((dispatcherId: string, clientId: string, updater: (c: SubClient) => SubClient) => {
    setDispatchers(prev => prev.map(d =>
      d.id === dispatcherId
        ? { ...d, clients: d.clients.map(c => c.id === clientId ? updater(c) : c) }
        : d
    ));
  }, [setDispatchers]);

  // === Undo ===
  const scheduleUndoDismiss = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoAction(null), 5000);
  }, []);

  const executeUndo = useCallback(() => {
    if (!undoAction) return;
    switch (undoAction.type) {
      case 'delete_entry':
        updateSubClientEntries(undoAction.dispatcherId, undoAction.clientId, entries => {
          const copy = [...entries];
          copy.splice(undoAction.index, 0, undoAction.entry);
          return copy;
        });
        break;
      case 'clear_all':
        updateSubClient(undoAction.dispatcherId, undoAction.clientId, c => ({
          ...c,
          name: undoAction.clientName,
          entries: undoAction.entries,
        }));
        if (undoAction.sessionId) {
          setSessions(prev => prev.filter(s => s.id !== undoAction.sessionId));
        }
        break;
    }
    setUndoAction(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, [undoAction, updateSubClient, updateSubClientEntries, setSessions]);

  useEffect(() => {
    return () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); };
  }, []);

  // === Acciones ===
  const addEntry = useCallback(() => {
    const parsed = evalMathExpr(inputAmount);
    if (parsed === 0 || !activeRate || !activeDispatcher || !activeClient) return;

    let usd: number, bs: number;
    if (inputCurrency === 'USD') {
      usd = parsed; bs = parsed * activeRate;
    } else {
      bs = parsed; usd = parsed / activeRate;
    }

    const hasExpression = /[+\-*/]/.test(inputAmount.replace(/^-/, ''));
    const entry: CalcEntry = {
      id: crypto.randomUUID(),
      description: description.trim(),
      amountUSD: usd,
      amountBs: bs,
      isNegative: false,
      expression: hasExpression ? inputAmount.trim() : undefined,
    };
    updateSubClientEntries(activeDispatcher.id, activeClient.id, prev => [...prev, entry]);
    setInputAmount('');
    setDescription('');
  }, [inputAmount, inputCurrency, activeRate, activeDispatcher, activeClient, description, updateSubClientEntries]);

  const removeEntry = useCallback((entryId: string) => {
    if (!activeDispatcher || !activeClient) return;
    const idx = activeClient.entries.findIndex(e => e.id === entryId);
    const entry = activeClient.entries[idx];
    if (!entry) return;

    setUndoAction({ type: 'delete_entry', dispatcherId: activeDispatcher.id, clientId: activeClient.id, entry, index: idx });
    scheduleUndoDismiss();
    updateSubClientEntries(activeDispatcher.id, activeClient.id, prev => prev.filter(e => e.id !== entryId));
  }, [activeDispatcher, activeClient, updateSubClientEntries, scheduleUndoDismiss]);

  const updateEntryDescription = useCallback((entryId: string, description: string) => {
    if (!activeDispatcher || !activeClient) return;
    updateSubClientEntries(activeDispatcher.id, activeClient.id, prev =>
      prev.map(e => e.id === entryId ? { ...e, description } : e)
    );
  }, [activeDispatcher, activeClient, updateSubClientEntries]);

  const updateEntryAmount = useCallback((entryId: string, newUSD: number) => {
    if (newUSD <= 0 || !activeRate || !activeDispatcher || !activeClient) return;
    updateSubClientEntries(activeDispatcher.id, activeClient.id, prev =>
      prev.map(e => e.id === entryId ? { ...e, amountUSD: newUSD, amountBs: newUSD * activeRate } : e)
    );
  }, [activeDispatcher, activeClient, activeRate, updateSubClientEntries]);

  const adjustTotal = useCallback((newTotalUSD: number) => {
    if (!activeRate || !activeDispatcher || !activeClient) return;
    const diff = newTotalUSD - currentTotals.usd;
    if (Math.abs(diff) < 0.001) return;
    const entry: CalcEntry = {
      id: crypto.randomUUID(),
      description: 'Ajuste',
      amountUSD: Math.abs(diff),
      amountBs: Math.abs(diff) * activeRate,
      isNegative: diff < 0,
    };
    updateSubClientEntries(activeDispatcher.id, activeClient.id, prev => [...prev, entry]);
  }, [activeDispatcher, activeClient, activeRate, currentTotals.usd, updateSubClientEntries]);

  const clearAll = useCallback(() => {
    if (!activeDispatcher || !activeClient) return;
    const clientEntries = activeClient.entries;
    let sessionId: string | undefined;

    if (clientEntries.length > 0) {
      sessionId = crypto.randomUUID();
      const session: SavedSession = {
        id: sessionId,
        clientName: activeClient.name,
        dispatcher: activeDispatcher.dispatcher,
        entries: [...clientEntries],
        totalUSD: currentTotals.usd,
        totalBs: currentTotals.bs,
        rate: activeRate,
        timestamp: Date.now(),
      };
      setSessions(prev => [session, ...prev].slice(0, 100));
    }

    setUndoAction({
      type: 'clear_all',
      dispatcherId: activeDispatcher.id,
      clientId: activeClient.id,
      entries: [...clientEntries],
      clientName: activeClient.name,
      sessionId,
    });
    scheduleUndoDismiss();

    const idx = activeDispatcher.clients.indexOf(activeClient);
    updateSubClient(activeDispatcher.id, activeClient.id, c => ({
      ...c,
      name: DEFAULT_SUBCLIENT_NAME(idx >= 0 ? idx : 0),
      entries: [],
    }));
    setInputAmount('');
    setDescription('');
  }, [activeDispatcher, activeClient, currentTotals, activeRate, setSessions, updateSubClient, scheduleUndoDismiss]);

  clearAllRef.current = clearAll;

  // === Gestión de sub-clientes ===
  const renameSubClient = useCallback((name: string) => {
    if (!activeDispatcher || !activeClient) return;
    updateSubClient(activeDispatcher.id, activeClient.id, c => ({ ...c, name }));
  }, [activeDispatcher, activeClient, updateSubClient]);

  const addSubClient = useCallback(() => {
    if (!activeDispatcher) return;
    const newClient: SubClient = {
      id: crypto.randomUUID(),
      name: DEFAULT_SUBCLIENT_NAME(activeDispatcher.clients.length),
      entries: [],
    };
    setDispatchers(prev => prev.map(d =>
      d.id === activeDispatcher.id
        ? { ...d, clients: [...d.clients, newClient] }
        : d
    ));
    setActiveClientId(newClient.id);
  }, [activeDispatcher, setDispatchers, setActiveClientId]);

  const removeSubClient = useCallback(() => {
    if (!activeDispatcher || !activeClient || activeDispatcher.clients.length <= 1) return;
    const idx = activeDispatcher.clients.indexOf(activeClient);
    const remaining = activeDispatcher.clients.filter(c => c.id !== activeClient.id);
    setDispatchers(prev => prev.map(d =>
      d.id === activeDispatcher.id
        ? { ...d, clients: remaining }
        : d
    ));
    const newIdx = idx > 0 ? idx - 1 : 0;
    setActiveClientId(remaining[newIdx]?.id ?? remaining[0]?.id ?? '');
  }, [activeDispatcher, activeClient, setDispatchers, setActiveClientId]);

  // === Efectos ===
  // Fetch tasa BCV al montar
  useEffect(() => {
    if (initialBcv?.rate) {
      setAutoRate(initialBcv.rate);
      setRateLoading(false);
      return;
    }
    fetch('/api/config/bcv-rate')
      .then(r => r.json())
      .then(data => { if (data.rate) setAutoRate(data.rate); })
      .catch(() => {})
      .finally(() => setRateLoading(false));
  }, [initialBcv]);

  // Foco al cambiar de sub-cliente
  useEffect(() => {
    amountRef.current?.focus();
  }, [activeClientId]);

  // Asegurar que el mapa tenga entrada para cada dispatcher
  useEffect(() => {
    let needsUpdate = false;
    const updated = { ...activeClientMap };
    for (const d of dispatchers) {
      if (!updated[d.id] || !d.clients.some(c => c.id === updated[d.id])) {
        updated[d.id] = d.clients[0]?.id ?? '';
        needsUpdate = true;
      }
    }
    if (needsUpdate) setActiveClientMap(updated);
  }, [dispatchers, activeClientMap, setActiveClientMap]);

  // Navegación global con teclado (3 niveles: input → dispatcher → subclient)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' && target !== amountRef.current) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (navLevel === 'input') {
          setNavLevel('dispatcher');
          amountRef.current?.blur();
        } else if (navLevel === 'dispatcher') {
          setNavLevel('subclient');
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (navLevel === 'subclient') {
          setNavLevel('dispatcher');
        } else {
          setNavLevel('input');
          amountRef.current?.focus();
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (navLevel === 'dispatcher') {
          const idx = dispatchers.findIndex(d => d.id === activeDispatcherId);
          const newIdx = (idx - 1 + dispatchers.length) % dispatchers.length;
          setActiveDispatcherId(dispatchers[newIdx].id);
        } else if (navLevel === 'subclient' && activeDispatcher) {
          const clients = activeDispatcher.clients;
          const idx = clients.findIndex(c => c.id === activeClientId);
          const newIdx = (idx - 1 + clients.length) % clients.length;
          setActiveClientId(clients[newIdx].id);
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (navLevel === 'dispatcher') {
          const idx = dispatchers.findIndex(d => d.id === activeDispatcherId);
          const newIdx = (idx + 1) % dispatchers.length;
          setActiveDispatcherId(dispatchers[newIdx].id);
        } else if (navLevel === 'subclient' && activeDispatcher) {
          const clients = activeDispatcher.clients;
          const idx = clients.findIndex(c => c.id === activeClientId);
          const newIdx = (idx + 1) % clients.length;
          setActiveClientId(clients[newIdx].id);
        }
      } else if (e.key === '\\') {
        e.preventDefault();
        clearAllRef.current();
      } else if (e.key === "'" || e.key === '"') {
        e.preventDefault();
        setInputCurrency(prev => prev === 'USD' ? 'Bs' : 'USD');
        amountRef.current?.focus();
        setNavLevel('input');
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [dispatchers, activeDispatcherId, activeDispatcher, activeClientId, navLevel, setActiveDispatcherId, setActiveClientId]);

  // === Render ===
  return (
    <div className="p-2 sm:p-4 space-y-2 sm:space-y-3">
      <div>
        {/* Tasa actual + toggles */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-ocean-400">Tasa:</span>
            <span className="text-sm font-bold text-ocean-700 font-mono">
              {rateLoading ? '...' : `Bs. ${activeRate.toFixed(2)}`}
            </span>
            {rateConfig.useManualRate && (
              <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">Manual</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeTab === 'calculator' && <KeyboardHelp />}
            {activeTab === 'calculator' && (() => {
              const todayStr = new Date().toDateString();
              const todayCount = sessions.filter(s => new Date(s.timestamp).toDateString() === todayStr).length;
              return todayCount > 0 ? (
                <button
                  onClick={() => { setShowQueue(prev => !prev); setShowHistory(false); }}
                  className={`relative p-1.5 rounded-lg transition-colors ${showQueue ? 'bg-ocean-100 text-ocean-700' : 'text-ocean-400 hover:text-ocean-600 hover:bg-ocean-50'}`}
                  title="Cola"
                >
                  <QueueIcon />
                  <span className="absolute -top-1 -right-1 bg-ocean-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {todayCount}
                  </span>
                </button>
              ) : null;
            })()}
            {activeTab === 'calculator' && sessions.length > 0 && (
              <button
                onClick={() => { setShowHistory(prev => !prev); setShowQueue(false); }}
                className={`p-1.5 rounded-lg transition-colors ${showHistory ? 'bg-ocean-100 text-ocean-700' : 'text-ocean-400 hover:text-ocean-600 hover:bg-ocean-50'}`}
                title="Historial"
              >
                <ClockIcon />
              </button>
            )}
            <button
              onClick={() => setShowSettings(prev => !prev)}
              className={`p-1.5 rounded-lg transition-colors ${showSettings ? 'bg-ocean-100 text-ocean-700' : 'text-ocean-400 hover:text-ocean-600 hover:bg-ocean-50'}`}
              title="Configurar tasa"
            >
              <GearIcon />
            </button>
          </div>
        </div>

        {/* Pestañas: Calculadora / Rápido */}
        <div className="flex gap-1 bg-ocean-50 rounded-xl p-1 mb-2">
          <button
            onClick={() => setActiveTab('calculator')}
            className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'calculator'
                ? 'bg-white text-ocean-700 shadow-sm'
                : 'text-ocean-400 hover:text-ocean-600'
            }`}
          >
            Calculadora
          </button>
          <button
            onClick={() => setActiveTab('quickops')}
            className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-all relative ${
              activeTab === 'quickops'
                ? 'bg-white text-ocean-700 shadow-sm'
                : 'text-ocean-400 hover:text-ocean-600'
            }`}
          >
            ⚡ Rápido
            {quickQueue.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-emerald-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {quickQueue.length}
              </span>
            )}
          </button>
        </div>

        {showSettings && (
          <RateSettings
            autoRate={autoRate}
            rateConfig={rateConfig}
            onRateConfigChange={setRateConfig}
          />
        )}

        {activeTab === 'calculator' && (
          <>
            {showQueue && (
              <QueuePanel
                sessions={sessions}
                onRemoveSession={(id) => setSessions(prev => prev.filter(s => s.id !== id))}
              />
            )}

            {showHistory && sessions.length > 0 && (
              <HistoryPanel
                sessions={sessions}
                onRemoveSession={(id) => setSessions(prev => prev.filter(s => s.id !== id))}
                onClearHistory={() => setSessions([])}
              />
            )}

            <CalcInput
              inputAmount={inputAmount}
              inputCurrency={inputCurrency}
              description={description}
              activeRate={activeRate}
              dispatcherBg={dispatcherInfo?.bg}
              dispatcherText={dispatcherInfo?.text}
              onInputAmountChange={setInputAmount}
              onCurrencyToggle={() => setInputCurrency(prev => prev === 'USD' ? 'Bs' : 'USD')}
              onDescriptionChange={setDescription}
              onAddEntry={addEntry}
              amountRef={amountRef}
            />

            {/* Tabs de repartidores */}
            <ClientTabs
              dispatchers={dispatchers}
              activeDispatcherId={activeDispatcherId}
              activeClientMap={activeClientMap}
              navFocused={navLevel === 'dispatcher'}
              onSelectDispatcher={(id) => { setActiveDispatcherId(id); setNavLevel('dispatcher'); }}
            />

            {/* Cards de sub-clientes */}
            {activeDispatcher && (
              <SubClientCards
                clients={activeDispatcher.clients}
                activeClientId={activeClientId}
                subClientTotals={subClientTotals}
                dispatcher={activeDispatcher.dispatcher}
                navFocused={navLevel === 'subclient'}
                onSelectClient={(id) => { setActiveClientId(id); setNavLevel('subclient'); }}
                onRenameClient={renameSubClient}
                onAddClient={addSubClient}
                onRemoveClient={removeSubClient}
                clientCount={activeDispatcher.clients.length}
              />
            )}

            {/* Total del sub-cliente + acciones */}
            {activeDispatcher && activeClient && (
              <ClientHeader
                dispatcher={activeDispatcher}
                client={activeClient}
                totalUSD={currentTotals.usd}
                totalBs={currentTotals.bs}
                activeRate={activeRate}
                onClearAll={clearAll}
                onAdjustTotal={adjustTotal}
                amountRef={amountRef}
              />
            )}
          </>
        )}

        {activeTab === 'quickops' && (
          <QuickOps
            activeRate={activeRate}
            queue={quickQueue}
            onQueueChange={setQuickQueue}
            onAddSession={(session) => setSessions(prev => [session, ...prev].slice(0, 100))}
          />
        )}
      </div>

      {activeTab === 'calculator' && (
        <EntryList
          entries={entries}
          onRemoveEntry={removeEntry}
          onUpdateAmount={updateEntryAmount}
          onUpdateDescription={updateEntryDescription}
        />
      )}

      {undoAction && (
        <UndoToast
          action={undoAction}
          onUndo={executeUndo}
          onDismiss={() => setUndoAction(null)}
        />
      )}
    </div>
  );
}
