import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { evalMathExpr } from '../lib/safe-math';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { migrateIfNeeded } from './calculator/migration';
import type { ClientData, CalcEntry, SavedSession, UndoAction, RateConfig, ClientTotals } from './calculator/types';
import { LS_KEYS, DEFAULT_CLIENT_NAME, DEFAULT_CLIENTS_COUNT } from './calculator/constants';
import { ClockIcon, GearIcon } from './calculator/icons';
import { CalcInput } from './calculator/CalcInput';
import { ClientTabs } from './calculator/ClientTabs';
import { EntryList } from './calculator/EntryList';
import { HistoryPanel } from './calculator/HistoryPanel';
import { RateSettings } from './calculator/RateSettings';
import { ClientHeader } from './calculator/ClientHeader';

import { KeyboardHelp } from './calculator/KeyboardHelp';
import { UndoToast } from './calculator/UndoToast';

interface AdminCalculatorProps {
  bcvRate?: { rate: number; date: string; source: string };
}

function makeDefaultClients(): ClientData[] {
  return Array.from({ length: DEFAULT_CLIENTS_COUNT }, (_, i) => ({
    id: crypto.randomUUID(),
    name: DEFAULT_CLIENT_NAME(i),
    entries: [],
  }));
}

export default function AdminCalculator({ bcvRate: initialBcv }: AdminCalculatorProps) {
  // Migración de formato viejo (una sola vez)
  const migrated = useRef(false);
  if (!migrated.current) {
    migrateIfNeeded();
    migrated.current = true;
  }

  // === Estado persistido ===
  const [clients, setClients] = useLocalStorage<ClientData[]>(LS_KEYS.CLIENTS, makeDefaultClients);
  const [activeClientId, setActiveClientId] = useLocalStorage<string>(LS_KEYS.ACTIVE_CLIENT, () => clients[0]?.id ?? '');
  const [sessions, setSessions] = useLocalStorage<SavedSession[]>(LS_KEYS.SESSIONS, []);
  const [rateConfig, setRateConfig] = useLocalStorage<RateConfig>(LS_KEYS.RATE_CONFIG, { useManualRate: false, manualRate: '' });

  // === Estado no persistido ===
  const [autoRate, setAutoRate] = useState(initialBcv?.rate ?? 0);
  const [rateLoading, setRateLoading] = useState(!initialBcv);
  const [inputAmount, setInputAmount] = useState('');
  const [inputCurrency, setInputCurrency] = useState<'USD' | 'Bs'>('USD');
  const [description, setDescription] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearAllRef = useRef<() => void>(() => {});
  const amountRef = useRef<HTMLInputElement>(null);

  // === Derivados ===
  const activeClient = clients.find(c => c.id === activeClientId) ?? clients[0];
  const activeRate = rateConfig.useManualRate && rateConfig.manualRate
    ? parseFloat(rateConfig.manualRate) : autoRate;
  const entries = activeClient?.entries ?? [];

  // === Totales memoizados ===
  const allClientTotals = useMemo(() => {
    const totals = new Map<string, ClientTotals>();
    for (const client of clients) {
      const usd = client.entries.reduce((sum, e) => sum + (e.isNegative ? -e.amountUSD : e.amountUSD), 0);
      const bs = client.entries.reduce((sum, e) => sum + (e.isNegative ? -e.amountBs : e.amountBs), 0);
      totals.set(client.id, { usd, bs });
    }
    return totals;
  }, [clients]);

  const currentTotals = allClientTotals.get(activeClient?.id ?? '') ?? { usd: 0, bs: 0 };

  // === Helpers de mutación ===
  const updateClient = useCallback((clientId: string, updater: (c: ClientData) => ClientData) => {
    setClients(prev => prev.map(c => c.id === clientId ? updater(c) : c));
  }, [setClients]);

  const updateClientEntries = useCallback((clientId: string, updater: (entries: CalcEntry[]) => CalcEntry[]) => {
    setClients(prev => prev.map(c =>
      c.id === clientId ? { ...c, entries: updater(c.entries) } : c
    ));
  }, [setClients]);

  // === Undo ===
  const scheduleUndoDismiss = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoAction(null), 5000);
  }, []);

  const executeUndo = useCallback(() => {
    if (!undoAction) return;
    switch (undoAction.type) {
      case 'delete_entry':
        updateClientEntries(undoAction.clientId, entries => {
          const copy = [...entries];
          copy.splice(undoAction.index, 0, undoAction.entry);
          return copy;
        });
        break;
      case 'clear_all':
        updateClient(undoAction.clientId, c => ({
          ...c,
          name: undoAction.clientName,
          dispatcher: undoAction.dispatcher,
          entries: undoAction.entries,
        }));
        if (undoAction.sessionId) {
          setSessions(prev => prev.filter(s => s.id !== undoAction.sessionId));
        }
        break;
      case 'toggle_sign':
        updateClientEntries(undoAction.clientId, entries =>
          entries.map(e => e.id === undoAction.entryId ? { ...e, isNegative: !e.isNegative } : e)
        );
        break;
    }
    setUndoAction(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, [undoAction, updateClient, updateClientEntries, setSessions]);

  useEffect(() => {
    return () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); };
  }, []);

  // === Acciones ===
  const addEntry = useCallback(() => {
    const parsed = evalMathExpr(inputAmount);
    if (parsed === 0 || !activeRate || !activeClient) return;

    let usd: number, bs: number;
    if (inputCurrency === 'USD') {
      usd = parsed; bs = parsed * activeRate;
    } else {
      bs = parsed; usd = parsed / activeRate;
    }

    const entry: CalcEntry = {
      id: crypto.randomUUID(),
      description: description.trim(),
      amountUSD: usd,
      amountBs: bs,
      isNegative: false,
    };
    updateClientEntries(activeClient.id, prev => [...prev, entry]);
    setInputAmount('');
    setDescription('');
  }, [inputAmount, inputCurrency, activeRate, activeClient, description, updateClientEntries]);

  const removeEntry = useCallback((entryId: string) => {
    if (!activeClient) return;
    const idx = activeClient.entries.findIndex(e => e.id === entryId);
    const entry = activeClient.entries[idx];
    if (!entry) return;

    setUndoAction({ type: 'delete_entry', clientId: activeClient.id, entry, index: idx });
    scheduleUndoDismiss();
    updateClientEntries(activeClient.id, prev => prev.filter(e => e.id !== entryId));
  }, [activeClient, updateClientEntries, scheduleUndoDismiss]);

  const toggleSign = useCallback((entryId: string) => {
    if (!activeClient) return;
    setUndoAction({ type: 'toggle_sign', clientId: activeClient.id, entryId });
    scheduleUndoDismiss();
    updateClientEntries(activeClient.id, prev =>
      prev.map(e => e.id === entryId ? { ...e, isNegative: !e.isNegative } : e)
    );
  }, [activeClient, updateClientEntries, scheduleUndoDismiss]);

  const updateEntryAmount = useCallback((entryId: string, newUSD: number) => {
    if (newUSD <= 0 || !activeRate || !activeClient) return;
    updateClientEntries(activeClient.id, prev =>
      prev.map(e => e.id === entryId ? { ...e, amountUSD: newUSD, amountBs: newUSD * activeRate } : e)
    );
  }, [activeClient, activeRate, updateClientEntries]);

  const adjustTotal = useCallback((newTotalUSD: number) => {
    if (!activeRate || !activeClient) return;
    const diff = newTotalUSD - currentTotals.usd;
    if (Math.abs(diff) < 0.001) return;
    const entry: CalcEntry = {
      id: crypto.randomUUID(),
      description: 'Ajuste',
      amountUSD: Math.abs(diff),
      amountBs: Math.abs(diff) * activeRate,
      isNegative: diff < 0,
    };
    updateClientEntries(activeClient.id, prev => [...prev, entry]);
  }, [activeClient, activeRate, currentTotals.usd, updateClientEntries]);

  const clearAll = useCallback(() => {
    if (!activeClient) return;
    const clientEntries = activeClient.entries;
    let sessionId: string | undefined;

    if (clientEntries.length > 0) {
      sessionId = crypto.randomUUID();
      const session: SavedSession = {
        id: sessionId,
        clientName: activeClient.name,
        dispatcher: activeClient.dispatcher,
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
      clientId: activeClient.id,
      entries: [...clientEntries],
      clientName: activeClient.name,
      dispatcher: activeClient.dispatcher,
      sessionId,
    });
    scheduleUndoDismiss();

    const idx = clients.indexOf(activeClient);
    updateClient(activeClient.id, c => ({
      ...c,
      name: DEFAULT_CLIENT_NAME(idx >= 0 ? idx : 0),
      dispatcher: undefined,
      entries: [],
    }));
    setInputAmount('');
    setDescription('');
  }, [activeClient, clients, currentTotals, activeRate, setSessions, updateClient, scheduleUndoDismiss]);

  clearAllRef.current = clearAll;

  // === Gestión de clientes ===
  const addClient = useCallback(() => {
    const newClient: ClientData = {
      id: crypto.randomUUID(),
      name: DEFAULT_CLIENT_NAME(clients.length),
      entries: [],
    };
    setClients(prev => [...prev, newClient]);
    setActiveClientId(newClient.id);
  }, [clients.length, setClients, setActiveClientId]);

  const removeClient = useCallback(() => {
    if (clients.length <= 1 || !activeClient) return;
    const idx = clients.indexOf(activeClient);
    setClients(prev => prev.filter(c => c.id !== activeClient.id));
    const newIdx = idx > 0 ? idx - 1 : 0;
    const remaining = clients.filter(c => c.id !== activeClient.id);
    setActiveClientId(remaining[newIdx]?.id ?? remaining[0]?.id ?? '');
  }, [clients, activeClient, setClients, setActiveClientId]);

  const renameClient = useCallback((name: string) => {
    if (!activeClient) return;
    updateClient(activeClient.id, c => ({ ...c, name }));
  }, [activeClient, updateClient]);

  const setDispatcher = useCallback((dispatcher: string | undefined) => {
    if (!activeClient) return;
    updateClient(activeClient.id, c => ({ ...c, dispatcher }));
  }, [activeClient, updateClient]);

  const handleStartRenaming = useCallback((_id: string) => {
    // ClientHeader maneja su propio estado de edición de nombre
    // Este callback existe para que ClientTabs pueda disparar rename
    // cuando el tab activo es clickeado de nuevo
  }, []);

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

  // Foco al cambiar de cliente
  useEffect(() => {
    amountRef.current?.focus();
  }, [activeClientId]);

  // Navegación global con teclado
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // No interceptar si hay input activo (excepto nuestro amount input)
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' && target !== amountRef.current) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const idx = clients.findIndex(c => c.id === activeClientId);
        const newIdx = (idx - 1 + clients.length) % clients.length;
        setActiveClientId(clients[newIdx].id);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const idx = clients.findIndex(c => c.id === activeClientId);
        const newIdx = (idx + 1) % clients.length;
        setActiveClientId(clients[newIdx].id);
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
  }, [clients, activeClientId, setActiveClientId]);

  // === Render ===
  return (
    <div className="flex flex-col h-full p-2 sm:p-4 gap-2 sm:gap-3">
      <div className="shrink-0">
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
            <KeyboardHelp />
            {sessions.length > 0 && (
              <button
                onClick={() => setShowHistory(prev => !prev)}
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

        {showSettings && (
          <RateSettings
            autoRate={autoRate}
            rateConfig={rateConfig}
            onRateConfigChange={setRateConfig}
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
          onInputAmountChange={setInputAmount}
          onCurrencyToggle={() => setInputCurrency(prev => prev === 'USD' ? 'Bs' : 'USD')}
          onDescriptionChange={setDescription}
          onAddEntry={addEntry}
          amountRef={amountRef}
        />

        <ClientTabs
          clients={clients}
          activeClientId={activeClientId}
          allClientTotals={allClientTotals}
          onSelectClient={setActiveClientId}
          onStartRenaming={handleStartRenaming}
          onAddClient={addClient}
        />

        {activeClient && (
          <ClientHeader
            client={activeClient}
            totalUSD={currentTotals.usd}
            totalBs={currentTotals.bs}
            activeRate={activeRate}
            clientCount={clients.length}
            onRename={renameClient}
            onSetDispatcher={setDispatcher}
            onClearAll={clearAll}
            onRemoveClient={removeClient}
            onAdjustTotal={adjustTotal}
            amountRef={amountRef}
          />
        )}
      </div>

      <EntryList
        entries={entries}
        onRemoveEntry={removeEntry}
        onToggleSign={toggleSign}
        onUpdateAmount={updateEntryAmount}
      />

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
