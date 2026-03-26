export interface CalcEntry {
  id: string;
  description: string;
  amountUSD: number;
  amountBs: number;
  isNegative: boolean;
  expression?: string;
}

export interface SubClient {
  id: string;
  name: string;
  entries: CalcEntry[];
}

export interface DispatcherTab {
  id: string;
  dispatcher: string;
  clients: SubClient[];
}

/** @deprecated Usar DispatcherTab + SubClient */
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
  | { type: 'delete_entry'; dispatcherId: string; clientId: string; entry: CalcEntry; index: number }
  | { type: 'clear_all'; dispatcherId: string; clientId: string; entries: CalcEntry[]; clientName: string; sessionId?: string };

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
  strip: string;
}

export interface ClientTotals {
  usd: number;
  bs: number;
}

export interface QuickOpEntry {
  id: string;
  amountInput: string;
  currency: 'USD' | 'Bs';
  amountUSD: number;
  amountBs: number;
  expression?: string;
  note?: string;
}

export interface QuickQueueItem {
  id: string;
  dispatcher: string;
  entries: QuickOpEntry[];
  totalUSD: number;
  totalBs: number;
  rate: number;
  timestamp: number;
  note?: string;
}
