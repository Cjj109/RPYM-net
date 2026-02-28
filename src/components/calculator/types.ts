export interface CalcEntry {
  id: string;
  description: string;
  amountUSD: number;
  amountBs: number;
  isNegative: boolean;
}

export interface ClientData {
  id: string;
  name: string;
  dispatcher?: string;
  entries: CalcEntry[];
}

export interface SavedSession {
  id: string;
  clientName: string;
  dispatcher?: string;
  entries: CalcEntry[];
  totalUSD: number;
  totalBs: number;
  rate: number;
  timestamp: number;
}

export type UndoAction =
  | { type: 'delete_entry'; clientId: string; entry: CalcEntry; index: number }
  | { type: 'clear_all'; clientId: string; entries: CalcEntry[]; clientName: string; dispatcher?: string; sessionId?: string }
  | { type: 'toggle_sign'; clientId: string; entryId: string };

export interface RateConfig {
  useManualRate: boolean;
  manualRate: string;
}

export interface Dispatcher {
  name: string;
  bg: string;
  text: string;
  ring: string;
  badge: string;
}

export interface ClientTotals {
  usd: number;
  bs: number;
}
