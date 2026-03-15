import { useState, useRef, useEffect } from 'react';
import { formatUSD, formatBs } from '../../lib/format';
import type { SubClient, ClientTotals } from './types';
import { DISPATCHERS } from './constants';
import { PlusIcon, TrashIcon } from './icons';

interface SubClientCardsProps {
  clients: SubClient[];
  activeClientId: string;
  subClientTotals: Map<string, ClientTotals>;
  dispatcher: string;
  navFocused: boolean;
  onSelectClient: (id: string) => void;
  onRenameClient: (name: string) => void;
  onAddClient: () => void;
  onRemoveClient: () => void;
  clientCount: number;
}

export function SubClientCards({
  clients, activeClientId, subClientTotals, dispatcher, navFocused,
  onSelectClient, onRenameClient, onAddClient, onRemoveClient, clientCount,
}: SubClientCardsProps) {
  const disp = DISPATCHERS.find(d => d.name === dispatcher);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) {
      requestAnimationFrame(() => { editRef.current?.focus(); editRef.current?.select(); });
    }
  }, [editingId]);

  // Reset editing when active client changes
  useEffect(() => {
    setEditingId(null);
  }, [activeClientId]);

  const finishRename = () => {
    if (editValue.trim()) onRenameClient(editValue.trim());
    setEditingId(null);
  };

  return (
    <div className="bg-white border-x border-ocean-100 px-2 sm:px-3 pb-0.5">
      <div className="flex gap-1.5 overflow-x-auto py-1">
        {clients.map(client => {
          const isActive = client.id === activeClientId;
          const totals = subClientTotals.get(client.id) || { usd: 0, bs: 0 };
          const hasEntries = client.entries.length > 0;
          const isEditing = editingId === client.id;

          return (
            <button
              key={client.id}
              onClick={() => {
                if (isActive && !isEditing) {
                  setEditingId(client.id);
                  setEditValue(client.name);
                } else if (!isActive) {
                  onSelectClient(client.id);
                }
              }}
              className={`flex flex-col items-center px-2.5 py-1.5 rounded-lg transition-all shrink-0 min-w-[70px] ${
                isActive
                  ? `${disp?.bg ?? 'bg-ocean-100'} ${navFocused ? `ring-2 ${disp?.ring ?? 'ring-ocean-300'} scale-[1.02]` : `ring-1 ${disp?.ring ?? 'ring-ocean-200'}`}`
                  : 'bg-gray-50 hover:bg-gray-100'
              }`}
            >
              {isEditing ? (
                <input
                  ref={editRef}
                  type="text"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={finishRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  onClick={e => e.stopPropagation()}
                  className="w-16 text-[10px] font-semibold text-center bg-transparent border-b border-current outline-none py-0"
                />
              ) : (
                <span className={`text-[10px] font-semibold truncate max-w-[80px] ${
                  isActive ? (disp?.text ?? 'text-ocean-700') : 'text-gray-500'
                }`}>
                  {client.name}
                </span>
              )}
              {hasEntries ? (
                <>
                  <span className={`text-sm font-mono font-bold leading-tight mt-0.5 ${
                    isActive ? (disp?.text ?? 'text-green-700') : 'text-green-600'
                  }`}>
                    {formatBs(Math.abs(totals.bs))}
                  </span>
                  <span className={`text-[9px] font-mono leading-tight ${
                    isActive ? 'text-ocean-500' : 'text-ocean-300'
                  }`}>
                    {formatUSD(Math.abs(totals.usd))}
                  </span>
                </>
              ) : (
                <span className="text-[9px] text-gray-300 mt-0.5">--</span>
              )}
            </button>
          );
        })}
        <div className="flex flex-col gap-0.5 shrink-0">
          <button
            onClick={onAddClient}
            className="flex-1 px-2 py-1 text-ocean-300 hover:text-ocean-600 hover:bg-ocean-50 rounded-lg transition-colors"
            title="Agregar cliente"
          >
            <PlusIcon className="w-3.5 h-3.5" />
          </button>
          {clientCount > 1 && (
            <button
              onClick={onRemoveClient}
              className="flex-1 px-2 py-1 text-ocean-200 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="Eliminar cliente activo"
            >
              <TrashIcon className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
