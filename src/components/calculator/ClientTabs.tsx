import { formatUSD, formatBs } from '../../lib/format';
import type { ClientData, ClientTotals } from './types';
import { DISPATCHERS } from './constants';
import { PlusIcon } from './icons';

interface ClientTabsProps {
  clients: ClientData[];
  activeClientId: string;
  allClientTotals: Map<string, ClientTotals>;
  onSelectClient: (id: string) => void;
  onStartRenaming: (id: string) => void;
  onAddClient: () => void;
}

export function ClientTabs({
  clients, activeClientId, allClientTotals,
  onSelectClient, onStartRenaming, onAddClient,
}: ClientTabsProps) {
  return (
    <div className="mt-2 sm:mt-3 bg-white rounded-t-xl shadow-sm border border-ocean-100 border-b-0">
      <div className="flex overflow-x-auto">
        {clients.map(client => {
          const isActive = client.id === activeClientId;
          const totals = allClientTotals.get(client.id) || { usd: 0, bs: 0 };
          const count = client.entries.length;

          return (
            <div key={client.id} className={`flex-1 min-w-[60px] sm:min-w-[70px] relative ${
              isActive ? 'bg-white' : 'bg-ocean-50/50'
            }`}>
              <button
                onClick={() => {
                  if (isActive) onStartRenaming(client.id);
                  else onSelectClient(client.id);
                }}
                className={`w-full py-2 text-xs font-medium transition-colors truncate px-1 ${
                  isActive ? 'text-ocean-700' : 'text-ocean-400 hover:text-ocean-600'
                }`}
                title={isActive ? 'Click para renombrar' : ''}
              >
                <div className="truncate">{client.name}</div>
                {client.dispatcher && (() => {
                  const disp = DISPATCHERS.find(d => d.name === client.dispatcher);
                  return (
                    <div className={`text-[8px] font-semibold rounded-full px-1.5 mx-auto mt-0.5 truncate max-w-full ${disp ? disp.badge : 'bg-gray-50 text-gray-500'}`}>
                      {client.dispatcher}
                    </div>
                  );
                })()}
                {count > 0 ? (
                  <div className="mt-1">
                    <div className={`text-[11px] font-mono font-bold leading-tight ${isActive ? 'text-green-700' : 'text-green-500'}`}>
                      {formatBs(Math.abs(totals.bs))}
                    </div>
                    <div className={`text-[9px] font-mono leading-tight ${isActive ? 'text-ocean-400' : 'text-ocean-300'}`}>
                      {formatUSD(Math.abs(totals.usd))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 text-[9px] text-ocean-200">--</div>
                )}
              </button>
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-ocean-600" />
              )}
            </div>
          );
        })}
        <button
          onClick={onAddClient}
          className="px-3 py-2 text-ocean-300 hover:text-ocean-600 hover:bg-ocean-50 transition-colors shrink-0 border-l border-ocean-100"
          title="Agregar cliente"
        >
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}
