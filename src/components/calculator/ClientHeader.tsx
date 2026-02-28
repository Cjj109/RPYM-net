import { useState, useRef, useEffect } from 'react';
import { formatUSD, formatBs } from '../../lib/format';
import type { ClientData, CalcEntry } from './types';
import { DISPATCHERS } from './constants';
import { PencilIcon, TrashIcon, CopyIcon, WhatsAppIcon } from './icons';

interface ClientHeaderProps {
  client: ClientData;
  totalUSD: number;
  totalBs: number;
  activeRate: number;
  clientCount: number;
  onRename: (name: string) => void;
  onSetDispatcher: (name: string | undefined) => void;
  onClearAll: () => void;
  onRemoveClient: () => void;
  onAdjustTotal: (newTotalUSD: number) => void;
  amountRef: React.RefObject<HTMLInputElement | null>;
}

function buildClientSummary(client: ClientData, totalUSD: number, totalBs: number, activeRate: number): string {
  let text = `*${client.name}*\n`;
  if (client.dispatcher) text += `Despachador: ${client.dispatcher}\n`;
  text += `\n`;

  for (const entry of client.entries) {
    const sign = entry.isNegative ? '-' : '';
    text += `${entry.description ? entry.description + ': ' : ''}${sign}${formatUSD(entry.amountUSD)} / ${sign}${formatBs(entry.amountBs)}\n`;
  }

  text += `\n---\n`;
  text += `*Total:* ${totalUSD < 0 ? '-' : ''}${formatUSD(Math.abs(totalUSD))} / ${totalBs < 0 ? '-' : ''}${formatBs(Math.abs(totalBs))}\n`;
  text += `Tasa: Bs. ${activeRate.toFixed(2)}`;

  return text;
}

export function ClientHeader({
  client, totalUSD, totalBs, activeRate, clientCount,
  onRename, onSetDispatcher, onClearAll, onRemoveClient, onAdjustTotal, amountRef,
}: ClientHeaderProps) {
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const editNameRef = useRef<HTMLInputElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editingTotal, setEditingTotal] = useState(false);
  const [editTotalValue, setEditTotalValue] = useState('');
  const editTotalRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (editingName) {
      requestAnimationFrame(() => { editNameRef.current?.focus(); editNameRef.current?.select(); });
    }
  }, [editingName]);

  useEffect(() => {
    if (editingTotal) {
      requestAnimationFrame(() => { editTotalRef.current?.focus(); editTotalRef.current?.select(); });
    }
  }, [editingTotal]);

  // Resetear confirmación al cambiar de cliente
  useEffect(() => {
    setConfirmingDelete(false);
  }, [client.id]);

  const startRenaming = () => {
    setEditingName(true);
    setEditNameValue(client.name);
  };

  const finishRenaming = () => {
    onRename(editNameValue.trim() || client.name);
    setEditingName(false);
  };

  const handleCopy = async () => {
    const summary = buildClientSummary(client, totalUSD, totalBs, activeRate);
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: no hacer nada
    }
  };

  const handleWhatsApp = () => {
    const summary = buildClientSummary(client, totalUSD, totalBs, activeRate);
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(summary)}`, '_blank');
  };

  const entries = client.entries;

  return (
    <div className="bg-white border-x border-ocean-100 px-2.5 sm:px-4 pt-2 sm:pt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {editingName ? (
            <input
              ref={editNameRef}
              type="text"
              value={editNameValue}
              onChange={e => setEditNameValue(e.target.value)}
              onBlur={finishRenaming}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditingName(false);
              }}
              className="text-sm font-semibold text-ocean-900 bg-transparent border-b-2 border-ocean-500 outline-none py-0 px-0"
            />
          ) : (
            <h2
              onClick={startRenaming}
              className="text-sm font-semibold text-ocean-900 cursor-pointer hover:text-ocean-600 transition-colors"
              title="Click para renombrar"
            >
              {client.name}
              <PencilIcon className="w-3 h-3 inline-block ml-1 text-ocean-300" />
            </h2>
          )}
          <div className="flex items-center gap-1">
            {DISPATCHERS.map(d => {
              const isActive = client.dispatcher === d.name;
              return (
                <button
                  key={d.name}
                  onClick={() => {
                    onSetDispatcher(isActive ? undefined : d.name);
                    requestAnimationFrame(() => amountRef.current?.focus());
                  }}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all ${
                    isActive
                      ? `${d.bg} ${d.text} ring-1 ${d.ring} scale-105`
                      : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
                  }`}
                >
                  {d.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {entries.length > 0 && (
            <>
              <button
                onClick={handleCopy}
                className={`p-1 rounded transition-colors ${copied ? 'text-green-600' : 'text-ocean-300 hover:text-ocean-600'}`}
                title={copied ? 'Copiado!' : 'Copiar resumen'}
              >
                <CopyIcon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleWhatsApp}
                className="p-1 text-green-500 hover:text-green-700 rounded transition-colors"
                title="Enviar por WhatsApp"
              >
                <WhatsAppIcon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onClearAll}
                className="text-xs text-red-500 hover:text-red-700 transition-colors"
              >
                Limpiar
              </button>
            </>
          )}
          {clientCount > 1 && (
            confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-red-500">Eliminar?</span>
                <button
                  onClick={() => { onRemoveClient(); setConfirmingDelete(false); }}
                  className="text-[10px] font-medium text-red-600 hover:text-red-800 transition-colors"
                >
                  Si
                </button>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="text-[10px] font-medium text-ocean-400 hover:text-ocean-600 transition-colors"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="text-xs text-ocean-300 hover:text-red-500 transition-colors"
                title="Eliminar cliente"
              >
                <TrashIcon />
              </button>
            )
          )}
        </div>
      </div>

      {entries.length > 0 && (
        <div className={`p-2 sm:p-3 rounded-lg text-center ${totalUSD < 0 ? 'bg-red-50 border border-red-200' : 'bg-ocean-50'}`}>
          <span className={`text-xs ${totalUSD < 0 ? 'text-red-500' : 'text-ocean-500'}`}>Total</span>
          <p className={`text-xl sm:text-2xl font-bold mt-0.5 ${totalBs < 0 ? 'text-red-600' : 'text-ocean-800'}`}>
            {totalBs < 0 ? '-' : ''}{formatBs(Math.abs(totalBs))}
          </p>
          {editingTotal ? (
            <div className="flex items-center gap-1 justify-center mt-1">
              <span className="text-xs font-mono text-ocean-400">$</span>
              <input
                ref={editTotalRef}
                type="text"
                inputMode="decimal"
                value={editTotalValue}
                onChange={e => setEditTotalValue(e.target.value)}
                onBlur={() => {
                  const val = parseFloat(editTotalValue.replace(/,/g, '.'));
                  if (!isNaN(val) && val >= 0) onAdjustTotal(val);
                  setEditingTotal(false);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditingTotal(false);
                }}
                className="w-20 text-xs font-mono bg-transparent border-b-2 border-ocean-400 outline-none py-0 text-center"
              />
            </div>
          ) : (
            <p
              onClick={() => { setEditingTotal(true); setEditTotalValue(Math.abs(totalUSD).toFixed(2)); }}
              className={`text-xs font-mono cursor-pointer hover:underline mt-0.5 ${totalUSD < 0 ? 'text-red-400' : 'text-ocean-400'}`}
              title="Click para ajustar total"
            >
              {totalUSD < 0 ? '-' : ''}{formatUSD(Math.abs(totalUSD))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
