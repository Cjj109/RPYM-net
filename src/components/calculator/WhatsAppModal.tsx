import { useState, useRef } from 'react';
import html2canvas from 'html2canvas';
import { formatUSD, formatBs } from '../../lib/format';
import { formatPhoneDisplay, isValidVenezuelanPhone } from '../../lib/phone-ve';
import { renderCalcCardHTML, openCalcCardWindow } from '../../lib/calc-whatsapp-card';
import type { CalcEntry } from './types';
import { WhatsAppIcon } from './icons';

interface WhatsAppModalProps {
  entries: CalcEntry[];
  clientName: string;
  totalUSD: number;
  totalBs: number;
  activeRate: number;
  onClose: () => void;
}

export function WhatsAppModal({ entries, clientName, totalUSD, totalBs, activeRate, onClose }: WhatsAppModalProps) {
  const [phone, setPhone] = useState('');
  const [nameInput, setNameInput] = useState(clientName || '');
  const [status, setStatus] = useState<'idle' | 'capturing' | 'uploading' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  const [refId] = useState(() => String(Math.floor(100000 + Math.random() * 900000)));

  const resolvedName = nameInput.trim() || 'Cliente';
  const cardData = { entries, clientName: resolvedName, totalUSD, totalBs, activeRate, refId };

  const handlePreview = () => {
    openCalcCardWindow(cardData, window.location.origin);
  };

  const handleSend = async () => {
    if (!isValidVenezuelanPhone(phone)) {
      setError('Número inválido. Usa formato: 0414XXXXXXX');
      setStatus('error');
      return;
    }

    setSending(true);
    setStatus('capturing');
    setError(null);

    try {
      const captureDiv = captureRef.current;
      if (!captureDiv) throw new Error('Container de captura no encontrado');

      captureDiv.innerHTML = renderCalcCardHTML(cardData, window.location.origin);
      captureDiv.style.display = 'block';

      await new Promise(resolve => setTimeout(resolve, 400));

      const canvas = await html2canvas(captureDiv.firstElementChild as HTMLElement, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: 320,
        windowWidth: 320,
      });

      captureDiv.style.display = 'none';

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => b ? resolve(b) : reject(new Error('Error al crear imagen')),
          'image/jpeg',
          0.85
        );
      });

      if (blob.size > 5 * 1024 * 1024) {
        throw new Error('La imagen es demasiado grande');
      }

      setStatus('uploading');

      const formData = new FormData();
      formData.append('image', blob, 'calculadora.jpg');
      formData.append('phone', phone.replace(/\D/g, ''));
      formData.append('customerName', resolvedName);
      formData.append('totalUSD', Math.abs(totalUSD).toFixed(2));
      formData.append('presupuestoId', refId);

      const response = await fetch('/api/send-whatsapp', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        setStatus('sent');
      } else {
        throw new Error(result.error || 'Error desconocido');
      }
    } catch (err: any) {
      console.error('WhatsApp send error:', err);
      setStatus('error');
      setError(err.message || 'Error al enviar por WhatsApp');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-green-600 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-white">
              <WhatsAppIcon className="w-6 h-6" />
              <span className="font-semibold">Enviar por WhatsApp</span>
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white p-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            {/* Info */}
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">{entries.length} producto{entries.length !== 1 ? 's' : ''}</p>
              <p className="text-lg font-bold text-green-600 mt-1">{totalUSD < 0 ? '-' : ''}{formatUSD(Math.abs(totalUSD))}</p>
              {activeRate > 0 && (
                <p className="text-sm font-semibold text-orange-500">{totalBs < 0 ? '-' : ''}{formatBs(Math.abs(totalBs))}</p>
              )}
            </div>

            {/* Ver imagen */}
            <button
              onClick={handlePreview}
              className="w-full py-2.5 bg-ocean-100 text-ocean-700 rounded-xl font-medium transition-colors hover:bg-ocean-200 flex items-center justify-center gap-2 text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Ver imagen (para screenshot)
            </button>

            {/* Teléfono */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">Número de WhatsApp</label>
              <input
                type="tel"
                placeholder="0414-123-4567"
                value={formatPhoneDisplay(phone)}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '');
                  setPhone(digits.slice(0, 11));
                  setStatus('idle');
                  setError(null);
                }}
                className="w-full px-4 py-3 text-lg border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none placeholder:text-gray-400 font-mono text-center"
                disabled={sending}
                autoFocus
              />
            </div>

            {/* Nombre */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">Nombre del cliente</label>
              <input
                type="text"
                placeholder="Cliente"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none placeholder:text-gray-400 text-center"
                disabled={sending}
              />
            </div>

            {/* Status */}
            {status === 'sent' && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-green-700 font-medium">Enviado correctamente</span>
              </div>
            )}
            {status === 'error' && error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                <span className="text-red-500 flex-shrink-0">&#9888;&#65039;</span>
                <span className="text-sm text-red-700">{error}</span>
              </div>
            )}

            {/* Enviar */}
            <button
              onClick={handleSend}
              disabled={sending || !isValidVenezuelanPhone(phone)}
              className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold transition-colors hover:bg-green-500 disabled:bg-green-300 flex items-center justify-center gap-2"
            >
              {status === 'capturing' ? (
                <>
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                  Capturando imagen...
                </>
              ) : status === 'uploading' ? (
                <>
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                  Enviando...
                </>
              ) : (
                <>
                  <WhatsAppIcon className="w-5 h-5" />
                  Enviar por WhatsApp
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Hidden div for html2canvas capture */}
      <div
        ref={captureRef}
        style={{ position: 'fixed', left: '-9999px', top: 0, zIndex: -1, display: 'none' }}
      />
    </>
  );
}
