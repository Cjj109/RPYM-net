import { useState } from 'react';
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

function formatHistoryDate(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Hoy';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' });
}

export function HistoryPanel({ sessions, onRemoveSession, onClearHistory }: HistoryPanelProps) {
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  return (
    <div className="mb-3 bg-white rounded-lg border border-ocean-100 overflow-hidden">
      <div className="max-h-48 sm:max-h-64 overflow-y-auto divide-y divide-ocean-50">
        {sessions.map(session => (
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
      <div className="px-4 py-1.5 border-t border-ocean-100 bg-ocean-50/50">
        <button onClick={onClearHistory} className="text-xs text-red-400 hover:text-red-600 transition-colors">
          Borrar historial
        </button>
      </div>
    </div>
  );
}
