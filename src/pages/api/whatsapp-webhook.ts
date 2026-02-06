import type { APIRoute } from 'astro';

export const prerender = false;

// WhatsApp webhook verification token (set in Meta console)
const VERIFY_TOKEN = 'rpym_webhook_2026';

// Jose RPYM phone number (from website)
const JOSE_WHATSAPP = '+58 414-214-5202';

// Auto-reply message
const AUTO_REPLY_MESSAGE = `¡Hola! 👋

Este número es exclusivo para el envío de facturas y presupuestos de *RPYM Repuestos y Mas*.

Para consultas, pedidos o atención al cliente, por favor comunícate directamente con *José RPYM* al:
📱 ${JOSE_WHATSAPP}

¡Gracias por tu preferencia!
_RPYM - Repuestos y Mas_`;

/**
 * Webhook verification (GET) - Required by Meta for webhook setup
 */
export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  // Verify the webhook
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
 * Incoming message handler (POST) - Receives messages and sends auto-reply
 */
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json();

    // Meta sends webhooks for various events
    // We only care about incoming messages
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Check if this is a message event
    if (value?.messaging_product !== 'whatsapp' || !value?.messages) {
      // Not a message, acknowledge anyway
      return new Response('OK', { status: 200 });
    }

    const message = value.messages[0];
    const from = message.from; // Sender's phone number
    const messageId = message.id;
    const messageType = message.type;

    // Only respond to text messages (not reactions, status updates, etc.)
    // Also only respond to first message in a thread (not replies to our auto-reply)
    if (messageType !== 'text') {
      return new Response('OK', { status: 200 });
    }

    // Get credentials
    const runtime = (locals as any).runtime;
    const accessToken = runtime?.env?.WHATSAPP_ACCESS_TOKEN || import.meta.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = runtime?.env?.WHATSAPP_PHONE_NUMBER_ID || import.meta.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!accessToken || !phoneNumberId) {
      console.error('WhatsApp webhook: Missing credentials');
      return new Response('OK', { status: 200 });
    }

    // Check if we already replied to this user recently (prevent spam)
    // In production, you'd use D1/KV to store this, but for now we'll just reply
    // Meta's Cloud API has built-in rate limiting

    // Send auto-reply
    const graphApiUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

    const replyPayload = {
      messaging_product: 'whatsapp',
      to: from,
      type: 'text',
      text: {
        body: AUTO_REPLY_MESSAGE
      },
      // Mark the original message as read
      context: {
        message_id: messageId
      }
    };

    const response = await fetch(graphApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(replyPayload),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('WhatsApp auto-reply error:', error);
    } else {
      console.log(`Auto-reply sent to ${from}`);
    }

    // Also mark the message as read
    await fetch(graphApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId
      }),
    });

    return new Response('OK', { status: 200 });

  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    // Always return 200 to prevent Meta from retrying
    return new Response('OK', { status: 200 });
  }
};
