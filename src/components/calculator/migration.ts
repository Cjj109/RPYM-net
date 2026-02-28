import type { CalcEntry, ClientData, SavedSession } from './types';
import { LS_KEYS, DEFAULT_CLIENT_NAME } from './constants';

interface LegacyCalcEntry {
  id: number;
  description: string;
  amountUSD: number;
  amountBs: number;
  isNegative: boolean;
}

/**
 * Detecta formato antiguo (claves separadas con índices numéricos)
 * y migra a formato nuevo (ClientData[] unificado con UUIDs).
 * Retorna los datos migrados, o null si ya están en formato nuevo o no hay datos.
 */
export function migrateIfNeeded(): { clients: ClientData[]; activeClientId: string; sessions: SavedSession[] } | null {
  const newClients = localStorage.getItem(LS_KEYS.CLIENTS);
  if (newClients !== null) return null;

  const oldNames = localStorage.getItem(LS_KEYS.LEGACY_CLIENT_NAMES);
  if (oldNames === null) return null;

  try {
    const names: string[] = JSON.parse(oldNames);
    const oldEntries: Record<string, LegacyCalcEntry[]> = JSON.parse(
      localStorage.getItem(LS_KEYS.LEGACY_CLIENT_ENTRIES) || '{}'
    );
    const oldDispatchers: Record<string, string> = JSON.parse(
      localStorage.getItem(LS_KEYS.LEGACY_CLIENT_DISPATCHER) || '{}'
    );
    const oldActiveIndex = parseInt(localStorage.getItem('rpym_calc_active_client') || '0');

    const clients: ClientData[] = names.map((name, i) => ({
      id: crypto.randomUUID(),
      name: name || DEFAULT_CLIENT_NAME(i),
      dispatcher: oldDispatchers[String(i)] || undefined,
      entries: (oldEntries[String(i)] || []).map(e => ({
        ...e,
        id: crypto.randomUUID(),
      })),
    }));

    const activeClientId = clients[oldActiveIndex]?.id || clients[0]?.id || '';

    const oldSessions: any[] = JSON.parse(
      localStorage.getItem(LS_KEYS.SESSIONS) || '[]'
    );
    const sessions: SavedSession[] = oldSessions.map(s => ({
      ...s,
      id: typeof s.id === 'number' ? crypto.randomUUID() : s.id,
      entries: (s.entries || []).map((e: any) => ({
        ...e,
        id: typeof e.id === 'number' ? crypto.randomUUID() : e.id,
      })),
    }));

    localStorage.setItem(LS_KEYS.CLIENTS, JSON.stringify(clients));
    localStorage.setItem(LS_KEYS.ACTIVE_CLIENT, JSON.stringify(activeClientId));
    localStorage.setItem(LS_KEYS.SESSIONS, JSON.stringify(sessions));

    return { clients, activeClientId, sessions };
  } catch {
    return null;
  }
}
