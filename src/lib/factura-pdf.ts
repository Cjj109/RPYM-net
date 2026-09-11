/**
 * PDF de presupuesto con el diseño "factura" (el mismo de la Vista WhatsApp).
 * Lo usan el envío de factura por WhatsApp desde el admin y el bot de Telegram.
 * Modos: BCV (una página), divisa (una página ámbar) y dual (BCV + divisa).
 */
import { jsPDF } from 'jspdf';
import { formatUSD, formatBs, formatQuantity, formatUSDCompact } from './format';
import { inferModoPrecio } from './presupuesto-utils';
import { getFacturaColors, displayCustomerName } from './presupuesto-whatsapp-card';
import { RPYM_LOGO_JPEG } from './rpym-logo-jpeg';

export interface FacturaItem {
  producto: string;
  cantidad: number;
  unidad: string;
  precioUnit: number;
  subtotal: number;
  precioUnitDivisa?: number;
  subtotalDivisa?: number;
}

export interface FacturaPDFData {
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
}

type RGB = [number, number, number];

// Geometría A4 en mm: la tarjeta va centrada y se parte en páginas si no cabe
const PAGE_W = 210;
const PAGE_H = 297;
const CARD_W = 150;
const CARD_X = (PAGE_W - CARD_W) / 2;
const PAD = 8;
const INNER_X = CARD_X + PAD;
const INNER_W = CARD_W - 2 * PAD;
const TOP = 14;
const BOTTOM = PAGE_H - 26;
const LOGO_W = 64;

const hexToRgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

function pdfColors(isAmber: boolean) {
  const c = getFacturaColors(isAmber);
  return {
    dark: hexToRgb(c.dark),
    ribbonBg: hexToRgb(c.ribbonBg),
    text: hexToRgb(c.text),
    textLight: hexToRgb(c.textLight),
    orange: hexToRgb(c.orange),
    border: hexToRgb(c.border),
  };
}

/** Recorta el texto con "..." para que quepa en maxW (con la fuente actual) */
function fitText(doc: jsPDF, text: string, maxW: number): string {
  if (doc.getTextWidth(text) <= maxW) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(t + '...') > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '...';
}

/** Dibuja tramos de texto con estilos distintos en una sola línea centrada */
function drawCenteredRuns(doc: jsPDF, runs: Array<{ text: string; bold?: boolean; color: RGB }>, centerX: number, y: number): void {
  const widths = runs.map(r => {
    doc.setFont('helvetica', r.bold ? 'bold' : 'normal');
    return doc.getTextWidth(r.text);
  });
  let x = centerX - widths.reduce((a, b) => a + b, 0) / 2;
  runs.forEach((r, i) => {
    doc.setFont('helvetica', r.bold ? 'bold' : 'normal');
    doc.setTextColor(...r.color);
    doc.text(r.text, x, y);
    x += widths[i];
  });
}

/**
 * Dibuja una tarjeta "factura" (bcv o divisa) empezando en la página actual.
 * Si la tabla de productos no cabe, continúa en páginas nuevas.
 */
function drawFacturaCard(doc: jsPDF, data: FacturaPDFData, variant: 'bcv' | 'divisa', bcvRate: number): void {
  const colors = pdfColors(variant === 'divisa');
  const setText = (c: RGB) => doc.setTextColor(...c);
  const setFill = (c: RGB) => doc.setFillColor(...c);
  const setDraw = (c: RGB) => doc.setDrawColor(...c);

  const customerName = displayCustomerName(data.customerName);
  const delivery = data.delivery || 0;
  const total = variant === 'divisa' ? (data.totalUSDDivisa ?? data.total) : data.total;
  const showBcvBlocks = variant === 'bcv' && !data.hideRate && bcvRate > 0;
  const totalBs = data.totalBs && data.totalBs > 0 ? data.totalBs : total * bcvRate;

  let segmentTop = TOP;
  let y = TOP + PAD;

  const closeSegment = () => {
    setDraw(colors.dark);
    doc.setLineWidth(0.6);
    doc.roundedRect(CARD_X, segmentTop, CARD_W, y + PAD / 2 - segmentTop, 5, 5, 'S');
  };
  const breakPage = () => {
    closeSegment();
    doc.addPage();
    segmentTop = TOP;
    y = TOP + PAD;
  };
  const ensureSpace = (h: number) => {
    if (y + h > BOTTOM) breakPage();
  };

  // Logo
  const logoH = LOGO_W * RPYM_LOGO_JPEG.height / RPYM_LOGO_JPEG.width;
  doc.addImage(`data:image/jpeg;base64,${RPYM_LOGO_JPEG.base64}`, 'JPEG', PAGE_W / 2 - LOGO_W / 2, y, LOGO_W, logoH, 'rpym-logo');
  y += logoH + 5;

  // Pastilla PRESUPUESTO
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const pillW = doc.getTextWidth('PRESUPUESTO') + 16;
  const pillH = 8;
  setFill(colors.dark);
  doc.roundedRect(PAGE_W / 2 - pillW / 2, y, pillW, pillH, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text('PRESUPUESTO', PAGE_W / 2, y + pillH / 2, { align: 'center', baseline: 'middle' });
  y += pillH + 5;

  if (data.isPaid) {
    doc.setFontSize(8.5);
    const paidW = doc.getTextWidth('PAGADO') + 10;
    const paidH = 5.5;
    doc.setFillColor(220, 252, 231);
    doc.roundedRect(PAGE_W / 2 - paidW / 2, y, paidW, paidH, paidH / 2, paidH / 2, 'F');
    doc.setTextColor(22, 101, 52);
    doc.text('PAGADO', PAGE_W / 2, y + paidH / 2, { align: 'center', baseline: 'middle' });
    y += paidH + 4;
  }

  // Cliente (izquierda) y fecha/referencia (derecha)
  let leftBottom = y;
  if (customerName) {
    const r = 4.5;
    const textX = INNER_X + 2 * r + 3;
    const textW = INNER_W * 0.62 - (2 * r + 3);
    setFill(colors.dark);
    doc.circle(INNER_X + r, y + r, r, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(customerName.charAt(0).toUpperCase(), INNER_X + r, y + r, { align: 'center', baseline: 'middle' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    setText(colors.textLight);
    doc.text('Cliente', textX, y + 3);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    setText(colors.text);
    doc.text(fitText(doc, customerName, textW), textX, y + 8);
    leftBottom = y + 2 * r;

    if (data.customerAddress) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      setText(colors.textLight);
      const lines: string[] = doc.splitTextToSize(data.customerAddress, textW).slice(0, 2);
      doc.text(lines, textX, y + 12.5);
      leftBottom = y + 12.5 + (lines.length - 1) * 3.5 + 1;
    }
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  setText(colors.text);
  doc.text(`Fecha: ${data.date}`, INNER_X + INNER_W, y + 3, { align: 'right' });
  doc.text(`Ref. ${data.facturaId}`, INNER_X + INNER_W, y + 8, { align: 'right' });
  y = Math.max(leftBottom, y + 9) + 5;

  // Franja de tasa BCV
  if (showBcvBlocks) {
    const h = 12;
    const r = 3.5;
    const cx = INNER_X + 4 + r;
    const textX = cx + r + 3.5;
    setFill(colors.ribbonBg);
    doc.roundedRect(INNER_X, y, INNER_W, h, 3, 3, 'F');
    setFill(colors.dark);
    doc.circle(cx, y + h / 2, r, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text('$', cx, y + h / 2, { align: 'center', baseline: 'middle' });

    doc.setFontSize(9);
    setText(colors.text);
    doc.setFont('helvetica', 'normal');
    doc.text('Tasa aplicada:', textX, y + 5);
    const labelW = doc.getTextWidth('Tasa aplicada:');
    doc.setFont('helvetica', 'bold');
    doc.text('BCV', textX + labelW + 1.5, y + 5);
    doc.setFont('helvetica', 'normal');
    doc.text(`${formatBs(bcvRate)} / USD`, textX, y + 9.5);
    y += h + 5;
  }

  // Tabla de productos (columnas 2:1:1:1 como en la tarjeta)
  const HEAD_H = 7.5;
  const ROW_H = 8.5;
  const LINE_H = 4;
  const x0 = INNER_X + 3.5;
  const cw = (INNER_W - 7) / 5;
  const cantX = x0 + cw * 2.5;
  const precioX = x0 + cw * 4;
  const totalX = x0 + cw * 5;
  let tableTop = y;

  const drawTableHeader = () => {
    tableTop = y;
    setFill(colors.dark);
    doc.roundedRect(INNER_X, y, INNER_W, HEAD_H, 2.5, 2.5, 'F');
    doc.rect(INNER_X, y + HEAD_H / 2, INNER_W, HEAD_H / 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    const hy = y + HEAD_H / 2;
    doc.text('PRODUCTO', x0, hy, { baseline: 'middle' });
    doc.text('CANT.', cantX, hy, { align: 'center', baseline: 'middle' });
    doc.text('PRECIO UNIT.', precioX, hy, { align: 'right', baseline: 'middle' });
    doc.text('TOTAL', totalX, hy, { align: 'right', baseline: 'middle' });
    y += HEAD_H;
  };
  const closeTable = () => {
    setDraw(colors.ribbonBg);
    doc.setLineWidth(0.3);
    doc.roundedRect(INNER_X, tableTop, INNER_W, y - tableTop, 2.5, 2.5, 'S');
  };

  ensureSpace(HEAD_H + ROW_H);
  drawTableHeader();
  data.items.forEach((item, i) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    let nameLines: string[] = doc.splitTextToSize(item.producto, cw * 2 - 2);
    if (nameLines.length > 2) nameLines = [nameLines[0], fitText(doc, nameLines.slice(1).join(' '), cw * 2 - 2)];
    const rowH = ROW_H + (nameLines.length - 1) * LINE_H;

    if (y + rowH > BOTTOM) {
      closeTable();
      breakPage();
      drawTableHeader();
    }

    const itemTotal = variant === 'divisa' ? (item.subtotalDivisa ?? item.subtotal) : item.subtotal;
    const unitLabel = item.cantidad > 0 && itemTotal > 0
      ? `${formatUSDCompact(itemTotal / item.cantidad)} / ${item.unidad}`
      : '—';
    const cy = y + rowH / 2;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    setText(colors.text);
    doc.text(nameLines, x0, cy - (nameLines.length - 1) * LINE_H / 2, { baseline: 'middle' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    setText(colors.textLight);
    doc.text(`${formatQuantity(item.cantidad)} ${item.unidad}`, cantX, cy, { align: 'center', baseline: 'middle' });
    doc.text(unitLabel, precioX, cy, { align: 'right', baseline: 'middle' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    setText(colors.text);
    doc.text(formatUSD(itemTotal), totalX, cy, { align: 'right', baseline: 'middle' });
    y += rowH;

    if (i < data.items.length - 1) {
      setDraw(colors.ribbonBg);
      doc.setLineWidth(0.3);
      doc.line(INNER_X, y, INNER_X + INNER_W, y);
    }
  });
  closeTable();
  y += 5;

  // Caja TOTAL A PAGAR
  const BOX_HEAD = 8;
  const boxH = BOX_HEAD + 4 + (delivery > 0 ? 6 : 0) + 10 + (showBcvBlocks ? 17 : 0) + 4;
  ensureSpace(boxH);
  const boxTop = y;
  setFill(colors.dark);
  doc.roundedRect(INNER_X, y, INNER_W, BOX_HEAD, 3, 3, 'F');
  doc.rect(INNER_X, y + BOX_HEAD / 2, INNER_W, BOX_HEAD / 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text('TOTAL A PAGAR', PAGE_W / 2, y + BOX_HEAD / 2, { align: 'center', baseline: 'middle' });
  y += BOX_HEAD + 4;

  if (delivery > 0) {
    doc.setFontSize(9);
    drawCenteredRuns(doc, [
      { text: 'Subtotal ', color: colors.textLight },
      { text: formatUSD(total - delivery), bold: true, color: colors.text },
      { text: '   +   ', color: colors.textLight },
      { text: 'Delivery ', color: colors.textLight },
      { text: formatUSD(delivery), bold: true, color: colors.text },
    ], PAGE_W / 2, y + 3);
    y += 6;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  setText(colors.text);
  doc.text(formatUSD(total), PAGE_W / 2, y + 5, { align: 'center', baseline: 'middle' });
  y += 10;

  if (showBcvBlocks) {
    setDraw(colors.border);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(INNER_X + 6, y + 2, INNER_X + INNER_W - 6, y + 2);
    doc.setLineDashPattern([], 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    setText(colors.textLight);
    doc.text('Equivalente en bolívares', PAGE_W / 2, y + 7, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    setText(colors.orange);
    doc.text(formatBs(totalBs), PAGE_W / 2, y + 14, { align: 'center' });
    y += 17;
  }
  y += 4;
  setDraw(colors.dark);
  doc.setLineWidth(0.5);
  doc.roundedRect(INNER_X, boxTop, INNER_W, y - boxTop, 3, 3, 'S');
  y += 5;

  // Pie de la tarjeta
  ensureSpace(16);
  setDraw(colors.ribbonBg);
  doc.setLineWidth(0.3);
  doc.line(INNER_X, y, INNER_X + INNER_W, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  setText(colors.text);
  doc.text('WhatsApp: +58 414-214-5202', INNER_X, y + 5);
  doc.text('¡Gracias por preferir los mejores productos!', INNER_X + INNER_W, y + 5, { align: 'right' });
  y += 8;
  doc.setLineDashPattern([1, 1], 0);
  doc.line(INNER_X, y, INNER_X + INNER_W, y);
  doc.setLineDashPattern([], 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  setText(colors.textLight);
  doc.text('RPYM – El Rey de los Pescados y Mariscos', PAGE_W / 2, y + 4.5, { align: 'center' });
  y += 6;

  closeSegment();
}

/**
 * Genera el PDF del presupuesto con el diseño "factura".
 * Los Bs (franja de tasa y equivalente) solo aparecen en BCV y si no hay hideRate.
 */
export function generateFacturaPDF(data: FacturaPDFData): ArrayBuffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Use modoPrecio if available, otherwise infer from values (legacy support)
  const modoPrecio = inferModoPrecio({
    modoPrecio: data.modoPrecio,
    totalUSDDivisa: data.totalUSDDivisa,
    totalBs: data.totalBs,
    totalUSD: data.total,
    hideRate: data.hideRate,
  });

  // El bot de Telegram no manda exchangeRate: se deduce de totalBs / total
  const bcvRate = data.exchangeRate && data.exchangeRate > 0
    ? data.exchangeRate
    : (data.totalBs && data.total ? data.totalBs / data.total : 0);

  if (modoPrecio === 'divisa') {
    drawFacturaCard(doc, data, 'divisa', 0);
  } else {
    drawFacturaCard(doc, data, 'bcv', bcvRate);
    if (modoPrecio === 'dual') {
      doc.addPage();
      drawFacturaCard(doc, data, 'divisa', 0);
    }
  }

  // Aviso no fiscal al pie de cada página
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(180, 83, 9);
    doc.text('Este documento no tiene validez fiscal - Solo para referencia', PAGE_W / 2, PAGE_H - 13, { align: 'center' });
    doc.setTextColor(100, 116, 139);
    doc.text('www.rpym.net', PAGE_W / 2, PAGE_H - 9, { align: 'center' });
  }

  return doc.output('arraybuffer');
}
