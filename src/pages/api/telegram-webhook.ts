import type { APIRoute } from 'astro';
import { getBCVRate } from '../../lib/sheets';
import { getD1, getR2 } from '../../lib/d1-types';
import { detectIntent, parseCustomerActions, type CustomerAction, type AlternativeIntent, type RouterResult } from '../../lib/telegram-ai';
import { AUTHORIZED_CHAT_IDS, ADMIN_NAMES } from '../../lib/services/telegram/config';
import {
  getCustomersList,
  getCustomerBalance,
  getCustomerMovements,
  executeCustomerAction,
  createCustomer,
  updateCustomerPhone,
  markTransactionPaid,
  markTransactionUnpaid,
  deleteTransaction,
  deleteCustomer,
  updateCustomer,
  generateShareLink,
  revokeShareLink,
} from '../../lib/services/telegram/customer-handlers';
import { getStats, changeTheme } from '../../lib/services/telegram/config-handlers';
import { getProductsList, updateProductPrice, updateProductAvailability } from '../../lib/services/telegram/products-handlers';
import {
  getBudget,
  searchBudgetsByCustomer,
  deleteBudget,
  markBudgetPaid,
  updatePaymentMethod,
  updateBudgetProperty,
  editBudget,
  sendBudgetWhatsApp,
  linkBudgetToCustomer,
  createBudgetFromText,
  createCustomerPurchaseWithProducts,
  type BudgetEdit,
} from '../../lib/services/telegram/budget-handlers';
import {
  downloadTelegramPhoto,
  analyzeSeniatPhoto,
  buildSeniatConfirmMsg,
  registerSeniatObligations,
  uploadSeniatImageToR2,
} from '../../lib/services/telegram/fiscal-handlers';

export const prerender = false;

// ═══════════════════════════════════════════════════════════════════
// SISTEMA DE CLARIFICACIÓN
// ═══════════════════════════════════════════════════════════════════

// Marcador para detectar mensajes de clarificación pendiente
const CLARIFICATION_MARKER = '🤔 *¿Qué quieres hacer?*';

// Emojis numerados para las opciones
const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

// Thresholds de confianza
const CONFIDENCE_THRESHOLD_EXECUTE = 0.7;  // Por debajo de esto, pedir clarificación
const CONFIDENCE_THRESHOLD_LOG = 0.85;     // Por debajo de esto, loggear como low confidence

function isConfirmationResponse(text: string): boolean {
  const t = text.toLowerCase().trim();
  return /^(s[ií]|si|confirmar|confirmo|dale|ok|vale|bueno|yes)$/.test(t) ||
    t === '👍' || t === '✅';
}

function isCancellationResponse(text: string): boolean {
  const t = text.toLowerCase().trim();
  return /^(no|nope|cancelar|cancelo|mejor no|olvidalo)$/.test(t) ||
    t === '👎' || t === '❌';
}

async function getPendingConfirmation(db: any, chatId: number): Promise<{ intent: string; params: Record<string, any> } | null> {
  if (!db) return null;
  try {
    const row = await db.prepare(`
      SELECT intent, params FROM telegram_pending_confirmations
      WHERE chat_id = ? AND created_at > datetime('now', '-5 minutes')
    `).bind(chatId).first();
    if (!row) return null;
    return { intent: row.intent, params: JSON.parse(row.params || '{}') };
  } catch {
    return null;
  }
}

async function savePendingConfirmation(db: any, chatId: number, intent: string, params: Record<string, any>): Promise<void> {
  if (!db) return;
  try {
    await db.prepare(`
      INSERT OR REPLACE INTO telegram_pending_confirmations (chat_id, intent, params, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).bind(chatId, intent, JSON.stringify(params)).run();
  } catch (e) {
    console.error('[Telegram] Error saving pending confirmation:', e);
  }
}

async function clearPendingConfirmation(db: any, chatId: number): Promise<void> {
  if (!db) return;
  try {
    await db.prepare('DELETE FROM telegram_pending_confirmations WHERE chat_id = ?').bind(chatId).run();
  } catch (e) {
    console.error('[Telegram] Error clearing pending confirmation:', e);
  }
}

function buildConfirmationMessage(intent: string, params: Record<string, any>): string {
  switch (intent) {
    case 'customer_action':
      if (params.action === 'transaction_eliminar' || params.action === 'transaction_eliminar_contexto') {
        return `⚠️ *¿Confirmas eliminar el movimiento #${params.id}*${params.cliente ? ` de ${params.cliente}` : ''}?\n\n_Responde "sí" para confirmar o "no" para cancelar._`;
      }
      if (params.action === 'eliminar') {
        return `⚠️ *¿Confirmas eliminar/desactivar al cliente "${params.cliente}"?*\n\n_Responde "sí" para confirmar o "no" para cancelar._`;
      }
      if (params.action === 'revocar_link') {
        return `⚠️ *¿Confirmas revocar el link de cuenta de "${params.cliente}"?*\n\nEl cliente ya no podrá ver su cuenta con el enlace anterior.\n\n_Responde "sí" para confirmar o "no" para cancelar._`;
      }
      break;
    case 'budget_action':
      if (params.action === 'eliminar') {
        return `⚠️ *¿Confirmas eliminar el presupuesto #${params.id}?*\n\n_Responde "sí" para confirmar o "no" para cancelar._`;
      }
      break;
  }
  return `⚠️ ¿Confirmas esta acción?\n\n_Responde "sí" o "no"._`;
}

/**
 * Construye un mensaje de clarificación amigable
 */
function buildClarificationMessage(
  originalText: string,
  primaryIntent: AlternativeIntent,
  alternatives: AlternativeIntent[]
): string {
  let message = CLARIFICATION_MARKER + '\n\n';
  message += `No estoy seguro qué quieres hacer con: "${originalText}"\n\n`;
  message += `Opciones:\n`;

  // Incluir el intent primario como primera opción
  const allOptions = [primaryIntent, ...alternatives].slice(0, 5); // Max 5 opciones

  for (let i = 0; i < allOptions.length; i++) {
    const opt = allOptions[i];
    message += `${NUMBER_EMOJIS[i]} ${opt.description}\n`;
  }

  message += `\n_Responde con el número o escribe más claro_`;
  return message;
}

/**
 * Detecta si hay una clarificación pendiente en el historial
 * y extrae las opciones si existe
 */
function getPendingClarification(chatHistory: ChatMessage[]): {
  hasPending: boolean;
  options: AlternativeIntent[];
  originalText: string;
} {
  // Buscar el último mensaje del bot que sea una clarificación
  const lastBotMessage = [...chatHistory].reverse().find(m =>
    m.role === 'assistant' && m.content.includes(CLARIFICATION_MARKER)
  );

  if (!lastBotMessage) {
    return { hasPending: false, options: [], originalText: '' };
  }

  // El último mensaje del usuario antes de la clarificación
  const lastUserBeforeClarification = chatHistory.find(m => m.role === 'user');
  const originalText = lastUserBeforeClarification?.content || '';

  // Extraer las opciones del mensaje de clarificación
  const options: AlternativeIntent[] = [];
  const lines = lastBotMessage.content.split('\n');

  for (const line of lines) {
    // Buscar líneas que empiecen con emoji numérico
    for (let i = 0; i < NUMBER_EMOJIS.length; i++) {
      if (line.includes(NUMBER_EMOJIS[i])) {
        const description = line.replace(NUMBER_EMOJIS[i], '').trim();
        options.push({
          intent: 'chat', // Se actualizará al parsear
          description,
          params: {}
        });
        break;
      }
    }
  }

  return { hasPending: true, options, originalText };
}

/**
 * Genera una descripción legible para una intención
 */
function getIntentDescription(intent: string, params: Record<string, any>): string {
  switch (intent) {
    case 'customer_action':
      if (params.action === 'ver') return `Ver balance de ${params.cliente || 'cliente'}`;
      if (params.action === 'movimientos') return `Ver movimientos de ${params.cliente || 'cliente'}`;
      if (params.action === 'crear') return `Crear cliente ${params.nombre || ''}`;
      if (params.action === 'listar') return 'Ver lista de clientes';
      if (params.action === 'eliminar') return `Eliminar cliente ${params.cliente || ''}`;
      if (params.action === 'compartir') return `Generar link de cuenta para ${params.cliente || 'cliente'}`;
      if (params.action === 'revocar_link') return `Revocar link de cuenta de ${params.cliente || 'cliente'}`;
      if (params.action === 'transaction_pagar' || params.action === 'transaction_pagar_contexto') return `Marcar movimiento #${params.id} como pagado`;
      if (params.action === 'transaction_desmarcar' || params.action === 'transaction_desmarcar_contexto') return `Marcar movimiento #${params.id} como pendiente`;
      if (params.action === 'transaction_eliminar' || params.action === 'transaction_eliminar_contexto') return `Eliminar movimiento #${params.id}`;
      if (params.rawText) return `Anotar transacción: ${params.rawText.substring(0, 30)}...`;
      return 'Acción de cliente';

    case 'customer_purchase_products':
      return `Anotar compra con productos a cliente`;

    case 'budget_create':
      return `Crear presupuesto${params.rawText ? `: ${params.rawText.substring(0, 30)}...` : ''}`;

    case 'budget_action':
      if (params.action === 'ver') return `Ver presupuesto #${params.id || '?'}`;
      if (params.action === 'eliminar') return `Eliminar presupuesto #${params.id || '?'}`;
      if (params.action === 'pagar') return `Marcar presupuesto #${params.id || '?'} como pagado`;
      if (params.action === 'whatsapp') return `Enviar presupuesto por WhatsApp`;
      if (params.action === 'editar') return `Editar presupuesto`;
      if (params.action === 'buscar') return `Buscar presupuestos de ${params.cliente || 'cliente'}`;
      return 'Acción sobre presupuesto';

    case 'config_action':
      if (params.action === 'tema') return `Cambiar tema a ${params.tema || '?'}`;
      if (params.action === 'stats') return 'Ver estadísticas';
      if (params.action === 'tasa') return 'Ver tasa BCV';
      return 'Configuración';

    case 'product_action':
      if (params.action === 'listar') return 'Ver lista de productos';
      if (params.action === 'precio') return `Cambiar precio de ${params.producto || 'producto'}`;
      return 'Acción de productos';

    case 'help':
      return 'Ver ayuda';

    case 'chat':
      return 'Conversación general';

    default:
      return 'Acción no especificada';
  }
}

/**
 * Verifica si el mensaje del usuario es una respuesta a clarificación (1, 2, 3...)
 */
function parseClarificationResponse(text: string): number | null {
  const trimmed = text.trim();

  // Verificar si es un número simple (1, 2, 3...)
  if (/^[1-5]$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  // Verificar si contiene emoji numérico
  for (let i = 0; i < NUMBER_EMOJIS.length; i++) {
    if (trimmed.includes(NUMBER_EMOJIS[i])) {
      return i + 1;
    }
  }

  // Verificar palabras que indican opción (primero, segundo, etc.)
  const wordMap: Record<string, number> = {
    'primero': 1, 'primera': 1, 'uno': 1,
    'segundo': 2, 'segunda': 2, 'dos': 2,
    'tercero': 3, 'tercera': 3, 'tres': 3,
    'cuarto': 4, 'cuarta': 4, 'cuatro': 4,
    'quinto': 5, 'quinta': 5, 'cinco': 5
  };

  const lower = trimmed.toLowerCase();
  for (const [word, num] of Object.entries(wordMap)) {
    if (lower === word || lower.startsWith(word + ' ')) {
      return num;
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════
// FUNCIONES DE HISTORIAL DE CHAT
// ═══════════════════════════════════════════════════════════════════

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function getChatHistory(db: any, chatId: number, limit: number = 6): Promise<ChatMessage[]> {
  if (!db) return [];
  try {
    // Obtener últimos N mensajes (3 intercambios = 6 mensajes)
    const rows = await db.prepare(`
      SELECT role, content FROM telegram_chat_history
      WHERE chat_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(chatId, limit).all();

    // Revertir para orden cronológico
    return (rows?.results || []).reverse().map((r: any) => ({
      role: r.role as 'user' | 'assistant',
      content: r.content
    }));
  } catch (error) {
    console.error('[Telegram] Error loading chat history:', error);
    return [];
  }
}

async function saveChatMessage(db: any, chatId: number, role: 'user' | 'assistant', content: string): Promise<void> {
  if (!db) return;
  try {
    await db.prepare(`
      INSERT INTO telegram_chat_history (chat_id, role, content)
      VALUES (?, ?, ?)
    `).bind(chatId, role, content).run();

    // Limpiar mensajes viejos (más de 1 hora) para este chat
    await db.prepare(`
      DELETE FROM telegram_chat_history
      WHERE chat_id = ? AND created_at < datetime('now', '-1 hour')
    `).bind(chatId).run();
  } catch (error) {
    console.error('[Telegram] Error saving chat message:', error);
  }
}

function formatHistoryForContext(history: ChatMessage[]): string {
  if (history.length === 0) return '';

  return '\n\nCONTEXTO - Mensajes recientes de esta conversación:\n' +
    history.map(m => `${m.role === 'user' ? 'Usuario' : 'Bot'}: ${m.content}`).join('\n') +
    '\n\nUSA ESTE CONTEXTO para entender referencias como "esos", "los 3", "el primero", etc.';
}

// ═══════════════════════════════════════════════════════════════════
// FUNCIONES DE TELEGRAM
// ═══════════════════════════════════════════════════════════════════

async function sendTelegramMessage(
  chatId: number,
  text: string,
  botToken: string,
  parseMode: 'Markdown' | 'HTML' = 'Markdown'
): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
    });
    return response.ok;
  } catch (error) {
    console.error('[Telegram] Error sending message:', error);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════════════

export const POST: APIRoute = async ({ request, locals, url }) => {
  try {
    const body = await request.json();
    const message = body.message;
    const hasPhoto = Array.isArray(message?.photo) && message.photo.length > 0;
    if (!message?.text && !hasPhoto) return new Response('OK', { status: 200 });

    const chatId = message.chat.id;
    const runtime = (locals as any).runtime;
    const botToken = runtime?.env?.TELEGRAM_BOT_TOKEN || import.meta.env.TELEGRAM_BOT_TOKEN;
    const geminiApiKey = runtime?.env?.GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY;
    const adminSecret = runtime?.env?.ADMIN_SECRET || 'rpym-default-secret-2024';

    if (!botToken) return new Response('OK', { status: 200 });
    if (!AUTHORIZED_CHAT_IDS.includes(chatId)) {
      await sendTelegramMessage(chatId, `🚫 No autorizado.\nTu chat ID: \`${chatId}\``, botToken);
      return new Response('OK', { status: 200 });
    }

    const adminName = ADMIN_NAMES[chatId] || 'Admin';
    const db = getD1(locals);

    // ═══════════════════════════════════════════════════════════════
    // FOTOS — capturas fiscales (SENIAT, comprobantes, etc.)
    // ═══════════════════════════════════════════════════════════════
    if (hasPhoto) {
      const photos = message.photo as Array<{ file_id: string; file_size?: number; width?: number }>;
      // Seleccionar la foto de mayor tamaño explícitamente (no asumir orden)
      const largest = photos.reduce((max, p) =>
        ((p.file_size ?? p.width ?? 0) > (max.file_size ?? max.width ?? 0) ? p : max)
      );
      const caption = message.caption?.trim() ?? '';

      if (!largest?.file_id) {
        await sendTelegramMessage(chatId, '❌ No pude leer el archivo de la foto.', botToken);
        return new Response('OK', { status: 200 });
      }

      await sendTelegramMessage(chatId, '🔍 Analizando imagen...', botToken);

      const imageData = await downloadTelegramPhoto(largest.file_id, botToken);
      if (!imageData) {
        await sendTelegramMessage(chatId, '❌ No pude descargar la imagen. Intenta de nuevo.', botToken);
        return new Response('OK', { status: 200 });
      }

      const parseResult = await analyzeSeniatPhoto(imageData.base64, imageData.mimeType, geminiApiKey, caption);
      if (!parseResult.success || parseResult.obligations.length === 0) {
        await sendTelegramMessage(
          chatId,
          `❌ ${parseResult.error ?? 'No reconocí un Compromiso de Pago del SENIAT en esta imagen.'}`,
          botToken
        );
        return new Response('OK', { status: 200 });
      }

      // Subir imagen a R2 como evidencia (no bloqueante: si falla, seguimos sin image_key)
      const r2 = getR2(locals);
      const imageKey = await uploadSeniatImageToR2(r2, imageData.buffer, imageData.mimeType);

      const confirmMsg = buildSeniatConfirmMsg(parseResult.obligations);
      await savePendingConfirmation(db, chatId, 'fiscal_seniat', {
        obligations: parseResult.obligations,
        imageKey,
      });
      await sendTelegramMessage(chatId, confirmMsg, botToken);
      return new Response('OK', { status: 200 });
    }

    const text = message.text.trim();

    // Comandos directos
    if (text === '/start') {
      await sendTelegramMessage(chatId, `¡Hola ${adminName}! 👋\n\nSoy el bot RPYM con IA. Ejemplos:\n\n` +
        `📋 "presupuesto de 2kg jumbo para Maria"\n` +
        `👥 "anota a delcy $5 de calamar"\n` +
        `⚙️ "tema navidad" / "ver stats"\n` +
        `💡 "ayuda" para más comandos`, botToken);
      return new Response('OK', { status: 200 });
    }

    if (!geminiApiKey) {
      await sendTelegramMessage(chatId, '❌ API de Gemini no configurada', botToken);
      return new Response('OK', { status: 200 });
    }

    // ═══════════════════════════════════════════════════════════════
    // PASO 0: Verificar si es respuesta a confirmación pendiente
    // ═══════════════════════════════════════════════════════════════
    const pendingConfirm = await getPendingConfirmation(db, chatId);
    if (pendingConfirm) {
      if (isConfirmationResponse(text)) {
        await clearPendingConfirmation(db, chatId);
        let response = '';
        const { intent, params } = pendingConfirm;

        if (intent === 'customer_action') {
          if (params.action === 'transaction_eliminar' && params.cliente && params.id) {
            response = await deleteTransaction(db, params.cliente, params.id);
          } else if (params.action === 'transaction_eliminar_contexto' && params.cliente && params.id) {
            response = await deleteTransaction(db, params.cliente, params.id);
          } else if (params.action === 'eliminar' && params.cliente) {
            response = await deleteCustomer(db, params.cliente);
          } else if (params.action === 'revocar_link' && params.cliente) {
            response = await revokeShareLink(db, params.cliente);
          }
        } else if (intent === 'budget_action' && params.action === 'eliminar' && params.id) {
          response = await deleteBudget(db, params.id);
        } else if (intent === 'fiscal_seniat' && params.obligations) {
          response = await registerSeniatObligations(db, params.obligations, params.imageKey ?? null);
        }

        if (response) {
          await saveChatMessage(db, chatId, 'user', text);
          await sendTelegramMessage(chatId, response, botToken);
          await saveChatMessage(db, chatId, 'assistant', response.substring(0, 500));
        }
        return new Response('OK', { status: 200 });
      }
      if (isCancellationResponse(text)) {
        await clearPendingConfirmation(db, chatId);
        const cancelMsg = '❌ _Acción cancelada._';
        await saveChatMessage(db, chatId, 'user', text);
        await sendTelegramMessage(chatId, cancelMsg, botToken);
        await saveChatMessage(db, chatId, 'assistant', cancelMsg);
        return new Response('OK', { status: 200 });
      }
      // Usuario dijo algo distinto: cancelar para evitar confusión
      await clearPendingConfirmation(db, chatId);
      const unclearMsg = '❌ _No entendí. Acción cancelada. Puedes intentar de nuevo._';
      await saveChatMessage(db, chatId, 'user', text);
      await sendTelegramMessage(chatId, unclearMsg, botToken);
      await saveChatMessage(db, chatId, 'assistant', unclearMsg);
      return new Response('OK', { status: 200 });
    }

    // ═══════════════════════════════════════════════════════════════
    // COMANDO /debug - Prueba el router sin ejecutar la acción
    // ═══════════════════════════════════════════════════════════════
    if (text.startsWith('/debug ')) {
      const testText = text.replace('/debug ', '').trim();
      if (!testText) {
        await sendTelegramMessage(chatId, '❌ Uso: /debug <mensaje a probar>\n\nEjemplo: /debug ponle 5 a delcy', botToken);
        return new Response('OK', { status: 200 });
      }

      // Cargar historial para contexto (igual que en ejecución normal)
      const debugHistory = await getChatHistory(db, chatId, 6);
      const debugHistoryContext = formatHistoryForContext(debugHistory);

      // Detectar intención sin ejecutar
      const debugIntent = await detectIntent(testText, geminiApiKey, debugHistoryContext);

      // Formatear resultado
      let debugMsg = `📊 *DEBUG*\n\n`;
      debugMsg += `📝 *Texto:* "${testText}"\n`;
      debugMsg += `🎯 *Intent:* \`${debugIntent.intent}\`\n`;
      debugMsg += `📈 *Confianza:* ${(debugIntent.confidence * 100).toFixed(0)}%`;

      // Indicador visual de confianza
      if (debugIntent.confidence >= 0.85) {
        debugMsg += ` ✅ Alta\n`;
      } else if (debugIntent.confidence >= 0.7) {
        debugMsg += ` ⚠️ Media\n`;
      } else {
        debugMsg += ` ❌ Baja (pediría clarificación)\n`;
      }

      debugMsg += `\n📦 *Params:*\n\`\`\`\n${JSON.stringify(debugIntent.params, null, 2)}\n\`\`\``;

      // Mostrar alternativas si las hay
      if (debugIntent.alternativeIntents && debugIntent.alternativeIntents.length > 0) {
        debugMsg += `\n\n🔀 *Alternativas:*\n`;
        for (const alt of debugIntent.alternativeIntents) {
          debugMsg += `• ${alt.description}\n`;
        }
      }

      debugMsg += `\n\n_Este mensaje NO ejecutó ninguna acción_`;

      await sendTelegramMessage(chatId, debugMsg, botToken);
      return new Response('OK', { status: 200 });
    }

    // Cargar historial de conversación para contexto
    const chatHistory = await getChatHistory(db, chatId, 6);
    const historyContext = formatHistoryForContext(chatHistory);

    // ═══════════════════════════════════════════════════════════════
    // PASO 1: Verificar si es respuesta a clarificación pendiente
    // ═══════════════════════════════════════════════════════════════
    const pendingClarification = getPendingClarification(chatHistory);
    const clarificationOption = parseClarificationResponse(text);

    // Variable para almacenar el texto a procesar (puede ser modificado si es respuesta a clarificación)
    let textToProcess = text;

    if (pendingClarification.hasPending && clarificationOption !== null) {
      // El usuario respondió con un número a una clarificación previa
      console.log(`[Telegram] Clarification response: option ${clarificationOption}`);

      if (clarificationOption > 0 && clarificationOption <= pendingClarification.options.length) {
        // Re-procesar el texto original con la intención seleccionada
        // Agregar contexto explícito para que Gemini entienda mejor
        const selectedOption = pendingClarification.options[clarificationOption - 1];
        textToProcess = `${pendingClarification.originalText} (quiero: ${selectedOption.description})`;
        console.log(`[Telegram] Re-processing with clarified text: "${textToProcess}"`);
      } else {
        // Número inválido
        await saveChatMessage(db, chatId, 'user', text);
        const errorMsg = `❌ Opción inválida. Elige entre 1 y ${pendingClarification.options.length}, o escribe tu solicitud más claro.`;
        await sendTelegramMessage(chatId, errorMsg, botToken);
        await saveChatMessage(db, chatId, 'assistant', errorMsg);
        return new Response('OK', { status: 200 });
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // PASO 2: Detectar intención con IA
    // ═══════════════════════════════════════════════════════════════
    console.log(`[Telegram] ${adminName}: "${textToProcess}" (history: ${chatHistory.length} msgs)`);
    const intent = await detectIntent(textToProcess, geminiApiKey, historyContext);
    console.log(`[Telegram] Intent: ${intent.intent} (confidence: ${intent.confidence})`, JSON.stringify(intent.params));

    // ═══════════════════════════════════════════════════════════════
    // PASO 3: Verificar confianza y pedir clarificación si es necesario
    // ═══════════════════════════════════════════════════════════════
    if (intent.confidence < CONFIDENCE_THRESHOLD_EXECUTE && intent.alternativeIntents && intent.alternativeIntents.length > 0) {
      // Confianza baja - pedir clarificación en lugar de ejecutar
      console.log(`[Telegram] Low confidence (${intent.confidence}) - asking for clarification`);

      // Guardar mensaje del usuario
      await saveChatMessage(db, chatId, 'user', text);

      // Construir mensaje de clarificación
      const primaryOption: AlternativeIntent = {
        intent: intent.intent,
        description: intent.message || getIntentDescription(intent.intent, intent.params),
        params: intent.params
      };

      const clarificationMsg = buildClarificationMessage(text, primaryOption, intent.alternativeIntents);
      await sendTelegramMessage(chatId, clarificationMsg, botToken);
      await saveChatMessage(db, chatId, 'assistant', clarificationMsg);
      return new Response('OK', { status: 200 });
    }

    // Log si es confianza media
    if (intent.confidence < CONFIDENCE_THRESHOLD_LOG) {
      console.log(`[Telegram] Medium confidence (${intent.confidence}) - executing but logging`);
    }

    let response = intent.message;

    switch (intent.intent) {
      case 'customer_action':
        console.log('[Telegram] customer_action - params:', JSON.stringify(intent.params));
        if (intent.params.action === 'listar') {
          response = await getCustomersList(db);
        } else if (intent.params.action === 'ver' && intent.params.cliente) {
          response = await getCustomerBalance(db, intent.params.cliente);
        } else if (intent.params.action === 'movimientos' && intent.params.cliente) {
          response = await getCustomerMovements(db, intent.params.cliente);
        } else if (intent.params.action === 'movimientos_contexto') {
          // Buscar el último cliente mencionado en el contexto
          const lastCustomerMatch = [...chatHistory].reverse().find(m =>
            m.role === 'assistant' && m.content.includes('👤 *')
          );
          const customerMatch = lastCustomerMatch?.content.match(/👤 \*([^*]+)\*/);
          if (customerMatch) {
            response = await getCustomerMovements(db, customerMatch[1]);
          } else {
            response = '❓ No encontré un cliente reciente. Dime de quién: "movimientos de [nombre]"';
          }
        } else if (intent.params.action === 'crear' && intent.params.nombre) {
          response = await createCustomer(db, intent.params.nombre, intent.params.telefono);
        } else if (intent.params.action === 'editar_cliente_contexto' && intent.params.telefono) {
          // Buscar el último cliente mencionado en el contexto
          const lastCustomerMatch = [...chatHistory].reverse().find(m =>
            m.role === 'assistant' && (m.content.includes('👤 *') || m.content.includes('✅ Cliente creado:'))
          );
          const customerNameMatch = lastCustomerMatch?.content.match(/👤 \*([^*]+)\*/) ||
                                    lastCustomerMatch?.content.match(/Cliente creado: \*([^*]+)\*/);
          if (customerNameMatch) {
            const customerName = customerNameMatch[1];
            response = await updateCustomerPhone(db, customerName, intent.params.telefono);
          } else {
            response = '❓ No encontré un cliente reciente. Especifica: "el teléfono de [nombre] es [número]"';
          }
        } else if (intent.params.action === 'editar_cliente' && intent.params.cliente && intent.params.telefono) {
          response = await updateCustomerPhone(db, intent.params.cliente, intent.params.telefono);
        } else if (intent.params.action === 'eliminar' && intent.params.cliente) {
          await savePendingConfirmation(db, chatId, 'customer_action', { action: 'eliminar', cliente: intent.params.cliente });
          response = buildConfirmationMessage('customer_action', { action: 'eliminar', cliente: intent.params.cliente });
          await saveChatMessage(db, chatId, 'user', text);
          await sendTelegramMessage(chatId, response, botToken);
          await saveChatMessage(db, chatId, 'assistant', response.substring(0, 500));
          return new Response('OK', { status: 200 });
        } else if (intent.params.action === 'compartir' && intent.params.cliente) {
          response = await generateShareLink(db, intent.params.cliente, url.origin);
        } else if (intent.params.action === 'revocar_link' && intent.params.cliente) {
          await savePendingConfirmation(db, chatId, 'customer_action', { action: 'revocar_link', cliente: intent.params.cliente });
          response = buildConfirmationMessage('customer_action', { action: 'revocar_link', cliente: intent.params.cliente });
          await saveChatMessage(db, chatId, 'user', text);
          await sendTelegramMessage(chatId, response, botToken);
          await saveChatMessage(db, chatId, 'assistant', response.substring(0, 500));
          return new Response('OK', { status: 200 });
        } else if ((intent.params.action === 'editar_cliente_contexto' || intent.params.action === 'editar_cliente') && (intent.params.nombre || intent.params.notes !== undefined)) {
          const customerName = intent.params.cliente || (() => {
            const lastCustomerMatch = [...chatHistory].reverse().find(m =>
              m.role === 'assistant' && (m.content.includes('👤 *') || m.content.includes('✅ Cliente creado:'))
            );
            const match = lastCustomerMatch?.content.match(/👤 \*([^*]+)\*/) ||
                         lastCustomerMatch?.content.match(/Cliente creado: \*([^*]+)\*/);
            return match?.[1];
          })();
          if (customerName) {
            response = await updateCustomer(db, customerName, {
              nombre: intent.params.nombre,
              notes: intent.params.notes
            });
          } else {
            response = '❓ No encontré un cliente reciente. Especifica: "edita cliente [nombre], ponle nombre [nuevo]"';
          }
        } else if (intent.params.action === 'transaction_pagar' && intent.params.cliente && intent.params.id) {
          response = await markTransactionPaid(db, intent.params.cliente, intent.params.id, intent.params.metodo);
        } else if (intent.params.action === 'transaction_pagar_contexto' && intent.params.id) {
          const lastCustomerMatch = [...chatHistory].reverse().find(m =>
            m.role === 'assistant' && m.content.includes('👤 *')
          );
          const customerMatch = lastCustomerMatch?.content.match(/👤 \*([^*]+)\*/);
          if (customerMatch) {
            response = await markTransactionPaid(db, customerMatch[1], intent.params.id, intent.params.metodo);
          } else {
            response = '❓ No encontré un cliente reciente. Dime de quién: "marca movimiento 12345 de [nombre] pagado"';
          }
        } else if (intent.params.action === 'transaction_desmarcar' && intent.params.cliente && intent.params.id) {
          response = await markTransactionUnpaid(db, intent.params.cliente, intent.params.id);
        } else if (intent.params.action === 'transaction_desmarcar_contexto' && intent.params.id) {
          const lastCustomerMatch = [...chatHistory].reverse().find(m =>
            m.role === 'assistant' && m.content.includes('👤 *')
          );
          const customerMatch = lastCustomerMatch?.content.match(/👤 \*([^*]+)\*/);
          if (customerMatch) {
            response = await markTransactionUnpaid(db, customerMatch[1], intent.params.id);
          } else {
            response = '❓ No encontré un cliente reciente. Dime de quién: "desmarca 12345 de [nombre]"';
          }
        } else if (intent.params.action === 'transaction_eliminar' && intent.params.cliente && intent.params.id) {
          await savePendingConfirmation(db, chatId, 'customer_action', { action: 'transaction_eliminar', cliente: intent.params.cliente, id: intent.params.id });
          response = buildConfirmationMessage('customer_action', { action: 'transaction_eliminar', cliente: intent.params.cliente, id: intent.params.id });
          await saveChatMessage(db, chatId, 'user', text);
          await sendTelegramMessage(chatId, response, botToken);
          await saveChatMessage(db, chatId, 'assistant', response.substring(0, 500));
          return new Response('OK', { status: 200 });
        } else if (intent.params.action === 'transaction_eliminar_contexto' && intent.params.id) {
          const lastCustomerMatch = [...chatHistory].reverse().find(m =>
            m.role === 'assistant' && m.content.includes('👤 *')
          );
          const customerMatch = lastCustomerMatch?.content.match(/👤 \*([^*]+)\*/);
          if (customerMatch) {
            await savePendingConfirmation(db, chatId, 'customer_action', { action: 'transaction_eliminar_contexto', cliente: customerMatch[1], id: intent.params.id });
            response = buildConfirmationMessage('customer_action', { action: 'transaction_eliminar_contexto', cliente: customerMatch[1], id: intent.params.id });
            await saveChatMessage(db, chatId, 'user', text);
            await sendTelegramMessage(chatId, response, botToken);
            await saveChatMessage(db, chatId, 'assistant', response.substring(0, 500));
            return new Response('OK', { status: 200 });
          } else {
            response = '❓ No encontré un cliente reciente. Dime de quién: "elimina movimiento 12345 de [nombre]"';
          }
        } else if (intent.params.rawText) {
          console.log('[Telegram] Parsing customer action with rawText');
          // Usar customer-ai para parsear la anotación
          const customers = await db?.prepare(`SELECT id, name FROM customers WHERE is_active = 1`).all();
          const presupuestos = await db?.prepare(`SELECT id, fecha, customer_name, total_usd, total_usd_divisa FROM presupuestos ORDER BY fecha DESC LIMIT 20`).all();
          console.log('[Telegram] Got customers:', customers?.results?.length, 'presupuestos:', presupuestos?.results?.length);

          const result = await parseCustomerActions(
            intent.params.rawText,
            customers?.results?.map((c: any) => ({ id: c.id, name: c.name })) || [],
            presupuestos?.results?.map((p: any) => ({ id: p.id, fecha: p.fecha, customerName: p.customer_name, totalUSD: p.total_usd, totalUSDDivisa: p.total_usd_divisa })) || [],
            geminiApiKey
          );
          console.log('[Telegram] parseCustomerActions result:', JSON.stringify(result));

          if (result.success && result.actions.length > 0) {
            const results: string[] = [];
            for (const action of result.actions) {
              console.log('[Telegram] Executing action:', JSON.stringify(action));
              const r = await executeCustomerAction(db, action);
              console.log('[Telegram] Action result:', r);
              results.push(r);
            }
            response = results.join('\n\n');
            if (result.unmatchedCustomers.length > 0) {
              response += `\n\n⚠️ No encontré: ${result.unmatchedCustomers.join(', ')}`;
            }
          } else {
            response = `❌ ${result.error || 'No pude interpretar la anotación'}`;
          }
        }
        break;

      case 'customer_purchase_products':
        console.log('[Telegram] customer_purchase_products - rawText:', intent.params.rawText, 'modo:', intent.params.modo, 'sinBs:', intent.params.sinBs);
        response = await createCustomerPurchaseWithProducts(db, intent.params.rawText || text, intent.params.modo || 'bcv', url.origin, geminiApiKey, adminSecret, intent.params.sinBs || false, text);
        break;

      case 'budget_create':
        console.log('[Telegram] ===== BUDGET_CREATE START =====');
        console.log('[Telegram] rawText:', intent.params.rawText?.substring(0, 100));
        console.log('[Telegram] modo:', intent.params.modo, 'sinBs:', intent.params.sinBs);
        try {
          response = await createBudgetFromText(db, intent.params.rawText || text, intent.params.modo || 'bcv', url.origin, geminiApiKey, adminSecret, intent.params.sinBs || false, text);
          console.log('[Telegram] ===== BUDGET_CREATE SUCCESS =====');
          console.log('[Telegram] response length:', response?.length, 'first 200:', response?.substring(0, 200));
        } catch (budgetError: any) {
          console.error('[Telegram] ===== BUDGET_CREATE ERROR =====');
          console.error('[Telegram] error:', budgetError?.message || budgetError);
          response = `❌ Error: ${String(budgetError?.message || budgetError).slice(0, 150)}`;
        }
        break;

      case 'budget_action':
        if (intent.params.action === 'ver' && intent.params.id) {
          response = await getBudget(db, intent.params.id, adminSecret);
        } else if (intent.params.action === 'eliminar' && intent.params.id) {
          await savePendingConfirmation(db, chatId, 'budget_action', { action: 'eliminar', id: intent.params.id });
          response = buildConfirmationMessage('budget_action', { action: 'eliminar', id: intent.params.id });
          await saveChatMessage(db, chatId, 'user', text);
          await sendTelegramMessage(chatId, response, botToken);
          await saveChatMessage(db, chatId, 'assistant', response.substring(0, 500));
          return new Response('OK', { status: 200 });
        } else if (intent.params.action === 'pagar' && intent.params.id) {
          response = await markBudgetPaid(db, intent.params.id, intent.params.metodo);
        } else if (intent.params.action === 'pagar_multiple' && intent.params.ids?.length) {
          // Marcar múltiples presupuestos como pagados
          const results: string[] = [];
          for (const id of intent.params.ids) {
            const r = await markBudgetPaid(db, id, intent.params.metodo);
            results.push(r);
          }
          response = results.join('\n\n');
        } else if (intent.params.action === 'pagar_contexto') {
          // Buscar el último presupuesto mencionado en el contexto para marcarlo como pagado
          const lastBudgetMatch = [...chatHistory].reverse().find(m =>
            m.role === 'assistant' && m.content.includes('Presupuesto #')
          );
          const idMatch = lastBudgetMatch?.content.match(/#(\d+)/);
          if (idMatch) {
            response = await markBudgetPaid(db, idMatch[1], intent.params.metodo);
          } else {
            response = '❓ No encontré un presupuesto reciente. Especifica el número: "marca 12345 como pagado"';
          }
        } else if (intent.params.action === 'pagar_y_whatsapp_contexto' && intent.params.telefono) {
          // Comando compuesto: marcar pagado Y enviar por WhatsApp
          const lastBudgetMatch = [...chatHistory].reverse().find(m =>
            m.role === 'assistant' && m.content.includes('Presupuesto #')
          );
          const idMatch = lastBudgetMatch?.content.match(/#(\d+)/);
          if (idMatch) {
            const budgetId = idMatch[1];
            // 1. Marcar como pagado
            const paidResponse = await markBudgetPaid(db, budgetId, intent.params.metodo);
            // 2. Enviar por WhatsApp
            const whatsappResponse = await sendBudgetWhatsApp(db, budgetId, intent.params.telefono, url.origin);
            // Combinar respuestas
            response = `${paidResponse}\n\n${whatsappResponse}`;
          } else {
            response = '❓ No encontré un presupuesto reciente. Especifica: "marca 12345 pagado y envíaselo al 0414..."';
          }
        } else if (intent.params.action === 'metodo_pago' && intent.params.metodo) {
          // Buscar el último presupuesto marcado como pagado en el contexto
          const lastPaidMatch = chatHistory.reverse().find(m =>
            m.role === 'assistant' && m.content.includes('marcado como *PAGADO*')
          );
          const idMatch = lastPaidMatch?.content.match(/#(\d+)/);
          if (idMatch) {
            response = await updatePaymentMethod(db, idMatch[1], intent.params.metodo);
          } else {
            response = '❓ No encontré un presupuesto reciente para actualizar. Especifica el ID: "el pago del 12345 fue por pago movil"';
          }
        } else if (intent.params.action === 'actualizar' && intent.params.cambio) {
          // Buscar ID del presupuesto en params o en contexto
          let budgetId = intent.params.id;
          if (!budgetId) {
            // Buscar el último presupuesto mencionado en el contexto
            const lastBudgetMatch = [...chatHistory].reverse().find(m =>
              m.role === 'assistant' && m.content.includes('Presupuesto #')
            );
            const idMatch = lastBudgetMatch?.content.match(/#(\d+)/);
            budgetId = idMatch?.[1];
          }
          if (budgetId) {
            response = await updateBudgetProperty(db, budgetId, intent.params.cambio);
          } else {
            response = '❓ No encontré un presupuesto reciente. Especifica el ID: "oculta bs del presupuesto 12345"';
          }
        } else if (intent.params.action === 'editar' && intent.params.edicion) {
          // Editar presupuesto (precio, cantidad, fecha, items)
          let budgetId = intent.params.id ? String(intent.params.id).trim() : null;
          if (!budgetId) {
            // Extraer ID del texto: "presupuesto 56409", "#25376", "presupuesto #56409", "al presupuesto 56409"
            const idInText = text.match(/(?:presupuesto\s*#?\s*|#|al\s+presupuesto\s*#?\s*)(\d{4,6})\b/i)
              || text.match(/presupuesto\s+(\d{4,6})\b/i);
            if (idInText) budgetId = idInText[1];
          }
          if (!budgetId) {
            const lastBudgetMatch = [...chatHistory].reverse().find(m =>
              m.role === 'assistant' && m.content.includes('Presupuesto #')
            );
            const idMatch = lastBudgetMatch?.content.match(/#(\d+)/);
            budgetId = idMatch?.[1];
          }
          console.log('[Telegram] budget_action editar: budgetId=', budgetId, 'edicion=', JSON.stringify(intent.params.edicion));
          if (budgetId) {
            // Handle both single edit and array of edits
            const ediciones = Array.isArray(intent.params.edicion)
              ? intent.params.edicion
              : [intent.params.edicion];

            const responses: string[] = [];
            for (const edicion of ediciones) {
              const result = await editBudget(db, budgetId, edicion);
              responses.push(result);
            }
            response = responses.join('\n');
          } else {
            response = '❓ No encontré un presupuesto reciente. Especifica el ID: "edita el presupuesto 12345..."';
          }
        } else if (intent.params.action === 'whatsapp' && intent.params.id && intent.params.telefono) {
          response = await sendBudgetWhatsApp(db, intent.params.id, intent.params.telefono, url.origin);
        } else if (intent.params.action === 'whatsapp_contexto' && intent.params.telefono) {
          // Buscar el último presupuesto mencionado en el contexto
          const lastBudgetMatch = [...chatHistory].reverse().find(m =>
            m.role === 'assistant' && m.content.includes('Presupuesto #')
          );
          const idMatch = lastBudgetMatch?.content.match(/#(\d+)/);
          if (idMatch) {
            response = await sendBudgetWhatsApp(db, idMatch[1], intent.params.telefono, url.origin);
          } else {
            response = '❓ No encontré un presupuesto reciente. Especifica: "envía el presupuesto 12345 al 0414..."';
          }
        } else if (intent.params.action === 'buscar' && intent.params.cliente) {
          response = await searchBudgetsByCustomer(db, intent.params.cliente);
        } else if (intent.params.action === 'asignar' && intent.params.id && intent.params.cliente) {
          // Asignar presupuesto explícito a cliente explícito
          const bcvRateForLink = await getBCVRate(db);
          const linkResult = await linkBudgetToCustomer(db, intent.params.id, intent.params.cliente, bcvRateForLink);
          response = linkResult.message;
        } else if (intent.params.action === 'asignar_contexto') {
          // Buscar el último presupuesto y cliente mencionados en el contexto
          let budgetId = intent.params.id;
          let customerName = intent.params.cliente;

          // Si no hay ID, buscar el último presupuesto mencionado
          if (!budgetId) {
            const lastBudgetMatch = [...chatHistory].reverse().find(m =>
              m.role === 'assistant' && m.content.includes('Presupuesto #')
            );
            const idMatch = lastBudgetMatch?.content.match(/#(\d+)/);
            budgetId = idMatch?.[1];
          }

          // Si no hay cliente, buscar el último cliente mencionado o el del presupuesto
          if (!customerName && budgetId) {
            // Primero intentar obtener el nombre del cliente del presupuesto
            const budget = await db?.prepare(`SELECT customer_name FROM presupuestos WHERE id = ?`).bind(budgetId).first();
            if (budget?.customer_name) {
              customerName = budget.customer_name;
            } else {
              // Buscar en el historial
              const lastCustomerMatch = [...chatHistory].reverse().find(m =>
                m.role === 'assistant' && m.content.includes('👤')
              );
              const customerMatch = lastCustomerMatch?.content.match(/👤 \*?([^*\n]+)\*?/);
              if (customerMatch) {
                customerName = customerMatch[1].trim();
              }
            }
          }

          if (budgetId && customerName) {
            const bcvRateForLink = await getBCVRate(db);
            const linkResult = await linkBudgetToCustomer(db, budgetId, customerName, bcvRateForLink);
            response = linkResult.message;
          } else if (!budgetId) {
            response = '❓ No encontré un presupuesto reciente. Especifica: "asigna el presupuesto 12345 a [cliente]"';
          } else {
            response = '❓ No encontré a qué cliente asignar. Especifica: "asígnalo a [cliente]"';
          }
        }
        break;

      case 'config_action':
        if (intent.params.action === 'tema' && intent.params.tema) {
          response = await changeTheme(db, intent.params.tema);
        } else if (intent.params.action === 'stats') {
          response = await getStats(db);
        } else if (intent.params.action === 'tasa') {
          const bcvRate = await getBCVRate(db);
          response = `💱 *Tasa BCV*\n\nBs. ${bcvRate.rate.toFixed(2)} por dólar\nFuente: ${bcvRate.source}`;
        }
        break;

      case 'product_action':
        if (intent.params.action === 'listar') {
          response = await getProductsList(db);
        } else if (intent.params.action === 'precio' && intent.params.producto) {
          response = await updateProductPrice(db, intent.params.producto, intent.params.precioBcv, intent.params.precioDivisa);
        } else if (intent.params.action === 'disponibilidad' && intent.params.producto !== undefined) {
          response = await updateProductAvailability(db, intent.params.producto, intent.params.disponible);
        }
        break;

      case 'help':
        response = `📖 *Comandos RPYM*\n\n` +
          `*Clientes*\n• "anota a X $Y de Z"\n• "abona X $Y"\n• "ver clientes" / "como está X"\n• "movimientos de X" (ver IDs)\n• "marca [ID] pagado" / "borra movimiento [ID]"\n• "elimina cliente X" / "genera link de cuenta para X"\n\n` +
          `*Presupuestos*\n• "presupuesto de 2kg jumbo para Maria"\n• "presupuesto dual de..."\n• "ver/eliminar presupuesto 12345"\n• "ponle dirección Av. X"\n\n` +
          `*Productos*\n• "ver productos"\n• "sube jumbo a $15"\n• "no hay pulpo"\n\n` +
          `*Config*\n• "tema navidad/normal"\n• "estadísticas"\n• "tasa bcv"`;
        break;

      case 'chat':
      default:
        response = intent.params.respuesta || intent.message || '¿En qué te ayudo?';
        break;
    }

    // Guardar mensaje del usuario y respuesta para memoria
    await saveChatMessage(db, chatId, 'user', text);
    await saveChatMessage(db, chatId, 'assistant', response.substring(0, 500)); // Limitar tamaño

    await sendTelegramMessage(chatId, response, botToken);
    return new Response('OK', { status: 200 });

  } catch (error) {
    console.error('[Telegram] Error:', error);
    try {
      const runtime = (locals as any).runtime;
      const botToken = runtime?.env?.TELEGRAM_BOT_TOKEN || import.meta.env.TELEGRAM_BOT_TOKEN;
      const body = await request.clone().json();
      const chatId = body?.message?.chat?.id;
      if (botToken && chatId) {
        const errMsg = String((error as Error)?.message || error).slice(0, 200);
        await sendTelegramMessage(
          chatId,
          `❌ *Error al procesar*\n\n\`${errMsg}\`\n\n_Revisa los logs o intenta de nuevo._`,
          botToken
        );
      }
    } catch (e) {
      console.error('[Telegram] Error mandando mensaje de error:', e);
    }
    return new Response('OK', { status: 200 });
  }
};

export const GET: APIRoute = async ({ url, locals }) => {
  const testText = url.searchParams.get('test');
  const simulate = url.searchParams.get('simulate');

  const runtime = (locals as any).runtime;
  const geminiApiKey = runtime?.env?.GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY;
  const adminSecret = runtime?.env?.ADMIN_SECRET || 'rpym-default-secret-2024';
  const db = getD1(locals);

  // Simulación completa del flujo POST
  if (simulate) {
    if (!geminiApiKey) {
      return new Response(JSON.stringify({ error: 'No Gemini API key' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    try {
      const intent = await detectIntent(simulate, geminiApiKey);
      let response = intent.message;
      let executionLog: string[] = [];

      switch (intent.intent) {
        case 'customer_action':
          if (intent.params.rawText) {
            executionLog.push('Parsing customer action...');
            const customers = await db?.prepare(`SELECT id, name FROM customers WHERE is_active = 1`).all();
            const presupuestos = await db?.prepare(`SELECT id, fecha, customer_name, total_usd, total_usd_divisa FROM presupuestos ORDER BY fecha DESC LIMIT 20`).all();
            executionLog.push(`Found ${customers?.results?.length || 0} customers, ${presupuestos?.results?.length || 0} presupuestos`);

            const result = await parseCustomerActions(
              intent.params.rawText,
              customers?.results?.map((c: any) => ({ id: c.id, name: c.name })) || [],
              presupuestos?.results?.map((p: any) => ({ id: p.id, fecha: p.fecha, customerName: p.customer_name, totalUSD: p.total_usd, totalUSDDivisa: p.total_usd_divisa })) || [],
              geminiApiKey
            );
            executionLog.push(`parseCustomerActions: ${JSON.stringify(result)}`);

            if (result.success && result.actions.length > 0) {
              const results: string[] = [];
              for (const action of result.actions) {
                executionLog.push(`Executing: ${JSON.stringify(action)}`);
                const r = await executeCustomerAction(db, action);
                executionLog.push(`Result: ${r}`);
                results.push(r);
              }
              response = results.join('\n\n');
            } else {
              response = `❌ ${result.error || 'No pude interpretar'}`;
            }
          }
          break;

        case 'customer_purchase_products':
          executionLog.push(`Customer purchase with products: ${intent.params.rawText}, mode: ${intent.params.modo}, sinBs: ${intent.params.sinBs}`);
          response = await createCustomerPurchaseWithProducts(db, intent.params.rawText || simulate, intent.params.modo || 'bcv', url.origin, geminiApiKey, adminSecret, intent.params.sinBs || false, simulate);
          executionLog.push(`Response: ${response}`);
          break;

        case 'budget_create':
          executionLog.push(`Creating budget: ${intent.params.rawText}, mode: ${intent.params.modo}, sinBs: ${intent.params.sinBs}`);
          response = await createBudgetFromText(db, intent.params.rawText || simulate, intent.params.modo || 'bcv', url.origin, geminiApiKey, adminSecret, intent.params.sinBs || false, simulate);
          executionLog.push(`Response: ${response}`);
          break;
      }

      return new Response(JSON.stringify({ input: simulate, intent, response, executionLog }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error), stack: (error as any).stack }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // Test simple del router
  if (testText) {
    if (!geminiApiKey) {
      return new Response(JSON.stringify({ error: 'No Gemini API key' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    try {
      const intent = await detectIntent(testText, geminiApiKey);
      let parseResult = null;
      if (intent.intent === 'customer_action' && intent.params.rawText) {
        const customers = await db?.prepare(`SELECT id, name FROM customers WHERE is_active = 1`).all();
        const presupuestos = await db?.prepare(`SELECT id, fecha, customer_name, total_usd, total_usd_divisa FROM presupuestos ORDER BY fecha DESC LIMIT 20`).all();
        parseResult = await parseCustomerActions(
          intent.params.rawText,
          customers?.results?.map((c: any) => ({ id: c.id, name: c.name })) || [],
          presupuestos?.results?.map((p: any) => ({ id: p.id, fecha: p.fecha, customerName: p.customer_name, totalUSD: p.total_usd, totalUSDDivisa: p.total_usd_divisa })) || [],
          geminiApiKey
        );
      }
      return new Response(JSON.stringify({ input: testText, intent, parseResult, origin: url.origin }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  return new Response('Telegram webhook running', { status: 200 });
};
