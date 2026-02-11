import type { APIRoute } from 'astro';
import { requireAuth } from '../../lib/require-auth';
import { getGeminiApiKey } from '../../lib/env';
import { callGeminiWithRetry } from '../../lib/gemini-client';

export const prerender = false;

interface ProductInfo {
  id: string;
  nombre: string;
  unidad: string;
  precioUSD: number;
  precioUSDDivisa?: number | null;
}

interface CustomerInfo {
  id: number;
  name: string;
}

interface ParsedItem {
  productId: string | null;
  productName: string | null;
  requestedName: string;
  suggestedName?: string | null;
  quantity: number;
  unit: string;
  matched: boolean;
  customPrice?: number | null;
  customPriceDivisa?: number | null;
}

interface PurchaseRequest {
  text: string;
  products: ProductInfo[];
  customers: CustomerInfo[];
  bcvRate: number;
  pricingMode: 'bcv' | 'divisas' | 'dual';
}

interface ParsedAction {
  customerName: string;
  customerId: number | null;
  items: Array<{
    nombre: string;
    cantidad: number;
    unidad: string;
    precioUSD: number;
    subtotalUSD: number;
    precioUSDDivisa?: number;
    subtotalUSDDivisa?: number;
  }>;
  totalUSD: number;
  totalBs: number;
  totalUSDDivisa: number | null;
  date: string | null;
  description: string;
  pricingMode: 'bcv' | 'divisas' | 'dual';
}

// Generate unique presupuesto ID (same as in presupuestos/index.ts)
function generatePresupuestoId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 5; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const apiKey = getGeminiApiKey(locals);

    if (!apiKey) {
      return new Response(JSON.stringify({
        success: false, error: 'API key de Gemini no configurada'
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const body: PurchaseRequest = await request.json();
    const { text, products, customers, bcvRate, pricingMode } = body;

    if (!text || !text.trim()) {
      return new Response(JSON.stringify({
        success: false, error: 'Texto no proporcionado'
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Create product list for prompt
    const productList = products.map(p =>
      `- ID: ${p.id} | Nombre: "${p.nombre}" | Precio BCV: $${p.precioUSD.toFixed(2)}/${p.unidad}${p.precioUSDDivisa ? ` | Precio Divisa: $${p.precioUSDDivisa.toFixed(2)}/${p.unidad}` : ''} | Unidad: ${p.unidad}`
    ).join('\n');

    // Create customer list
    const customerList = customers.map(c => `- ID: ${c.id} | Nombre: "${c.name}"`).join('\n');

    // Get current date info
    const now = new Date();
    const todayISO = now.toISOString().split('T')[0];
    const dayOfWeek = now.getDay();
    const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const todayName = dayNames[dayOfWeek];

    const systemPrompt = `Eres un asistente experto para RPYM, un negocio de mariscos en Venezuela. Tu tarea es interpretar textos que contienen:
1. Un nombre de cliente
2. Una lista de productos con cantidades
3. Opcionalmente, una fecha

FECHA ACTUAL: ${todayISO} (${todayName})

CLIENTES REGISTRADOS:
${customerList}

PRODUCTOS DISPONIBLES:
${productList}

REGLAS DE INTERPRETACION:

CLIENTE:
- Buscar el nombre del cliente en la lista de clientes registrados
- Match fuzzy (ej: "delcy" = "Delcy", "jose" = "Jose Garcia")
- Si no se encuentra, devolver customerId: null pero el nombre tal como se escribio

PRODUCTOS:
- Identificar cada producto mencionado con su cantidad
- Formatos de cantidad: "2kg", "1 kilo", "500g" (= 0.5kg), "medio kilo" (= 0.5kg), "1/2", "2 1/2" (= 2.5)
- Si no hay unidad, asumir "kg" para productos por peso
- Hacer match con el catalogo usando nombres parciales
- "calamar" sin especificar → preferir "Calamar Nacional"
- "camaron" → buscar por talla si se menciona (41/50, 61/70, etc.)
- PRECIOS PERSONALIZADOS (CRITICO - LEE CON CUIDADO):
  * Si el usuario escribe "a $X" o "a X" DESPUES de un producto, ese producto tiene customPrice: X
  * El modificador de precio aplica al producto INMEDIATAMENTE ANTERIOR
  * Patrones: "producto a $12", "producto a 12", "producto #12", "producto por $12"
  * EJEMPLOS IMPORTANTES:
    - "2kg cuerpo de calamar a $12 el 04/febrero" → cuerpo de calamar tiene customPrice: 12 (NO 13)
    - "1kg calamar y 2kg camaron a $16" → solo camaron tiene customPrice: 16, calamar usa precio catalogo
    - "pescado a $8 del lunes" → pescado tiene customPrice: 8
  * Si ves "a $X" despues de un producto, ESE producto tiene customPrice: X
  * El precio del catalogo se IGNORA cuando hay precio personalizado

- PRECIOS DUALES (DOS PRECIOS - BCV Y DIVISA):
  * Si el usuario menciona DOS precios para un producto, son precios duales
  * Patrones: "a $X/$Y", "a $X y $Y", "$X bcv $Y divisa", "$X bcv / $Y paralelo"
  * El PRIMER precio es BCV (customPrice), el SEGUNDO es divisa (customPriceDivisa)
  * EJEMPLOS:
    - "langosta a $42/$30" → customPrice: 42, customPriceDivisa: 30
    - "calamar $15 bcv $12 divisa" → customPrice: 15, customPriceDivisa: 12
    - "producto a $20 y $18" → customPrice: 20, customPriceDivisa: 18
  * Si solo hay un precio, customPriceDivisa = null

- PRODUCTOS PERSONALIZADOS (NO EN CATALOGO):
  * Si el producto NO esta en la lista pero el usuario da un precio, crear item personalizado
  * Poner matched: false, productId: null, productName: null
  * Poner suggestedName con el nombre que uso el usuario (capitalizado correctamente)
  * Poner customPrice con el precio dado
  * Si hay precio dual, poner tambien customPriceDivisa

MONTOS EN DOLARES:
- "$20 de calamar" → calcular cantidad = monto / precio del producto
- Usar el precio segun el modo de precio especificado

FECHAS:
- Por defecto, date = null (significa hoy)
- "ayer" = fecha de ayer
- "el lunes/martes/etc" = el ultimo dia de la semana mencionado
- "hace 2 dias" = restar 2 dias a hoy
- "el 03 de febrero", "03/febrero", "el dia 03/febrero" = 2025-02-03 (año actual)
- "04/feb", "4 de febrero", "el 4 febrero" = fecha correspondiente
- "antier/anteayer" = hace 2 dias

Responde SOLO con un JSON valido:
{
  "customerName": "nombre del cliente como aparece en la lista o como lo escribio",
  "customerId": numero o null,
  "items": [
    {
      "productId": "id del producto o null",
      "productName": "nombre del catalogo o null",
      "requestedName": "lo que escribio el usuario",
      "suggestedName": "nombre sugerido si es producto personalizado" | null,
      "quantity": numero,
      "unit": "kg" | "caja" | "paquete",
      "matched": true/false,
      "customPrice": numero o null,
      "customPriceDivisa": numero o null
    }
  ],
  "date": "YYYY-MM-DD" o null,
  "unmatched": ["productos que no se pudieron identificar"]
}`;

    const geminiResult = await callGeminiWithRetry({
      systemPrompt,
      userMessage: text,
      apiKey,
      temperature: 0.1,
      maxOutputTokens: 2048,
      jsonMode: true,
    });

    if (!geminiResult.success) {
      console.error('Error de API Gemini:', geminiResult.error);
      return new Response(JSON.stringify({
        success: false, error: 'Error al procesar. Intenta de nuevo.'
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const content = geminiResult.content;

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found');
      }
    } catch {
      console.error('Error parsing AI response:', content);
      return new Response(JSON.stringify({
        success: false, error: 'Error interpretando la respuesta. Reformula tu texto.'
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // Build presupuesto items with prices based on mode
    const presupuestoItems: ParsedAction['items'] = [];

    for (const item of parsed.items || []) {
      if (item.matched && item.productId) {
        const product = products.find(p => String(p.id) === String(item.productId));
        if (product) {
          const precioBcv = item.customPrice || product.precioUSD;
          const precioDivisa = item.customPriceDivisa || product.precioUSDDivisa || precioBcv;

          // For divisas mode: use divisa price as the main price
          // For BCV mode: use BCV price
          // For dual mode: use BCV as main, divisa as secondary
          const precioMain = pricingMode === 'divisas' ? precioDivisa : precioBcv;

          const itemData: any = {
            nombre: item.productName || product.nombre,
            cantidad: item.quantity,
            unidad: item.unit || product.unidad,
            precioUSD: precioMain,
            subtotalUSD: Math.round(precioMain * item.quantity * 100) / 100,
          };

          // Only add divisa prices for dual mode
          if (pricingMode === 'dual') {
            itemData.precioUSDDivisa = precioDivisa;
            itemData.subtotalUSDDivisa = Math.round(precioDivisa * item.quantity * 100) / 100;
          }

          presupuestoItems.push(itemData);
        }
      } else if (!item.matched && item.suggestedName && item.customPrice) {
        // Custom product
        const precioBcv = item.customPrice;
        const precioDivisa = item.customPriceDivisa || precioBcv;
        const precioMain = pricingMode === 'divisas' ? precioDivisa : precioBcv;

        const itemData: any = {
          nombre: item.suggestedName,
          cantidad: item.quantity,
          unidad: item.unit || 'kg',
          precioUSD: precioMain,
          subtotalUSD: Math.round(precioMain * item.quantity * 100) / 100,
        };

        // Only add divisa prices for dual mode
        if (pricingMode === 'dual') {
          itemData.precioUSDDivisa = precioDivisa;
          itemData.subtotalUSDDivisa = Math.round(precioDivisa * item.quantity * 100) / 100;
        }

        presupuestoItems.push(itemData);
      }
    }

    if (presupuestoItems.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No se identificaron productos. Verifica que los productos existan en el catalogo.',
        unmatched: parsed.unmatched || []
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Calculate totals based on mode
    const totalUSD = presupuestoItems.reduce((sum, i) => sum + i.subtotalUSD, 0);
    // For divisas mode: no Bs total (set to 0)
    // For BCV and dual: calculate Bs
    const totalBs = pricingMode === 'divisas' ? 0 : Math.round(totalUSD * bcvRate * 100) / 100;
    // Only set totalUSDDivisa for dual mode
    const totalUSDDivisa = pricingMode === 'dual'
      ? presupuestoItems.reduce((sum, i) => sum + (i.subtotalUSDDivisa || i.subtotalUSD), 0)
      : null;

    // Build description
    const description = presupuestoItems.map(i =>
      `${i.nombre} ${i.cantidad}${i.unidad}`
    ).join(', ');

    const action: ParsedAction = {
      customerName: parsed.customerName || 'Cliente',
      customerId: parsed.customerId || null,
      items: presupuestoItems,
      totalUSD: Math.round(totalUSD * 100) / 100,
      totalBs: Math.round(totalBs * 100) / 100,
      totalUSDDivisa: totalUSDDivisa ? Math.round(totalUSDDivisa * 100) / 100 : null,
      date: parsed.date || null,
      description,
      pricingMode
    };

    return new Response(JSON.stringify({
      success: true,
      action,
      unmatched: parsed.unmatched || []
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error en purchase-with-products:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error interno del servidor' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
