import type { APIRoute } from 'astro';
import { getR2 } from '../../lib/d1-types';

export const prerender = false;

// Valid Venezuelan mobile prefixes
const VALID_PREFIXES = ['412', '414', '416', '424', '426'];

/**
 * Convert Venezuelan phone number to WhatsApp format (without + prefix)
 * Input: 04141234567 or 0414-123-4567 or 584141234567 or +584141234567
 * Output: 584141234567
 */
function formatVenezuelanPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');

  let normalized: string;
  if (digits.startsWith('58') && digits.length === 12) {
    normalized = digits;
  } else if (digits.startsWith('0') && digits.length === 11) {
    normalized = '58' + digits.substring(1);
  } else if (digits.length === 10 && digits.startsWith('4')) {
    normalized = '58' + digits;
  } else {
    return null;
  }

  const prefix = normalized.substring(2, 5);
  if (!VALID_PREFIXES.includes(prefix)) {
    return null;
  }

  return normalized;
}

/**
 * Send presupuesto image via Meta WhatsApp Cloud API
 *
 * Flow:
 * 1. Receive image + phone + metadata from frontend
 * 2. Upload image to R2 (public whatsapp/ prefix)
 * 3. Call Meta Graph API with image URL and template
 * 4. Meta fetches the image and sends it via WhatsApp
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  try {
    const runtime = (locals as any).runtime;
    const accessToken = runtime?.env?.WHATSAPP_ACCESS_TOKEN || import.meta.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = runtime?.env?.WHATSAPP_PHONE_NUMBER_ID || import.meta.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!accessToken || !phoneNumberId) {
      console.error('Meta WhatsApp: Missing credentials');
      return new Response(JSON.stringify({
        success: false,
        error: 'WhatsApp no configurado. Faltan credenciales de Meta.'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const r2 = getR2(locals);
    if (!r2) {
      console.error('Meta WhatsApp: R2 not available');
      return new Response(JSON.stringify({
        success: false,
        error: 'Almacenamiento de imagenes no disponible.'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Parse form data
    const formData = await request.formData();
    const imageFile = formData.get('image') as File | null;
    const phone = formData.get('phone') as string | null;
    const customerName = formData.get('customerName') as string | null;
    const totalUSD = formData.get('totalUSD') as string | null;
    const presupuestoId = formData.get('presupuestoId') as string | null;

    if (!imageFile || !phone || !presupuestoId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Faltan datos requeridos (imagen, telefono o ID).'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate phone
    const formattedPhone = formatVenezuelanPhone(phone);
    if (!formattedPhone) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Numero de telefono invalido. Usa formato: 0414XXXXXXX'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate image size (5MB max for WhatsApp)
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
    if (imageFile.size > MAX_IMAGE_SIZE) {
      return new Response(JSON.stringify({
        success: false,
        error: 'La imagen es demasiado grande. Maximo 5MB.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Step 1: Upload image to R2 with unique key
    const imageKey = `${crypto.randomUUID()}.jpg`;
    const imageBuffer = await imageFile.arrayBuffer();

    await r2.put(`whatsapp/${imageKey}`, imageBuffer, {
      httpMetadata: { contentType: 'image/jpeg' }
    });

    // Step 2: Build public URL for the image
    const baseUrl = url.origin;
    const mediaUrl = `${baseUrl}/api/whatsapp-media/${imageKey}`;

    // Step 3: Send via Meta WhatsApp Cloud API
    const graphApiUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

    const name = customerName || 'Cliente';
    const total = totalUSD || '0.00';

    // Template message with header image and body parameters
    // Template: presupuesto_rpym (Spanish)
    // Variables: {{1}} = customer name, {{2}} = total USD, {{3}} = presupuesto ID
    const messagePayload = {
      messaging_product: 'whatsapp',
      to: formattedPhone,
      type: 'template',
      template: {
        name: 'presupuesto_rpym',
        language: { code: 'es' },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'image',
                image: { link: mediaUrl }
              }
            ]
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: name },
              { type: 'text', text: total },
              { type: 'text', text: presupuestoId }
            ]
          }
        ]
      }
    };

    const metaResponse = await fetch(graphApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messagePayload),
    });

    const metaResult = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error('Meta API error:', metaResponse.status, metaResult);

      let userMessage = 'Error al enviar el mensaje de WhatsApp.';
      const error = metaResult.error;

      if (error) {
        const errorCode = error.code;
        const errorSubcode = error.error_subcode;

        // Handle common Meta API errors
        if (errorCode === 190) {
          userMessage = 'Token de acceso invalido o expirado. Contacta al administrador.';
        } else if (errorCode === 131030) {
          userMessage = 'El destinatario no tiene WhatsApp o el numero es invalido.';
        } else if (errorCode === 131047) {
          userMessage = 'Demasiados mensajes enviados. Espera un momento.';
        } else if (errorCode === 131026) {
          userMessage = 'El destinatario no ha iniciado una conversacion. Debe enviar un mensaje primero.';
        } else if (errorCode === 132000) {
          userMessage = 'Plantilla de mensaje no encontrada o no aprobada.';
        } else if (errorCode === 132001) {
          userMessage = 'Parametros de plantilla incorrectos.';
        } else if (errorCode === 132015 || errorSubcode === 2494055) {
          userMessage = 'La plantilla de mensaje esta pausada o deshabilitada.';
        } else if (errorCode === 100) {
          if (error.message?.includes('phone number')) {
            userMessage = 'Numero de telefono invalido o formato incorrecto.';
          } else {
            userMessage = `Error de parametros: ${error.message?.substring(0, 100) || 'Verifica los datos'}`;
          }
        } else if (error.message) {
          userMessage = `Error de Meta: ${error.message.substring(0, 120)}`;
        }
      }

      // Clean up R2 image on error
      try {
        await r2.delete(`whatsapp/${imageKey}`);
      } catch (_) { /* ignore cleanup error */ }

      return new Response(JSON.stringify({
        success: false,
        error: userMessage
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      messageId: metaResult.messages?.[0]?.id || 'sent'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('WhatsApp endpoint error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error interno del servidor. Intenta de nuevo.'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
