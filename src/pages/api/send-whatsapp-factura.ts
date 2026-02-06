import type { APIRoute } from 'astro';
import { getR2 } from '../../lib/d1-types';
import { jsPDF } from 'jspdf';

export const prerender = false;

// Valid Venezuelan mobile prefixes (all operators)
// Movistar: 414, 424 | Digitel: 412, 422 | Movilnet: 416, 426
const VALID_PREFIXES = ['412', '414', '416', '422', '424', '426'];

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

interface FacturaItem {
  producto: string;
  cantidad: number;
  unidad: string;
  precioUnit: number;
  subtotal: number;
}

/**
 * Generate PDF factura using jsPDF
 */
function generateFacturaPDF(data: {
  facturaId: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  items: FacturaItem[];
  subtotal: number;
  iva?: number;
  total: number;
  totalBs?: number;
  exchangeRate?: number;
  date: string;
  notes?: string;
}): ArrayBuffer {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = 20;

  // Header - Company name
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 102, 204); // Blue
  doc.text('RPYM', margin, y);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text('El Rey de los Pescados y Mariscos', margin, y + 6);

  // Factura number - right aligned
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(50, 50, 50);
  doc.text(`FACTURA #${data.facturaId}`, pageWidth - margin, y, { align: 'right' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Fecha: ${data.date}`, pageWidth - margin, y + 6, { align: 'right' });

  y += 25;

  // Divider line
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // Customer info
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(50, 50, 50);
  doc.text('CLIENTE:', margin, y);

  doc.setFont('helvetica', 'normal');
  doc.text(data.customerName, margin + 25, y);
  y += 6;

  if (data.customerPhone) {
    doc.setFont('helvetica', 'bold');
    doc.text('Telefono:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(data.customerPhone, margin + 25, y);
    y += 6;
  }

  if (data.customerAddress) {
    doc.setFont('helvetica', 'bold');
    doc.text('Direccion:', margin, y);
    doc.setFont('helvetica', 'normal');
    // Word wrap for address
    const addressLines = doc.splitTextToSize(data.customerAddress, pageWidth - margin - 40);
    doc.text(addressLines, margin + 25, y);
    y += 6 * addressLines.length;
  }

  y += 8;

  // Items table header
  const colWidths = {
    producto: 70,
    cantidad: 20,
    unidad: 25,
    precio: 30,
    subtotal: 30
  };

  doc.setFillColor(0, 102, 204);
  doc.rect(margin, y, pageWidth - 2 * margin, 8, 'F');

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);

  let x = margin + 2;
  doc.text('Producto', x, y + 5.5);
  x += colWidths.producto;
  doc.text('Cant.', x, y + 5.5);
  x += colWidths.cantidad;
  doc.text('Unidad', x, y + 5.5);
  x += colWidths.unidad;
  doc.text('P. Unit.', x, y + 5.5);
  x += colWidths.precio;
  doc.text('Subtotal', x, y + 5.5);

  y += 10;

  // Items
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(50, 50, 50);

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];

    // Alternate row colors
    if (i % 2 === 0) {
      doc.setFillColor(245, 245, 245);
      doc.rect(margin, y - 1, pageWidth - 2 * margin, 7, 'F');
    }

    x = margin + 2;

    // Truncate product name if too long
    const productName = item.producto.length > 35
      ? item.producto.substring(0, 32) + '...'
      : item.producto;
    doc.text(productName, x, y + 4);

    x += colWidths.producto;
    doc.text(item.cantidad.toString(), x, y + 4);

    x += colWidths.cantidad;
    doc.text(item.unidad, x, y + 4);

    x += colWidths.unidad;
    doc.text(`$${item.precioUnit.toFixed(2)}`, x, y + 4);

    x += colWidths.precio;
    doc.text(`$${item.subtotal.toFixed(2)}`, x, y + 4);

    y += 7;

    // Check if we need a new page
    if (y > 260) {
      doc.addPage();
      y = 20;
    }
  }

  y += 5;

  // Divider
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // Totals section - right aligned
  const totalsX = pageWidth - margin - 60;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  // Subtotal
  doc.text('Subtotal:', totalsX, y);
  doc.text(`$${data.subtotal.toFixed(2)}`, pageWidth - margin, y, { align: 'right' });
  y += 6;

  // IVA if applicable
  if (data.iva && data.iva > 0) {
    doc.text('IVA (16%):', totalsX, y);
    doc.text(`$${data.iva.toFixed(2)}`, pageWidth - margin, y, { align: 'right' });
    y += 6;
  }

  // Total USD
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('TOTAL USD:', totalsX, y);
  doc.setTextColor(0, 102, 204);
  doc.text(`$${data.total.toFixed(2)}`, pageWidth - margin, y, { align: 'right' });
  y += 8;

  // Total Bs if exchange rate provided
  if (data.totalBs && data.exchangeRate) {
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(10);
    doc.text(`Tasa BCV: Bs. ${data.exchangeRate.toFixed(2)}`, totalsX, y);
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.text('TOTAL Bs:', totalsX, y);
    doc.setTextColor(34, 139, 34); // Green
    doc.text(`Bs. ${data.totalBs.toFixed(2)}`, pageWidth - margin, y, { align: 'right' });
    y += 8;
  }

  // Notes
  if (data.notes) {
    y += 5;
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    const noteLines = doc.splitTextToSize(`Nota: ${data.notes}`, pageWidth - 2 * margin);
    doc.text(noteLines, margin, y);
  }

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 15;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(150, 150, 150);
  doc.text('Gracias por su compra - RPYM El Rey de los Pescados y Mariscos', pageWidth / 2, footerY, { align: 'center' });

  return doc.output('arraybuffer');
}

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
      exchangeRate,
      date,
      notes
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
      exchangeRate,
      date: date || new Date().toLocaleDateString('es-VE'),
      notes
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
