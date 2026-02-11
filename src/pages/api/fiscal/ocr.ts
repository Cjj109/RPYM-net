import type { APIRoute } from 'astro';
import { getR2 } from '../../../lib/d1-types';
import { requireAuth } from '../../../lib/require-auth';
import { getGeminiApiKey } from '../../../lib/env';
import type { OcrZReportData } from '../../../lib/fiscal-types';
import { callGeminiWithRetry } from '../../../lib/gemini-client';

export const prerender = false;

const OCR_SYSTEM_PROMPT = `Eres un sistema de OCR especializado en extraer datos de REPORTES Z de máquinas fiscales venezolanas (impresoras fiscales BIXOLON, HKA, The Factory, etc).

ESTRUCTURA TÍPICA DE UN REPORTE Z VENEZOLANO:
- "REPORTE Z" o "CIERRE Z" en el encabezado
- Fecha y hora del cierre
- Sección VENTAS con alícuotas: BI G(16%), BI R(08%), BI A(31%) y sus IVAs correspondientes
- SUBTL VENTAS: Subtotal de ventas
- IGTF VENTAS(03,00%): El IGTF cobrado (3% de ventas en divisas) - MUY IMPORTANTE
- IVA VENTAS: Total de IVA cobrado
- TOTAL VENTAS: Total general
- BI IGTF: Base imponible del IGTF (monto de ventas cobradas en divisas) - MUY IMPORTANTE
- FACTURAS: Rango de facturas emitidas

CAMPOS A EXTRAER:
1. fecha: Fecha del reporte (formato YYYY-MM-DD). Busca "FECHA:" en el encabezado. IMPORTANTE: El año actual es 2026, si ves "26" en la fecha es 2026, NO 2020
2. subtotalExento: Ventas EXENTAS de IVA (busca "EXENTO" en la sección VENTAS)
3. subtotalGravable: Busca "SUBTL VENTAS" o suma las bases imponibles (BI R, BI G, etc)
4. ivaCobrado: Busca "IVA VENTAS" - es el total del IVA cobrado
5. baseImponibleIgtf: Busca "BI IGTF" - aparece DESPUÉS de TOTAL VENTAS, es la base para calcular el IGTF
6. igtfVentas: Busca "IGTF VENTAS(03,00%)" o "IGTF VENTAS" - es el 3% del BI IGTF
7. totalVentas: Busca "TOTAL VENTAS" - es el total general incluyendo IVA e IGTF
8. numeracionFacturas: Busca "ULTIMA FACTURA" o rango en el reporte

EJEMPLO REAL DE VALORES:
- SUBTL VENTAS: Bs 376133,94
- IGTF VENTAS(03,00%): Bs 1449,86 ← Este es igtfVentas
- IVA VENTAS: Bs 30090,72 ← Este es ivaCobrado
- TOTAL VENTAS: Bs 407674,52 ← Este es totalVentas
- BI IGTF: Bs 48328,75 ← Este es baseImponibleIgtf (verificar: 48328.75 * 0.03 ≈ 1449.86)

IMPORTANTE:
- Los montos usan COMA como decimal y PUNTO como separador de miles: 1.234,56 = 1234.56
- Convierte TODOS los montos al formato decimal estándar (sin puntos de miles, con punto decimal)
- El BI IGTF y el IGTF VENTAS son campos CRÍTICOS para el cálculo de impuestos
- Si un campo no existe en el reporte, usa 0 o null según corresponda
- Lee CUIDADOSAMENTE cada número, no inventes datos

Responde SOLO con JSON válido:
{"fecha":"YYYY-MM-DD","subtotalExento":0.00,"subtotalGravable":0.00,"ivaCobrado":0.00,"baseImponibleIgtf":0.00,"igtfVentas":0.00,"totalVentas":0.00,"numeracionFacturas":"XXX-XXX","confidence":0.95}

Si no es un reporte Z válido: {"error":"No es un reporte Z válido","confidence":0}`;

// Helper function to convert Uint8Array to base64 (Cloudflare Workers compatible)
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000; // 32KB chunks to avoid call stack issues
  let result = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    result += String.fromCharCode(...chunk);
  }
  return btoa(result);
}

// POST /api/fiscal/ocr - Process Z report image with Claude Vision
export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;
  const r2 = getR2(locals);

  try {
    const apiKey = getGeminiApiKey(locals);

    if (!apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'API key de Gemini no configurada' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const formData = await request.formData();
    const imageFile = formData.get('image') as File | null;

    if (!imageFile) {
      return new Response(JSON.stringify({ success: false, error: 'Imagen requerida' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for HEIC format (iPhone photos) - must check BEFORE size to give better error
    const fileType = imageFile.type?.toLowerCase() || '';
    const fileName = imageFile.name?.toLowerCase() || '';
    const isHeic = fileType.includes('heic') || fileType.includes('heif') ||
                   fileName.endsWith('.heic') || fileName.endsWith('.heif');

    if (isHeic) {
      const sizeMB = (imageFile.size / (1024 * 1024)).toFixed(1);
      return new Response(JSON.stringify({
        success: false,
        error: `Formato HEIC no soportado (${sizeMB}MB). Desde tu iPhone: abre la foto → toca Compartir → "Guardar como archivo" y elige JPEG, o toma un screenshot de la foto.`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check file size (max 5MB)
    if (imageFile.size > 5 * 1024 * 1024) {
      const sizeMB = (imageFile.size / (1024 * 1024)).toFixed(1);
      return new Response(JSON.stringify({
        success: false,
        error: `Imagen muy grande (${sizeMB}MB). Máximo 5MB. Tip: toma un screenshot de la foto para reducir el tamaño.`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate and normalize media type
    const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    let mediaType = fileType;

    // Handle common variations
    if (mediaType === 'image/jpg') mediaType = 'image/jpeg';
    if (!SUPPORTED_TYPES.includes(mediaType)) {
      // Try to detect from file extension
      if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
        mediaType = 'image/jpeg';
      } else if (fileName.endsWith('.png')) {
        mediaType = 'image/png';
      } else if (fileName.endsWith('.gif')) {
        mediaType = 'image/gif';
      } else if (fileName.endsWith('.webp')) {
        mediaType = 'image/webp';
      } else {
        // Default to JPEG if can't detect
        mediaType = 'image/jpeg';
      }
    }

    // Convert image to base64 using Uint8Array (works in Cloudflare Workers)
    const arrayBuffer = await imageFile.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Convert to base64 without using Buffer (Cloudflare Workers compatible)
    const base64 = uint8ArrayToBase64(uint8Array);

    // Call Gemini Vision API con retry
    const geminiResult = await callGeminiWithRetry({
      systemPrompt: OCR_SYSTEM_PROMPT,
      userMessage: 'Extrae los datos de este reporte Z fiscal venezolano.',
      apiKey,
      temperature: 0.1,
      maxOutputTokens: 500,
      jsonMode: true,
      inlineData: { mimeType: mediaType, data: base64 },
    });

    if (!geminiResult.success) {
      console.error('Gemini Vision API error:', geminiResult.error);
      return new Response(JSON.stringify({ success: false, error: 'Error al procesar imagen. Intenta de nuevo.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const ocrText = geminiResult.content;

    // Parse JSON response
    let ocrData: OcrZReportData;
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = ocrText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        ocrData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse OCR response:', ocrText);
      return new Response(JSON.stringify({
        success: false,
        error: 'No se pudo interpretar la respuesta del OCR',
        rawText: ocrText,
      }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for error response from Claude
    if ((ocrData as any).error) {
      return new Response(JSON.stringify({
        success: false,
        error: (ocrData as any).error,
      }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Store image temporarily in R2 if available
    let tempImageKey: string | null = null;
    if (r2) {
      const ext = mediaType.includes('png') ? 'png' : mediaType.includes('webp') ? 'webp' : 'jpg';
      tempImageKey = `fiscal/z-temp/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      await r2.put(tempImageKey, arrayBuffer, {
        httpMetadata: { contentType: mediaType },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      ocrData,
      tempImageKey,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('OCR error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error interno procesando OCR' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
