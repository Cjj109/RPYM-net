/**
 * RPYM - WhatsApp negocio status (abierto/cerrado)
 * Reglas automáticas + override manual
 */

/**
 * Verifica si hoy es lunes en Venezuela (UTC-4)
 */
export function isMonday(): boolean {
  const now = new Date();
  const venezuelaOffset = -4 * 60;
  const localTime = new Date(now.getTime() + (venezuelaOffset + now.getTimezoneOffset()) * 60000);
  return localTime.getDay() === 1;
}

export interface NegocioStatus {
  abierto: boolean;
  mensaje: string;
  esAutomatico: boolean;
}

/**
 * Obtiene el estado del negocio desde la DB (con lógica automática)
 */
export async function getNegocioStatus(db: any): Promise<NegocioStatus> {
  const defaultStatus = { abierto: !isMonday(), mensaje: '', esAutomatico: true };

  if (!db) return defaultStatus;

  try {
    const override = await db.prepare(
      "SELECT value, expires_at FROM bot_settings WHERE key = 'negocio_abierto_override'"
    ).first();

    const mensaje = await db.prepare(
      "SELECT value FROM bot_settings WHERE key = 'mensaje_cierre'"
    ).first();

    if (override?.value && override.value !== 'null') {
      const expiresAt = override.expires_at;
      if (!expiresAt || new Date(expiresAt) > new Date()) {
        return {
          abierto: override.value === 'true',
          mensaje: mensaje?.value || '',
          esAutomatico: false
        };
      }
      await db.prepare(
        "UPDATE bot_settings SET value = 'null', expires_at = NULL WHERE key = 'negocio_abierto_override'"
      ).run();
    }

    return { ...defaultStatus, mensaje: mensaje?.value || '' };
  } catch (error) {
    console.error('[WhatsApp] Error getting negocio status:', error);
    return defaultStatus;
  }
}

/**
 * Establece override manual del estado del negocio
 */
export async function setNegocioOverride(
  db: any,
  abierto: boolean | null,
  mensaje: string = '',
  duracionHoras: number | null = null
): Promise<void> {
  if (!db) return;

  try {
    const value = abierto === null ? 'null' : String(abierto);
    const expiresAt = duracionHoras
      ? new Date(Date.now() + duracionHoras * 60 * 60 * 1000).toISOString()
      : null;

    await db.prepare(
      "INSERT OR REPLACE INTO bot_settings (key, value, expires_at, updated_at) VALUES ('negocio_abierto_override', ?, ?, datetime('now'))"
    ).bind(value, expiresAt).run();

    await db.prepare(
      "INSERT OR REPLACE INTO bot_settings (key, value, updated_at) VALUES ('mensaje_cierre', ?, datetime('now'))"
    ).bind(mensaje).run();
  } catch (error) {
    console.error('[WhatsApp] Error setting negocio override:', error);
  }
}
