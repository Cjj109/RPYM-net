import { formatUSD, formatBs } from '../../lib/format';
import type { DispatcherTab, ClientTotals } from './types';
import { DISPATCHERS } from './constants';

interface ClientTabsProps {
  dispatchers: DispatcherTab[];
  activeDispatcherId: string;
  activeClientMap: Record<string, string>;
  onSelectDispatcher: (id: string) => void;
}

function getSelectedClientTotals(tab: DispatcherTab, clientId: string): ClientTotals {
  const client = tab.clients.find(c => c.id === clientId) ?? tab.clients[0];
  if (!client) return { usd: 0, bs: 0 };
  const usd = client.entries.reduce((sum, e) => sum + (e.isNegative ? -e.amountUSD : e.amountUSD), 0);
  const bs = client.entries.reduce((sum, e) => sum + (e.isNegative ? -e.amountBs : e.amountBs), 0);
  return { usd, bs };
}

export function ClientTabs({
  dispatchers, activeDispatcherId, activeClientMap, onSelectDispatcher,
}: ClientTabsProps) {
  return (
    <div className="mt-2 sm:mt-3 bg-white rounded-t-xl shadow-sm border border-ocean-100 border-b-0">
      <div className="flex">
        {dispatchers.map(tab => {
          const isActive = tab.id === activeDispatcherId;
          const selectedClientId = activeClientMap[tab.id] ?? tab.clients[0]?.id ?? '';
          const totals = getSelectedClientTotals(tab, selectedClientId);
          const hasEntries = totals.bs !== 0 || totals.usd !== 0;
          const disp = DISPATCHERS.find(d => d.name === tab.dispatcher);
          const tabBg = disp ? disp.bg : (isActive ? 'bg-white' : 'bg-ocean-50/50');

          return (
            <div key={tab.id} className={`relative flex-1 transition-all duration-200 ${tabBg} ${
              isActive ? `ring-2 ${disp?.ring ?? 'ring-ocean-300'} scale-[1.03] z-10 rounded-t-lg` : ''
            }`}>
              <button
                onClick={() => onSelectDispatcher(tab.id)}
                className={`w-full py-2 font-medium transition-colors truncate px-1.5 ${
                  isActive ? 'text-ocean-700' : 'text-ocean-400 hover:text-ocean-600'
                }`}
              >
                <div className={`text-xs font-bold truncate ${disp ? disp.text : ''}`}>
                  {tab.dispatcher}
                </div>
                {hasEntries ? (
                  <div className="mt-0.5">
                    <div className={`text-sm font-mono font-bold leading-tight ${disp ? disp.text : 'text-green-700'}`}>
                      {formatBs(Math.abs(totals.bs))}
                    </div>
                    <div className={`text-[10px] font-mono font-bold leading-tight ${disp ? disp.text : 'text-green-700'}`}>
                      {formatUSD(Math.abs(totals.usd))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-0.5 text-[9px] text-ocean-200">--</div>
                )}
              </button>
              {isActive && (
                <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${disp ? disp.text.replace('text-', 'bg-') : 'bg-ocean-600'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
