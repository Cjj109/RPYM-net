import type { APIRoute } from 'astro';
import { requireAuth } from '../../lib/require-auth';
import { getEnv } from '../../lib/env';
import { callAIWithFallback } from '../../lib/ai-fallback';
import { getProviderOrder } from '../../lib/ai-config';
import { normalizeDictatedText } from '../../lib/normalize-dictated';
import { detectExplicitUnit } from '../../lib/detect-explicit-unit';

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
  /** El texto viene de una nota de voz: nombres fonéticos, sin puntuación */
  dictado?: boolean;
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

/** Abono/pago detectado en el mismo texto que la compra */
interface ParsedPayment {
  customerName: string;
  customerId: number | null;
  amountUsd: number;
  amountUsdDivisa: number | null;
  description: string;
  currencyType: 'divisas' | 'dolar_bcv';
  paymentMethod: string | null;
  date: string | null;
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
    const env = getEnv(locals);
    const apiKeys = {
      gemini: env.GEMINI_API_KEY,
      claude: env.CLAUDE_API_KEY,
      openai: env.OPENAI_API_KEY,
      openrouter: env.OPENROUTER_API_KEY,
    };

    if (!apiKeys.gemini && !apiKeys.claude && !apiKeys.openai && !apiKeys.openrouter) {
      return new Response(JSON.stringify({
        success: false, error: 'API key de IA no configurada'
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const body: PurchaseRequest = await request.json();
    const { text: textoCrudo, products, customers, bcvRate, pricingMode, dictado } = body;
    // "medio kilo" -> "0.5kg" antes de que lo vea el modelo. La conversión en
    // código acierta siempre; pedírsela al prompt acierta casi siempre.
    const text: string = dictado ? normalizeDictatedText(textoCrudo || '') : textoCrudo;

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
4. Opcionalmente, uno o varios ABONOS/PAGOS de clientes

FECHA ACTUAL: ${todayISO} (${todayName})

CLIENTES REGISTRADOS:
${customerList}

PRODUCTOS DISPONIBLES:
${productList}

${dictado ? `⚠️ ESTE TEXTO VIENE DE UNA NOTA DE VOZ, NO FUE ESCRITO.
El reconocimiento de voz no conoce los nombres del negocio, así que los escribe
como suenan. Por eso, y SOLO en este caso, aplica lo siguiente:

- Los nombres de clientes y productos vienen deformados fonéticamente. Buscá el
  que SUENE igual, aunque se escriba distinto: "delsi"/"del si"/"delci" = "Delcy",
  "bibito"/"vivitos" = "Vivito", "calamares" = "Calamar", "pepitonas" = "Pepitona".
- Ignorá la regla de "no matchear por parecido": aquí el parecido fonético SÍ es
  la señal correcta. Preferí siempre el nombre del catálogo que suene más cerca
  antes que dejarlo sin identificar o crear un cliente nuevo.
- Si un producto del catálogo tiene paréntesis o palabras extra, el usuario no las
  dice: "camaron vivito" = "Camaron Vivito (concha)".
- El dictado no trae puntuación. Separá cliente y productos por el sentido de la
  frase: lo primero suele ser el cliente, lo demás son productos con cantidades.
- Si aun así dudás entre dos productos parecidos, elegí el más común y dejá el
  resto en unmatched; es preferible acertar el cliente y la mayoría de productos.

` : ''}REGLAS DE INTERPRETACION:

CLIENTE:
- Buscar el nombre del cliente en la lista de clientes registrados
- Ignorar acentos/mayusculas (ej: "delcy" = "Delcy", "garcia" = "García", "angel" = "Ángel")
- PRIORIDAD de match: 1) coincidencia exacta, 2) coincidencia parcial única (solo un cliente posible)
- Si el nombre escrito es AMBIGUO (varios clientes coinciden), devolver customerId: null
- CORRECTO: "jose" con clientes ["Jose", "Jose Luis"] → usar "Jose" (exacto)
- CORRECTO: "garcia" con clientes ["Jose Garcia"] → único parcial, usar "Jose Garcia"
- INCORRECTO: "jose" con clientes ["Jose", "Jose Luis"] → NO auto-asignar "Jose Luis"
- INCORRECTO: "Delsy" con clientes ["Delicias de la Nona"] → NO matchear por parecido superficial (compartir las primeras letras NO es coincidencia). Si el nombre escrito no coincide con ningún cliente, customerId: null y customerName con el nombre TAL CUAL lo escribió el usuario
- Si el usuario dice "cliente" sin apellido ni nombre → customerId: null, customerName: "Cliente" (nombre genérico válido)
- Si no hay nombre en absoluto → customerId: null, customerName: ""
- NO usar términos como "desconocido", "sin nombre", etc.

PRODUCTOS:
- Identificar cada producto mencionado con su cantidad
- Formatos de cantidad: "2kg", "1 kilo", "500g" (= 0.5kg), "medio kilo" (= 0.5kg), "1/2", "2 1/2" (= 2.5)
- ⚠️ TEXTO DICTADO: el texto puede venir de una nota de voz, con los números
  escritos en palabras. Convertirlos a cifras:
  - "dos kilos" = 2, "tres kilos y medio" = 3.5, "kilo y medio" = 1.5
  - "un kilo" / "una caja" = 1, "media caja" = 0.5, "docena" = 12
  - "quinientos gramos" = 0.5kg, "doscientos cincuenta gramos" = 0.25kg
  - Montos: "diez dólares" = 10, "veinte" tras un verbo de pago = 20
  - El dictado no trae puntuación: separar los productos por el sentido de la
    frase, no por comas. "dos kilos de calamar un kilo de camaron" son DOS
    productos, no uno.
- Si no hay unidad, asumir "kg" para productos por peso
- ⚠️ UNIDAD EXPLÍCITA: Si el usuario dice "1kg", "2kg", etc., usar SIEMPRE "kg" aunque el catálogo diga "caja" u otra unidad
- ⚠️ UNIDAD POR DEFECTO: NUNCA asignes unit "caja" a un producto a menos que el usuario lo diga EXPLÍCITAMENTE para ESE producto. Que otro producto anterior sea "caja" NO afecta a los siguientes. Sin unidad explícita, usar la unidad del catálogo.
- Hacer match con el catalogo usando nombres parciales
- "calamar" sin especificar → preferir "Calamar Nacional"
- "camaron" → buscar por talla si se menciona (41/50, 61/70, etc.)

MOLUSCOS (unidad crítica):
- "pepitona", "pepitonas" = Pepitona. Si el usuario dice "1kg pepitona" → unit: "kg". Solo "caja" si dice explícitamente "caja de pepitona" o "X cajas"
- ⚠️⚠️ CRITICO "pepitona": "pepitona" SIN "caja" → SIEMPRE usar producto "Pepitona" (kg/unidad), NUNCA "Caja de Pepitona". Solo "Caja de Pepitona" si dice EXPLICITAMENTE "caja de pepitona" o "X cajas de pepitona".
- "mejillon", "mejillones" = Mejillón
- "almeja", "almejas" = Almeja

CAMARONES - REGLA CRITICA DE DISAMBIGUATION:
- "camaron jumbo", "jumbo", "camarones jumbo" = SIEMPRE Camarón Jumbo (en concha) - ES EL PRODUCTO JUMBO POR DEFECTO
- "camaron pelado" = Camarón Pelado (sin concha)
- "camaron desvenado", "pelado y desvenado", "P&D" = Camarón Desvenado (NORMAL, talla 41/50)
- "camaron desvenado jumbo", "desvenado jumbo", "jumbo desvenado" = Camarón Desvenado Jumbo (talla 31/35-36/40)
- ⚠️ REGLA MAS IMPORTANTE: "jumbo" SOLO o "camaron jumbo" SIN la palabra "desvenado" = Camarón Jumbo (en concha). NUNCA lo interpretes como Camarón Desvenado Jumbo a menos que EXPLICITAMENTE digan "desvenado"
- "camaron vivito", "vivitos" = Camarón Vivito
- ⚠️ CRITICO: "camaron vivito"/"vivito" NUNCA debe matchear "Camarón Precocido" ni otro producto. Si existe "Camarón Vivito" en el catálogo, SIEMPRE usarlo.
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
  * ⚠️ PRECIO CON ETIQUETA DE MONEDA (UN SOLO PRECIO): "a $X en divisas", "$X divisa", "$X efectivo", "$X cash" → customPriceDivisa: X, customPrice: null (NO es BCV)
  * ⚠️ PRECIO CON ETIQUETA DE MONEDA (UN SOLO PRECIO): "a $X a BCV", "$X BCV", "$X bolivares", "$X bs" → customPrice: X, customPriceDivisa: null (NO es divisa)

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
- El cliente especifica CUÁNTO DINERO quiere gastar, NO la cantidad
- PATRONES RECONOCIDOS: "$X de producto", "$X en producto", "X$ de producto", "X$ en producto", "X dólares de producto", "X dólares en producto", "Dame $X de producto", "dame $X en producto"
- DEBES calcular: quantity = monto / precio del producto. NUNCA pongas quantity: 0
- "$20 de calamar" (precio $18/kg) → quantity: 20/18 = 1.111 kg, dollarAmount: 20, customPrice: null
- "$50 en camarones 61/70" (precio $14/kg) → quantity: 50/14 = 3.571 kg, dollarAmount: 50, customPrice: null
- "dame $30 de pulpo" (precio $22/kg) → quantity: 30/22 = 1.364 kg, dollarAmount: 30, customPrice: null
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

ABONOS / PAGOS (array "payments"):
- Un ABONO es dinero que el cliente ENTREGA, no una compra. Va en "payments", NUNCA en "items".
- Verbos de abono: "abona", "abono", "abonó", "paga", "pagó", "pago", "cancela", "canceló", "deposita", "depositó", "entrega", "me dio", "me pasó"
- Ejemplos: "Friteria Chon abono $10" → payments: [{"customerName":"Friteria Chon","amountUsd":10,...}]
- Un mismo texto puede traer abonos Y productos a la vez. Ejemplo:
  "Chon abonó $10 y llevó 2kg de camaron" → payments: [{...$10}] + items: [{camaron 2kg}]
- Cada abono lleva su propio cliente. Si el texto nombra un solo cliente, todos usan ese nombre.
- Aplicar a cada "customerName" de payments las MISMAS reglas de match de la seccion CLIENTE.
- currencyType: "divisas" si el pago fue en efectivo USD, zelle, usdt, paypal, binance, cripto.
  "dolar_bcv" si fue pago movil, transferencia, tarjeta, debito o no se especifica.
- paymentMethod: "efectivo" | "pago_movil" | "transferencia" | "zelle" | "tarjeta" | null
- description: texto corto de lo que dice el usuario (ej: "Abono", "Abono pago movil")
- Si el texto NO menciona ningun abono, payments debe ser un array vacio [].

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
      "unit": "kg" | "caja" | "unidad" | "paquete" | "bolsa",
      "matched": true/false,
      "customPrice": numero o null,
      "customPriceDivisa": numero o null,
      "dollarAmount": numero o null (monto total en $ que el cliente quiere gastar)
    }
  ],
  "date": "YYYY-MM-DD" o null,
  "delivery": numero o null (costo de delivery en USD si se menciono),
  "payments": [
    {
      "customerName": "nombre del cliente que abona",
      "customerId": numero o null,
      "amountUsd": numero,
      "description": "texto corto del abono",
      "currencyType": "divisas" | "dolar_bcv",
      "paymentMethod": "efectivo" | "pago_movil" | "transferencia" | "zelle" | "tarjeta" | null,
      "date": "YYYY-MM-DD" o null
    }
  ],
  "unmatched": ["productos que no se pudieron identificar"]
}`;

    const providerOrder = await getProviderOrder(db);
    const aiResult = await callAIWithFallback({
      systemPrompt,
      userMessage: text,
      providerOrder,
      apiKeys,
      temperature: 0.1,
      maxOutputTokens: 2048,
      jsonMode: true,
    });

    if (!aiResult.success) {
      console.error('Error de IA (anotación con productos):', aiResult.error);
      return new Response(JSON.stringify({
        success: false, error: 'Error al procesar. Intenta de nuevo.'
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    console.log(`[purchase-with-products] Procesado con: ${aiResult.provider}`);
    const content = aiResult.content;

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

    // Pre-escanear texto original para patrones de monto en dólares
    const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Corrige matches incorrectos del AI: valida que keywords del usuario estén en el producto matcheado
    const correctProductMatch = (requestedName: string, productId: string): ProductInfo | null => {
      const normReq = normalize(requestedName);
      const current = products.find((p: ProductInfo) => String(p.id) === productId);
      if (!current) return null;
      const normCurrent = normalize(current.nombre);

      // "jumbo" sin "desvenado" → NO debe matchear producto con "desvenado"
      if (/\bjumbo\b/.test(normReq) && !/\bdesvenado\b/.test(normReq) && /\bdesvenado\b/.test(normCurrent)) {
        const better = products.find((p: ProductInfo) => /\bjumbo\b/.test(normalize(p.nombre)) && !/\bdesvenado\b/.test(normalize(p.nombre)));
        if (better) return better;
      }

      // "vivito" debe matchear producto con "vivito"
      if (/\bvivito\b/.test(normReq) && !/\bvivito\b/.test(normCurrent)) {
        const better = products.find((p: ProductInfo) => /\bvivito\b/.test(normalize(p.nombre)));
        if (better) return better;
      }

      // "pepitona" sin "caja" → NO debe matchear "Caja de Pepitona"
      if (/\bpepitona\b/.test(normReq) && !/\bcaja\b/.test(normReq) && /\bcaja\b/.test(normCurrent)) {
        const better = products.find((p: ProductInfo) => /\bpepitona\b/.test(normalize(p.nombre)) && !/\bcaja\b/.test(normalize(p.nombre)));
        if (better) return better;
      }

      // "caja de X" → preferir producto con "caja" en el nombre si existe uno que comparte palabras base
      if (/\bcaja\b/.test(normReq) && !/\bcaja\b/.test(normCurrent)) {
        const baseWords = normCurrent.split(/\s+/).filter((w: string) => w.length > 3);
        const better = products.find((p: ProductInfo) => {
          const pn = normalize(p.nombre);
          return /\bcaja\b/.test(pn) && baseWords.some((w: string) => pn.includes(w));
        });
        if (better) return better;
      }

      return null;
    };

    const dollarFromText: { amount: number; fragment: string }[] = [];
    // Captura: "$X de/del/en producto", "X$ de/del/en producto", "X dólares/dolares de/del/en producto"
    const dollarTextPatterns2 = [
      /\$\s*(\d+(?:\.\d+)?)\s*(?:de|del|en)\s+([^,\n$]+)/gi,
      /(\d+(?:\.\d+)?)\s*\$\s*(?:de|del|en)\s+([^,\n$]+)/gi,
      /(\d+(?:\.\d+)?)\s*(?:d[oó]lares?|dollars?|usd)\s+(?:de|del|en)\s+([^,\n$]+)/gi,
    ];
    for (const rx of dollarTextPatterns2) {
      let dm;
      while ((dm = rx.exec(text)) !== null) {
        // Cortar en "y" para evitar que "$X de prodA y prodB" asigne el monto a prodB
        const rawFragment = dm[2].trim().split(/\s+y\s+/i)[0].trim();
        const fragment = normalize(rawFragment);
        if (!dollarFromText.some(d => d.amount === parseFloat(dm![1]) && d.fragment === fragment)) {
          dollarFromText.push({ amount: parseFloat(dm[1]), fragment });
        }
      }
    }

    const dollarAmountRegex = /^\$\s*(\d+(?:\.\d+)?)|^(\d+(?:\.\d+)?)\s*\$|^(\d+(?:\.\d+)?)\s*(?:dolares?|dollars?|usd)\s/i;
    const dollarDeRegex = /^\$?\s*(\d+(?:\.\d+)?)\s*\$?\s*(?:de\s|del\s|en\s|d\s)/i;

    for (const item of parsed.items || []) {
      if (item.matched && item.productId) {
        // Corregir matches incorrectos del AI
        const matchCorrection = correctProductMatch(item.requestedName || '', String(item.productId));
        if (matchCorrection) {
          item.productId = matchCorrection.id;
          item.productName = matchCorrection.nombre;
          item.unit = matchCorrection.unidad;
        }
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

          let effectiveCustomPriceDivisa = item.customPriceDivisa;
          // En modo divisas, si Gemini puso el precio en customPrice (BCV) sin customPriceDivisa,
          // ese precio aplica a divisas (el usuario no tiene intención de dar precio BCV)
          if (pricingMode === 'divisas' && effectiveCustomPrice && !effectiveCustomPriceDivisa) {
            effectiveCustomPriceDivisa = effectiveCustomPrice;
            effectiveCustomPrice = null;
          }
          const precioBcv = effectiveCustomPrice || product.precioUSD;
          const precioDivisa = effectiveCustomPriceDivisa || product.precioUSDDivisa || precioBcv;
          const precioMain = pricingMode === 'divisas' ? precioDivisa : precioBcv;

          // Si hay dollarAmount, SIEMPRE recalcular qty con precio real del catálogo
          let qty = item.quantity;
          if (effectiveDollarAmount && effectiveDollarAmount > 0 && precioMain > 0) {
            qty = Math.round((effectiveDollarAmount / precioMain) * 1000) / 1000;
          }

          const itemData: any = {
            nombre: item.productName || product.nombre,
            cantidad: qty,
            unidad: detectExplicitUnit(item, text) || product.unidad,
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
      } else if (!item.matched && item.suggestedName && (item.customPrice || item.customPriceDivisa)) {
        // Custom product.
        // Se acepta con precio en CUALQUIERA de los dos campos: el prompt indica
        // que "a $X en divisas" debe dar customPrice: null y solo
        // customPriceDivisa, y antes se exigia customPrice, asi que esos
        // productos se descartaban en silencio.
        const precioBcv = item.customPrice ?? item.customPriceDivisa!;
        const precioDivisa = item.customPriceDivisa ?? precioBcv;
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

    let resolvedCustomerId = parsed.customerId || null;
    let resolvedCustomerName = parsed.customerName?.trim() || 'Cliente';

    // Validar el cliente que eligió la IA contra el texto original: a veces
    // matchea por similitud superficial (ej: "Delsy" → "Delicias de la Nona").
    // Si ninguna palabra del nombre elegido aparece en el texto, descartarlo
    // y usar el nombre que el usuario escribió ("Delsy: ..." o "... para Delsy")
    if (resolvedCustomerId) {
      const textNorm = normalize(text);
      const stopTokens = new Set(['los', 'las', 'del', 'para', 'con', 'cliente']);
      const chosen = customers.find(c => String(c.id) === String(resolvedCustomerId));
      const appearsInText = chosen
        ? normalize(chosen.name).split(/\s+/)
            .filter(t => t.length >= 3 && !stopTokens.has(t))
            .some(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(textNorm))
        : false;
      if (chosen && !appearsInText) {
        resolvedCustomerId = null;
        const writtenName = text.match(/^\s*([\p{L} .'-]{2,40}?)\s*:/u)?.[1]
          || text.match(/\bpara\s+([\p{L} .'-]{2,40}?)\s*(?:$|[,;\n.])/iu)?.[1];
        if (writtenName?.trim()) resolvedCustomerName = writtenName.trim();
      }
    }

    // Fallback: si no hay cliente resuelto, buscar sin acentos por nombre
    if (!resolvedCustomerId && resolvedCustomerName && resolvedCustomerName !== 'Cliente') {
      const normalizedInput = normalize(resolvedCustomerName).trim();
      if (normalizedInput) {
        const exactMatch = customers.find(c => normalize(c.name) === normalizedInput);
        if (exactMatch) {
          resolvedCustomerId = exactMatch.id;
          resolvedCustomerName = exactMatch.name;
        } else {
          const partialMatches = customers.filter(c => normalize(c.name).includes(normalizedInput));
          if (partialMatches.length === 1) {
            resolvedCustomerId = partialMatches[0].id;
            resolvedCustomerName = partialMatches[0].name;
          }
        }
      }
    }

    const action: ParsedAction = {
      customerName: resolvedCustomerName,
      customerId: resolvedCustomerId,
      items: presupuestoItems,
      totalUSD,
      totalBs: Math.round(totalBs * 100) / 100,
      totalUSDDivisa: totalUSDDivisa ?? null,
      date: parsed.date || null,
      description,
      pricingMode,
      delivery: delivery > 0 ? delivery : null
    };

    // Abonos/pagos detectados en el mismo texto. Se resuelve el cliente de cada
    // uno igual que el de la compra: exacto primero, parcial unico despues.
    const resolvePaymentCustomer = (name: string): { id: number | null; name: string } => {
      const raw = (name || '').trim();
      if (!raw) return { id: resolvedCustomerId, name: resolvedCustomerName };
      const norm = normalize(raw);
      const exact = customers.find(c => normalize(c.name) === norm);
      if (exact) return { id: exact.id, name: exact.name };
      const partial = customers.filter(c => normalize(c.name).includes(norm));
      if (partial.length === 1) return { id: partial[0].id, name: partial[0].name };
      return { id: null, name: raw };
    };

    const payments: ParsedPayment[] = ((parsed.payments || []) as any[])
      .map(p => {
        const amountUsd = Math.round((Number(p?.amountUsd) || 0) * 100) / 100;
        if (amountUsd <= 0) return null;
        // La IA a veces devuelve un customerId que no existe; se revalida por nombre.
        const byId = p?.customerId != null
          ? customers.find(c => String(c.id) === String(p.customerId))
          : null;
        const resolved = byId
          ? { id: byId.id, name: byId.name }
          : resolvePaymentCustomer(String(p?.customerName || ''));
        return {
          customerName: resolved.name,
          customerId: resolved.id,
          amountUsd,
          amountUsdDivisa: null,
          description: String(p?.description || 'Abono').slice(0, 120),
          currencyType: p?.currencyType === 'divisas' ? 'divisas' : 'dolar_bcv',
          paymentMethod: p?.paymentMethod ? String(p.paymentMethod) : null,
          date: typeof p?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : null,
        } as ParsedPayment;
      })
      .filter((p): p is ParsedPayment => p !== null);

    // No reportar como "no identificados" productos que sí se agregaron:
    // la IA a veces lista en unmatched un producto que igual entró como
    // producto personalizado (suggestedName + customPrice), y eso infla
    // el conteo del badge de verificación (ej: 5/6 cuando capturó 5/5)
    const itemNames = presupuestoItems.map(i => normalize(i.nombre));
    const unmatched = ((parsed.unmatched || []) as unknown[]).map(u => String(u)).filter(u => {
      const nu = normalize(u);
      return !itemNames.some(n => n.includes(nu) || nu.includes(n));
    });

    return new Response(JSON.stringify({
      success: true,
      // action null = el texto no traia productos identificables; el cliente
      // decide si cae al modo simple o si solo registra los abonos.
      action: presupuestoItems.length > 0 ? action : null,
      payments,
      unmatched
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
