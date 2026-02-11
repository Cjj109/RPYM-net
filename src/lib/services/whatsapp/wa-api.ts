/**
 * RPYM - WhatsApp Graph API helpers
 */

import { JOSE_CONTACT, NUMERO_PRINCIPAL } from './config';

/**
 * Divide un mensaje largo en partes que respeten el límite de WhatsApp (4096 chars)
 */
export function splitLongMessage(text: string, maxLen: number = 4000): string[] {
  if (text.length <= maxLen) {
    return [text];
  }

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      parts.push(remaining);
      break;
    }

    let cutPoint = maxLen;
    const searchArea = remaining.substring(0, maxLen);

    const lastParagraph = searchArea.lastIndexOf('\n\n');
    if (lastParagraph > maxLen * 0.5) {
      cutPoint = lastParagraph + 2;
    } else {
      const lastNewline = searchArea.lastIndexOf('\n');
      if (lastNewline > maxLen * 0.5) {
        cutPoint = lastNewline + 1;
      } else {
        const lastSentence = searchArea.lastIndexOf('. ');
        if (lastSentence > maxLen * 0.4) {
          cutPoint = lastSentence + 2;
        } else {
          const lastSpace = searchArea.lastIndexOf(' ');
          if (lastSpace > maxLen * 0.3) {
            cutPoint = lastSpace + 1;
          }
        }
      }
    }

    parts.push(remaining.substring(0, cutPoint).trim());
    remaining = remaining.substring(cutPoint).trim();
  }

  if (parts.length > 1) {
    return parts.map((part, i) => `${part}\n\n_(${i + 1}/${parts.length})_`);
  }

  return parts;
}

/**
 * Envía mensaje de texto por WhatsApp
 */
export async function sendWhatsAppMessage(
  to: string,
  message: string,
  accessToken: string,
  phoneNumberId: string,
  replyToMessageId?: string
): Promise<boolean> {
  const messageParts = splitLongMessage(message);

  for (let i = 0; i < messageParts.length; i++) {
    const payload: any = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: messageParts[i] }
    };

    if (i === 0 && replyToMessageId) {
      payload.context = { message_id: replyToMessageId };
    }

    const response = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('WhatsApp send error:', error);
      return false;
    }

    if (i < messageParts.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  return true;
}

/**
 * Envía tarjeta de contacto de José
 */
export async function sendContactCard(
  to: string,
  accessToken: string,
  phoneNumberId: string
): Promise<boolean> {
  const response = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'contacts',
        contacts: [
          {
            name: {
              formatted_name: JOSE_CONTACT.name,
              first_name: 'José',
              last_name: 'RPYM'
            },
            phones: [
              {
                phone: JOSE_CONTACT.phone,
                type: 'CELL',
                wa_id: JOSE_CONTACT.wa_id
              }
            ],
            org: {
              company: 'RPYM - El Rey de los Pescados y Mariscos'
            }
          }
        ]
      }),
    }
  );

  return response.ok;
}

/**
 * Marca mensaje como leído
 */
export async function markAsRead(
  messageId: string,
  accessToken: string,
  phoneNumberId: string
): Promise<void> {
  await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
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
    }
  );
}

/**
 * Envía indicador de "escribiendo..."
 */
export async function sendTypingIndicator(
  to: string,
  accessToken: string,
  phoneNumberId: string
): Promise<void> {
  try {
    await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'reaction',
          reaction: {
            message_id: '',
            emoji: ''
          }
        }),
      }
    );
  } catch {
    // Ignorar errores del typing indicator
  }
}

export { NUMERO_PRINCIPAL };
