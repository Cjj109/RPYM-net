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
  delivery: number | null;
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
    const currentYear = now.getFullYear();
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
- ⚠️ UNIDAD EXPLÍCITA: Si el usuario dice "1kg", "2kg", etc., usar SIEMPRE "kg" aunque el catálogo diga "caja" u otra unidad
- Hacer match con el catalogo usando nombres parciales
- "calamar" sin especificar → preferir "Calamar Nacional"
- "camaron" → buscar por talla si se menciona (41/50, 61/70, etc.)

MOLUSCOS (unidad crítica):
- "pepitona", "pepitonas" = Pepitona. Si el usuario dice "1kg pepitona" → unit: "kg". Solo "caja" si dice explícitamente "caja de pepitona" o "X cajas"
- "mejillon", "mejillones" = Mejillón
- "almeja", "almejas" = Almeja

CAMARONES - REGLA CRITICA DE DISAMBIGUATION:
- "camaron jumbo", "jumbo", "camarones jumbo" = SIEMPRE Camarón Jumbo (en concha) - ES EL PRODUCTO JUMBO POR DEFECTO
- "camaron pelado" = Camarón Pelado (sin concha)
- "camaron desvenado", "pelado y desvenado", "P&D" = Camarón Desvenado (NORMAL, talla 41/50)
- "camaron desvenado jumbo", "desvenado jumbo", "jumbo desvenado" = Camarón Desvenado Jumbo (talla 31/35-36/40)
- ⚠️ REGLA MAS IMPORTANTE: "jumbo" SOLO o "camaron jumbo" SIN la palabra "desvenado" = Camarón Jumbo (en concha). NUNCA lo interpretes como Camarón Desvenado Jumbo a menos que EXPLICITAMENTE digan "desvenado"
- "camaron vivito", "vivitos" = Camarón Vivito
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
  * customPrice = precio BCV (bolivares), customPriceDivisa = precio Divisa (dolar efectivo)
  * Si el usuario menciona DOS precios para un producto, son precios duales
  * ⚠️ REGLA CRITICA: Si el usuario ETIQUETA los precios ("en divisas", "a BCV", "bcv", "divisa", "en bs"), SIEMPRE respetar las etiquetas SIN IMPORTAR el orden. NO uses la posicion para decidir cual es cual.
  * Ejemplos CON etiquetas (respetar lo que dice el usuario):
    - "a $8.75 en divisas y $11 a BCV" → customPrice: 11 (BCV), customPriceDivisa: 8.75 (divisa) — divisa vino primero pero se respeta la etiqueta
    - "a $9 en divisas y $13 a BCV" → customPrice: 13 (BCV), customPriceDivisa: 9 (divisa)
    - "calamar $15 bcv $12 divisa" → customPrice: 15, customPriceDivisa: 12
  * Ejemplos SIN etiquetas (usar formato posicional):
    - "langosta a $42/$30" → customPrice: 42 (BCV), customPriceDivisa: 30 (divisa) — formato X/Y = BCV/divisa
    - "producto a $20 y $18" → customPrice: 20, customPriceDivisa: 18
  * Si solo hay un precio, customPriceDivisa = null

- PRODUCTOS PERSONALIZADOS (NO EN CATALOGO):
  * Si el producto NO esta en la lista pero el usuario da un precio, crear item personalizado
  * Poner matched: false, productId: null, productName: null
  * Poner suggestedName con el nombre que uso el usuario (capitalizado correctamente)
  * Poner customPrice con el precio dado
  * Si hay precio dual, poner tambien customPriceDivisa

MONTOS EN DOLARES (¡¡¡MUY IMPORTANTE!!!):
- "$X de producto" o "X$ de producto" = el cliente quiere COMPRAR por ese monto total
- DEBES calcular: quantity = monto / precio del producto. NUNCA pongas quantity: 0
- "$20 de calamar" (precio $18/kg) → quantity: 20/18 = 1.111 kg, dollarAmount: 20, customPrice: null
- "$15 de langostino" (precio $12/kg) → quantity: 15/12 = 1.25 kg, dollarAmount: 15, customPrice: null
- ¡¡¡NO confundas dollarAmount con customPrice!!! dollarAmount = cuanto dinero gastar, customPrice = precio por unidad
- Usar el precio segun el modo de precio especificado

FECHAS (CRITICO - año actual es ${currentYear}):
- Por defecto, date = null (significa hoy)
- Si NO se especifica el año, SIEMPRE usar el año actual: ${currentYear}
- "11 de enero", "el 11 enero", "11/01" = ${currentYear}-01-11 (año actual)
- "ayer" = fecha de ayer
- "el lunes/martes/etc" = el ultimo dia de la semana mencionado
- "hace 2 dias" = restar 2 dias a hoy
- "el 03 de febrero", "03/febrero", "el dia 03/febrero" = ${currentYear}-02-03
- "04/feb", "4 de febrero", "el 4 febrero" = fecha correspondiente en ${currentYear}
- "antier/anteayer" = hace 2 dias

DELIVERY (OPCIONAL - cargo de envio):
- Si el usuario menciona "delivery", "envio", "envío", "flete", extrae el costo en dolares
- Formatos: "delivery $5", "$5 delivery", "5$ de delivery", "envío 5 dolares", "mas $5 de delivery", "agrega $5 de delivery"
- Si NO menciona delivery, delivery sera null
- Ejemplos: "2kg calamar y 1kg jumbo, mas $5 de delivery para Delcy" → delivery: 5

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
  "delivery": numero o null (costo de delivery en USD si se menciono),
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

    // Pre-escanear texto original para "$X de producto"
    const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const textDollarRegex2 = /\$\s*(\d+(?:\.\d+)?)\s*(?:de|del)\s+([^,\n$]+)/gi;
    const dollarFromText: { amount: number; fragment: string }[] = [];
    let dm2;
    while ((dm2 = textDollarRegex2.exec(text)) !== null) {
      dollarFromText.push({ amount: parseFloat(dm2[1]), fragment: normalize(dm2[2].trim()) });
    }

    const dollarAmountRegex = /^\$\s*(\d+(?:\.\d+)?)|^(\d+(?:\.\d+)?)\s*\$|^(\d+(?:\.\d+)?)\s*(?:dolares?|dollars?|usd)\s/i;
    const dollarDeRegex = /^\$?\s*(\d+(?:\.\d+)?)\s*\$?\s*(?:de\s|del\s|d\s)/i;

    for (const item of parsed.items || []) {
      if (item.matched && item.productId) {
        const product = products.find(p => String(p.id) === String(item.productId));
        if (product) {
          let effectiveDollarAmount = item.dollarAmount && item.dollarAmount > 0 ? item.dollarAmount : null;
          let effectiveCustomPrice = item.customPrice;

          if (item.requestedName) {
            const m = item.requestedName.match(dollarDeRegex) || item.requestedName.match(dollarAmountRegex);
            if (m) {
              effectiveDollarAmount = parseFloat(m[1] || m[2] || m[3]);
              effectiveCustomPrice = null;
            }
          }

          // Buscar en texto original del usuario
          if (!effectiveDollarAmount) {
            const prodName = normalize(product.nombre);
            const match = dollarFromText.find(d => {
              const f = d.fragment;
              return prodName.includes(f) || f.includes(prodName) ||
                prodName.split(' ').some(w => w.length > 3 && f.includes(w));
            });
            if (match) {
              effectiveDollarAmount = match.amount;
              effectiveCustomPrice = null;
            }
          }

          const precioBcv = effectiveCustomPrice || product.precioUSD;
          const precioDivisa = item.customPriceDivisa || product.precioUSDDivisa || precioBcv;
          const precioMain = pricingMode === 'divisas' ? precioDivisa : precioBcv;

          // Si hay dollarAmount, SIEMPRE recalcular qty con precio real del catálogo
          let qty = item.quantity;
          if (effectiveDollarAmount && effectiveDollarAmount > 0 && precioMain > 0) {
            qty = Math.round((effectiveDollarAmount / precioMain) * 1000) / 1000;
          }

          const itemData: any = {
            nombre: item.productName || product.nombre,
            cantidad: qty,
            unidad: item.unit || product.unidad,
            precioUSD: precioMain,
            subtotalUSD: Math.round(precioMain * qty * 100) / 100,
          };

          // Only add divisa prices for dual mode
          if (pricingMode === 'dual') {
            itemData.precioUSDDivisa = precioDivisa;
            // Dual + dollarAmount: ambos subtotales = dollarAmount
            if (effectiveDollarAmount && effectiveDollarAmount > 0 && precioDivisa > 0) {
              const cantidadDivisa = Math.round((effectiveDollarAmount / precioDivisa) * 1000) / 1000;
              itemData.subtotalUSDDivisa = effectiveDollarAmount;
              itemData.cantidadDivisa = cantidadDivisa;
            } else {
              itemData.subtotalUSDDivisa = Math.round(precioDivisa * qty * 100) / 100;
            }
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

    // Calculate totals based on mode (items + optional delivery)
    const delivery = typeof parsed.delivery === 'number' && parsed.delivery > 0 ? parsed.delivery : 0;
    const itemsTotalUSD = presupuestoItems.reduce((sum, i) => sum + i.subtotalUSD, 0);
    const totalUSD = Math.round((itemsTotalUSD + delivery) * 100) / 100;
    // For divisas mode: no Bs total (set to 0)
    // For BCV and dual: calculate Bs
    const totalBs = pricingMode === 'divisas' ? 0 : Math.round(totalUSD * bcvRate * 100) / 100;
    // Only set totalUSDDivisa for dual mode
    const itemsTotalDivisa = pricingMode === 'dual'
      ? presupuestoItems.reduce((sum, i) => sum + (i.subtotalUSDDivisa || i.subtotalUSD), 0)
      : 0;
    const totalUSDDivisa = pricingMode === 'dual'
      ? Math.round((itemsTotalDivisa + delivery) * 100) / 100
      : null;

    // Build description
    const description = presupuestoItems.map(i =>
      `${i.nombre} ${i.cantidad}${i.unidad}`
    ).join(', ');

    const action: ParsedAction = {
      customerName: parsed.customerName || 'Cliente',
      customerId: parsed.customerId || null,
      items: presupuestoItems,
      totalUSD,
      totalBs: Math.round(totalBs * 100) / 100,
      totalUSDDivisa: totalUSDDivisa ?? null,
      date: parsed.date || null,
      description,
      pricingMode,
      delivery: delivery > 0 ? delivery : null
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
