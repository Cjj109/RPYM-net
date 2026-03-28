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

interface DispatcherStats {
  name: string;
  totalUSD: number;
  totalBs: number;
  clients: Set<string>;
  sessionCount: number;
  daySessions: SavedSession[];
}

export function HistoryPanel({ sessions, onRemoveSession, onClearHistory }: HistoryPanelProps) {
  const [view, setView] = useState<'summary' | 'detail' | 'ranking'>('detail');
  const [rankingTab, setRankingTab] = useState<'day' | 'week'>('day');
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
        <button
          onClick={() => setView('ranking')}
          className={`flex-1 text-xs font-medium py-2 transition-colors ${view === 'ranking' ? 'text-ocean-700 bg-ocean-50 border-b-2 border-ocean-500' : 'text-ocean-400 hover:text-ocean-600'}`}
        >
          Ranking
        </button>
      </div>

      {view === 'ranking' ? (
        /* Vista Ranking — Podio visual grande */
        (() => {
          const BG_GRADIENT: Record<string, string> = {
            Luis: 'from-amber-400 to-amber-500', Pedro: 'from-teal-400 to-teal-500', Johan: 'from-violet-400 to-violet-500',
          };
          const BG_LIGHT: Record<string, string> = {
            Luis: 'bg-amber-100', Pedro: 'bg-teal-100', Johan: 'bg-violet-100',
          };
          const TEXT_COLOR: Record<string, string> = {
            Luis: 'text-amber-700', Pedro: 'text-teal-700', Johan: 'text-violet-700',
          };
          const BORDER_COLOR: Record<string, string> = {
            Luis: 'border-amber-300', Pedro: 'border-teal-300', Johan: 'border-violet-300',
          };

          const EXCLUDED = new Set(['Carlos', 'Pa']);

          // --- Datos del día ---
          const daySessions = sessions.filter(s => dateKey(s.timestamp) === selectedDateKey && !EXCLUDED.has(s.dispatcher || ''));
          const buildRanking = (filtered: SavedSession[]) => {
            const ops = new Map<string, number>();
            const amt = new Map<string, number>();
            for (const s of filtered) {
              const d = s.dispatcher || 'Sin asignar';
              ops.set(d, (ops.get(d) || 0) + 1);
              amt.set(d, (amt.get(d) || 0) + s.totalUSD);
            }
            return {
              ops: [...ops.entries()].sort((a, b) => b[1] - a[1]),
              amt: [...amt.entries()].sort((a, b) => b[1] - a[1]),
            };
          };
          const dayRanking = buildRanking(daySessions);

          // --- Datos de la semana (lun-dom) ---
          const getWeekRange = (key: string) => {
            const [y, m, d] = key.split('-').map(Number);
            const date = new Date(y, m - 1, d);
            const day = date.getDay();
            const monday = new Date(date);
            monday.setDate(date.getDate() - ((day + 6) % 7));
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            return { start: monday, end: sunday };
          };
          const week = getWeekRange(selectedDateKey);
          const weekSessions = sessions.filter(s => {
            const d = new Date(s.timestamp);
            return d >= week.start && d <= week.end && !EXCLUDED.has(s.dispatcher || '');
          });
          const weekRanking = buildRanking(weekSessions);

          // --- Acumulado semanal: cuántas veces fue 1ro cada uno ---
          const weekWins = { ops: new Map<string, number>(), amt: new Map<string, number>() };
          const daysInWeek: string[] = [];
          for (let i = 0; i < 7; i++) {
            const d = new Date(week.start);
            d.setDate(week.start.getDate() + i);
            if (d > new Date()) break;
            daysInWeek.push(dateKey(d.getTime()));
          }
          for (const dk of daysInWeek) {
            const ds = sessions.filter(s => dateKey(s.timestamp) === dk && !EXCLUDED.has(s.dispatcher || ''));
            if (ds.length === 0) continue;
            const r = buildRanking(ds);
            if (r.ops[0]) weekWins.ops.set(r.ops[0][0], (weekWins.ops.get(r.ops[0][0]) || 0) + 1);
            if (r.amt[0]) weekWins.amt.set(r.amt[0][0], (weekWins.amt.get(r.amt[0][0]) || 0) + 1);
          }
          const winsOps = [...weekWins.ops.entries()].sort((a, b) => b[1] - a[1]);
          const winsAmt = [...weekWins.amt.entries()].sort((a, b) => b[1] - a[1]);

          // --- Corona SVG ---
          const Crown = () => (
            <svg viewBox="0 0 64 48" className="w-10 h-8 drop-shadow-md" fill="none">
              <path d="M4 40L12 16L24 28L32 8L40 28L52 16L60 40H4Z" fill="#FFD700" stroke="#DAA520" strokeWidth="2"/>
              <rect x="4" y="38" width="56" height="6" rx="2" fill="#FFD700" stroke="#DAA520" strokeWidth="1.5"/>
              <circle cx="18" cy="42" r="2" fill="#DAA520"/><circle cx="32" cy="42" r="2" fill="#DAA520"/><circle cx="46" cy="42" r="2" fill="#DAA520"/>
              <circle cx="32" cy="14" r="3" fill="#FFF" stroke="#DAA520" strokeWidth="1.5"/>
              <circle cx="12" cy="18" r="2.5" fill="#FFF" stroke="#DAA520" strokeWidth="1.5"/>
              <circle cx="52" cy="18" r="2.5" fill="#FFF" stroke="#DAA520" strokeWidth="1.5"/>
            </svg>
          );

          // Podio layout: [2do, 1ro, 3ro]
          const podiumOrder = (ranking: [string, number][]) => {
            const r = ranking.slice(0, 3);
            if (r.length === 0) return [];
            if (r.length === 1) return [{ name: r[0][0], value: r[0][1], place: 1 }];
            const result: { name: string; value: number; place: number }[] = [];
            if (r[1]) result.push({ name: r[1][0], value: r[1][1], place: 2 });
            result.push({ name: r[0][0], value: r[0][1], place: 1 });
            if (r[2]) result.push({ name: r[2][0], value: r[2][1], place: 3 });
            return result;
          };

          const renderPodium = (title: string, icon: string, ranking: [string, number][], formatLabel: (v: number) => string) => {
            const podium = podiumOrder(ranking);
            if (podium.length === 0) return null;
            const heights = { 1: 140, 2: 100, 3: 72 } as Record<number, number>;
            return (
              <div>
                <div className="text-center mb-4">
                  <span className="text-3xl">{icon}</span>
                  <p className="text-sm font-extrabold text-ocean-800 uppercase tracking-wider mt-1">{title}</p>
                </div>
                <div className="flex items-end justify-center gap-3 px-1">
                  {podium.map(({ name, value, place }) => {
                    const grad = BG_GRADIENT[name] ?? 'from-ocean-400 to-ocean-500';
                    const text = TEXT_COLOR[name] ?? 'text-ocean-700';
                    const border = BORDER_COLOR[name] ?? 'border-ocean-300';
                    const h = heights[place];
                    return (
                      <div key={name} className="flex flex-col items-center flex-1 max-w-[130px]">
                        {place === 1 && <Crown />}
                        <span className={`text-sm font-extrabold ${text} mb-1`}>{name}</span>
                        <span className={`text-[11px] font-bold ${text} opacity-80 mb-1.5`}>
                          {formatLabel(value)}
                        </span>
                        <div
                          className={`w-full bg-gradient-to-t ${grad} rounded-t-2xl flex flex-col items-center justify-center shadow-lg border-2 border-b-0 ${border} relative overflow-hidden`}
                          style={{ height: `${h}px` }}
                        >
                          <div className="absolute inset-0 bg-gradient-to-t from-black/5 to-white/20" />
                          <span className="text-white font-black text-2xl relative z-10 drop-shadow">
                            {place === 1 ? '1' : place === 2 ? '2' : '3'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          };

          const weekStartLabel = week.start.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' });
          const weekEndLabel = week.end.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' });

          return (
            <div className="p-3 space-y-4">
              {/* Sub-tabs: Día / Semana */}
              <div className="flex rounded-lg bg-ocean-50 p-0.5 gap-0.5">
                <button
                  onClick={() => setRankingTab('day')}
                  className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${rankingTab === 'day' ? 'bg-white text-ocean-800 shadow-sm' : 'text-ocean-400'}`}
                >Hoy</button>
                <button
                  onClick={() => setRankingTab('week')}
                  className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${rankingTab === 'week' ? 'bg-white text-ocean-800 shadow-sm' : 'text-ocean-400'}`}
                >Semana</button>
              </div>

              {rankingTab === 'day' ? (<>
                {/* Navegación de día */}
                <div className="flex items-center justify-between">
                  <button onClick={() => setSelectedDateKey(allDayKeys[currentDayIndex + 1])} disabled={currentDayIndex >= allDayKeys.length - 1} className="p-1.5 rounded-md text-ocean-400 hover:text-ocean-600 hover:bg-ocean-50 disabled:opacity-30 transition-colors">←</button>
                  <span className="text-sm font-semibold text-ocean-700">
                    {formatDayLabel(selectedDateKey)}
                    {selectedDateKey !== dateKey(Date.now()) && (
                      <button onClick={() => setSelectedDateKey(dateKey(Date.now()))} className="ml-2 text-[10px] font-normal text-ocean-400 hover:text-ocean-600 underline">Ir a hoy</button>
                    )}
                  </span>
                  <button onClick={() => setSelectedDateKey(allDayKeys[currentDayIndex - 1])} disabled={currentDayIndex <= 0} className="p-1.5 rounded-md text-ocean-400 hover:text-ocean-600 hover:bg-ocean-50 disabled:opacity-30 transition-colors">→</button>
                </div>

                {daySessions.length === 0 ? (
                  <div className="text-center py-10 text-ocean-300">
                    <p className="text-4xl mb-2">🏆</p>
                    <p className="text-sm">Sin operaciones para rankear</p>
                  </div>
                ) : (<>
                  {renderPodium('Más Clientes', '⚡', dayRanking.ops, v => `${v} clientes`)}
                  <div className="border-t border-ocean-100 my-2" />
                  {renderPodium('Más Ventas', '💰', dayRanking.amt, v => formatUSD(v))}
                </>)}
              </>) : (<>
                {/* Vista Semana */}
                <div className="text-center">
                  <p className="text-xs text-ocean-400">Semana {weekStartLabel} — {weekEndLabel}</p>
                </div>

                {weekSessions.length === 0 ? (
                  <div className="text-center py-10 text-ocean-300">
                    <p className="text-4xl mb-2">🏆</p>
                    <p className="text-sm">Sin operaciones esta semana</p>
                  </div>
                ) : (<>
                  {renderPodium('Más Clientes (semana)', '⚡', weekRanking.ops, v => `${v} clientes`)}
                  <div className="border-t border-ocean-100 my-2" />
                  {renderPodium('Más Ventas (semana)', '💰', weekRanking.amt, v => formatUSD(v))}

                  {/* Acumulado: quién fue 1ro más veces */}
                  {daysInWeek.length > 1 && (winsOps.length > 0 || winsAmt.length > 0) && (<>
                    <div className="border-t border-ocean-100 my-2" />
                    <div className="text-center mb-2">
                      <span className="text-2xl">🔥</span>
                      <p className="text-xs font-extrabold text-ocean-800 uppercase tracking-wider mt-1">Días como #1</p>
                      <p className="text-[10px] text-ocean-400">{daysInWeek.length} días contados</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Clientes */}
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-ocean-500 text-center uppercase">Clientes</p>
                        {winsOps.map(([name, wins]) => {
                          const text = TEXT_COLOR[name] ?? 'text-ocean-700';
                          const bgL = BG_LIGHT[name] ?? 'bg-ocean-100';
                          return (
                            <div key={name} className={`${bgL} rounded-lg px-2 py-1.5 text-center`}>
                              <span className={`text-2xl font-black ${text}`}>{wins}</span>
                              <p className={`text-[10px] font-bold ${text}`}>{name}</p>
                            </div>
                          );
                        })}
                      </div>
                      {/* Ventas */}
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-ocean-500 text-center uppercase">Ventas</p>
                        {winsAmt.map(([name, wins]) => {
                          const text = TEXT_COLOR[name] ?? 'text-ocean-700';
                          const bgL = BG_LIGHT[name] ?? 'bg-ocean-100';
                          return (
                            <div key={name} className={`${bgL} rounded-lg px-2 py-1.5 text-center`}>
                              <span className={`text-2xl font-black ${text}`}>{wins}</span>
                              <p className={`text-[10px] font-bold ${text}`}>{name}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>)}
                </>)}
              </>)}
            </div>
          );
        })()
      ) : view === 'summary' ? (
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
        /* Vista Detalle — sesiones del día seleccionado con navegación */
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

          {/* Sesiones del día */}
          {(() => {
            const daySessions = sessions
              .filter(s => dateKey(s.timestamp) === selectedDateKey)
              .sort((a, b) => b.timestamp - a.timestamp);
            if (daySessions.length === 0) {
              return (
                <div className="text-center py-6 text-ocean-300">
                  <p className="text-sm">Sin operaciones {formatDayLabel(selectedDateKey) === 'Hoy' ? 'hoy' : 'este día'}</p>
                </div>
              );
            }
            return (
              <div className="max-h-64 sm:max-h-72 overflow-y-auto divide-y divide-ocean-50 rounded-lg border border-ocean-100">
                {daySessions.map(session => (
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
            );
          })()}
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
