import { useRef, useState } from 'react';
import { formatUSD, formatBs } from '../../lib/format';
import { evalMathExpr } from '../../lib/safe-math';
import { ChatBubbleIcon } from './icons';

const QUICK_PRODUCTS = [
  'Camarón Jumbo', 'Camarón Vivito', 'Camarón Desvenado', 'Camarón Precocido',
  'Calamar Nacional', 'Calamar Limpio', 'Pulpo', 'Salmón',
  'Pepitona', 'Guacuco', 'Mejillones Conchas', 'Mejillones Pelados',
  'Vieiras', 'Almejas', 'Tentáculo', 'Vaquita', 'Kigua', 'Pulpa de Cangrejo', 'Jaiba', 'Langostino',
];

interface CalcInputProps {
  inputAmount: string;
  inputCurrency: 'USD' | 'Bs';
  description: string;
  activeRate: number;
  dispatcherBg?: string;
  dispatcherText?: string;
  onInputAmountChange: (val: string) => void;
  onCurrencyToggle: () => void;
  onDescriptionChange: (val: string) => void;
  onAddEntry: () => void;
  amountRef: React.RefObject<HTMLInputElement | null>;
}

export function CalcInput({
  inputAmount, inputCurrency, description, activeRate,
  dispatcherBg, dispatcherText,
  onInputAmountChange, onCurrencyToggle, onDescriptionChange, onAddEntry, amountRef,
}: CalcInputProps) {
  const noteRef = useRef<HTMLInputElement>(null);
  const [showProducts, setShowProducts] = useState(false);
  const parsedAmount = evalMathExpr(inputAmount);
  const hasExpression = /[+\-*/]/.test(inputAmount.replace(/^-/, ''));

  let convertedUSD: number;
  let convertedBs: number;
  if (inputCurrency === 'USD') {
    convertedUSD = parsedAmount;
    convertedBs = activeRate ? parsedAmount * activeRate : 0;
  } else {
    convertedBs = parsedAmount;
    convertedUSD = activeRate ? parsedAmount / activeRate : 0;
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onAddEntry();
    }
  };

  return (
    <div className="bg-white rounded-xl p-2.5 sm:p-4 shadow-sm border border-ocean-100">
      <div className="flex items-center gap-2">
        <input
          ref={amountRef}
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={inputAmount}
          onChange={e => onInputAmountChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === ' ') {
              e.preventDefault();
              onInputAmountChange(inputAmount + '+');
            } else if (e.key === '[') {
              e.preventDefault();
              onInputAmountChange(inputAmount + '*');
            } else if (e.key === '=') {
              e.preventDefault();
              onInputAmountChange(inputAmount + '/');
            } else if (e.key === 'Escape') {
              onInputAmountChange('');
            } else if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp') {
              handleKeyDown(e);
            }
          }}
          className="flex-1 px-3 sm:px-4 py-2.5 sm:py-3 text-xl sm:text-2xl font-semibold border border-ocean-200 rounded-lg focus:ring-2 focus:ring-ocean-500 focus:border-transparent text-ocean-900 font-mono"
          autoFocus
        />
        <button
          onClick={onCurrencyToggle}
          className={`px-3 sm:px-4 py-2.5 sm:py-3 font-bold text-base sm:text-lg rounded-lg transition-colors min-w-[48px] sm:min-w-[56px] ${dispatcherBg && dispatcherText ? `${dispatcherBg} ${dispatcherText} hover:opacity-80` : 'bg-ocean-100 text-ocean-700 hover:bg-ocean-200'}`}
        >
          {inputCurrency === 'USD' ? '$' : 'Bs'}
        </button>
      </div>

      {hasExpression && parsedAmount !== 0 && (
        <div className={`mt-1 px-1 text-sm font-bold ${dispatcherText ?? 'text-ocean-500'}`}>
          = {inputCurrency === 'USD' ? formatUSD(parsedAmount) : formatBs(parsedAmount)}
        </div>
      )}

      {activeRate > 0 && (
        <div className={`mt-1.5 sm:mt-2 p-2 sm:p-3 rounded-lg text-center ${dispatcherBg ?? 'bg-ocean-50'}`}>
          <span className={`text-xs ${dispatcherText ?? 'text-ocean-500'}`}>
            {inputCurrency === 'USD' ? 'Bolívares' : 'Dólares'}
          </span>
          <p className={`text-xl sm:text-2xl font-bold ${dispatcherText ?? 'text-ocean-800'}`}>
            {inputCurrency === 'USD' ? formatBs(convertedBs) : formatUSD(convertedUSD)}
          </p>
        </div>
      )}

      {(() => {
        const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const segments = description.split(', ').filter(Boolean);
        const selectedProducts = segments.filter(s => QUICK_PRODUCTS.includes(s));
        const lastSeg = segments[segments.length - 1] ?? '';
        const isSearching = showProducts && lastSeg && !QUICK_PRODUCTS.includes(lastSeg);
        const searchTerm = isSearching ? lastSeg : '';
        const filtered = searchTerm
          ? QUICK_PRODUCTS.filter(p => normalize(p).includes(normalize(searchTerm)))
          : QUICK_PRODUCTS;

        const toggleProduct = (product: string) => {
          if (selectedProducts.includes(product)) {
            const remaining = segments.filter(s => s !== product);
            onDescriptionChange(remaining.join(', '));
          } else {
            const withoutSearch = isSearching ? segments.slice(0, -1) : segments;
            onDescriptionChange([...withoutSearch, product].join(', '));
          }
        };

        return (
          <>
            <div className="mt-1.5 sm:mt-2 flex items-center gap-2">
              <button
                onClick={() => {
                  setShowProducts(prev => !prev);
                  requestAnimationFrame(() => noteRef.current?.focus());
                }}
                className={`p-1.5 rounded-lg transition-colors ${showProducts || description ? 'bg-ocean-100 text-ocean-700' : 'bg-ocean-50 text-ocean-300 hover:text-ocean-500'}`}
                title="Productos / nota"
              >
                <ChatBubbleIcon />
              </button>
              <input
                ref={noteRef}
                type="text"
                placeholder={showProducts ? 'Buscar producto o escribir nota...' : 'nota...'}
                value={description}
                onChange={e => onDescriptionChange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    amountRef.current?.focus();
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (showProducts && searchTerm && filtered.length > 0) {
                      toggleProduct(filtered[0]);
                    } else {
                      onAddEntry();
                    }
                  } else if (e.key === 'Escape' && showProducts) {
                    setShowProducts(false);
                  }
                }}
                className="flex-1 px-2 py-1 text-xs text-ocean-400 border-0 bg-transparent focus:ring-0 focus:text-ocean-600 placeholder:text-ocean-200"
              />
              <button
                onClick={onAddEntry}
                disabled={parsedAmount === 0 || !activeRate}
                className="px-4 py-1.5 bg-ocean-600 text-white rounded-lg text-sm font-medium hover:bg-ocean-500 disabled:bg-ocean-300 transition-colors"
              >
                Agregar
              </button>
            </div>

            {showProducts && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {filtered.map(product => {
                  const isSelected = selectedProducts.includes(product);
                  return (
                    <button
                      key={product}
                      onClick={() => {
                        toggleProduct(product);
                        noteRef.current?.focus();
                      }}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                        isSelected
                          ? 'bg-ocean-600 text-white'
                          : 'bg-ocean-50 text-ocean-500 hover:bg-ocean-100'
                      }`}
                    >
                      {product}
                    </button>
                  );
                })}
                {searchTerm && filtered.length === 0 && (
                  <p className="text-[10px] text-ocean-400 py-0.5">Sin coincidencias</p>
                )}
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
