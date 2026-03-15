import { formatUSD, formatBs } from '../../lib/format';
import type { SavedSession } from './types';
import { DISPATCHERS } from './constants';
import { CloseIcon } from './icons';

interface QueuePanelProps {
  sessions: SavedSession[];
  onRemoveSession: (id: string) => void;
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
}

export function QueuePanel({ sessions, onRemoveSession }: QueuePanelProps) {
  // Today's sessions, oldest first (queue order)
  const today = new Date();
  const todaySessions = sessions
    .filter(s => new Date(s.timestamp).toDateString() === today.toDateString())
    .slice()
    .reverse(); // oldest first = queue order

  if (todaySessions.length === 0) {
    return (
      <div className="mb-3 bg-white rounded-lg border border-ocean-100 p-4 text-center">
        <p className="text-sm text-ocean-400">No hay cuentas en cola hoy</p>
      </div>
    );
  }

  return (
    <div className="mb-3 bg-white rounded-lg border border-ocean-100 overflow-hidden">
      <div className="px-3 py-2 bg-ocean-50 border-b border-ocean-100">
        <span className="text-xs font-semibold text-ocean-600">Cola de hoy</span>
        <span className="text-[10px] text-ocean-400 ml-2">{todaySessions.length} cuenta{todaySessions.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="max-h-60 sm:max-h-80 overflow-y-auto divide-y divide-ocean-50">
        {todaySessions.map((session, i) => {
          const disp = DISPATCHERS.find(d => d.name === session.dispatcher);
          return (
            <div key={session.id} className="flex items-center gap-2 px-3 py-2 hover:bg-ocean-50/50 transition-colors">
              {/* Number */}
              <span className="text-lg font-bold text-ocean-300 w-7 text-center shrink-0">{i + 1}</span>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-ocean-700 truncate">{session.clientName}</span>
                  {session.dispatcher && (
                    <span className={`text-[9px] font-semibold rounded-full px-1.5 py-0.5 shrink-0 ${disp ? disp.badge : 'bg-gray-50 text-gray-500'}`}>
                      {session.dispatcher}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-ocean-400">{formatTime(session.timestamp)}</span>
              </div>

              {/* Totals */}
              <div className="text-right shrink-0">
                <p className={`text-sm font-bold font-mono ${disp ? disp.text : 'text-green-700'}`}>
                  {formatBs(Math.abs(session.totalBs))}
                </p>
                <p className="text-[10px] font-mono font-bold text-ocean-500">
                  {formatUSD(Math.abs(session.totalUSD))}
                </p>
              </div>

              {/* Remove */}
              <button
                onClick={() => onRemoveSession(session.id)}
                className="p-1 text-ocean-200 hover:text-red-500 transition-colors shrink-0"
                title="Eliminar de la cola"
              >
                <CloseIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
