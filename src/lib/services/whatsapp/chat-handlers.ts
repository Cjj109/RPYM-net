/**
 * RPYM - WhatsApp chat history (memoria de conversación)
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function getChatHistory(db: any, phone: string, limit: number = 6): Promise<ChatMessage[]> {
  if (!db) return [];
  try {
    const rows = await db.prepare(`
      SELECT role, content FROM whatsapp_chat_history
      WHERE phone = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(phone, limit).all();

    return (rows?.results || []).reverse().map((r: any) => ({
      role: r.role as 'user' | 'assistant',
      content: r.content
    }));
  } catch (error) {
    console.error('[WhatsApp] Error loading chat history:', error);
    return [];
  }
}

export async function saveChatMessage(db: any, phone: string, role: 'user' | 'assistant', content: string): Promise<void> {
  if (!db) return;
  try {
    await db.prepare(`
      INSERT INTO whatsapp_chat_history (phone, role, content)
      VALUES (?, ?, ?)
    `).bind(phone, role, content).run();

    const thirtyMinutesAgo = Math.floor(Date.now() / 1000) - (30 * 60);
    await db.prepare(`
      DELETE FROM whatsapp_chat_history
      WHERE phone = ? AND strftime('%s', created_at) < ?
    `).bind(phone, thirtyMinutesAgo.toString()).run();
  } catch (error) {
    console.error('[WhatsApp] Error saving chat message:', error);
  }
}

export function formatHistoryForGemini(history: ChatMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
  return history.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));
}

/**
 * Detecta si un mensaje es claramente un tema nuevo/independiente
 */
export function isNewTopicMessage(message: string): boolean {
  const msgLower = message.toLowerCase().trim();

  const newTopicIndicators = [
    /^(hola|buenos dias|buenas tardes|buenas noches|hey|ey|epa|epale)/i,
    /^(cuanto|precio|tienen|hay|venden|tienes)/i,
    /^(estado|status|cerrar|abrir|admin|comandos)$/i,
    /^(trabajan|estan abiertos|horario|abren)/i,
    /^(donde|direccion|ubicacion)/i,
  ];

  const priceQueryPatterns = [
    /a (que|qué) precio/i,
    /a (cuanto|cuánto)/i,
    /(que|qué) vale/i,
    /(cuanto|cuánto) (vale|cuesta|es|está)/i,
    /precio del?/i,
    /precios de/i,
    /tienen .*(camaron|langost|pulpo|calamar|pescado|marisco|pargo|mero|atun|salmon|cangrejo|langosta)/i,
  ];

  const productOnlyPattern = /^(y\s+)?(el|la|los|las|del|de\s+la)?\s*(camaron|camarones|langostino|langostinos|calamar|calamares|pulpo|pulpos|pepitona|pepitonas|mejillon|mejillones|guacuco|guacucos|almeja|almejas|viera|vieras|jaiba|jaibas|cangrejo|salmon|merluza|pargo|mero|atun|pescado)e?s?\b/i;
  if (productOnlyPattern.test(msgLower)) {
    return true;
  }

  if (newTopicIndicators.some(pattern => pattern.test(msgLower))) {
    return true;
  }

  if (priceQueryPatterns.some(pattern => pattern.test(msgLower))) {
    return true;
  }

  return false;
}
