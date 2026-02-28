import { useState, useEffect, useCallback } from 'react';
import { formatUSD, formatBs } from '../lib/format';

interface CalcEntry {
  id: number;
  description: string;
  amountUSD: number;
  amountBs: number;
  isNegative: boolean;
}

interface AdminCalculatorProps {
  bcvRate?: { rate: number; date: string; source: string };
}

export default function AdminCalculator({ bcvRate: initialBcv }: AdminCalculatorProps) {
  // Tasa local (no afecta config global)
  const [autoRate, setAutoRate] = useState(initialBcv?.rate ?? 0);
  const [manualRate, setManualRate] = useState(() => {
    try {
      const saved = localStorage.getItem('rpym_calc_rate_config');
      return saved ? JSON.parse(saved).manualRate || '' : '';
    } catch { return ''; }
  });
  const [useManualRate, setUseManualRate] = useState(() => {
    try {
      const saved = localStorage.getItem('rpym_calc_rate_config');
      return saved ? JSON.parse(saved).useManualRate || false : false;
    } catch { return false; }
  });
  const [rateLoading, setRateLoading] = useState(!initialBcv);

  // Calculadora
  const [inputAmount, setInputAmount] = useState('');
  const [inputCurrency, setInputCurrency] = useState<'USD' | 'Bs'>('USD');
  const [description, setDescription] = useState('');

  // Lista de operaciones
  const [entries, setEntries] = useState<CalcEntry[]>(() => {
    try {
      const saved = localStorage.getItem('rpym_calc_entries');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [nextId, setNextId] = useState(() => {
    try {
      const saved = localStorage.getItem('rpym_calc_entries');
      const parsed: CalcEntry[] = saved ? JSON.parse(saved) : [];
      return parsed.length > 0 ? Math.max(...parsed.map(e => e.id)) + 1 : 1;
    } catch { return 1; }
  });

  const activeRate = useManualRate && manualRate ? parseFloat(manualRate) : autoRate;

  // Persistir entries en localStorage
  useEffect(() => {
    localStorage.setItem('rpym_calc_entries', JSON.stringify(entries));
  }, [entries]);

  // Persistir config de tasa manual
  useEffect(() => {
    localStorage.setItem('rpym_calc_rate_config', JSON.stringify({ useManualRate, manualRate }));
  }, [useManualRate, manualRate]);

  // Fetch tasa BCV al montar
  useEffect(() => {
    if (initialBcv?.rate) {
      setAutoRate(initialBcv.rate);
      setRateLoading(false);
      return;
    }
    fetch('/api/config/bcv-rate')
      .then(r => r.json())
      .then(data => {
        if (data.rate) setAutoRate(data.rate);
      })
      .catch(() => {})
      .finally(() => setRateLoading(false));
  }, [initialBcv]);

  // Evaluar expresión matemática (soporta +, -, *, /)
  const evalExpr = (expr: string): number => {
    const sanitized = expr.replace(/[^0-9+\-*/.() ]/g, '').trim();
    if (!sanitized) return 0;
    try {
      // Tokenizar y calcular de forma segura
      const tokens = sanitized.match(/(\d+\.?\d*|[+\-*/()])/g);
      if (!tokens) return 0;
      // Usar Function en vez de eval para aislamiento
      const result = new Function(`return (${tokens.join('')})`)();
      return typeof result === 'number' && isFinite(result) ? result : 0;
    } catch { return 0; }
  };

  const hasExpression = /[+\-*/]/.test(inputAmount.replace(/^-/, ''));

  // Conversión en vivo
  const parsedAmount = evalExpr(inputAmount);
  let convertedUSD: number;
  let convertedBs: number;
  if (inputCurrency === 'USD') {
    convertedUSD = parsedAmount;
    convertedBs = activeRate ? parsedAmount * activeRate : 0;
  } else {
    convertedBs = parsedAmount;
    convertedUSD = activeRate ? parsedAmount / activeRate : 0;
  }

  const addEntry = useCallback(() => {
    if (parsedAmount === 0 || !activeRate) return;
    const entry: CalcEntry = {
      id: nextId,
      description: description.trim(),
      amountUSD: convertedUSD,
      amountBs: convertedBs,
      isNegative: false,
    };
    setEntries(prev => [...prev, entry]);
    setNextId(prev => prev + 1);
    setInputAmount('');
    setDescription('');
  }, [parsedAmount, activeRate, nextId, description, convertedUSD, convertedBs]);

  const removeEntry = (id: number) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const toggleSign = (id: number) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, isNegative: !e.isNegative } : e));
  };

  const clearAll = () => {
    setEntries([]);
    setInputAmount('');
    setDescription('');
  };

  // Totales
  const totalUSD = entries.reduce((sum, e) => sum + (e.isNegative ? -e.amountUSD : e.amountUSD), 0);
  const totalBs = entries.reduce((sum, e) => sum + (e.isNegative ? -e.amountBs : e.amountBs), 0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEntry();
    }
  };

  return (
    <div className="space-y-6">
      {/* Tasa BCV */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-ocean-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-ocean-900">Tasa BCV</h2>
          {rateLoading ? (
            <span className="text-sm text-ocean-400 animate-pulse">Cargando...</span>
          ) : (
            <span className="text-2xl font-bold text-ocean-700">
              Bs. {activeRate.toFixed(2)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setUseManualRate(false)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              !useManualRate
                ? 'bg-ocean-600 text-white'
                : 'bg-ocean-50 text-ocean-600 hover:bg-ocean-100'
            }`}
          >
            Automatica ({autoRate.toFixed(2)})
          </button>
          <button
            onClick={() => setUseManualRate(true)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              useManualRate
                ? 'bg-ocean-600 text-white'
                : 'bg-ocean-50 text-ocean-600 hover:bg-ocean-100'
            }`}
          >
            Manual
          </button>
          {useManualRate && (
            <input
              type="number"
              step="0.01"
              placeholder="Ej: 419.98"
              value={manualRate}
              onChange={e => setManualRate(e.target.value)}
              className="w-32 px-3 py-2 border border-ocean-200 rounded-lg text-sm focus:ring-2 focus:ring-ocean-500 focus:border-transparent"
            />
          )}
        </div>
      </div>

      {/* Convertidor */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-ocean-100">
        {/* Monto principal grande */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={inputAmount}
            onChange={e => setInputAmount(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 px-4 py-3 text-2xl font-semibold border border-ocean-200 rounded-lg focus:ring-2 focus:ring-ocean-500 focus:border-transparent text-ocean-900 font-mono"
            autoFocus
          />
          <button
            onClick={() => setInputCurrency(prev => prev === 'USD' ? 'Bs' : 'USD')}
            className="px-4 py-3 bg-ocean-100 text-ocean-700 font-bold text-lg rounded-lg hover:bg-ocean-200 transition-colors min-w-[56px]"
          >
            {inputCurrency === 'USD' ? '$' : 'Bs'}
          </button>
        </div>

        {/* Resultado de expresión cuando hay operadores */}
        {hasExpression && parsedAmount !== 0 && (
          <div className="mt-2 px-1 text-sm text-ocean-500">
            = {inputCurrency === 'USD' ? formatUSD(parsedAmount) : formatBs(parsedAmount)}
          </div>
        )}

        {/* Resultado de conversión */}
        {activeRate > 0 && (
          <div className="mt-3 p-4 bg-ocean-50 rounded-lg text-center">
            <span className="text-sm text-ocean-500">
              {inputCurrency === 'USD' ? 'Bolivares' : 'Dolares'}
            </span>
            <p className="text-3xl font-bold text-ocean-800 mt-1">
              {inputCurrency === 'USD' ? formatBs(convertedBs) : formatUSD(convertedUSD)}
            </p>
          </div>
        )}

        {/* Descripción + agregar */}
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            placeholder="Nota (opcional)"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 px-3 py-2 border border-ocean-200 rounded-lg text-sm text-ocean-600 focus:ring-2 focus:ring-ocean-500 focus:border-transparent"
          />
          <button
            onClick={addEntry}
            disabled={parsedAmount === 0 || !activeRate}
            className="px-5 py-2 bg-ocean-600 text-white rounded-lg text-sm font-medium hover:bg-ocean-500 disabled:bg-ocean-300 transition-colors"
          >
            Agregar
          </button>
        </div>
      </div>

      {/* Lista de operaciones */}
      {entries.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-ocean-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-ocean-900">Operaciones</h2>
            <button
              onClick={clearAll}
              className="text-sm text-red-500 hover:text-red-700 transition-colors"
            >
              Limpiar todo
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ocean-100">
                  <th className="text-left py-2 px-2 text-ocean-500 font-medium">Desc.</th>
                  <th className="text-right py-2 px-2 text-ocean-500 font-medium">USD</th>
                  <th className="text-right py-2 px-2 text-ocean-500 font-medium">Bs</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry.id} className="border-b border-ocean-50 hover:bg-ocean-25">
                    <td className="py-2 px-2 text-ocean-700">
                      {entry.description || '-'}
                    </td>
                    <td className={`py-2 px-2 text-right font-mono ${entry.isNegative ? 'text-red-600' : 'text-ocean-800'}`}>
                      {entry.isNegative ? '-' : ''}{formatUSD(entry.amountUSD)}
                    </td>
                    <td className={`py-2 px-2 text-right font-mono ${entry.isNegative ? 'text-red-600' : 'text-ocean-800'}`}>
                      {entry.isNegative ? '-' : ''}{formatBs(entry.amountBs)}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <button
                        onClick={() => toggleSign(entry.id)}
                        className="p-1 text-ocean-400 hover:text-ocean-600 transition-colors"
                        title={entry.isNegative ? 'Cambiar a positivo' : 'Cambiar a negativo'}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                      </button>
                      <button
                        onClick={() => removeEntry(entry.id)}
                        className="p-1 text-red-300 hover:text-red-500 transition-colors"
                        title="Eliminar"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ocean-200">
                  <td className="py-3 px-2 font-semibold text-ocean-900">Total</td>
                  <td className={`py-3 px-2 text-right font-mono font-bold ${totalUSD < 0 ? 'text-red-600' : 'text-ocean-900'}`}>
                    {totalUSD < 0 ? '-' : ''}{formatUSD(Math.abs(totalUSD))}
                  </td>
                  <td className={`py-3 px-2 text-right font-mono font-bold ${totalBs < 0 ? 'text-red-600' : 'text-ocean-900'}`}>
                    {totalBs < 0 ? '-' : ''}{formatBs(Math.abs(totalBs))}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
