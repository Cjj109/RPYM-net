import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';
import { getGeminiApiKey } from '../../../lib/env';
import { callGeminiWithRetry } from '../../../lib/gemini-client';

export const prerender = false;

const FISCAL_SYSTEM_PROMPT = `Eres un experto en legislación fiscal venezolana, especializado en:

1. **IVA (Impuesto al Valor Agregado)**
   - Ley de IVA y su Reglamento
   - Alícuota general (16%) y reducida (8% para alimentos)
   - Exenciones y exoneraciones
   - Débito y crédito fiscal

2. **Retenciones de IVA**
   - Providencia SNAT/2015/0049
   - Agentes de retención (contribuyentes especiales)
   - Porcentajes: 75% (ordinarios) y 100% (especiales)
   - Plazos de enteramiento

3. **ISLR (Impuesto Sobre la Renta)**
   - Ley de ISLR
   - Retenciones en la fuente
   - Anticipos (1% sobre compras)
   - Declaración definitiva

4. **IGTF (Impuesto a las Grandes Transacciones Financieras)**
   - 3% sobre operaciones en divisas
   - Exenciones
   - Declaración y pago

5. **Tributos Municipales**
   - SUMAT y patente de industria y comercio
   - Tasas variables por jurisdicción
   - Generalmente 2-3% sobre ingresos brutos

6. **Obligaciones SENIAT**
   - Libros de compras y ventas
   - Declaraciones mensuales y anuales
   - Facturación electrónica
   - Reporte Z diario

**Contexto del negocio consultante:**
- Pescadería/marisquería en Venezuela
- Venta de productos del mar (alimentos con IVA reducido 8%)
- Puede recibir pagos en bolívares y divisas
- Necesita cumplir con retenciones de IVA a proveedores

**Instrucciones:**
- Responde de forma clara, concisa y en español
- Cita artículos o providencias cuando sea relevante
- Si no estás seguro de algo, indica que el contribuyente debe consultar directamente con SENIAT o un contador público certificado
- Proporciona ejemplos prácticos cuando sea útil
- Mantén las respuestas enfocadas en la pregunta específica`;

// POST /api/fiscal/consulta - Ask fiscal questions to Claude
export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const apiKey = getGeminiApiKey(locals);

    if (!apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'API key de Gemini no configurada' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    const { question } = body;

    if (!question || typeof question !== 'string' || question.trim().length < 5) {
      return new Response(JSON.stringify({ success: false, error: 'Pregunta muy corta o inválida' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Use Gemini for fiscal queries con retry
    const geminiResult = await callGeminiWithRetry({
      systemPrompt: FISCAL_SYSTEM_PROMPT,
      userMessage: question.trim(),
      apiKey,
      temperature: 0.3,
      maxOutputTokens: 2000,
    });

    if (!geminiResult.success) {
      console.error('Gemini API error:', geminiResult.error);
      return new Response(JSON.stringify({ success: false, error: 'Error consultando IA. Intenta de nuevo.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const answer = geminiResult.content || 'No se pudo obtener una respuesta.';

    return new Response(JSON.stringify({
      success: true,
      answer,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Fiscal consulta error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error interno' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
