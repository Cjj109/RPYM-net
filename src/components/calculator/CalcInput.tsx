import { useRef } from 'react';
import { formatUSD, formatBs } from '../../lib/format';
import { evalMathExpr } from '../../lib/safe-math';
import { ChatBubbleIcon } from './icons';

interface CalcInputProps {
  inputAmount: string;
  inputCurrency: 'USD' | 'Bs';
  description: string;
  activeRate: number;
  onInputAmountChange: (val: string) => void;
  onCurrencyToggle: () => void;
  onDescriptionChange: (val: string) => void;
  onAddEntry: () => void;
  amountRef: React.RefObject<HTMLInputElement | null>;
}

export function CalcInput({
  inputAmount, inputCurrency, description, activeRate,
  onInputAmountChange, onCurrencyToggle, onDescriptionChange, onAddEntry, amountRef,
}: CalcInputProps) {
  const noteRef = useRef<HTMLInputElement>(null);
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
          className="px-3 sm:px-4 py-2.5 sm:py-3 bg-ocean-100 text-ocean-700 font-bold text-base sm:text-lg rounded-lg hover:bg-ocean-200 transition-colors min-w-[48px] sm:min-w-[56px]"
        >
          {inputCurrency === 'USD' ? '$' : 'Bs'}
        </button>
      </div>

      {hasExpression && parsedAmount !== 0 && (
        <div className="mt-1 px-1 text-sm text-ocean-500">
          = {inputCurrency === 'USD' ? formatUSD(parsedAmount) : formatBs(parsedAmount)}
        </div>
      )}

      {activeRate > 0 && (
        <div className="mt-1.5 sm:mt-2 p-2 sm:p-3 bg-ocean-50 rounded-lg text-center">
          <span className="text-xs text-ocean-500">
            {inputCurrency === 'USD' ? 'Bolívares' : 'Dólares'}
          </span>
          <p className="text-xl sm:text-2xl font-bold text-ocean-800">
            {inputCurrency === 'USD' ? formatBs(convertedBs) : formatUSD(convertedUSD)}
          </p>
        </div>
      )}

      <div className="mt-1.5 sm:mt-2 flex items-center gap-2">
        <button
          onClick={() => noteRef.current?.focus()}
          className={`p-1.5 rounded-lg transition-colors ${description ? 'bg-ocean-100 text-ocean-700' : 'bg-ocean-50 text-ocean-300 hover:text-ocean-500'}`}
          title="Agregar nota"
        >
          <ChatBubbleIcon />
        </button>
        <input
          ref={noteRef}
          type="text"
          placeholder="nota..."
          value={description}
          onChange={e => onDescriptionChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              amountRef.current?.focus();
            } else {
              handleKeyDown(e);
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
    </div>
  );
}
