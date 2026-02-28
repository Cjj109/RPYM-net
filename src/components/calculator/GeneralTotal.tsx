import { formatUSD, formatBs } from '../../lib/format';

interface GeneralTotalProps {
  totalUSD: number;
  totalBs: number;
  activeClientCount: number;
}

export function GeneralTotal({ totalUSD, totalBs, activeClientCount }: GeneralTotalProps) {
  if (activeClientCount < 2) return null;

  return (
    <div className="bg-ocean-600 text-white px-3 py-1.5 flex items-center justify-between text-xs rounded-lg mt-1">
      <span className="font-medium">Total General ({activeClientCount} clientes)</span>
      <div className="flex items-center gap-3 font-mono">
        <span>{totalUSD < 0 ? '-' : ''}{formatUSD(Math.abs(totalUSD))}</span>
        <span className="font-bold">{totalBs < 0 ? '-' : ''}{formatBs(Math.abs(totalBs))}</span>
      </div>
    </div>
  );
}
