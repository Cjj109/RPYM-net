import type { APIRoute } from 'astro';

// Este endpoint NO se prerenderiza (se ejecuta en el servidor)
export const prerender = false;

interface ProductInfo {
  id: string;
  nombre: string;
  unidad: string;
  precioUSD: number;
}

interface ParsedItem {
  productId: string;
  productName: string;
  requestedName: string;
  quantity: number;
  unit: string;
  matched: boolean;
  confidence: 'high' | 'medium' | 'low';
}

interface ParseRequest {
  text: string;
  products: ProductInfo[];
}

interface ParseResponse {
  success: boolean;
  items: ParsedItem[];
  unmatched: string[];
  error?: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    // En Cloudflare Pages, las env vars se acceden via locals.runtime.env
    const runtime = (locals as any).runtime;
    const apiKey = runtime?.env?.CLAUDE_API_KEY || import.meta.env.CLAUDE_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({
        success: false,
        items: [],
        unmatched: [],
        error: 'API key no configurada. Contacta al administrador.'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body: ParseRequest = await request.json();
    const { text, products } = body;

    if (!text || !products || products.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        items: [],
        unmatched: [],
        error: 'Texto o productos no proporcionados'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Crear lista de productos disponibles para el prompt
    const productList = products.map(p =>
      `- ID: ${p.id} | Nombre: "${p.nombre}" | Unidad: ${p.unidad}`
    ).join('\n');

    const systemPrompt = `Eres un asistente especializado en interpretar listas de pedidos de mariscos para un negocio en Venezuela.

Tu tarea es:
1. Analizar el texto del usuario que contiene una lista de productos con cantidades
2. Identificar cada producto y su cantidad
3. Hacer match con los productos disponibles en el catálogo

REGLAS DE INTERPRETACIÓN:
- "1/2 kg", "medio kilo", "500g", "500gr" = 0.5 kg
- "1kg", "1 kilo", "un kilo" = 1 kg
- "2 cajas", "2cj" = 2 (unidad: caja)
- Los números antes del producto indican cantidad
- Si no se especifica unidad, asumir "kg" para productos por peso
- Para camarones, las tallas como "41/50", "61/70" son importantes para el match

VARIACIONES COMUNES:
- "camaron" = "camarón"
- "camarones conchas" = "camarón en concha" o "camarón con concha"
- "langostino" puede referirse a "Langostino"
- "jaiba" = "Jaiba"
- "calamar" puede ser "Calamar Pota" o "Calamar Nacional"
- "desvenado" = "Pelado y Desvenado"

Responde SOLO con un JSON válido con esta estructura:
{
  "items": [
    {
      "productId": "id del producto del catálogo o null si no hay match",
      "productName": "nombre exacto del catálogo o null",
      "requestedName": "nombre como lo escribió el usuario",
      "quantity": número,
      "unit": "kg" o "caja" o "paquete",
      "matched": true/false,
      "confidence": "high" | "medium" | "low"
    }
  ],
  "unmatched": ["items que no pudiste identificar"]
}`;

    const userPrompt = `CATÁLOGO DE PRODUCTOS DISPONIBLES:
${productList}

LISTA DEL CLIENTE A INTERPRETAR:
${text}

Analiza la lista e identifica cada producto con su cantidad. Haz el mejor match posible con el catálogo.`;

    // Llamar a la API de Anthropic
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ],
        system: systemPrompt
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error de API Claude:', response.status, errorText);

      // Parsear el error para dar mejor feedback
      let errorMessage = 'Error al procesar la lista. Intenta de nuevo.';
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.type === 'authentication_error') {
          errorMessage = 'Error de autenticación con la API. Verifica la API key.';
        } else if (errorJson.error?.type === 'invalid_api_key') {
          errorMessage = 'API key inválida. Contacta al administrador.';
        } else if (errorJson.error?.type === 'rate_limit_error') {
          errorMessage = 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.';
        } else if (errorJson.error?.message) {
          errorMessage = `Error: ${errorJson.error.message}`;
        }
      } catch {
        // Si no es JSON, usar el mensaje genérico
      }

      return new Response(JSON.stringify({
        success: false,
        items: [],
        unmatched: [],
        error: errorMessage
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const claudeResponse = await response.json();
    const content = claudeResponse.content[0]?.text || '';

    // Extraer el JSON de la respuesta
    let parsedResult;
    try {
      // Buscar el JSON en la respuesta (puede estar envuelto en markdown)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No se encontró JSON en la respuesta');
      }
    } catch (parseError) {
      console.error('Error parseando respuesta de Claude:', content);
      return new Response(JSON.stringify({
        success: false,
        items: [],
        unmatched: [],
        error: 'Error interpretando la respuesta. Intenta reformular tu lista.'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      items: parsedResult.items || [],
      unmatched: parsedResult.unmatched || []
    } as ParseResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error en parse-order:', error);
    return new Response(JSON.stringify({
      success: false,
      items: [],
      unmatched: [],
      error: 'Error interno del servidor'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
