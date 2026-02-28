import { useState, useRef, useEffect } from 'react';
import { formatUSD, formatBs } from '../../lib/format';
import type { CalcEntry } from './types';
import { PlusMinusIcon, CloseIcon } from './icons';

interface EntryListProps {
  entries: CalcEntry[];
  onRemoveEntry: (id: string) => void;
  onToggleSign: (id: string) => void;
  onUpdateAmount: (id: string, newUSD: number) => void;
}

export function EntryList({ entries, onRemoveEntry, onToggleSign, onUpdateAmount }: EntryListProps) {
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [editEntryValue, setEditEntryValue] = useState('');
  const editEntryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingEntry !== null) {
      requestAnimationFrame(() => {
        editEntryRef.current?.focus();
        editEntryRef.current?.select();
      });
    }
  }, [editingEntry]);

  if (entries.length === 0) {
    return (
      <div className="flex-1 min-h-0 bg-white rounded-b-xl border-x border-b border-ocean-100 overflow-y-auto">
        <div className="p-2.5 sm:p-4">
          <p className="text-sm text-ocean-400 text-center py-4">Sin operaciones</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 bg-white rounded-b-xl border-x border-b border-ocean-100 overflow-y-auto">
      <div className="p-2.5 sm:p-4">
        <div className="space-y-2">
          {entries.map(entry => (
            <div key={entry.id} className={`flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg border ${entry.isNegative ? 'border-red-100 bg-red-50/50' : 'border-ocean-100 bg-ocean-50/30'}`}>
              <div className="flex-1 min-w-0">
                {entry.description && (
                  <p className="text-xs text-ocean-500 truncate mb-0.5">{entry.description}</p>
                )}
                {editingEntry === entry.id ? (
                  <div className="flex items-center gap-1">
                    <span className={`text-sm font-mono ${entry.isNegative ? 'text-red-400' : 'text-ocean-400'}`}>$</span>
                    <input
                      ref={editEntryRef}
                      type="text"
                      inputMode="decimal"
                      value={editEntryValue}
                      onChange={e => setEditEntryValue(e.target.value)}
                      onBlur={() => {
                        const val = parseFloat(editEntryValue.replace(/,/g, '.'));
                        if (val > 0) onUpdateAmount(entry.id, val);
                        setEditingEntry(null);
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setEditingEntry(null);
                      }}
                      className="w-20 text-sm font-mono bg-transparent border-b-2 border-ocean-500 outline-none py-0"
                    />
                  </div>
                ) : (
                  <p
                    onClick={() => { setEditingEntry(entry.id); setEditEntryValue(entry.amountUSD.toFixed(2)); }}
                    className={`text-sm font-mono ${entry.isNegative ? 'text-red-400' : 'text-ocean-400'} cursor-pointer hover:underline`}
                    title="Click para editar"
                  >
                    {entry.isNegative ? '-' : ''}{formatUSD(entry.amountUSD)}
                  </p>
                )}
                <p className={`text-base sm:text-xl font-bold font-mono ${entry.isNegative ? 'text-red-600' : 'text-green-700'}`}>
                  {entry.isNegative ? '-' : ''}{formatBs(entry.amountBs)}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => onToggleSign(entry.id)}
                  className="p-1.5 text-ocean-400 hover:text-ocean-600 hover:bg-ocean-100 rounded transition-colors"
                  title={entry.isNegative ? 'Cambiar a positivo' : 'Cambiar a negativo'}
                >
                  <PlusMinusIcon />
                </button>
                <button
                  onClick={() => onRemoveEntry(entry.id)}
                  className="p-1.5 text-red-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                  title="Eliminar"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
