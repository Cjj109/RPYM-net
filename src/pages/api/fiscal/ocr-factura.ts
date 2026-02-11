import type { APIRoute } from 'astro';
import { getR2 } from '../../../lib/d1-types';
import { requireAuth } from '../../../lib/require-auth';
import { getGeminiApiKey } from '../../../lib/env';
import { callGeminiWithRetry } from '../../../lib/gemini-client';

export const prerender = false;

const OCR_FACTURA_PROMPT = `Eres un sistema de OCR especializado en extraer datos de FACTURAS DE PROVEEDORES venezolanas.

FORMATOS COMUNES DE FACTURAS VENEZOLANAS:
1. Facturas de distribuidores de alimentos (Alimentos Oceania, Promar, etc.)
2. Formato "Forma Libre" autorizado por SENIAT
3. Facturas con doble moneda (USD y Bs)

CAMPOS A EXTRAER:
1. proveedorRif: RIF del proveedor (formato J-12345678-9 o similar). Busca "RIF:" en el encabezado
2. proveedorNombre: Nombre/Razón Social del proveedor
3. numeroFactura: Número de factura (busca "FACTURA N°:" o "Factura Nro:")
4. numeroControl: Número de control (formato 00-XXXXXXXX, busca "N° DE CONTROL:" o "No. DE CONTROL:")
5. fechaFactura: Fecha de emisión (formato YYYY-MM-DD). El año actual es 2026
6. subtotalExento: Monto EXENTO de IVA (productos alimenticios suelen ser exentos)
7. subtotalGravable: Base imponible gravable (sujeta a IVA)
8. alicuotaIva: Porcentaje de IVA aplicado (8% para alimentos, 16% general)
9. iva: Monto del IVA cobrado
10. total: Total de la factura (antes de IGTF)
11. igtf: IGTF cobrado (3% si se paga en divisas). Busca "I.G.T.F 3%" o similar
12. totalPagar: Total a pagar (incluye IGTF si aplica)
13. montoUsd: Si muestra monto en dólares, extráelo
14. tasaBcv: Tasa de cambio BCV usada (busca "Tasa de cambio según B.C.V:" o similar)
15. condicionPago: Crédito, Contado, etc.
16. plazo: Días de crédito si aplica

FORMATO DE NÚMEROS VENEZOLANOS:
- COMA es decimal, PUNTO es separador de miles: 1.234.567,89 = 1234567.89
- Convierte TODOS los montos al formato decimal estándar

EJEMPLOS DE EXTRACCIÓN:
- "Bs1.333.885,00" → 1333885.00
- "Bs 20.431,56" → 20431.56
- "$82.80" o "USD 82.80" → montoUsd: 82.80
- "Tasa de cambio según B.C.V: 228.479" → tasaBcv: 228.479

IMPORTANTE:
- Si hay moneda extranjera (USD) y IGTF, es probable que se pagó en divisas
- Si subtotalExento tiene valor y subtotalGravable es 0, el producto es exento (alimentos)
- El IVA puede ser 8% (alimentos) o 16% (general)
- Lee CUIDADOSAMENTE cada número del documento

Responde SOLO con JSON válido:
{
  "proveedorRif": "J-12345678-9",
  "proveedorNombre": "NOMBRE DEL PROVEEDOR",
  "numeroFactura": "000000123",
  "numeroControl": "00-00000123",
  "fechaFactura": "2026-02-07",
  "subtotalExento": 0.00,
  "subtotalGravable": 0.00,
  "alicuotaIva": 8,
  "iva": 0.00,
  "total": 0.00,
  "igtf": 0.00,
  "totalPagar": 0.00,
  "montoUsd": null,
  "tasaBcv": null,
  "condicionPago": "CRÉDITO",
  "plazo": 7,
  "confidence": 0.95
}

Si no es una factura válida: {"error":"No es una factura de proveedor válida","confidence":0}`;

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

export interface OcrFacturaData {
  proveedorRif?: string;
  proveedorNombre?: string;
  numeroFactura?: string;
  numeroControl?: string;
  fechaFactura?: string;
  subtotalExento?: number;
  subtotalGravable?: number;
  alicuotaIva?: number;
  iva?: number;
  total?: number;
  igtf?: number;
  totalPagar?: number;
  montoUsd?: number | null;
  tasaBcv?: number | null;
  condicionPago?: string;
  plazo?: number;
  confidence: number;
  error?: string;
}

// POST /api/fiscal/ocr-factura - Process supplier invoice image with Gemini Vision
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

    // Check for HEIC format (iPhone photos)
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
        error: `Imagen muy grande (${sizeMB}MB). Máximo 5MB. Tip: toma un screenshot de la foto.`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate and normalize media type
    const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    let mediaType = fileType;

    if (mediaType === 'image/jpg') mediaType = 'image/jpeg';
    if (!SUPPORTED_TYPES.includes(mediaType)) {
      if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
        mediaType = 'image/jpeg';
      } else if (fileName.endsWith('.png')) {
        mediaType = 'image/png';
      } else if (fileName.endsWith('.gif')) {
        mediaType = 'image/gif';
      } else if (fileName.endsWith('.webp')) {
        mediaType = 'image/webp';
      } else {
        mediaType = 'image/jpeg';
      }
    }

    // Convert image to base64
    const arrayBuffer = await imageFile.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const base64 = uint8ArrayToBase64(uint8Array);

    // Call Gemini Vision API con retry
    const geminiResult = await callGeminiWithRetry({
      systemPrompt: OCR_FACTURA_PROMPT,
      userMessage: 'Extrae los datos de esta factura de proveedor venezolana.',
      apiKey,
      temperature: 0.1,
      maxOutputTokens: 800,
      jsonMode: true,
      inlineData: { mimeType: mediaType, data: base64 },
    });

    if (!geminiResult.success) {
      console.error('Gemini Vision API error (factura):', geminiResult.error);
      return new Response(JSON.stringify({ success: false, error: 'Error al procesar imagen. Intenta de nuevo.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const ocrText = geminiResult.content;

    // Parse JSON response
    let ocrData: OcrFacturaData;
    try {
      const jsonMatch = ocrText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        ocrData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse OCR factura response:', ocrText);
      return new Response(JSON.stringify({
        success: false,
        error: 'No se pudo interpretar la respuesta del OCR',
        rawText: ocrText,
      }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for error response
    if (ocrData.error) {
      return new Response(JSON.stringify({
        success: false,
        error: ocrData.error,
      }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Store image temporarily in R2 if available
    let tempImageKey: string | null = null;
    if (r2) {
      const ext = mediaType.includes('png') ? 'png' : mediaType.includes('webp') ? 'webp' : 'jpg';
      tempImageKey = `fiscal/factura-temp/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
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
    console.error('OCR factura error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error interno procesando OCR' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
