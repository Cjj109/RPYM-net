import type { APIRoute } from 'astro';
import { getR2 } from '../../lib/d1-types';
import { jsPDF } from 'jspdf';
import { formatVenezuelanPhone } from '../../lib/phone-ve';
import { formatUSD, formatBs, formatQuantity } from '../../lib/format';
import { inferModoPrecio } from '../../lib/presupuesto-utils';

export const prerender = false;

interface FacturaItem {
  producto: string;
  cantidad: number;
  unidad: string;
  precioUnit: number;
  subtotal: number;
  precioUnitDivisa?: number;
  subtotalDivisa?: number;
}

// Ocean blue theme colors (matching admin panel print)
const COLORS = {
  // BCV / Primary theme
  primary: { r: 7, g: 89, b: 133 },      // #075985
  primaryDark: { r: 12, g: 74, b: 110 }, // #0c4a6e
  primaryLight: { r: 3, g: 105, b: 161 }, // #0369a1
  primaryBg: { r: 224, g: 242, b: 254 },  // #e0f2fe
  primaryAltBg: { r: 240, g: 249, b: 255 }, // #f0f9ff

  // Divisa / Amber theme
  amber: { r: 146, g: 64, b: 14 },        // #92400e
  amberDark: { r: 113, g: 63, b: 18 },    // #713f12
  amberBg: { r: 254, g: 243, b: 199 },    // #fef3c7
  amberAltBg: { r: 254, g: 252, b: 232 }, // #fefce8

  // USD Only / Green theme
  green: { r: 22, g: 101, b: 52 },        // #166534
  greenBg: { r: 220, g: 252, b: 231 },    // #dcfce7

  // Orange for Bs
  orange: { r: 234, g: 88, b: 12 },       // #ea580c

  // Neutrals
  white: { r: 255, g: 255, b: 255 },
  gray: { r: 100, g: 100, b: 100 },
  lightGray: { r: 245, g: 245, b: 245 },
};


/**
 * Generate PDF presupuesto matching admin panel print design
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
  totalUSDDivisa?: number;
  exchangeRate?: number;
  date: string;
  notes?: string;
  isPaid?: boolean;
  delivery?: number;
  modoPrecio?: 'bcv' | 'divisa' | 'dual';
  hideRate?: boolean;
}): ArrayBuffer {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;

  // Use modoPrecio if available, otherwise infer from values (legacy support)
  const modoPrecio = inferModoPrecio({
    modoPrecio: data.modoPrecio,
    totalUSDDivisa: data.totalUSDDivisa,
    totalBs: data.totalBs,
    totalUSD: data.total,
    hideRate: data.hideRate,
  });

  const isDual = modoPrecio === 'dual';
  const isDivisasOnly = modoPrecio === 'divisa';

  // Helper to set color from object
  const setColor = (color: { r: number; g: number; b: number }, type: 'text' | 'draw' | 'fill') => {
    if (type === 'text') doc.setTextColor(color.r, color.g, color.b);
    else if (type === 'draw') doc.setDrawColor(color.r, color.g, color.b);
    else doc.setFillColor(color.r, color.g, color.b);
  };

  // Draw page function (can be called for BCV page and Divisa page)
  const drawPage = (isDivisaPage: boolean = false) => {
    const theme = isDivisaPage
      ? { primary: COLORS.amber, primaryDark: COLORS.amberDark, primaryLight: COLORS.amber, primaryBg: COLORS.amberBg, primaryAltBg: COLORS.amberAltBg }
      : { primary: COLORS.primary, primaryDark: COLORS.primaryDark, primaryLight: COLORS.primaryLight, primaryBg: COLORS.primaryBg, primaryAltBg: COLORS.primaryAltBg };

    let y = 15;

    // PAGADO stamp (watermark style)
    if (data.isPaid) {
      doc.saveGraphicsState();
      doc.setGState(new (doc as any).GState({ opacity: 0.15 }));
      setColor(COLORS.green, 'text');
      doc.setFontSize(48);
      doc.setFont('helvetica', 'bold');
      // Rotate and center the stamp
      const centerX = pageWidth / 2;
      const centerY = pageHeight / 2;
      doc.text('PAGADO', centerX, centerY, { align: 'center', angle: -15 });
      doc.restoreGraphicsState();
    }

    // === HEADER BOX ===
    setColor(theme.primary, 'draw');
    doc.setLineWidth(0.6);
    doc.rect(margin, y, pageWidth - 2 * margin, 28);

    // Left side - Logo area
    const logoX = margin + 5;
    const logoY = y + 8;

    // Circle for logo placeholder
    setColor(theme.primaryBg, 'fill');
    setColor(theme.primary, 'draw');
    doc.setLineWidth(0.5);
    doc.circle(logoX + 7, logoY + 5, 7, 'FD');

    // RPYM text inside circle area (stylized)
    setColor(theme.primaryDark, 'text');
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.text('RPYM', logoX + 7, logoY + 6, { align: 'center' });

    // Company name
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    setColor(theme.primaryDark, 'text');
    doc.text('RPYM', logoX + 20, logoY + 3);

    // Address
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    setColor(theme.primaryLight, 'text');
    doc.text('Muelle Pesquero "El Mosquero", Puesto 3 y 4, Maiquetia', logoX + 20, logoY + 9);

    // Right side - Document info
    const rightX = pageWidth - margin - 5;

    // Title
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    setColor(theme.primaryDark, 'text');
    doc.text('PRESUPUESTO', rightX, y + 10, { align: 'right' });

    // Type badge
    let badgeText = '';
    let badgeColor = theme.primaryBg;
    let badgeTextColor = theme.primary;

    if (isDivisaPage) {
      // Divisa page (second page of dual, or single page for divisa-only)
      badgeText = 'PRECIOS DIVISA';
      badgeColor = COLORS.amberBg;
      badgeTextColor = COLORS.amber;
    } else if (isDual) {
      // First page of dual (BCV prices)
      badgeText = 'PRECIOS BCV';
    } else {
      // BCV-only mode
      badgeText = 'PRECIOS BCV';
    }

    if (badgeText) {
      const badgeWidth = 30;
      const badgeHeight = 5;
      const badgeX = rightX - badgeWidth;
      const badgeY = y + 13;
      setColor(badgeColor, 'fill');
      doc.roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 1, 1, 'F');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      setColor(badgeTextColor, 'text');
      doc.text(badgeText, badgeX + badgeWidth / 2, badgeY + 3.5, { align: 'center' });
    }

    // ID and date
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    setColor(theme.primaryLight, 'text');
    doc.text('No:', rightX - 35, y + 22);
    doc.setFont('helvetica', 'bold');
    setColor(theme.primaryDark, 'text');
    doc.text(data.facturaId, rightX - 28, y + 22);

    doc.setFont('helvetica', 'normal');
    setColor(theme.primaryLight, 'text');
    doc.text('Fecha:', rightX - 35, y + 26);
    doc.setFont('helvetica', 'bold');
    setColor(theme.primaryDark, 'text');
    doc.text(data.date, rightX - 22, y + 26);

    y += 32;

    // === CLIENT INFO BOX ===
    setColor(theme.primary, 'draw');
    doc.setLineWidth(0.6);
    doc.rect(margin, y, pageWidth - 2 * margin, 16);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    setColor(theme.primaryLight, 'text');
    doc.text('Cliente:', margin + 3, y + 6);
    doc.setFont('helvetica', 'normal');
    setColor(theme.primaryDark, 'text');
    doc.text(data.customerName || '---', margin + 20, y + 6);

    doc.setFont('helvetica', 'bold');
    setColor(theme.primaryLight, 'text');
    doc.text('Direccion:', margin + 3, y + 12);
    doc.setFont('helvetica', 'normal');
    setColor(theme.primaryDark, 'text');
    const addressText = data.customerAddress || '---';
    const truncatedAddress = addressText.length > 80 ? addressText.substring(0, 77) + '...' : addressText;
    doc.text(truncatedAddress, margin + 23, y + 12);

    y += 20;

    // === PRODUCTS TABLE ===
    const tableWidth = pageWidth - 2 * margin;

    // Define exact column boundaries (absolute X positions)
    // Total width = 180mm (A4 width 210 - 2*15 margin)
    // Columns: Producto(70) + Cant(20) + Unidad(25) + P.Unit(28) + Subtotal(37) = 180
    const col = {
      producto: { start: margin, width: 70 },
      cantidad: { start: margin + 70, width: 20 },
      unidad: { start: margin + 90, width: 25 },
      precio: { start: margin + 115, width: 28 },
      subtotal: { start: margin + 143, width: 37 }
    };

    const headerHeight = 8;
    const rowHeight = 7;

    // Draw table header background
    setColor(theme.primaryBg, 'fill');
    doc.rect(margin, y, tableWidth, headerHeight, 'F');

    // Draw header border
    setColor(theme.primary, 'draw');
    doc.setLineWidth(0.5);
    doc.rect(margin, y, tableWidth, headerHeight, 'S');

    // Header text
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    setColor(theme.primaryDark, 'text');

    const headerY = y + 5.5;
    doc.text('Producto', col.producto.start + 3, headerY);
    doc.text('Cant', col.cantidad.start + col.cantidad.width / 2, headerY, { align: 'center' });
    doc.text('Unidad', col.unidad.start + col.unidad.width / 2, headerY, { align: 'center' });
    doc.text('P.Unitario', col.precio.start + col.precio.width / 2, headerY, { align: 'center' });
    doc.text('Subtotal', col.subtotal.start + col.subtotal.width / 2, headerY, { align: 'center' });

    // Header vertical lines
    setColor(theme.primary, 'draw');
    doc.line(col.cantidad.start, y, col.cantidad.start, y + headerHeight);
    doc.line(col.unidad.start, y, col.unidad.start, y + headerHeight);
    doc.line(col.precio.start, y, col.precio.start, y + headerHeight);
    doc.line(col.subtotal.start, y, col.subtotal.start, y + headerHeight);

    y += headerHeight;
    const bodyStartY = y;

    // Table rows
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);

    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];

      // Alternate row background
      if (i % 2 === 0) {
        setColor(theme.primaryAltBg, 'fill');
        doc.rect(margin, y, tableWidth, rowHeight, 'F');
      }

      setColor(theme.primaryDark, 'text');
      const rowY = y + 5;

      // Product name (truncate if needed)
      const productName = item.producto.length > 35 ? item.producto.substring(0, 32) + '...' : item.producto;
      doc.text(productName, col.producto.start + 3, rowY);

      // Quantity - centered
      doc.text(formatQuantity(item.cantidad), col.cantidad.start + col.cantidad.width / 2, rowY, { align: 'center' });

      // Unit - centered
      doc.text(item.unidad, col.unidad.start + col.unidad.width / 2, rowY, { align: 'center' });

      // Price and subtotal based on page type
      const precioUnit = isDivisaPage ? (item.precioUnitDivisa ?? item.precioUnit) : item.precioUnit;
      const subtotal = isDivisaPage ? (item.subtotalDivisa ?? item.subtotal) : item.subtotal;

      // Price - right aligned with padding
      doc.text(formatUSD(precioUnit), col.precio.start + col.precio.width - 3, rowY, { align: 'right' });

      // Subtotal - right aligned with padding, bold
      doc.setFont('helvetica', 'bold');
      doc.text(formatUSD(subtotal), col.subtotal.start + col.subtotal.width - 3, rowY, { align: 'right' });
      doc.setFont('helvetica', 'normal');

      y += rowHeight;
    }

    // Delivery row (if applicable)
    if (data.delivery && data.delivery > 0) {
      // Amber background for delivery row
      setColor({ r: 255, g: 251, b: 235 }, 'fill'); // #fffbeb
      doc.rect(margin, y, tableWidth, rowHeight, 'F');

      setColor(theme.primaryDark, 'text');
      const rowY = y + 5;

      doc.setFont('helvetica', 'italic');
      doc.text('Delivery', col.producto.start + 3, rowY);

      doc.setFont('helvetica', 'normal');
      doc.text('1', col.cantidad.start + col.cantidad.width / 2, rowY, { align: 'center' });
      doc.text('servicio', col.unidad.start + col.unidad.width / 2, rowY, { align: 'center' });
      doc.text(formatUSD(data.delivery), col.precio.start + col.precio.width - 3, rowY, { align: 'right' });

      doc.setFont('helvetica', 'bold');
      doc.text(formatUSD(data.delivery), col.subtotal.start + col.subtotal.width - 3, rowY, { align: 'right' });
      doc.setFont('helvetica', 'normal');

      y += rowHeight;
    }

    // Draw body border (around all rows)
    const bodyHeight = y - bodyStartY;
    setColor(theme.primary, 'draw');
    doc.rect(margin, bodyStartY, tableWidth, bodyHeight, 'S');

    // Body vertical lines (same positions as header)
    doc.line(col.cantidad.start, bodyStartY, col.cantidad.start, y);
    doc.line(col.unidad.start, bodyStartY, col.unidad.start, y);
    doc.line(col.precio.start, bodyStartY, col.precio.start, y);
    doc.line(col.subtotal.start, bodyStartY, col.subtotal.start, y);

    y += 4;

    // === TOTALS BOX ===
    const hasDelivery = data.delivery && data.delivery > 0;
    const baseHeight = isDivisaPage || isDivisasOnly ? 18 : 26;
    const totalsBoxHeight = hasDelivery ? baseHeight + 12 : baseHeight;
    setColor(theme.primary, 'draw');
    doc.rect(margin, y, tableWidth, totalsBoxHeight, 'S');

    // Left side - Observations
    const obsWidth = tableWidth * 0.6;
    doc.line(margin + obsWidth, y, margin + obsWidth, y + totalsBoxHeight);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    setColor(theme.primaryLight, 'text');
    doc.text('OBSERVACIONES:', margin + 3, y + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    if (isDivisaPage || isDivisasOnly) {
      doc.text('Precios en USD efectivo', margin + 3, y + 10);
    } else {
      // BCV mode (with or without hideRate) - always show BCV note
      doc.text('Tasa BCV aplicada al momento de pago', margin + 3, y + 10);
    }

    // Right side - Totals
    const totalsX = margin + obsWidth + 5;
    const totalsRightX = pageWidth - margin - 3;
    let totalsY = y + 5;

    // Show subtotal and delivery if delivery is present
    if (hasDelivery) {
      const subtotal = data.total - (data.delivery || 0);

      doc.setFontSize(9);
      setColor(theme.primaryLight, 'text');
      doc.setFont('helvetica', 'normal');
      doc.text('Subtotal:', totalsX, totalsY);
      setColor(theme.primaryDark, 'text');
      doc.text(formatUSD(subtotal), totalsRightX, totalsY, { align: 'right' });

      totalsY += 5;
      setColor(theme.primaryLight, 'text');
      doc.text('Delivery:', totalsX, totalsY);
      setColor(theme.primaryDark, 'text');
      doc.text(formatUSD(data.delivery!), totalsRightX, totalsY, { align: 'right' });

      totalsY += 3;
      // Separator line
      setColor(theme.primaryBg, 'draw');
      doc.line(totalsX, totalsY, totalsRightX, totalsY);
      totalsY += 4;
    }

    doc.setFontSize(10);
    setColor(theme.primaryLight, 'text');
    doc.setFont('helvetica', 'bold');
    doc.text('Total USD:', totalsX, totalsY);

    const totalAmount = isDivisaPage ? (data.totalUSDDivisa ?? data.total) : data.total;
    setColor(theme.primaryDark, 'text');
    doc.text(formatUSD(totalAmount), totalsRightX, totalsY, { align: 'right' });

    // Show Bs only on BCV page (not divisa, not USD-only, not hideRate)
    if (!isDivisaPage && !isDivisasOnly && !data.hideRate && data.totalBs) {
      // Separator line
      setColor(theme.primaryBg, 'draw');
      doc.line(totalsX, totalsY + 4, totalsRightX, totalsY + 4);

      doc.setFontSize(9);
      setColor(theme.primaryLight, 'text');
      doc.text('Total Bs.:', totalsX, totalsY + 10);

      setColor(COLORS.orange, 'text');
      doc.setFont('helvetica', 'bold');
      doc.text(formatBs(data.totalBs), totalsRightX, totalsY + 10, { align: 'right' });
    }

    y += totalsBoxHeight + 8;

    // === SIGNATURE LINES ===
    const sigWidth = (tableWidth - 20) / 2;

    setColor(theme.primary, 'draw');
    doc.setLineWidth(0.5);

    // Left signature
    doc.line(margin + 10, y + 15, margin + 10 + sigWidth, y + 15);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    setColor(theme.primaryLight, 'text');
    doc.text('CONFORME CLIENTE', margin + 10 + sigWidth / 2, y + 20, { align: 'center' });

    // Right signature
    const rightSigX = margin + 10 + sigWidth + 20;
    doc.line(rightSigX, y + 15, rightSigX + sigWidth, y + 15);
    doc.text('ENTREGADO POR', rightSigX + sigWidth / 2, y + 20, { align: 'center' });

    y += 28;

    // === THANK YOU MESSAGE (if paid) ===
    if (data.isPaid) {
      setColor(COLORS.greenBg, 'fill');
      doc.roundedRect(margin, y, tableWidth, 10, 2, 2, 'F');
      setColor(COLORS.green, 'text');
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Gracias por su compra!', pageWidth / 2, y + 7, { align: 'center' });
      y += 14;
    }

    // === NON-FISCAL NOTICE ===
    setColor({ r: 255, g: 251, b: 235 }, 'fill'); // #fffbeb
    setColor({ r: 253, g: 230, b: 138 }, 'draw'); // #fde68a
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, tableWidth, 8, 1, 1, 'FD');
    setColor({ r: 180, g: 83, b: 9 }, 'text'); // #b45309
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text('Este documento no tiene validez fiscal - Solo para referencia', pageWidth / 2, y + 5, { align: 'center' });

    y += 12;

    // === FOOTER ===
    setColor(theme.primaryBg, 'draw');
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageWidth - margin, y);

    doc.setFontSize(8);
    setColor(theme.primaryLight, 'text');
    doc.text('www.rpym.net  •  WhatsApp: +58 414-214-5202', pageWidth / 2, y + 5, { align: 'center' });
  };

  // Draw page(s) based on mode:
  // - BCV only: single page with BCV theme (isDivisaPage = false)
  // - Divisa only: single page with Divisa theme (isDivisaPage = true)
  // - Dual: two pages (BCV first, then Divisa)
  if (isDivisasOnly) {
    drawPage(true); // Single divisa page with amber theme
  } else {
    drawPage(false); // BCV page with blue theme
    if (isDual) {
      doc.addPage();
      drawPage(true); // Second page for divisa prices
    }
  }

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
