import type { APIRoute } from 'astro';
import { getD1 } from '../../lib/d1-types';
import {
  VERIFY_TOKEN,
  NUMERO_PRINCIPAL,
  MAX_MESSAGES_PER_DAY,
} from '../../lib/services/whatsapp/config';
import { getNegocioStatus } from '../../lib/services/whatsapp/negocio';
import { getCachedProducts } from '../../lib/services/whatsapp/product-cache';
import {
  getChatHistory,
  saveChatMessage,
  isNewTopicMessage,
} from '../../lib/services/whatsapp/chat-handlers';
import {
  isAdmin,
  handleAdminCommand,
  checkRateLimit,
  isMessageProcessed,
} from '../../lib/services/whatsapp/admin-handlers';
import { buildSystemPrompt } from '../../lib/services/whatsapp/prompts';
import { callGemini } from '../../lib/services/whatsapp/gemini-handler';
import {
  sendWhatsAppMessage,
  sendContactCard,
  markAsRead,
  sendTypingIndicator,
} from '../../lib/services/whatsapp/wa-api';

export const prerender = false;

/**
 * Verifica la firma HMAC-SHA256 que Meta envía en X-Hub-Signature-256.
 * La comparación es en tiempo constante para no filtrar la firma esperada
 * byte a byte mediante medición de tiempos.
 */
async function isValidMetaSignature(
  rawBody: string,
  signatureHeader: string,
  appSecret: string
): Promise<boolean> {
  if (!signatureHeader.startsWith('sha256=')) return false;
  const received = signatureHeader.slice('sha256='.length).toLowerCase();

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Webhook verification (GET) - Required by Meta for webhook setup
 */
export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WhatsApp webhook verified');
    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  return new Response('Forbidden', { status: 403 });
};

/**
 * Incoming message handler (POST) - Receives messages and responds with AI
 */
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const runtimeEarly = (locals as any).runtime;

    // Verificación de origen: Meta firma cada webhook con HMAC-SHA256 sobre el
    // cuerpo crudo, usando el App Secret. Sin esto, el campo `from` del JSON
    // era confiable a ciegas y permitía suplantar al admin o a cualquier cliente.
    const appSecret = runtimeEarly?.env?.WHATSAPP_APP_SECRET
      || import.meta.env.WHATSAPP_APP_SECRET;
    if (!appSecret) {
      console.error('[WhatsApp] WHATSAPP_APP_SECRET no configurado — se rechaza la petición');
      return new Response('Forbidden', { status: 403 });
    }

    // Hay que leer el cuerpo CRUDO: la firma se calcula sobre los bytes exactos,
    // así que no se puede usar request.json() antes de verificar.
    const rawBody = await request.text();
    const signatureHeader = request.headers.get('X-Hub-Signature-256') || '';
    if (!(await isValidMetaSignature(rawBody, signatureHeader, appSecret))) {
      console.warn('[WhatsApp] Firma inválida — petición rechazada');
      return new Response('Forbidden', { status: 403 });
    }

    const body = JSON.parse(rawBody);

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Meta reporta aquí el estado de cada mensaje que enviamos:
    // sent → delivered → read, o failed con el motivo real.
    // Sin esto, un envío que Meta acepta con 200 pero luego descarta desaparece
    // sin dejar rastro y en el panel queda como "enviado exitosamente".
    if (value?.messaging_product === 'whatsapp' && value?.statuses?.length) {
      for (const status of value.statuses) {
        if (status.status === 'failed') {
          const err = status.errors?.[0];
          console.error('[WhatsApp] Entrega FALLIDA ' + JSON.stringify({
            destinatario: status.recipient_id,
            messageId: status.id,
            codigo: err?.code,
            titulo: err?.title,
            detalle: err?.error_data?.details || err?.message || null,
          }));
        } else {
          console.log(`[WhatsApp] Estado ${status.status} -> ${status.recipient_id} (${status.id})`);
        }
      }
      return new Response('OK', { status: 200 });
    }

    if (value?.messaging_product !== 'whatsapp' || !value?.messages) {
      return new Response('OK', { status: 200 });
    }

    const message = value.messages[0];
    const from = message.from;
    const messageId = message.id;
    const messageType = message.type;

    const runtime = (locals as any).runtime;
    const accessToken = runtime?.env?.WHATSAPP_ACCESS_TOKEN || import.meta.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = runtime?.env?.WHATSAPP_PHONE_NUMBER_ID || import.meta.env.WHATSAPP_PHONE_NUMBER_ID;
    const geminiApiKey = runtime?.env?.GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY;

    if (!accessToken || !phoneNumberId) {
      console.error('WhatsApp webhook: Missing WhatsApp credentials');
      return new Response('OK', { status: 200 });
    }

    await markAsRead(messageId, accessToken, phoneNumberId);

    const db = getD1(locals);

    if (await isMessageProcessed(db, messageId)) {
      return new Response('OK', { status: 200 });
    }

    if (messageType !== 'text') {
      await sendWhatsAppMessage(
        from,
        '¡Épale! 🦐 Por ahora solo leo texto, mi pana. Escríbeme qué necesitas y te ayudo con precios y presupuestos.',
        accessToken,
        phoneNumberId,
        messageId
      );
      return new Response('OK', { status: 200 });
    }

    const rawUserMessage = message.text?.body?.trim();

    if (!rawUserMessage) {
      return new Response('OK', { status: 200 });
    }

    const MAX_USER_MESSAGE_LENGTH = 500;
    const userMessage = rawUserMessage.length > MAX_USER_MESSAGE_LENGTH
      ? rawUserMessage.substring(0, MAX_USER_MESSAGE_LENGTH) + '...'
      : rawUserMessage;

    const adminResult = await handleAdminCommand(userMessage, from, db);
    if (adminResult.handled && adminResult.response) {
      await sendWhatsAppMessage(from, adminResult.response, accessToken, phoneNumberId, messageId);
      return new Response('OK', { status: 200 });
    }

    const msgLower = userMessage.toLowerCase().trim();
    if (msgLower === 'reset' || msgLower === 'nuevo' || msgLower === 'nueva' || msgLower === 'reiniciar') {
      if (db) {
        await db.prepare('DELETE FROM whatsapp_chat_history WHERE phone = ?').bind(from).run();
      }
      await sendWhatsAppMessage(
        from,
        '🔄 ¡Listo mi pana! Conversación reiniciada.\n\n¿En qué te puedo ayudar? 🦐',
        accessToken,
        phoneNumberId,
        messageId
      );
      return new Response('OK', { status: 200 });
    }

    if (msgLower === 'lista' || msgLower === 'precios' || msgLower === 'menu' || msgLower === 'catalogo') {
      const { productosTexto, bcvRate } = await getCachedProducts(db);
      const listaFormateada = `🦐 *LISTA DE PRECIOS RPYM*\n(Tasa BCV: Bs. ${bcvRate.toFixed(2)})\n\n${productosTexto}\n📍 Muelle Pesquero El Mosquero\nPuesto 3 y 4, Maiquetía\n\nPa' pedir: ${NUMERO_PRINCIPAL}`;
      await sendWhatsAppMessage(from, listaFormateada, accessToken, phoneNumberId, messageId);
      await sendContactCard(from, accessToken, phoneNumberId);
      return new Response('OK', { status: 200 });
    }

    const negocioStatus = await getNegocioStatus(db);
    if (!negocioStatus.abierto && !isAdmin(from)) {
      let mensajeCierre = '🦐 ¡Hola mi pana! Ahorita estamos cerrados.';
      if (negocioStatus.mensaje) {
        mensajeCierre += `\n\n📝 ${negocioStatus.mensaje}`;
      }
      mensajeCierre += `\n\nPa' cualquier cosa urgente, escríbele a José: ${NUMERO_PRINCIPAL}`;
      await sendWhatsAppMessage(from, mensajeCierre, accessToken, phoneNumberId, messageId);
      await sendContactCard(from, accessToken, phoneNumberId);
      return new Response('OK', { status: 200 });
    }

    const rateLimit = isAdmin(from)
      ? { allowed: true, count: 0 }
      : await checkRateLimit(db, from);

    if (!rateLimit.allowed) {
      await sendWhatsAppMessage(
        from,
        `¡Ey mi pana! 🦐 Ya hablamos bastante hoy (${MAX_MESSAGES_PER_DAY} mensajes). Pa' seguir la conversa o hacer tu pedido, escríbele directo a José: ${NUMERO_PRINCIPAL}\n\n¡Mañana seguimos echando vaina! 😄`,
        accessToken,
        phoneNumberId,
        messageId
      );
      await sendContactCard(from, accessToken, phoneNumberId);
      return new Response('OK', { status: 200 });
    }

    if (!geminiApiKey) {
      console.error('WhatsApp webhook: Missing GEMINI_API_KEY');
      await sendWhatsAppMessage(
        from,
        `¡Épale! 🦐 Gracias por escribir.\n\nMira los precios aquí:\n👉 https://www.rpym.net/lista\n\nO arma tu presupuesto:\n👉 https://www.rpym.net/presupuesto\n\nPa' pedir, escríbele a José: ${NUMERO_PRINCIPAL}`,
        accessToken,
        phoneNumberId
      );
      return new Response('OK', { status: 200 });
    }

    const { bcvRate, productosTexto } = await getCachedProducts(db);
    const systemPrompt = buildSystemPrompt(productosTexto, bcvRate);

    const isNewTopic = isNewTopicMessage(userMessage);
    const chatHistory = isNewTopic ? [] : await getChatHistory(db, from, 6);
    console.log(`[WhatsApp] ${from}: "${userMessage.substring(0, 50)}..." (history: ${chatHistory.length} msgs, newTopic: ${isNewTopic})`);

    sendTypingIndicator(from, accessToken, phoneNumberId);

    let aiResponse: string;
    try {
      aiResponse = await callGemini(userMessage, systemPrompt, geminiApiKey, chatHistory);
    } catch (error) {
      console.error('Error calling Gemini:', error);
      aiResponse = `¡Epa! 🦐 Estoy medio trabado ahorita.\n\nChequea los precios en:\n👉 https://www.rpym.net/lista\n\nO escríbele a José directo: ${NUMERO_PRINCIPAL}`;
    }

    await saveChatMessage(db, from, 'user', userMessage);
    await saveChatMessage(db, from, 'assistant', aiResponse.substring(0, 1500));

    await sendWhatsAppMessage(from, aiResponse, accessToken, phoneNumberId, messageId);

    const shouldSendContact = aiResponse.includes(NUMERO_PRINCIPAL) ||
                              aiResponse.toLowerCase().includes('cuadrar') ||
                              aiResponse.toLowerCase().includes('escríbele a josé');

    if (shouldSendContact) {
      await new Promise(resolve => setTimeout(resolve, 500));
      await sendContactCard(from, accessToken, phoneNumberId);
    }

    console.log(`AI response sent to ${from} (${rateLimit.count}/${MAX_MESSAGES_PER_DAY})`);
    return new Response('OK', { status: 200 });

  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    return new Response('OK', { status: 200 });
  }
};
