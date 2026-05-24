/**
 * Handlers fiscales para el bot de Telegram.
 * Procesa capturas del portal SENIAT (Compromisos de Pago) con Gemini Vision
 * y las registra en fiscal_pagos_seniat.
 */
import { callGeminiWithRetry } from '../../gemini-client';
import type { D1Database, R2Bucket } from '../../d1-types';

export interface SeniatObligation {
  periodo: string;          // "2026-05"
  concepto: string;         // "iva_neto" | "igtf" | "retencion_islr" | "retencion_iva" | "sumat"
  tipo_pago: string;        // "pago1" | "pago2" | "sumat" | "otro"
  quincena: number | null;  // 1 = 1-15, 2 = 16-fin, null = mensual
  monto_bs: number;
  numero_planilla: string | null;
  fecha_vencimiento: string | null; // "YYYY-MM-DD"
  impuesto_label: string;   // "IVA/35", "IGTF" (solo para mostrar)
}

export interface SeniatParseResult {
  success: boolean;
  obligations: SeniatObligation[];
  error?: string;
}

export interface TelegramPhotoData {
  base64: string;
  mimeType: string;
  buffer: ArrayBuffer; // para subir a R2 sin re-decodificar
}

/** "YYYY-MM-DD" estricto */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Descarga una foto de Telegram. Retorna base64 (para Gemini) y buffer (para R2).
 */
export async function downloadTelegramPhoto(
  fileId: string,
  botToken: string
): Promise<TelegramPhotoData | null> {
  try {
    const infoRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
    );
    if (!infoRes.ok) return null;
    const info = await infoRes.json() as any;
    const filePath = info.result?.file_path;
    if (!filePath) return null;

    const imgRes = await fetch(
      `https://api.telegram.org/file/bot${botToken}/${filePath}`
    );
    if (!imgRes.ok) return null;

    const buffer = await imgRes.arrayBuffer();
    const uint8 = new Uint8Array(buffer);

    // btoa sin Buffer (compatible con Cloudflare Workers)
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < uint8.length; i += chunk) {
      binary += String.fromCharCode(...uint8.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);
    const mimeType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return { base64, mimeType, buffer };
  } catch (e) {
    console.error('[fiscal-handlers] downloadTelegramPhoto:', e);
    return null;
  }
}

/**
 * Sube la imagen al bucket R2 y retorna el image_key (o null si falla).
 */
export async function uploadSeniatImageToR2(
  r2: R2Bucket | null,
  buffer: ArrayBuffer,
  mimeType: string
): Promise<string | null> {
  if (!r2) return null;
  try {
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    const key = `fiscal/comprobante-seniat/bot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    await r2.put(key, buffer, { httpMetadata: { contentType: mimeType } });
    return key;
  } catch (e) {
    console.error('[fiscal-handlers] uploadSeniatImageToR2:', e);
    return null;
  }
}

/**
 * Analiza una captura del SENIAT con Gemini Vision.
 * El caption (opcional) se pasa como contexto adicional.
 */
export async function analyzeSeniatPhoto(
  base64: string,
  mimeType: string,
  geminiApiKey: string,
  caption: string = ''
): Promise<SeniatParseResult> {
  const captionHint = caption.trim()
    ? `\n\nNota del usuario sobre la imagen: "${caption.trim()}"`
    : '';

  const result = await callGeminiWithRetry({
    systemPrompt: `Eres un extractor de datos fiscales venezolanos especializado en el portal SENIAT.
Analizas imágenes y extraes datos estructurados en JSON exacto, sin texto adicional.`,
    userMessage: `Analiza esta imagen. Si muestra la tabla "Compromisos de Pago" del portal SENIAT, extrae los datos y responde SOLO con este JSON:

{
  "tipo": "compromisos_pago",
  "periodo": "YYYY-MM",
  "obligaciones": [
    {
      "impuesto": "IVA/35",
      "numero_documento": "2601417648",
      "fecha_vencimiento": "2026-05-26",
      "monto_bs": 417096.13
    }
  ]
}

REGLAS IMPORTANTES:
- El período está en la columna "Periodo" (ej: "05/2026" → "2026-05")
- El monto está en "Monto(Bs.)" — convierte a número: "417.096,13" → 417096.13 (punto=miles, coma=decimales)
- Incluye TODAS las filas de la tabla, sin omitir ninguna
- "fecha_vencimiento" debe estar en formato exacto YYYY-MM-DD
- Sobre las etiquetas de impuesto del SENIAT:
  • "IVA/30" = Declaración de IVA propio (Forma 30) — distinto de IVA/35
  • "IVA/35" = Retención de IVA a proveedores (Forma 35) — distinto de IVA/30
  • "IGTF" = Impuesto a Grandes Transacciones Financieras
  • "ISLR" o "ANTICIPO-ISLR" = Retención de ISLR
  • "SUMAT" = Impuesto municipal
  Conserva la etiqueta exacta como aparece (IVA/30 vs IVA/35 NO son intercambiables).
- Si NO es una imagen de Compromisos de Pago del SENIAT, responde: {"tipo": "otro"}${captionHint}`,
    apiKey: geminiApiKey,
    jsonMode: false,
    maxOutputTokens: 1024,
    inlineData: { mimeType, data: base64 },
  });

  if (!result.success) {
    return { success: false, obligations: [], error: 'Error al analizar la imagen con IA' };
  }

  let parsed: any;
  try {
    const raw = result.content.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('[fiscal-handlers] JSON.parse falló. Respuesta cruda:', result.content);
    return { success: false, obligations: [], error: 'Error al leer la respuesta de IA (JSON inválido)' };
  }

  if (parsed.tipo !== 'compromisos_pago' || !Array.isArray(parsed.obligaciones)) {
    return {
      success: false,
      obligations: [],
      error: 'La imagen no parece ser un Compromiso de Pago del SENIAT. (Por ahora solo proceso esa tabla — comprobantes bancarios y otros tipos vendrán pronto.)',
    };
  }

  // Primera pasada: clasificar conceptos
  // IVA/30 (Forma 30) = IVA neto propio; IVA/35 (Forma 35) = Retención IVA a proveedores
  const rawObligaciones = parsed.obligaciones.map((o: any) => {
    const label = String(o.impuesto || '').toUpperCase().trim();
    let concepto = 'iva_neto';
    if (label.includes('IGTF')) concepto = 'igtf';
    else if (label.includes('ISLR')) concepto = 'retencion_islr';
    else if (label.includes('SUMAT')) concepto = 'sumat';
    else if (label.includes('IVA') && label.includes('35')) concepto = 'retencion_iva';
    // IVA/30 o cualquier otra variante de IVA → iva_neto (default)
    return { concepto, label, o };
  });

  // Si hay IVA neto (IVA/30) → 1ER PAGO (retenciones Q2 del mes anterior + IVA mensual)
  // Si no hay IVA neto → 2DO PAGO (retenciones Q1 del mes actual)
  const esUnoPago = rawObligaciones.some((r: { concepto: string }) => r.concepto === 'iva_neto');
  const tipoPagoRet: string = esUnoPago ? 'pago1' : 'pago2';
  const quincenaRet: number = esUnoPago ? 2 : 1;

  const obligations: SeniatObligation[] = [];
  for (const { concepto, label, o } of rawObligaciones) {
    const monto_bs = Number(o.monto_bs);
    if (!Number.isFinite(monto_bs) || monto_bs <= 0) {
      console.warn('[fiscal-handlers] obligación descartada por monto inválido:', o);
      continue;
    }

    let tipo_pago: string;
    let quincena: number | null;

    if (concepto === 'iva_neto') {
      tipo_pago = 'pago1';
      quincena = null; // IVA neto es mensual, no tiene quincena
    } else if (concepto === 'sumat') {
      tipo_pago = 'sumat';
      quincena = null;
    } else {
      // igtf, retencion_islr, retencion_iva → dependen del tipo de pago detectado
      tipo_pago = tipoPagoRet;
      quincena = quincenaRet;
    }

    const fecha = typeof o.fecha_vencimiento === 'string' && ISO_DATE_RE.test(o.fecha_vencimiento)
      ? o.fecha_vencimiento
      : null;

    obligations.push({
      periodo: parsed.periodo,
      concepto,
      tipo_pago,
      quincena,
      monto_bs,
      numero_planilla: o.numero_documento ? String(o.numero_documento) : null,
      fecha_vencimiento: fecha,
      impuesto_label: o.impuesto || label,
    });
  }

  if (obligations.length === 0) {
    return { success: false, obligations: [], error: 'No se pudo extraer ninguna obligación válida de la imagen' };
  }

  return { success: true, obligations };
}

const fmtBs = (n: number) =>
  new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/**
 * Construye el mensaje de confirmación para el usuario.
 */
export function buildSeniatConfirmMsg(obligations: SeniatObligation[]): string {
  const periodo = obligations[0]?.periodo ?? '??';
  const esUnoPago = obligations.some(o => o.concepto === 'iva_neto');
  const tipoPagoLabel = esUnoPago ? '1er pago' : '2do pago';
  let msg = `📋 *Compromisos SENIAT — ${periodo}* (${tipoPagoLabel})\n\n`;

  for (const o of obligations) {
    msg += `• *${o.impuesto_label}*: Bs. ${fmtBs(o.monto_bs)}`;
    if (o.numero_planilla) msg += `\n  Planilla: \`${o.numero_planilla}\``;
    if (o.fecha_vencimiento) msg += `\n  Vence: ${o.fecha_vencimiento}`;
    msg += '\n\n';
  }

  msg += `Responde *"sí"* para registrarlos o *"no"* para cancelar.`;
  return msg;
}

/**
 * Inserta las obligaciones como pagos en fiscal_pagos_seniat.
 * Detecta duplicados por (periodo, concepto, numero_planilla) y los omite.
 */
export async function registerSeniatObligations(
  db: D1Database | null,
  obligations: SeniatObligation[],
  imageKey: string | null = null
): Promise<string> {
  if (!db || obligations.length === 0) return '❌ Error: sin datos para registrar.';

  let inserted = 0;
  let skipped = 0;

  try {
    for (const o of obligations) {
      // Detectar duplicado por (periodo, concepto, numero_planilla)
      if (o.numero_planilla) {
        const dup = await db.prepare(`
          SELECT id FROM fiscal_pagos_seniat
          WHERE periodo = ? AND concepto = ? AND numero_planilla = ?
          LIMIT 1
        `).bind(o.periodo, o.concepto, o.numero_planilla).first();
        if (dup) {
          skipped++;
          continue;
        }
      }

      const fechaPago = o.fecha_vencimiento ?? new Date().toISOString().split('T')[0];
      await db.prepare(`
        INSERT INTO fiscal_pagos_seniat
          (periodo, tipo_pago, concepto, quincena, fecha_pago, monto, numero_planilla, image_key, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        o.periodo,
        o.tipo_pago,
        o.concepto,
        o.quincena,
        fechaPago,
        o.monto_bs,
        o.numero_planilla,
        imageKey,
        'Registrado por bot Telegram (Compromiso de Pago SENIAT)'
      ).run();
      inserted++;
    }

    const periodo = obligations[0].periodo;
    const total = obligations.reduce((s, o) => s + o.monto_bs, 0);

    if (inserted === 0 && skipped > 0) {
      return `ℹ️ Ya estaban registrados los ${skipped} pago${skipped !== 1 ? 's' : ''} de ${periodo}. No se duplicó nada.`;
    }

    const skipMsg = skipped > 0 ? `\n(${skipped} ya estaban registrados, se omitieron)` : '';
    return `✅ *${inserted} pago${inserted !== 1 ? 's' : ''} registrado${inserted !== 1 ? 's' : ''}* para ${periodo}\nTotal: Bs. ${fmtBs(total)}${skipMsg}`;
  } catch (e) {
    console.error('[fiscal-handlers] registerSeniatObligations:', e);
    return '❌ Error al guardar en la base de datos.';
  }
}
