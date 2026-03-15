import { useState, useRef, useEffect } from 'react';
import { formatUSD, formatBs } from '../../lib/format';
import type { DispatcherTab, SubClient } from './types';
import { DISPATCHERS } from './constants';
import { CopyIcon, WhatsAppIcon, TrashIcon } from './icons';
import { WhatsAppModal } from './WhatsAppModal';

interface ClientHeaderProps {
  dispatcher: DispatcherTab;
  client: SubClient;
  totalUSD: number;
  totalBs: number;
  activeRate: number;
  onClearAll: () => void;
  onAdjustTotal: (newTotalUSD: number) => void;
  amountRef: React.RefObject<HTMLInputElement | null>;
}

function buildClientSummary(dispatcher: DispatcherTab, client: SubClient, totalUSD: number, totalBs: number, activeRate: number): string {
  let text = `*${dispatcher.dispatcher} — ${client.name}*\n\n`;

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
  dispatcher, client, totalUSD, totalBs, activeRate,
  onClearAll, onAdjustTotal, amountRef,
}: ClientHeaderProps) {
  const [editingTotal, setEditingTotal] = useState(false);
  const [editTotalValue, setEditTotalValue] = useState('');
  const editTotalRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [showWhatsApp, setShowWhatsApp] = useState(false);

  useEffect(() => {
    if (editingTotal) {
      requestAnimationFrame(() => { editTotalRef.current?.focus(); editTotalRef.current?.select(); });
    }
  }, [editingTotal]);

  useEffect(() => {
    setEditingTotal(false);
  }, [client.id]);

  const handleCopy = async () => {
    const summary = buildClientSummary(dispatcher, client, totalUSD, totalBs, activeRate);
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const entries = client.entries;
  const disp = DISPATCHERS.find(d => d.name === dispatcher.dispatcher);

  return (
    <div className="bg-white border-x border-ocean-100 px-2.5 sm:px-4">
      {/* Total */}
      {entries.length > 0 && (
        <div className={`p-2 sm:p-3 rounded-lg text-center ring-1 ${
          totalUSD < 0
            ? 'bg-red-50 border border-red-200 ring-red-200'
            : disp
              ? `${disp.bg} ${disp.ring}`
              : 'bg-ocean-50 ring-ocean-100'
        }`}>
          <span className={`text-xs ${totalUSD < 0 ? 'text-red-500' : disp ? disp.text : 'text-ocean-500'}`}>Total</span>
          <p className={`text-xl sm:text-2xl font-bold mt-0.5 ${totalBs < 0 ? 'text-red-600' : disp ? disp.text : 'text-ocean-800'}`}>
            {totalBs < 0 ? '-' : ''}{formatBs(Math.abs(totalBs))}
          </p>
          {editingTotal ? (
            <div className="flex items-center gap-1 justify-center mt-1">
              <span className={`text-xs font-mono ${disp ? disp.text : 'text-ocean-400'}`}>$</span>
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
                className="w-20 text-xs font-mono bg-transparent border-b-2 border-current outline-none py-0 text-center"
              />
            </div>
          ) : (
            <p
              onClick={() => { setEditingTotal(true); setEditTotalValue(Math.abs(totalUSD).toFixed(2)); }}
              className={`text-xs font-mono font-bold cursor-pointer hover:underline mt-0.5 ${totalUSD < 0 ? 'text-red-400' : disp ? `${disp.text} opacity-70` : 'text-ocean-400'}`}
              title="Click para ajustar total"
            >
              {totalUSD < 0 ? '-' : ''}{formatUSD(Math.abs(totalUSD))}
            </p>
          )}
        </div>
      )}

      {/* Acciones */}
      {entries.length > 0 && (
        <div className="flex items-center justify-center gap-3 py-1.5">
          <button onClick={handleCopy} className="p-1.5 text-ocean-300 hover:text-ocean-600 transition-colors" title="Copiar resumen">
            {copied ? <span className="text-green-500 text-xs font-medium">✓</span> : <CopyIcon className="w-4 h-4" />}
          </button>
          <button onClick={() => setShowWhatsApp(true)} className="p-1.5 text-ocean-300 hover:text-green-600 transition-colors" title="Enviar por WhatsApp">
            <WhatsAppIcon className="w-4 h-4" />
          </button>
          <button onClick={onClearAll} className="p-1.5 text-ocean-200 hover:text-red-500 transition-colors" title="Limpiar entradas">
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {showWhatsApp && (
        <WhatsAppModal
          entries={entries}
          clientName={`${dispatcher.dispatcher} — ${client.name}`}
          totalUSD={totalUSD}
          totalBs={totalBs}
          activeRate={activeRate}
          onClose={() => setShowWhatsApp(false)}
        />
      )}
    </div>
  );
}
