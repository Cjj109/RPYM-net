/**
 * Configuración de proveedores de IA.
 * La preferencia (cuál proveedor es principal y cuál de respaldo) se guarda
 * en la tabla site_config de D1. Las API keys NO se guardan aquí: viven en
 * las variables de entorno de Cloudflare (ver env.ts).
 */

import type { D1Database } from './d1-types';

/** Proveedores de IA soportados */
export type AIProvider = 'gemini' | 'claude' | 'openai';

/** Todos los proveedores, en orden de relleno por defecto */
export const ALL_PROVIDERS: AIProvider[] = ['gemini', 'claude', 'openai'];

export interface ProviderMeta {
  id: AIProvider;
  /** Nombre legible para mostrar en la UI */
  label: string;
  /** Nombre de la env var con la API key */
  envKey: 'GEMINI_API_KEY' | 'CLAUDE_API_KEY' | 'OPENAI_API_KEY';
}

export const PROVIDER_META: Record<AIProvider, ProviderMeta> = {
  gemini: { id: 'gemini', label: 'Google Gemini', envKey: 'GEMINI_API_KEY' },
  claude: { id: 'claude', label: 'Claude Haiku (Anthropic)', envKey: 'CLAUDE_API_KEY' },
  openai: { id: 'openai', label: 'ChatGPT (OpenAI)', envKey: 'OPENAI_API_KEY' },
};

const DEFAULT_PRIMARY: AIProvider = 'gemini';
const DEFAULT_FALLBACK: AIProvider = 'claude';

/** Type guard: verifica que un string sea un proveedor válido */
export function isAIProvider(value: unknown): value is AIProvider {
  return value === 'gemini' || value === 'claude' || value === 'openai';
}

/**
 * Lee la preferencia de IA (principal y respaldo) desde site_config.
 * Si no hay configuración o hay error, devuelve los valores por defecto.
 */
export async function getAIPreference(
  db: D1Database
): Promise<{ primary: AIProvider; fallback: AIProvider }> {
  try {
    const result = await db.prepare(
      "SELECT key, value FROM site_config WHERE key IN ('ai_primary', 'ai_fallback')"
    ).all<{ key: string; value: string }>();

    let primary: AIProvider = DEFAULT_PRIMARY;
    let fallback: AIProvider = DEFAULT_FALLBACK;

    for (const row of result.results || []) {
      if (row.key === 'ai_primary' && isAIProvider(row.value)) primary = row.value;
      if (row.key === 'ai_fallback' && isAIProvider(row.value)) fallback = row.value;
    }

    return { primary, fallback };
  } catch (error) {
    console.error('[ai-config] Error leyendo preferencia, usando defaults:', error);
    return { primary: DEFAULT_PRIMARY, fallback: DEFAULT_FALLBACK };
  }
}

/**
 * Construye el orden completo de proveedores a intentar: [principal, respaldo, ...resto].
 * El "resto" actúa como último recurso automático si los dos primeros fallan.
 */
export async function getProviderOrder(db: D1Database): Promise<AIProvider[]> {
  const { primary, fallback } = await getAIPreference(db);

  const order: AIProvider[] = [primary];
  if (fallback !== primary) order.push(fallback);
  for (const provider of ALL_PROVIDERS) {
    if (!order.includes(provider)) order.push(provider);
  }
  return order;
}

/**
 * Guarda la preferencia de IA en site_config.
 */
export async function saveAIPreference(
  db: D1Database,
  primary: AIProvider,
  fallback: AIProvider
): Promise<void> {
  const upsert = "INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES (?, ?, datetime('now'))";
  await db.prepare(upsert).bind('ai_primary', primary).run();
  await db.prepare(upsert).bind('ai_fallback', fallback).run();
}
