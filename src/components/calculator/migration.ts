import type { CalcEntry, ClientData, DispatcherTab, SubClient, SavedSession } from './types';
import { LS_KEYS, DEFAULT_SUBCLIENT_NAME, DEFAULT_SUBCLIENT_COUNT, DISPATCHERS } from './constants';

interface LegacyCalcEntry {
  id: number;
  description: string;
  amountUSD: number;
  amountBs: number;
  isNegative: boolean;
}

/**
 * Migra datos del formato V1 (claves separadas) al formato V2 (ClientData[]).
 * Solo se usa como paso intermedio antes de migrateToDispatchers.
 */
function migrateV1ToV2(): ClientData[] | null {
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

    return names.map((name, i) => ({
      id: crypto.randomUUID(),
      name: name || `Cliente ${i + 1}`,
      dispatcher: oldDispatchers[String(i)] || undefined,
      entries: (oldEntries[String(i)] || []).map(e => ({
        ...e,
        id: crypto.randomUUID(),
      })),
    }));
  } catch {
    return null;
  }
}

/**
 * Migra datos del formato V2 (ClientData[]) al nuevo formato de dispatchers (DispatcherTab[]).
 * Cada ClientData se convierte en un SubClient dentro del dispatcher correspondiente.
 */
function migrateV2ToDispatchers(clients: ClientData[]): DispatcherTab[] {
  // Crear tabs vacíos para cada dispatcher
  const tabs = new Map<string, DispatcherTab>();
  for (const d of DISPATCHERS) {
    tabs.set(d.name, {
      id: crypto.randomUUID(),
      dispatcher: d.name,
      clients: [],
    });
  }

  // Distribuir clientes existentes a sus dispatchers
  for (const client of clients) {
    const dispName = client.dispatcher || DISPATCHERS[0].name;
    const tab = tabs.get(dispName);
    if (tab) {
      tab.clients.push({
        id: client.id,
        name: client.name,
        entries: client.entries,
      });
    } else {
      // Si el dispatcher no existe, agregarlo al primero
      const first = tabs.values().next().value;
      if (first) {
        first.clients.push({
          id: client.id,
          name: client.name,
          entries: client.entries,
        });
      }
    }
  }

  // Asegurar que cada tab tenga al menos DEFAULT_SUBCLIENT_COUNT sub-clientes
  for (const tab of tabs.values()) {
    while (tab.clients.length < DEFAULT_SUBCLIENT_COUNT) {
      tab.clients.push({
        id: crypto.randomUUID(),
        name: DEFAULT_SUBCLIENT_NAME(tab.clients.length),
        entries: [],
      });
    }
  }

  return Array.from(tabs.values());
}

/**
 * Detecta formato antiguo y migra al nuevo formato de dispatchers.
 * Maneja tanto V1 (claves separadas) como V2 (ClientData[]).
 */
export function migrateToDispatchers(): void {
  // Si ya hay datos en el nuevo formato, no migrar
  const existing = localStorage.getItem(LS_KEYS.DISPATCHERS);
  if (existing !== null) return;

  // Intentar migrar desde V2 (ClientData[])
  const v2Data = localStorage.getItem(LS_KEYS.CLIENTS);
  if (v2Data !== null) {
    try {
      const clients: ClientData[] = JSON.parse(v2Data);
      const dispatchers = migrateV2ToDispatchers(clients);
      localStorage.setItem(LS_KEYS.DISPATCHERS, JSON.stringify(dispatchers));
      localStorage.setItem(LS_KEYS.ACTIVE_DISPATCHER, JSON.stringify(dispatchers[0]?.id ?? ''));
      localStorage.setItem(LS_KEYS.ACTIVE_SUBCLIENT, JSON.stringify(dispatchers[0]?.clients[0]?.id ?? ''));
      return;
    } catch {
      // Si falla, continuar
    }
  }

  // Intentar migrar desde V1 (claves separadas)
  const v1Clients = migrateV1ToV2();
  if (v1Clients) {
    const dispatchers = migrateV2ToDispatchers(v1Clients);
    localStorage.setItem(LS_KEYS.DISPATCHERS, JSON.stringify(dispatchers));
    localStorage.setItem(LS_KEYS.ACTIVE_DISPATCHER, JSON.stringify(dispatchers[0]?.id ?? ''));
    localStorage.setItem(LS_KEYS.ACTIVE_SUBCLIENT, JSON.stringify(dispatchers[0]?.clients[0]?.id ?? ''));

    // Migrar sesiones
    try {
      const oldSessions: any[] = JSON.parse(localStorage.getItem(LS_KEYS.SESSIONS) || '[]');
      const sessions: SavedSession[] = oldSessions.map(s => ({
        ...s,
        id: typeof s.id === 'number' ? crypto.randomUUID() : s.id,
        entries: (s.entries || []).map((e: any) => ({
          ...e,
          id: typeof e.id === 'number' ? crypto.randomUUID() : e.id,
        })),
      }));
      localStorage.setItem(LS_KEYS.SESSIONS, JSON.stringify(sessions));
    } catch {
      // Ignorar errores de sesiones
    }
  }
}

/** @deprecated Usar migrateToDispatchers */
export function migrateIfNeeded() {
  migrateToDispatchers();
}
