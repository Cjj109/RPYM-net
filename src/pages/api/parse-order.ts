import type { APIRoute } from 'astro';

// Este endpoint NO se prerenderiza (se ejecuta en el servidor)
export const prerender = false;

interface ProductInfo {
  id: string;
  nombre: string;
  unidad: string;
  precioUSD: number;
  precioUSDDivisa?: number | null;
}

interface ParsedItem {
  productId: string | null;
  productName: string | null;
  requestedName: string;
  suggestedName?: string | null;
  quantity: number;
  unit: string;
  matched: boolean;
  confidence: 'high' | 'medium' | 'low';
  dollarAmount?: number | null;
  customPrice?: number | null;
  customPriceDivisa?: number | null;
}

interface ParseRequest {
  text: string;
  products: ProductInfo[];
}

interface ParseResponse {
  success: boolean;
  items: ParsedItem[];
  unmatched: string[];
  delivery?: number | null;
  customerName?: string | null;
  dollarsOnly?: boolean;
  isPaid?: boolean;
  pricingMode?: 'bcv' | 'divisa' | 'dual' | null;
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

    // Crear lista de productos disponibles para el prompt (incluir precios para cálculos)
    const productList = products.map(p =>
      `- ID: ${p.id} | Nombre: "${p.nombre}" | Precio BCV: $${p.precioUSD.toFixed(2)}/${p.unidad}${p.precioUSDDivisa ? ` | Precio Divisa: $${p.precioUSDDivisa.toFixed(2)}/${p.unidad}` : ''} | Unidad: ${p.unidad}`
    ).join('\n');

    const systemPrompt = `Eres un EXPERTO en el negocio de mariscos RPYM - "El Rey de los Pescados y Mariscos" en Venezuela. Llevas años trabajando aquí y conoces TODOS los productos, cómo hablan los clientes, y cómo interpretar sus pedidos aunque escriban mal o de forma informal.

CONTEXTO DEL NEGOCIO:
- RPYM vende mariscos al mayor y detal en Venezuela
- Los clientes son personas normales, restaurantes, y revendedores
- Muchos escriben por WhatsApp de forma rápida e informal
- Usan abreviaturas, escriben mal, mezclan español coloquial venezolano
- Conoces cada producto y sus variantes de nombre

Tu tarea es:
1. Analizar el texto del usuario que contiene una lista de productos con cantidades O MONTOS EN DÓLARES
2. Identificar cada producto y su cantidad
3. Hacer match con los productos disponibles en el catálogo
4. Si el usuario especifica un MONTO EN DÓLARES (ej: "$20 de calamar"), CALCULAR la cantidad dividiendo el monto entre el precio del producto

REGLAS DE INTERPRETACIÓN:
- MONTOS EN DÓLARES: "$20 de calamar nacional" → buscar precio del calamar ($18/kg) → cantidad = 20/18 = 1.11 kg
- "1/2 kg", "medio kilo", "500g", "500gr" = 0.5 kg
- "1kg", "1 kilo", "un kilo" = 1 kg
- "1½", "1 1/2", "uno y medio" = 1.5 kg
- "2½", "2 1/2" = 2.5 kg
- "2 cajas", "2cj" = 2 (unidad: caja)
- Los números antes del producto indican cantidad (si no hay símbolo $)
- Si no se especifica unidad, asumir "kg" para productos por peso
- Para camarones, las tallas como "41/50", "61/70" son importantes para el match
- Redondear cantidades calculadas a 3 decimales

PRECIOS CON HASHTAG (# = precio personalizado):
- "camaron #16" o "camaron # 16" → precio personalizado $16/kg
- "4kg calamar #18" → 4kg a precio personalizado $18/kg
- El número después del # es el precio en USD por unidad (customPrice)

FORMATOS DE MONTO VÁLIDOS:
- "$20 de producto" → monto = 20, calcular cantidad
- "20$ de producto" → monto = 20
- "20 dolares de producto" → monto = 20
- "veinte dolares de producto" → monto = 20

PRECIOS PERSONALIZADOS (solo admin):
- "camaron vivito 5kg a 13" → 5kg con precio unitario $13 (no el precio del catálogo)
- "1kg pulpo a $20" → 1kg con precio unitario $20
- "2kg calamar a 15" → 2kg con precio unitario $15
- Si el usuario especifica "a X" o "a $X", ese es el precio personalizado por unidad (customPrice)

PRECIOS PERSONALIZADOS DUALES:
- "tentaculo a 13 en bs y 10 en divisas" → customPrice: 13 (BCV), customPriceDivisa: 10 (divisa)
- "pulpo a 20 bcv 18 divisa" → customPrice: 20, customPriceDivisa: 18
- "calamar a 15/12" → customPrice: 15 (BCV), customPriceDivisa: 12 (divisa) cuando hay formato X/Y
- Si solo se especifica un precio, customPriceDivisa será null
- Si se especifican dos precios, el mayor suele ser el BCV y el menor el divisa

CONOCIMIENTO DE PRODUCTOS (TU EXPERIENCIA EN RPYM):

CAMARONES (producto estrella):
- "camaron", "camarones" → buscar por talla si la mencionan (41/50, 61/70, 71/90, etc.)
- "camaron pelado" = camarón pelado (sin concha, puede ser desvenado o no)
- "camaron desvenado", "pelado y desvenado", "P&D" = Camarón Pelado y Desvenado
- "camaron con concha", "camarones conchas", "concha" = Camarón en Concha
- "camaron vivito", "vivitos", "camarones vivos" = Camarón Vivito (fresco, vivo)
- Si dicen "#16" o "# 16" después del camarón, es el PRECIO personalizado $16/kg
- Las tallas 41/50, 61/70 indican cantidad por libra (más bajo = más grande)

CANGREJOS Y JAIBA (¡OJO CON ESTO!):
- "cangrejos chiquitos", "cangrejo chiquito", "cangrejitos" = JAIBA (NO pulpa, NO cangrejo grande)
- "jaiba", "jaibas" = Jaiba
- "pulpa de cangrejo" = Pulpa de Cangrejo (es distinto a jaiba)
- "cangrejo" solo = depende del contexto, preguntar si no está claro

CALAMARES:
- "calamar" sin especificar → preferir "Calamar Nacional" sobre "Calamar Pota"
- "calamar nacional", "calamares nacionales" = Calamar Nacional
- "calamar pota", "pota" = Calamar Pota (más económico)
- "tentaculo", "tentáculos" = Tentáculo de Calamar o Pulpo

PULPO:
- "pulpo" sin especificar → "Pulpo Mediano" como default
- "pulpo grande", "pulpo mediano", "pulpo pequeño" → buscar la variante
- "tentaculo de pulpo" = Tentáculo de Pulpo

MOLUSCOS:
- "pepitona", "pepitonas" = Pepitona (no caja a menos que diga "caja")
- "mejillon", "mejillones" = Mejillón
- "almeja", "almejas" = Almeja
- "vieira", "vieras" = Vieira (verificar ortografía en catálogo)
- "guacuco", "guacucos" = Guacuco

LANGOSTINOS:
- "langostino", "langostinos" = Langostino (verificar en catálogo)
- "langosta" = Langosta (diferente a langostino)

PESCADOS:
- "filete", "filetes" = puede ser varios tipos, buscar en catálogo
- "salmon", "salmón" = Salmón
- "merluza" = Merluza
- "pargo" = Pargo
- "mero" = Mero

ABREVIATURAS VENEZOLANAS COMUNES:
- "KL", "kl", "K", "k" = kilogramo
- "medio", "1/2" = 0.5 kg
- "cuarto", "1/4" = 0.25 kg
- "CJ", "cj" = caja
- "PQ", "pq" = paquete

ACLARACIONES Y CORRECCIONES:
- Si el texto incluye una sección "ACLARACIONES DEL CLIENTE:", son correcciones del operador
- Las aclaraciones tienen PRIORIDAD ABSOLUTA sobre tu interpretación inicial
- IMPORTANTE: Solo modifica los productos ESPECÍFICAMENTE mencionados en las aclaraciones
- Si la aclaración dice "el calamar es nacional", solo cambia el calamar, deja el resto igual
- Si la aclaración dice "cangrejos chiquitos es jaiba", cambia cangrejos chiquitos → jaiba
- Si la aclaración dice "camaron # 16 significa precio 16", aplica customPrice: 16 a ese camaron
- NO re-interpretes productos que no fueron mencionados en las aclaraciones
- Mantén cantidades, precios y matches de productos NO mencionados en las aclaraciones

DELIVERY:
- Si el usuario menciona "delivery", "envío", "envio", "flete", extrae el costo
- Formatos: "delivery $5", "$5 delivery", "5$ de delivery", "envío 5 dólares"
- Si no menciona delivery, delivery será null

NOMBRE DEL CLIENTE:
- Detecta si se menciona un nombre de cliente
- Formatos: "cliente: Juan", "para Maria", "pedido de Pedro", "Juan Garcia", "cliente Juan"
- Si hay un nombre propio al inicio o después de "cliente/para/pedido de", extraerlo
- Si no se detecta nombre, customerName será null

SOLO DÓLARES:
- Detecta si el pedido es solo en dólares (sin bolívares)
- Formatos: "solo dolares", "sin bolivares", "en dolares", "puro dolar", "solo $", "factura en dolares"
- Si se menciona, dollarsOnly será true, sino false

ESTADO PAGADO:
- Detecta si el pedido ya está pagado
- Formatos: "pagado", "ya pago", "cancelado" (en el sentido de pagado), "ya pagó", "pago confirmado"
- Si se menciona, isPaid será true, sino false

MODO DE PRECIO:
- Cada producto puede tener dos precios: "Precio BCV" (para pago en bolívares) y "Precio Divisa" (para pago en dólares efectivos)
- Detecta el modo de pago del cliente:
  - Si dice "a BCV", "precios BCV", "va a pagar en bolivares", "pago movil", "transferencia" → pricingMode: "bcv"
  - Si dice "en dolares", "pago en divisa", "va a pagar en dolares", "precio divisa", "efectivo", "cash" → pricingMode: "divisa"
  - Si dice "dual", "ambos precios", "bcv y divisa", "los dos precios", "presupuesto dual" → pricingMode: "dual"
  - Si especifica precios personalizados duales (ej: "a 13 en bs y 10 en divisas") → pricingMode: "dual"
  - Si no se especifica → pricingMode: null
- Cuando el modo es "divisa" y el producto tiene Precio Divisa, usar ese precio para calcular cantidades por monto en dólares
- Cuando el modo es "bcv" o no se especifica, usar el Precio BCV (el precio por defecto)
- Cuando el modo es "dual", se usarán ambos precios (el presupuesto mostrará ambas versiones)
- Ejemplo: "$20 de calamar" en modo divisa con Precio Divisa $15/kg → cantidad = 20/15 = 1.333 kg

PRODUCTOS PERSONALIZADOS (no en catálogo):
- Si el usuario menciona un producto que NO está en el catálogo PERO especifica un precio:
  - "mariscos varios $25" → matched: false, productId: null, suggestedName: "Mariscos Varios", quantity: 1, customPrice: 25
  - "2kg de producto especial a $15" → matched: false, productId: null, suggestedName: "Producto Especial", quantity: 2, customPrice: 15
- Si el producto no está en catálogo Y no tiene precio especificado → va a "unmatched"
- suggestedName debe ser un nombre limpio y capitalizado para el producto personalizado

Responde SOLO con un JSON válido con esta estructura:
{
  "items": [
    {
      "productId": "id del producto del catálogo o null si no hay match",
      "productName": "nombre exacto del catálogo o null",
      "requestedName": "lo que escribió el usuario (ej: '$20 de calamar')",
      "suggestedName": "nombre sugerido para producto personalizado (solo si matched=false y tiene precio)" | null,
      "quantity": número calculado,
      "unit": "kg" o "caja" o "paquete",
      "matched": true/false,
      "confidence": "high" | "medium" | "low",
      "dollarAmount": número o null (si el usuario especificó monto en $),
      "customPrice": número o null (precio BCV por unidad si el usuario dijo "a $X"),
      "customPriceDivisa": número o null (precio Divisa por unidad, solo si el usuario dio dos precios)
    }
  ],
  "unmatched": ["items que no pudiste identificar"],
  "delivery": número o null (costo de delivery si se mencionó),
  "customerName": "nombre del cliente" o null,
  "dollarsOnly": true/false,
  "isPaid": true/false,
  "pricingMode": "bcv" | "divisa" | "dual" | null
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
      unmatched: parsedResult.unmatched || [],
      delivery: parsedResult.delivery || null,
      customerName: parsedResult.customerName || null,
      dollarsOnly: parsedResult.dollarsOnly || false,
      isPaid: parsedResult.isPaid || false,
      pricingMode: parsedResult.pricingMode || null
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
