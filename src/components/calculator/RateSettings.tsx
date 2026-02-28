import type { RateConfig } from './types';

interface RateSettingsProps {
  autoRate: number;
  rateConfig: RateConfig;
  onRateConfigChange: (config: RateConfig) => void;
}

export function RateSettings({ autoRate, rateConfig, onRateConfigChange }: RateSettingsProps) {
  const { useManualRate, manualRate } = rateConfig;

  return (
    <div className="mb-3 p-3 bg-ocean-50 rounded-lg border border-ocean-100">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => onRateConfigChange({ ...rateConfig, useManualRate: false })}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            !useManualRate ? 'bg-ocean-600 text-white' : 'bg-white text-ocean-600 hover:bg-ocean-100'
          }`}
        >
          Auto ({autoRate.toFixed(2)})
        </button>
        <button
          onClick={() => onRateConfigChange({ ...rateConfig, useManualRate: true })}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            useManualRate ? 'bg-ocean-600 text-white' : 'bg-white text-ocean-600 hover:bg-ocean-100'
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
            onChange={e => onRateConfigChange({ ...rateConfig, manualRate: e.target.value })}
            className="w-28 px-2 py-1.5 border border-ocean-200 rounded-lg text-xs focus:ring-2 focus:ring-ocean-500 focus:border-transparent"
          />
        )}
      </div>
    </div>
  );
}
