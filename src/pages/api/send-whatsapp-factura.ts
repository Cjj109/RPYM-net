import type { APIRoute } from 'astro';
import { getR2 } from '../../lib/d1-types';
import { formatVenezuelanPhone } from '../../lib/phone-ve';
import { generateFacturaPDF } from '../../lib/factura-pdf';

export const prerender = false;

/**
 * Send factura PDF via Meta WhatsApp Cloud API
 *
 * Flow:
 * 1. Receive factura data + phone from frontend
 * 2. Generate PDF using jsPDF
 * 3. Upload PDF to R2 (public whatsapp/ prefix)
 * 4. Call Meta Graph API with document URL and template
 * 5. Meta fetches the PDF and sends it via WhatsApp
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
        error: 'Almacenamiento no disponible.'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Parse JSON body
    const body = await request.json();
    const {
      phone,
      facturaId,
      customerName,
      customerPhone,
      customerAddress,
      items,
      subtotal,
      iva,
      total,
      totalBs,
      totalUSDDivisa,
      exchangeRate,
      date,
      notes,
      isPaid,
      delivery,
      modoPrecio,
      hideRate
    } = body;

    if (!phone || !facturaId || !items || !Array.isArray(items) || items.length === 0 || !total) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Faltan datos requeridos (telefono, facturaId, items o total).'
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

    // Generate PDF
    const pdfBuffer = generateFacturaPDF({
      facturaId,
      customerName: customerName || 'Cliente',
      customerPhone,
      customerAddress,
      items,
      subtotal: subtotal || total,
      iva,
      total,
      totalBs,
      totalUSDDivisa,
      exchangeRate,
      date: date || new Date().toLocaleDateString('es-VE'),
      notes,
      isPaid: isPaid || false,
      delivery: delivery || 0,
      modoPrecio: modoPrecio || undefined,
      hideRate: hideRate || false
    });

    // Upload PDF to R2
    const pdfKey = `${crypto.randomUUID()}.pdf`;

    await r2.put(`whatsapp/${pdfKey}`, pdfBuffer, {
      httpMetadata: { contentType: 'application/pdf' }
    });

    // Build public URL for the PDF
    const baseUrl = url.origin;
    const mediaUrl = `${baseUrl}/api/whatsapp-media/${pdfKey}`;

    // Send via Meta WhatsApp Cloud API
    const graphApiUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

    const name = customerName || 'Cliente';
    const totalFormatted = total.toFixed(2);

    // Template message with header document and body parameters
    // Template: factura_rpym (Spanish)
    // Variables: {{1}} = customer name, {{2}} = total USD, {{3}} = factura ID
    const messagePayload = {
      messaging_product: 'whatsapp',
      to: formattedPhone,
      type: 'template',
      template: {
        name: 'factura_rpym',
        language: { code: 'es' },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'document',
                document: {
                  link: mediaUrl,
                  filename: `Factura_${facturaId}.pdf`
                }
              }
            ]
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: name },
              { type: 'text', text: totalFormatted },
              { type: 'text', text: facturaId }
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

      let userMessage = 'Error al enviar la factura por WhatsApp.';
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
          userMessage = 'Plantilla factura_rpym no encontrada o no aprobada. Espera la aprobacion de Meta.';
        } else if (errorCode === 132001) {
          userMessage = 'Parametros de plantilla incorrectos.';
        } else if (errorCode === 132015 || errorSubcode === 2494055) {
          userMessage = 'La plantilla factura_rpym esta pausada o deshabilitada.';
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

      // Clean up R2 PDF on error
      try {
        await r2.delete(`whatsapp/${pdfKey}`);
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
      messageId: metaResult.messages?.[0]?.id || 'sent',
      pdfUrl: mediaUrl
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('WhatsApp factura endpoint error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error interno del servidor. Intenta de nuevo.'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
