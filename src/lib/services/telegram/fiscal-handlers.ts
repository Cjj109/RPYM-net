/**
 * Handlers fiscales para el bot de Telegram.
 * Procesa capturas del portal SENIAT (Compromisos de Pago) con Gemini Vision
 * y las registra en fiscal_pagos_seniat.
 */
import { callGeminiWithRetry } from '../../gemini-client';

export interface SeniatObligation {
  periodo: string;          // "2026-05"
  concepto: string;         // "iva_neto" | "igtf" | "retencion_islr" | "sumat"
  tipo_pago: string;        // "pago1" | "pago2" | "sumat" | "otro"
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

/**
 * Descarga una foto de Telegram como base64.
 * Recibe el file_id de la foto de mayor resolución.
 */
export async function downloadTelegramPhoto(
  fileId: string,
  botToken: string
): Promise<{ base64: string; mimeType: string } | null> {
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
    return { base64, mimeType };
  } catch (e) {
    console.error('[fiscal-handlers] downloadTelegramPhoto:', e);
    return null;
  }
}

/**
 * Analiza una captura del SENIAT con Gemini Vision.
 * Retorna las obligaciones de pago detectadas.
 */
export async function analyzeSeniatPhoto(
  base64: string,
  mimeType: string,
  geminiApiKey: string
): Promise<SeniatParseResult> {
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
- Incluye todas las filas de la tabla
- Si NO es una imagen de Compromisos de Pago del SENIAT, responde: {"tipo": "otro"}`,
    apiKey: geminiApiKey,
    model: 'gemini-2.0-flash',
    jsonMode: true,
    maxOutputTokens: 1024,
    inlineData: { mimeType, data: base64 },
  });

  if (!result.success) {
    return { success: false, obligations: [], error: 'Error al analizar la imagen con IA' };
  }

  try {
    const parsed = JSON.parse(result.content);

    if (parsed.tipo !== 'compromisos_pago' || !Array.isArray(parsed.obligaciones)) {
      return {
        success: false,
        obligations: [],
        error: 'La imagen no parece ser un Compromiso de Pago del SENIAT',
      };
    }

    const obligations: SeniatObligation[] = parsed.obligaciones.map((o: any) => {
      const label = String(o.impuesto || '').toUpperCase().trim();
      let concepto = 'iva_neto';
      let tipo_pago = 'pago1';

      if (label.includes('IGTF')) {
        concepto = 'igtf';
        tipo_pago = 'pago2';
      } else if (label.includes('ISLR')) {
        concepto = 'retencion_islr';
        tipo_pago = 'otro';
      } else if (label.includes('SUMAT')) {
        concepto = 'sumat';
        tipo_pago = 'sumat';
      }

      return {
        periodo: parsed.periodo,
        concepto,
        tipo_pago,
        monto_bs: Number(o.monto_bs) || 0,
        numero_planilla: o.numero_documento ? String(o.numero_documento) : null,
        fecha_vencimiento: o.fecha_vencimiento || null,
        impuesto_label: o.impuesto || label,
      };
    });

    return { success: true, obligations };
  } catch {
    return { success: false, obligations: [], error: 'Error al leer la respuesta de IA' };
  }
}

const fmtBs = (n: number) =>
  new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/**
 * Construye el mensaje de confirmación para el usuario.
 */
export function buildSeniatConfirmMsg(obligations: SeniatObligation[]): string {
  const periodo = obligations[0]?.periodo ?? '??';
  let msg = `📋 *Compromisos SENIAT — ${periodo}*\n\n`;

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
 */
export async function registerSeniatObligations(
  db: any,
  obligations: SeniatObligation[]
): Promise<string> {
  if (!db || obligations.length === 0) return '❌ Error: sin datos para registrar.';

  try {
    for (const o of obligations) {
      const fechaPago = o.fecha_vencimiento ?? new Date().toISOString().split('T')[0];
      await db.prepare(`
        INSERT INTO fiscal_pagos_seniat
          (periodo, tipo_pago, concepto, fecha_pago, monto, numero_planilla, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        o.periodo,
        o.tipo_pago,
        o.concepto,
        fechaPago,
        o.monto_bs,
        o.numero_planilla,
        'Registrado por bot Telegram (Compromiso de Pago SENIAT)'
      ).run();
    }

    const periodo = obligations[0].periodo;
    const total = obligations.reduce((s, o) => s + o.monto_bs, 0);
    return `✅ *${obligations.length} pago${obligations.length !== 1 ? 's' : ''} registrado${obligations.length !== 1 ? 's' : ''}* para ${periodo}\nTotal: Bs. ${fmtBs(total)}`;
  } catch (e) {
    console.error('[fiscal-handlers] registerSeniatObligations:', e);
    return '❌ Error al guardar en la base de datos.';
  }
}
