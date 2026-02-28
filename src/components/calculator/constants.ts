import type { Dispatcher } from './types';

export const DISPATCHERS: readonly Dispatcher[] = [
  { name: 'Carlos', bg: 'bg-blue-100', text: 'text-blue-700', ring: 'ring-blue-300', badge: 'bg-blue-50 text-blue-600' },
  { name: 'Pa', bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-300', badge: 'bg-emerald-50 text-emerald-600' },
  { name: 'Luis', bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-300', badge: 'bg-amber-50 text-amber-600' },
  { name: 'Pedro', bg: 'bg-rose-100', text: 'text-rose-700', ring: 'ring-rose-300', badge: 'bg-rose-50 text-rose-600' },
] as const;

export const LS_KEYS = {
  CLIENTS: 'rpym_calc_clients',
  ACTIVE_CLIENT: 'rpym_calc_active_client',
  SESSIONS: 'rpym_calc_sessions',
  RATE_CONFIG: 'rpym_calc_rate_config',
  // Claves legacy (para detectar migración)
  LEGACY_CLIENT_NAMES: 'rpym_calc_client_names',
  LEGACY_CLIENT_ENTRIES: 'rpym_calc_client_entries',
  LEGACY_CLIENT_DISPATCHER: 'rpym_calc_client_dispatcher',
} as const;

export const DEFAULT_CLIENT_NAME = (index: number) => `Cliente ${index + 1}`;

export const DEFAULT_CLIENTS_COUNT = 5;
