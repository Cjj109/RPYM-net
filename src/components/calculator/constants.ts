import type { Dispatcher } from './types';

export const DISPATCHERS: readonly Dispatcher[] = [
  { name: 'Carlos', bg: 'bg-red-100', text: 'text-red-700', ring: 'ring-red-300', badge: 'bg-red-100 text-red-600', strip: 'bg-red-400' },
  { name: 'Luis', bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-300', badge: 'bg-amber-50 text-amber-600', strip: 'bg-amber-400' },
  { name: 'Pedro', bg: 'bg-teal-100', text: 'text-teal-700', ring: 'ring-teal-300', badge: 'bg-teal-50 text-teal-600', strip: 'bg-teal-400' },
  { name: 'Johan', bg: 'bg-violet-100', text: 'text-violet-700', ring: 'ring-violet-300', badge: 'bg-violet-50 text-violet-600', strip: 'bg-violet-400' },
  { name: 'Pa', bg: 'bg-blue-100', text: 'text-blue-700', ring: 'ring-blue-300', badge: 'bg-blue-50 text-blue-600', strip: 'bg-blue-400' },
] as const;

export const LS_KEYS = {
  DISPATCHERS: 'rpym_calc_dispatchers',
  ACTIVE_DISPATCHER: 'rpym_calc_active_dispatcher',
  ACTIVE_SUBCLIENT: 'rpym_calc_active_subclient',
  ACTIVE_SUBCLIENT_MAP: 'rpym_calc_active_subclient_map',
  SESSIONS: 'rpym_calc_sessions',
  RATE_CONFIG: 'rpym_calc_rate_config',
  QUICK_QUEUE: 'rpym_calc_quick_queue',
  // Claves del formato anterior (para migración)
  CLIENTS: 'rpym_calc_clients',
  ACTIVE_CLIENT: 'rpym_calc_active_client',
  // Claves legacy V1
  LEGACY_CLIENT_NAMES: 'rpym_calc_client_names',
  LEGACY_CLIENT_ENTRIES: 'rpym_calc_client_entries',
  LEGACY_CLIENT_DISPATCHER: 'rpym_calc_client_dispatcher',
} as const;

export const DEFAULT_SUBCLIENT_NAME = (index: number) => `Cliente ${index + 1}`;
export const DEFAULT_SUBCLIENT_COUNT = 5;

/** @deprecated */
export const DEFAULT_CLIENT_NAME = (index: number) => `Cliente ${index + 1}`;
/** @deprecated */
export const DEFAULT_DISPATCHER: readonly string[] = ['Carlos', 'Luis', 'Pedro', 'Johan', 'Pa'];
/** @deprecated */
export const DEFAULT_CLIENTS_COUNT = 5;
