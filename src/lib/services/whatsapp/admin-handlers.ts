/**
 * RPYM - WhatsApp admin commands & utilities
 */

import { ADMIN_PHONES, MAX_MESSAGES_PER_DAY } from './config';
import { getNegocioStatus, setNegocioOverride, isMonday } from './negocio';
import { clearProductCache } from './product-cache';
import { normalizePhone } from '../../phone-ve';
export { normalizePhone };

export function isAdmin(phone: string): boolean {
  const normalized = normalizePhone(phone);
  const isAdminResult = ADMIN_PHONES.some(adminPhone =>
    normalizePhone(adminPhone) === normalized ||
    normalized.endsWith(normalizePhone(adminPhone)) ||
    normalizePhone(adminPhone).endsWith(normalized)
  );
  console.log(`[WhatsApp Admin Check] phone: ${phone}, normalized: ${normalized}, isAdmin: ${isAdminResult}`);
  return isAdminResult;
}

export interface AdminCommandResult {
  handled: boolean;
  response?: string;
}

export async function handleAdminCommand(message: string, phone: string, db: any): Promise<AdminCommandResult> {
  if (!isAdmin(phone)) {
    return { handled: false };
  }

  const msgLower = message.toLowerCase().trim();

  if (msgLower === 'cerrar' || msgLower === 'cierra' || msgLower.startsWith('cerrar:')) {
    let mensajePersonalizado = '';
    if (msgLower.startsWith('cerrar:')) {
      mensajePersonalizado = message.substring(7).trim();
    }
    await setNegocioOverride(db, false, mensajePersonalizado);

    let resp = '✅ Negocio CERRADO (override manual).';
    if (mensajePersonalizado) {
      resp += `\nMensaje: "${mensajePersonalizado}"`;
    }
    resp += '\n\nPara abrir: "abrir"\nPara volver a automático: "auto"';
    return { handled: true, response: resp };
  }

  if (msgLower === 'abrir' || msgLower === 'abre') {
    await setNegocioOverride(db, true, '');
    return {
      handled: true,
      response: '✅ Negocio ABIERTO (override manual).\n\nPara volver a automático: "auto"'
    };
  }

  if (msgLower === 'auto' || msgLower === 'automatico') {
    await setNegocioOverride(db, null, '');
    const hoyLunes = isMonday();
    return {
      handled: true,
      response: `✅ Modo AUTOMÁTICO activado.\n\n📅 Regla: Lunes cerrado, otros días abierto.\n🔄 Hoy ${hoyLunes ? 'es lunes → CERRADO' : 'no es lunes → ABIERTO'}`
    };
  }

  if (msgLower === 'estado' || msgLower === 'status') {
    const status = await getNegocioStatus(db);
    const estadoIcon = status.abierto ? '🟢 ABIERTO' : '🔴 CERRADO';
    const modoIcon = status.esAutomatico ? '🤖 Automático' : '✋ Manual';

    let resp = `📊 Estado del bot:\n${estadoIcon}\n${modoIcon}`;
    if (!status.abierto && status.mensaje) {
      resp += `\nMensaje: "${status.mensaje}"`;
    }
    if (status.esAutomatico) {
      resp += `\n\n📅 Regla: Lunes cerrado, otros días abierto`;
    }
    resp += '\n\nComandos:\n• cerrar / cerrar: [msg]\n• abrir\n• auto (modo automático)\n• estado';
    return { handled: true, response: resp };
  }

  if (msgLower === 'admin' || msgLower === 'comandos') {
    return {
      handled: true,
      response: '🔐 Comandos de Admin:\n\n• cerrar - Cierra (override)\n• cerrar: [mensaje] - Con razón\n• abrir - Abre (override)\n• auto - Modo automático\n• estado - Ver estado\n• cache - Refrescar productos\n\n🤖 Automático: Lunes cerrado, otros días abierto'
    };
  }

  if (msgLower === 'cache' || msgLower === 'refresh') {
    clearProductCache();
    return {
      handled: true,
      response: '✅ Cache de productos limpiado.\n\nEl próximo mensaje recargará productos y tasa BCV.'
    };
  }

  return { handled: false };
}

/**
 * Verifica y actualiza el rate limit para un usuario
 */
export async function checkRateLimit(db: any, phone: string): Promise<{ allowed: boolean; count: number }> {
  if (!db) return { allowed: true, count: 0 };

  try {
    const now = new Date();
    const venezuelaOffset = -4 * 60;
    const venezuelaTime = new Date(now.getTime() + (venezuelaOffset + now.getTimezoneOffset()) * 60000);
    const today = venezuelaTime.toISOString().split('T')[0];

    const existing = await db.prepare(
      'SELECT message_count, last_reset FROM whatsapp_rate_limit WHERE phone = ?'
    ).bind(phone).first();

    if (!existing) {
      await db.prepare(
        'INSERT INTO whatsapp_rate_limit (phone, message_count, last_reset) VALUES (?, 1, ?)'
      ).bind(phone, today).run();
      return { allowed: true, count: 1 };
    }

    if (existing.last_reset !== today) {
      await db.prepare(
        'UPDATE whatsapp_rate_limit SET message_count = 1, last_reset = ? WHERE phone = ?'
      ).bind(today, phone).run();
      return { allowed: true, count: 1 };
    }

    const newCount = existing.message_count + 1;
    if (newCount > MAX_MESSAGES_PER_DAY) {
      return { allowed: false, count: existing.message_count };
    }

    await db.prepare(
      'UPDATE whatsapp_rate_limit SET message_count = ? WHERE phone = ?'
    ).bind(newCount, phone).run();

    return { allowed: true, count: newCount };
  } catch (error) {
    console.error('Rate limit error:', error);
    return { allowed: true, count: 0 };
  }
}

/**
 * Verifica si un mensaje ya fue procesado (deduplicación)
 */
export async function isMessageProcessed(db: any, messageId: string): Promise<boolean> {
  if (!db) return false;

  try {
    const existing = await db.prepare(
      'SELECT 1 FROM whatsapp_processed_messages WHERE message_id = ?'
    ).bind(messageId).first();

    if (existing) {
      console.log(`[WhatsApp] Mensaje duplicado ignorado: ${messageId}`);
      return true;
    }

    await db.prepare(
      'INSERT INTO whatsapp_processed_messages (message_id, processed_at) VALUES (?, datetime("now"))'
    ).bind(messageId).run();

    await db.prepare(
      "DELETE FROM whatsapp_processed_messages WHERE processed_at < datetime('now', '-24 hours')"
    ).run();

    return false;
  } catch (error) {
    if (String(error).includes('no such table')) {
      try {
        await db.prepare(`
          CREATE TABLE IF NOT EXISTS whatsapp_processed_messages (
            message_id TEXT PRIMARY KEY,
            processed_at TEXT NOT NULL
          )
        `).run();
        await db.prepare(
          'INSERT INTO whatsapp_processed_messages (message_id, processed_at) VALUES (?, datetime("now"))'
        ).bind(messageId).run();
        return false;
      } catch {
        return false;
      }
    }
    console.error('Message dedup error:', error);
    return false;
  }
}
