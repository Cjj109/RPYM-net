import { useState, useMemo } from 'react';
import { formatUSD, formatBs } from '../../lib/format';
import type { SavedSession } from './types';
import { DISPATCHERS } from './constants';

interface HistoryPanelProps {
  sessions: SavedSession[];
  onRemoveSession: (id: string) => void;
  onClearHistory: () => void;
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
}

/** Devuelve clave YYYY-MM-DD para agrupar por día */
function dateKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDayLabel(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Hoy';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Ayer';
  return date.toLocaleDateString('es-VE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

interface DayGroup {
  key: string;
  sessions: SavedSession[];
  totalUSD: number;
  totalBs: number;
  clientCount: number;
}

interface DispatcherStats {
  name: string;
  totalUSD: number;
  totalBs: number;
  clients: Set<string>;
  sessionCount: number;
  daySessions: SavedSession[];
}

function groupByDay(sessions: SavedSession[]): DayGroup[] {
  const map = new Map<string, SavedSession[]>();
  for (const s of sessions) {
    const k = dateKey(s.timestamp);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(s);
  }
  // Ordenar días de más reciente a más antiguo
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, daySessions]) => {
      const clients = new Set(daySessions.map(s => s.clientName));
      return {
        key,
        sessions: daySessions.sort((a, b) => b.timestamp - a.timestamp),
        totalUSD: daySessions.reduce((sum, s) => sum + s.totalUSD, 0),
        totalBs: daySessions.reduce((sum, s) => sum + s.totalBs, 0),
        clientCount: clients.size,
      };
    });
}

export function HistoryPanel({ sessions, onRemoveSession, onClearHistory }: HistoryPanelProps) {
  const [view, setView] = useState<'summary' | 'detail'>('summary');
  const [selectedDateKey, setSelectedDateKey] = useState<string>(() => dateKey(Date.now()));
  const [expandedDispatcher, setExpandedDispatcher] = useState<string | null>(null);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  /** Días con sesiones + hoy, ordenados de más reciente a más antiguo */
  const allDayKeys = useMemo(() => {
    const todayKey = dateKey(Date.now());
    const keys = new Set(sessions.map(s => dateKey(s.timestamp)));
    keys.add(todayKey);
    return [...keys].sort((a, b) => b.localeCompare(a));
  }, [sessions]);

  const currentDayIndex = allDayKeys.indexOf(selectedDateKey);

  /** Stats del día seleccionado */
  const stats = useMemo(() => {
    const daySessions = sessions.filter(s => dateKey(s.timestamp) === selectedDateKey);

    const byDispatcher = new Map<string, { totalUSD: number; totalBs: number; clients: Set<string>; sessionCount: number; sessions: SavedSession[] }>();
    let grandTotalUSD = 0;
    let grandTotalBs = 0;

    for (const session of daySessions) {
      const dispName = session.dispatcher || 'Sin asignar';
      if (!byDispatcher.has(dispName)) {
        byDispatcher.set(dispName, { totalUSD: 0, totalBs: 0, clients: new Set(), sessionCount: 0, sessions: [] });
      }
      const stat = byDispatcher.get(dispName)!;
      stat.totalUSD += session.totalUSD;
      stat.totalBs += session.totalBs;
      stat.clients.add(session.clientName);
      stat.sessionCount += 1;
      stat.sessions.push(session);
      grandTotalUSD += session.totalUSD;
      grandTotalBs += session.totalBs;
    }

    // Sort by DISPATCHERS order
    const dispOrder = DISPATCHERS.map(d => d.name);
    const sorted: DispatcherStats[] = [...byDispatcher.entries()]
      .sort(([a], [b]) => {
        const ia = dispOrder.indexOf(a);
        const ib = dispOrder.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      })
      .map(([name, data]) => ({
        name,
        totalUSD: data.totalUSD,
        totalBs: data.totalBs,
        clients: data.clients,
        sessionCount: data.sessionCount,
        daySessions: data.sessions.sort((a, b) => b.timestamp - a.timestamp),
      }));

    return { byDispatcher: sorted, grandTotalUSD, grandTotalBs, totalSessions: daySessions.length };
  }, [sessions, selectedDateKey]);

  /** Días globales para la vista detalle */
  const globalDays = useMemo(() => groupByDay(sessions), [sessions]);

  return (
    <div className="mb-3 bg-white rounded-lg border border-ocean-100 overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-ocean-100">
        <button
          onClick={() => setView('summary')}
          className={`flex-1 text-xs font-medium py-2 transition-colors ${view === 'summary' ? 'text-ocean-700 bg-ocean-50 border-b-2 border-ocean-500' : 'text-ocean-400 hover:text-ocean-600'}`}
        >
          Resumen
        </button>
        <button
          onClick={() => setView('detail')}
          className={`flex-1 text-xs font-medium py-2 transition-colors ${view === 'detail' ? 'text-ocean-700 bg-ocean-50 border-b-2 border-ocean-500' : 'text-ocean-400 hover:text-ocean-600'}`}
        >
          Detalle ({sessions.length})
        </button>
      </div>

      {view === 'summary' ? (
        <div className="p-3 space-y-3">
          {/* Navegación de día */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSelectedDateKey(allDayKeys[currentDayIndex + 1])}
              disabled={currentDayIndex >= allDayKeys.length - 1}
              className="p-1.5 rounded-md text-ocean-400 hover:text-ocean-600 hover:bg-ocean-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Día anterior"
            >
              ←
            </button>
            <span className="text-sm font-semibold text-ocean-700">
              {formatDayLabel(selectedDateKey)}
              {selectedDateKey !== dateKey(Date.now()) && (
                <button
                  onClick={() => setSelectedDateKey(dateKey(Date.now()))}
                  className="ml-2 text-[10px] font-normal text-ocean-400 hover:text-ocean-600 underline transition-colors"
                >
                  Ir a hoy
                </button>
              )}
            </span>
            <button
              onClick={() => setSelectedDateKey(allDayKeys[currentDayIndex - 1])}
              disabled={currentDayIndex <= 0}
              className="p-1.5 rounded-md text-ocean-400 hover:text-ocean-600 hover:bg-ocean-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Día siguiente"
            >
              →
            </button>
          </div>

          {/* Total del día */}
          <div className="bg-ocean-50 rounded-lg p-3 text-center">
            <span className="text-[10px] text-ocean-400 uppercase tracking-wide">
              Total {formatDayLabel(selectedDateKey)}
            </span>
            <p className="text-xl font-bold font-mono text-ocean-800 mt-0.5">
              {stats.grandTotalBs < 0 ? '-' : ''}{formatBs(Math.abs(stats.grandTotalBs))}
            </p>
            <p className="text-xs font-mono font-bold text-ocean-500">
              {stats.grandTotalUSD < 0 ? '-' : ''}{formatUSD(Math.abs(stats.grandTotalUSD))}
            </p>
            <div className="flex justify-center gap-4 mt-2 text-[10px] text-ocean-400">
              <span>{stats.totalSessions} operaciones</span>
            </div>
          </div>

          {/* Estado vacío */}
          {stats.totalSessions === 0 ? (
            <div className="text-center py-6 text-ocean-300">
              <p className="text-sm">Sin operaciones {formatDayLabel(selectedDateKey) === 'Hoy' ? 'hoy' : 'este día'}</p>
              {sessions.length > 0 && currentDayIndex >= allDayKeys.length - 1 && (
                <p className="text-[11px] mt-1">
                  ← Navega para ver días anteriores
                </p>
              )}
            </div>
          ) : (
            /* Desglose por despachador */
            <div className="space-y-1.5">
              {stats.byDispatcher.map(stat => {
                const disp = DISPATCHERS.find(d => d.name === stat.name);
                const isExpanded = expandedDispatcher === stat.name;
                return (
                  <div key={stat.name}>
                    <button
                      onClick={() => setExpandedDispatcher(prev => prev === stat.name ? null : stat.name)}
                      className={`w-full flex items-center justify-between rounded-lg px-3 py-2 ring-1 transition-colors ${disp ? `${disp.bg} ${disp.ring}` : 'bg-gray-50 ring-gray-200'}`}
                    >
                      <div className="text-left">
                        <span className={`text-sm font-semibold ${disp ? disp.text : 'text-gray-700'}`}>{stat.name}</span>
                        <div className={`text-[10px] ${disp ? `${disp.text} opacity-70` : 'text-gray-400'}`}>
                          {stat.clients.size} cliente{stat.clients.size !== 1 ? 's' : ''} · {stat.sessionCount} op.
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold font-mono ${disp ? disp.text : 'text-gray-700'}`}>
                          {stat.totalBs < 0 ? '-' : ''}{formatBs(Math.abs(stat.totalBs))}
                        </p>
                        <p className={`text-[10px] font-mono font-bold ${disp ? `${disp.text} opacity-70` : 'text-gray-400'}`}>
                          {stat.totalUSD < 0 ? '-' : ''}{formatUSD(Math.abs(stat.totalUSD))}
                        </p>
                      </div>
                    </button>

                    {/* Sesiones del despachador en el día seleccionado */}
                    {isExpanded && (
                      <div className="mt-1 ml-2 space-y-0.5">
                        {stat.daySessions.map(session => (
                          <div key={session.id} className="bg-white rounded border border-ocean-100 overflow-hidden">
                            <button
                              onClick={() => setExpandedSession(prev => prev === session.id ? null : session.id)}
                              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-ocean-50/50 transition-colors text-left"
                            >
                              <div className="min-w-0">
                                <span className="text-xs font-medium text-ocean-700">{session.clientName}</span>
                                <span className="text-[10px] text-ocean-400 ml-1.5">({session.entries.length})</span>
                                <div className="text-[10px] text-ocean-400">{formatTime(session.timestamp)}</div>
                              </div>
                              <div className="text-right shrink-0 ml-2">
                                <div className="text-xs font-mono font-bold text-ocean-500">
                                  {session.totalUSD < 0 ? '-' : ''}{formatUSD(Math.abs(session.totalUSD))}
                                </div>
                                <div className="text-sm font-bold font-mono text-green-700">
                                  {session.totalBs < 0 ? '-' : ''}{formatBs(Math.abs(session.totalBs))}
                                </div>
                              </div>
                            </button>
                            {expandedSession === session.id && (
                              <div className="px-3 pb-2 space-y-0.5 bg-ocean-50/30">
                                {session.entries.map(entry => (
                                  <div key={entry.id} className="flex items-center justify-between text-[11px] py-0.5">
                                    <span className="text-ocean-500 truncate mr-2">{entry.description || '—'}</span>
                                    <div className="text-right shrink-0">
                                      <span className={`font-mono ${entry.isNegative ? 'text-red-400' : 'text-ocean-400'}`}>
                                        {entry.isNegative ? '-' : ''}{formatUSD(entry.amountUSD)}
                                      </span>
                                      <span className={`font-mono ml-1.5 font-medium ${entry.isNegative ? 'text-red-600' : 'text-green-700'}`}>
                                        {entry.isNegative ? '-' : ''}{formatBs(entry.amountBs)}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                                <div className="flex items-center justify-between pt-1">
                                  <span className="text-[9px] text-ocean-300">Tasa: Bs. {session.rate.toFixed(2)}</span>
                                  <button
                                    onClick={() => onRemoveSession(session.id)}
                                    className="text-[9px] text-red-400 hover:text-red-600 transition-colors"
                                  >
                                    Eliminar
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Vista Detalle — agrupada por día */
        <div className="max-h-64 sm:max-h-80 overflow-y-auto">
          {globalDays.length === 0 ? (
            <div className="text-center py-8 text-ocean-300">
              <p className="text-sm">No hay sesiones guardadas</p>
            </div>
          ) : (
            globalDays.map(day => (
              <div key={day.key}>
                {/* Cabecera del día */}
                <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-1.5 bg-ocean-50 border-b border-ocean-100">
                  <span className="text-xs font-semibold text-ocean-700">{formatDayLabel(day.key)}</span>
                  <div className="flex items-center gap-3 text-[10px] text-ocean-400">
                    <span>{day.sessions.length} op.</span>
                    <span className="font-mono font-bold text-green-700">
                      {day.totalBs < 0 ? '-' : ''}{formatBs(Math.abs(day.totalBs))}
                    </span>
                    <span className="font-mono font-bold text-ocean-500">
                      {day.totalUSD < 0 ? '-' : ''}{formatUSD(Math.abs(day.totalUSD))}
                    </span>
                  </div>
                </div>

                {/* Sesiones del día */}
                <div className="divide-y divide-ocean-50">
                  {day.sessions.map(session => (
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
                          <div className="text-xs text-ocean-400">{formatTime(session.timestamp)}</div>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <div className="text-sm font-mono text-ocean-500">
                            {session.totalUSD < 0 ? '-' : ''}{formatUSD(Math.abs(session.totalUSD))}
                          </div>
                          <div className="text-base font-bold font-mono text-green-700">
                            {session.totalBs < 0 ? '-' : ''}{formatBs(Math.abs(session.totalBs))}
                          </div>
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
                              onClick={() => onRemoveSession(session.id)}
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
              </div>
            ))
          )}
        </div>
      )}

      <div className="px-4 py-1.5 border-t border-ocean-100 bg-ocean-50/50">
        <button onClick={onClearHistory} className="text-xs text-red-400 hover:text-red-600 transition-colors">
          Borrar historial
        </button>
      </div>
    </div>
  );
}
