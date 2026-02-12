/**
 * RPYM - Telegram handlers para presupuestos
 * Handlers que devuelven mensajes formateados para Telegram
 */

import type { D1Database } from '../../d1-types';
import { getProducts, getBCVRate } from '../../sheets';
import { getAdminPresupuestoUrl } from '../../admin-token';
import { findCustomerByName, findCustomerSuggestions } from '../../repositories/customers';
import { callGeminiWithRetry } from '../../gemini-client';

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

interface ParseOrderResult {
  success: boolean;
  items: ParsedItem[];
  unmatched: string[];
  delivery?: number | null;
  customerName?: string | null;
  customerAddress?: string | null;
  dollarsOnly?: boolean;
  isPaid?: boolean;
  pricingMode?: 'bcv' | 'divisa' | 'dual' | null;
  date?: string | null;
  error?: string;
}

/**
 * Parsea un pedido directamente con Gemini (sin subrequest HTTP)
 * Evita problemas de timeout en Cloudflare Workers
 */
async function parseOrderDirect(
  text: string,
  products: ProductInfo[],
  customers: { id: number; name: string }[],
  apiKey: string
): Promise<ParseOrderResult> {
  if (!text || !products || products.length === 0) {
    return { success: false, items: [], unmatched: [], error: 'Texto o productos no proporcionados' };
  }

  const productList = products.map(p =>
    `- ID: ${p.id} | Nombre: "${p.nombre}" | Precio BCV: $${p.precioUSD.toFixed(2)}/${p.unidad}${p.precioUSDDivisa ? ` | Precio Divisa: $${p.precioUSDDivisa.toFixed(2)}/${p.unidad}` : ''} | Unidad: ${p.unidad}`
  ).join('\n');

  const now = new Date();
  now.setHours(now.getHours() - 4);
  const todayISO = now.toISOString().split('T')[0];
  const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const todayName = dayNames[now.getDay()];

  const systemPrompt = `Eres un EXPERTO en el negocio de mariscos RPYM - "El Rey de los Pescados y Mariscos" en Venezuela. Llevas años trabajando aquí y conoces TODOS los productos, cómo hablan los clientes, y cómo interpretar sus pedidos aunque escriban mal o de forma informal.

FECHA ACTUAL: ${todayISO} (${todayName})

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

PRECIOS PERSONALIZADOS - ¡¡¡CRÍTICO - LEE ESTO!!!:
Cuando el usuario escribe "a $X" o "a X" DESPUÉS de la cantidad/producto, ese X es el PRECIO PERSONALIZADO por unidad.
IGNORA el precio del catálogo y usa el precio que especificó el usuario.

¡¡¡SIEMPRE BUSCA EL PATRÓN "a $X" o "a X" EN CADA LÍNEA DEL PEDIDO!!!
Si hay un número después de "a " o "a $" o "a$", ESE ES EL PRECIO PERSONALIZADO.

EJEMPLOS CRÍTICOS (aprende estos patrones):
- "2kg Pepitona a $2.5" → quantity: 2, customPrice: 2.5 (NO uses precio catálogo)
- "5kg langostino a $12" → quantity: 5, customPrice: 12 (NO uses precio catálogo)
- "3kg calamar a 15" → quantity: 3, customPrice: 15
- "2kg calamar nacional grande a $10" → quantity: 2, customPrice: 10 (IMPORTANTE!)
- "2kg lengua de calamar a $12" → quantity: 2, customPrice: 12
- "camaron vivito 5kg a 13" → quantity: 5, customPrice: 13
- "1kg pulpo a $20" → quantity: 1, customPrice: 20
- "4 cajas 36/40 a $65" → quantity: 4, customPrice: 65
- "calamar a $8" → quantity: 1 (default), customPrice: 8
- "3kg jumbo a 15" → quantity: 3, customPrice: 15

REGEX PARA DETECTAR PRECIO PERSONALIZADO:
Busca: /a\\s*\\$?\\s*(\\d+(?:\\.\\d+)?)/i
Ejemplo: "2kg calamar a $10" → match: "a $10" → customPrice: 10

PATRONES A DETECTAR para precio personalizado:
- "a $X" (con símbolo dólar) ej: "a $10", "a $12.50"
- "a X" (sin símbolo, solo número) ej: "a 10", "a 15"
- "a$X" (pegado) ej: "a$10"
- "por $X" (alternativo) ej: "por $8"

¡¡¡NUNCA IGNORES EL PRECIO PERSONALIZADO!!! Si detectas "a [número]", SIEMPRE establece customPrice

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

NOMBRE DEL CLIENTE (MUY IMPORTANTE - extrae SIEMPRE que se mencione):
- Formatos: "cliente: Juan", "para Maria", "pedido de Pedro", "Juan Garcia", "cliente Juan"
- "a Delcy", "a Maria", "creale a Delcy", "crea presupuesto a Jose", "presupuesto a Carlos"
- "para Delcy", "presupuesto para Maria", "de Delcy" = el presupuesto es DE ese cliente
- Si hay un nombre propio después de "a", "para", "de", "cliente" → customerName con ese nombre
- Si recibes lista CLIENTES REGISTRADOS: usa el nombre EXACTO de esa lista (ej: si dicen "Delcy" y en la lista está "Delcy Rodriguez", usa "Delcy Rodriguez")
- Si no hay lista de clientes: devuelve el nombre tal como lo escribió el usuario
- Si no se detecta nombre, customerName será null

DIRECCIÓN DEL CLIENTE:
- Detecta si se menciona una dirección de entrega
- Formatos: "dirección: Av. Principal 123", "envío a Calle 5 con 6", "entrega en Urbanización X", "para: Av. Bolívar"
- También: "cliente: Juan, dirección: ...", "envío a..."
- Si no se detecta dirección, customerAddress será null

SOLO DÓLARES:
- Detecta si el pedido es solo en dólares (sin bolívares)
- Formatos: "solo dolares", "sin bolivares", "en dolares", "puro dolar", "solo $", "factura en dolares"
- Si se menciona, dollarsOnly será true, sino false

ESTADO PAGADO:
- Detecta si el pedido ya está pagado O si el usuario pide marcarlo como pagado
- Formatos: "pagado", "ya pago", "cancelado" (en el sentido de pagado), "ya pagó", "pago confirmado"
- INSTRUCCIONES (también isPaid: true): "márcalo pagado", "marca como pagado", "márcalo como pagado", "y márcalo pagado"
- Si el mensaje incluye cualquiera de estas frases al final o en el texto, isPaid será true

MODO DE PRECIO:
- Cada producto puede tener dos precios: "Precio BCV" (para pago en bolívares) y "Precio Divisa" (para pago en dólares efectivos)
- Detecta el modo de pago del cliente:
  - Si dice "a BCV", "precios BCV", "va a pagar en bolivares", "pago movil", "transferencia" → pricingMode: "bcv"
  - Si dice "en dolares", "pago en divisa", "va a pagar en dolares", "precio divisa", "efectivo", "cash" → pricingMode: "divisa"
  - Si dice "dual", "ambos precios", "bcv y divisa", "los dos precios", "presupuesto dual" → pricingMode: "dual"
  - Si especifica precios personalizados duales (ej: "a 13 en bs y 10 en divisas", "a 10 en divisas y 12 en bcv") → pricingMode: "dual"
  - NOTA: "bcv" = "bs" = "bolivares" son sinónimos
  - Si no se especifica → pricingMode: null
- Cuando el modo es "divisa" y el producto tiene Precio Divisa, usar ese precio para calcular cantidades por monto en dólares
- Cuando el modo es "bcv" o no se especifica, usar el Precio BCV (el precio por defecto)
- Cuando el modo es "dual", se usarán ambos precios (el presupuesto mostrará ambas versiones)
- Ejemplo: "$20 de calamar" en modo divisa con Precio Divisa $15/kg → cantidad = 20/15 = 1.333 kg

FECHAS (MUY IMPORTANTE):
- FECHA ACTUAL: ${todayISO} (${todayName})
- Por defecto, date = null (significa hoy/fecha actual)
- Detecta si el texto menciona una fecha específica pasada:
  - "ayer" = fecha de ayer (calcula desde ${todayISO})
  - "antier", "anteayer" = hace 2 días
  - "el lunes", "el martes", etc. = el último día de esa semana (hacia atrás desde hoy)
  - "hace 2 dias", "hace 3 dias" = restar esos días a hoy
  - "el 5", "el 05", "el dia 5" = día del mes actual o anterior
  - "el 5 de febrero", "del 5 febrero", "5/febrero", "05/feb" = fecha específica (usar año ${now.getFullYear()})
  - "del 03 de febrero" = ${now.getFullYear()}-02-03
- IMPORTANTE: Usa el año actual (${now.getFullYear()}) para todas las fechas
- Si detectas una fecha, devuelve en formato "YYYY-MM-DD"
- Si no se menciona fecha, date = null

PRODUCTOS PERSONALIZADOS (fuera del catálogo):
- PRODUCTO PERSONALIZADO = cualquier producto que NO está en el catálogo PERO tiene precio
- Si el producto NO hace match con el catálogo Y el usuario dio precio → matched: false, suggestedName, customPrice
- Ejemplos: "mariscos varios $25", "mojito a $8", "2kg producto especial a $15", "coctel a 12"
- Cualquier cosa que no sea pescado/mariscos del catálogo (bebidas, fiambres, otros) → producto personalizado
- suggestedName = nombre que escribió el usuario, capitalizado (ej: "Mariscos Varios", "Mojito")
- Si NO está en catálogo Y NO tiene precio → va a "unmatched"

MARCADOR DE PRODUCTO PERSONALIZADO (MUY IMPORTANTE):
- Si el usuario escribe "(producto personalizado)", "(personalizado)", "(custom)", "(nuevo)" junto al nombre del producto:
  - SIEMPRE tratar como producto personalizado (matched: false)
  - ELIMINAR el marcador del nombre final (suggestedName NO debe incluir el texto entre paréntesis)
  - Ejemplos:
    * "1kg pescado especial (producto personalizado) a $15" → suggestedName: "Pescado Especial", customPrice: 15
    * "2kg marisco mix (personalizado) a 20/18" → suggestedName: "Marisco Mix", customPrice: 20, customPriceDivisa: 18
    * "filete importado (custom) a $25" → suggestedName: "Filete Importado", customPrice: 25
  - El marcador puede ir antes o después del precio
  - Capitalizar el nombre correctamente en suggestedName

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
      "customPrice": número o null (¡¡IMPORTANTE!! si el usuario escribió "a $X" o "a X", este es ese precio),
      "customPriceDivisa": número o null (precio Divisa por unidad, solo si el usuario dio dos precios)
    }
  ],
  "unmatched": ["items que no pudiste identificar"],
  "delivery": número o null (costo de delivery si se mencionó),
  "customerName": "nombre del cliente" o null,
  "customerAddress": "dirección de entrega" o null,
  "dollarsOnly": true/false,
  "isPaid": true/false,
  "pricingMode": "bcv" | "divisa" | "dual" | null,
  "date": "YYYY-MM-DD" o null (fecha específica si se mencionó)
}`;

  const customerList = customers.length > 0
    ? `\nCLIENTES REGISTRADOS (usa el nombre EXACTO para customerName):\n${customers.map(c => `- ${c.name}`).join('\n')}\n`
    : '';

  const userPrompt = `CATÁLOGO DE PRODUCTOS DISPONIBLES:
${productList}
${customerList}
LISTA DEL CLIENTE A INTERPRETAR:
${text}

INSTRUCCIONES:
1. Analiza la lista e identifica cada producto con su cantidad
2. Haz el mejor match posible con el catálogo
3. Producto NO en catálogo pero CON precio → producto personalizado (matched: false, suggestedName, customPrice)
4. SIEMPRE extrae customerName si mencionan "a X", "para X", "creale a X"
5. Si el texto dice "márcalo pagado" o "marca como pagado" → isPaid: true
6. ¡¡¡CRÍTICO!!! Si un producto dice "a $X" o "a X", DEBES establecer customPrice con ese valor X
   - Ejemplo: "2kg Pepitona a $2.5" → customPrice: 2.5
   - Ejemplo: "5kg langostino a $12" → customPrice: 12
   - Ejemplo: "2kg calamar nacional grande a $10" → customPrice: 10
   - Ejemplo: "3kg jumbo a 15" → customPrice: 15
4. ¡¡¡NUNCA IGNORES LOS PRECIOS PERSONALIZADOS!!! Son críticos para el presupuesto
5. Busca el patrón "a" seguido de un número en CADA línea del pedido`;

  try {
    const geminiResult = await callGeminiWithRetry({
      systemPrompt,
      userMessage: userPrompt,
      apiKey,
      temperature: 0.1,
      maxOutputTokens: 2048,
      jsonMode: true,
    });

    if (!geminiResult.success) {
      console.error('[parseOrderDirect] Error de Gemini:', geminiResult.error);
      return { success: false, items: [], unmatched: [], error: 'Error al procesar la lista. Intenta de nuevo.' };
    }

    const content = geminiResult.content;
    let parsedResult;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No se encontró JSON en la respuesta');
      }
    } catch (parseError) {
      console.error('[parseOrderDirect] Error parseando respuesta:', content);
      return { success: false, items: [], unmatched: [], error: 'Error interpretando la respuesta. Intenta reformular tu lista.' };
    }

    return {
      success: true,
      items: parsedResult.items || [],
      unmatched: parsedResult.unmatched || [],
      delivery: parsedResult.delivery || null,
      customerName: parsedResult.customerName || null,
      customerAddress: parsedResult.customerAddress || null,
      dollarsOnly: parsedResult.dollarsOnly || false,
      isPaid: parsedResult.isPaid || false,
      pricingMode: parsedResult.pricingMode || null,
      date: parsedResult.date || null
    };
  } catch (error) {
    console.error('[parseOrderDirect] Error:', error);
    return { success: false, items: [], unmatched: [], error: 'Error interno del servidor' };
  }
}

export const PAYMENT_METHOD_NAMES: Record<string, string> = {
  pago_movil: 'Pago Móvil',
  transferencia: 'Transferencia',
  zelle: 'Zelle',
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  usdt: 'USDT',
  binance: 'Binance',
};

export interface BudgetEdit {
  tipo: 'precio' | 'precio_divisa' | 'fecha' | 'quitar' | 'agregar' | 'cantidad' | 'cliente' | 'delivery' | 'sustituir' | 'restar' | 'direccion';
  producto?: string;
  precio?: number;
  precioBcv?: number;
  precioDivisa?: number;
  cantidad?: number;
  unidad?: string;
  fecha?: string;
  nombre?: string;
  monto?: number;
  productoOriginal?: string;
  productoNuevo?: string;
  direccion?: string;
}

export async function getBudget(db: D1Database | null, budgetId: string, adminSecret: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT * FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;
    const items = JSON.parse(budget.items);
    const estado = budget.estado === 'pagado' ? '✅ PAGADO' : '⏳ PENDIENTE';
    let text = `📋 *Presupuesto #${budget.id}*\n${estado}\n`;
    if (budget.customer_name) text += `👤 ${budget.customer_name}\n`;
    text += `\n`;
    items.forEach((item: any) => text += `• ${item.nombre} x ${item.cantidad}: $${item.subtotalUSD.toFixed(2)}\n`);
    text += `\n*Total: $${budget.total_usd.toFixed(2)}*`;
    if (budget.total_usd_divisa) text += ` / DIV: $${budget.total_usd_divisa.toFixed(2)}`;
    const adminUrl = await getAdminPresupuestoUrl(budget.id, adminSecret, 'https://rpym.net');
    text += `\n🔗 ${adminUrl}`;
    return text;
  } catch (error) {
    return '❌ Error al obtener presupuesto';
  }
}

export async function searchBudgetsByCustomer(db: D1Database | null, customerName: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const searchTerm = customerName.toLowerCase();
    const budgets = await db.prepare(`
      SELECT id, fecha, customer_name, total_usd, total_usd_divisa, modo_precio
      FROM presupuestos
      WHERE estado = 'pendiente'
        AND LOWER(customer_name) LIKE ?
      ORDER BY fecha DESC
      LIMIT 10
    `).bind(`%${searchTerm}%`).all();

    if (!budgets?.results?.length) {
      return `📋 No encontré presupuestos pendientes para "*${customerName}*"`;
    }

    let text = `📋 *Presupuestos pendientes de "${customerName}"*\n\n`;
    let totalDeuda = 0;

    budgets.results.forEach((b: any) => {
      const fecha = b.fecha ? b.fecha.split(' ')[0] : 'Sin fecha';
      const isDual = b.modo_precio === 'dual' && b.total_usd_divisa;
      text += `• #${b.id} - ${fecha}\n`;
      text += `  💵 $${b.total_usd.toFixed(2)}${isDual ? ` / DIV: $${b.total_usd_divisa.toFixed(2)}` : ''}\n`;
      totalDeuda += b.total_usd;
    });

    text += `\n*Total pendiente: $${totalDeuda.toFixed(2)}* (${budgets.results.length} presupuesto${budgets.results.length > 1 ? 's' : ''})`;

    return text;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

export async function deleteBudget(db: D1Database | null, budgetId: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT id, customer_name, total_usd FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;
    await db.prepare(`DELETE FROM presupuestos WHERE id = ?`).bind(budgetId).run();
    return `🗑️ *Presupuesto #${budgetId} eliminado*\n${budget.customer_name ? `👤 ${budget.customer_name}\n` : ''}💵 $${budget.total_usd.toFixed(2)}`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

export async function markBudgetPaid(db: D1Database | null, budgetId: string, paymentMethod?: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT id, estado, customer_name, total_usd FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;
    if (budget.estado === 'pagado' && !paymentMethod) return `ℹ️ Presupuesto #${budgetId} ya está pagado`;

    if (paymentMethod) {
      await db.prepare(`UPDATE presupuestos SET estado = 'pagado', fecha_pago = datetime('now', '-4 hours'), payment_method = ? WHERE id = ?`).bind(paymentMethod, budgetId).run();
    } else {
      await db.prepare(`UPDATE presupuestos SET estado = 'pagado', fecha_pago = datetime('now', '-4 hours') WHERE id = ?`).bind(budgetId).run();
    }

    const txResult = await db.prepare(`
      UPDATE customer_transactions
      SET is_paid = 1, paid_date = datetime('now', '-4 hours'), paid_method = ?
      WHERE presupuesto_id = ?
    `).bind(paymentMethod || null, budgetId).run();

    let response = `✅ *Presupuesto #${budgetId}* marcado como *PAGADO*`;
    if (paymentMethod) {
      response += ` (${PAYMENT_METHOD_NAMES[paymentMethod] || paymentMethod})`;
    }
    if (txResult?.meta?.changes > 0) {
      response += `\n💼 Transacción del cliente también marcada como pagada`;
    }
    if (budget.customer_name) {
      response += `\n👤 ${budget.customer_name}`;
    }
    return response;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

export async function updatePaymentMethod(db: D1Database | null, budgetId: string, paymentMethod: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT id, estado, customer_name FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;

    await db.prepare(`UPDATE presupuestos SET payment_method = ? WHERE id = ?`).bind(paymentMethod, budgetId).run();
    await db.prepare(`UPDATE customer_transactions SET paid_method = ? WHERE presupuesto_id = ?`).bind(paymentMethod, budgetId).run();

    return `✅ Método de pago de #${budgetId} actualizado a *${PAYMENT_METHOD_NAMES[paymentMethod] || paymentMethod}*`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

export async function updateBudgetProperty(db: D1Database | null, budgetId: string, change: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT id, customer_name, hide_rate FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;

    if (change === 'ocultar_bs') {
      await db.prepare(`UPDATE presupuestos SET hide_rate = 1 WHERE id = ?`).bind(budgetId).run();
      return `✅ Presupuesto #${budgetId} actualizado - *Bs ocultos*${budget.customer_name ? `\n👤 ${budget.customer_name}` : ''}`;
    } else if (change === 'mostrar_bs') {
      await db.prepare(`UPDATE presupuestos SET hide_rate = 0 WHERE id = ?`).bind(budgetId).run();
      return `✅ Presupuesto #${budgetId} actualizado - *Bs visibles*${budget.customer_name ? `\n👤 ${budget.customer_name}` : ''}`;
    }

    return `❓ Cambio no reconocido: ${change}`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

export async function editBudget(db: D1Database | null, budgetId: string, edicion: BudgetEdit): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`
      SELECT id, items, total_usd, total_bs, total_usd_divisa, customer_name, fecha, modo_precio, delivery
      FROM presupuestos WHERE id = ?
    `).bind(budgetId).first();

    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;

    let items = typeof budget.items === 'string' ? JSON.parse(budget.items) : budget.items;
    let mensaje = '';

    const bcvRate = await getBCVRate(db);

    switch (edicion.tipo) {
      case 'precio': {
        const producto = edicion.producto?.toLowerCase();
        const itemIndex = items.findIndex((i: any) => i.nombre.toLowerCase().includes(producto || ''));
        if (itemIndex === -1) return `❌ No encontré "${edicion.producto}" en el presupuesto`;

        const item = items[itemIndex];
        const oldPrice = item.precioUSD;
        item.precioUSD = edicion.precio!;
        item.precioBs = edicion.precio! * bcvRate.rate;
        item.subtotalUSD = item.precioUSD * item.cantidad;
        item.subtotalBs = item.precioBs * item.cantidad;

        if (edicion.precioDivisa) {
          item.precioUSDDivisa = edicion.precioDivisa;
          item.subtotalUSDDivisa = edicion.precioDivisa * item.cantidad;
        } else if (item.precioUSDDivisa) {
          item.subtotalUSDDivisa = item.precioUSDDivisa * item.cantidad;
        }

        mensaje = `✏️ Precio de *${item.nombre}* cambiado: $${oldPrice.toFixed(2)} → $${edicion.precio!.toFixed(2)}`;
        break;
      }

      case 'precio_divisa': {
        if (items.length === 1) {
          const item = items[0];
          item.precioUSDDivisa = edicion.precio!;
          item.subtotalUSDDivisa = edicion.precio! * item.cantidad;
          mensaje = `✏️ Precio divisa de *${item.nombre}* cambiado a $${edicion.precio!.toFixed(2)}`;
        } else {
          return `❓ Hay varios productos. Especifica cuál: "el precio del [producto] era $X"`;
        }
        break;
      }

      case 'fecha': {
        await db.prepare(`UPDATE presupuestos SET fecha = ? WHERE id = ?`).bind(edicion.fecha + ' 12:00:00', budgetId).run();
        return `✅ Fecha de #${budgetId} cambiada a *${edicion.fecha}*`;
      }

      case 'direccion': {
        const dir = edicion.direccion?.trim() || '';
        await db.prepare(`UPDATE presupuestos SET customer_address = ? WHERE id = ?`).bind(dir || null, budgetId).run();
        return dir ? `✅ Dirección de #${budgetId}: *${dir}*` : `✅ Dirección de #${budgetId} eliminada`;
      }

      case 'quitar': {
        const producto = edicion.producto?.toLowerCase();
        const itemIndex = items.findIndex((i: any) => i.nombre.toLowerCase().includes(producto || ''));
        if (itemIndex === -1) return `❌ No encontré "${edicion.producto}" en el presupuesto`;

        const removed = items.splice(itemIndex, 1)[0];
        mensaje = `🗑️ *${removed.nombre}* eliminado del presupuesto`;
        break;
      }

      case 'agregar': {
        const modoPrecioRaw = budget.modo_precio || 'bcv';
        const modoPrecio = modoPrecioRaw === 'divisa' ? 'divisas' : modoPrecioRaw;
        const cantidadAgregar = edicion.cantidad || 1;
        const productoNombre = (edicion.producto || '').toLowerCase();

        const existingItemIndex = items.findIndex((i: any) =>
          i.nombre.toLowerCase().includes(productoNombre) ||
          productoNombre.includes(i.nombre.toLowerCase())
        );

        if (existingItemIndex !== -1 && !edicion.precio && !edicion.precioBcv) {
          const item = items[existingItemIndex];
          const oldQty = item.cantidad;
          item.cantidad += cantidadAgregar;
          item.subtotalUSD = item.precioUSD * item.cantidad;
          item.subtotalBs = item.precioBs * item.cantidad;
          if (item.precioUSDDivisa) {
            item.subtotalUSDDivisa = item.precioUSDDivisa * item.cantidad;
          }

          if (modoPrecio === 'divisas') {
            mensaje = `➕ *${item.nombre}*: ${oldQty} + ${cantidadAgregar} = ${item.cantidad}${item.unidad} x $${item.precioUSD.toFixed(2)} (DIV)`;
          } else if (modoPrecio === 'dual') {
            mensaje = `➕ *${item.nombre}*: ${oldQty} + ${cantidadAgregar} = ${item.cantidad}${item.unidad} x $${item.precioUSD.toFixed(2)} / DIV: $${item.precioUSDDivisa.toFixed(2)}`;
          } else {
            mensaje = `➕ *${item.nombre}*: ${oldQty} + ${cantidadAgregar} = ${item.cantidad}${item.unidad} x $${item.precioUSD.toFixed(2)}`;
          }
          break;
        }

        let precioBCV = edicion.precioBcv || edicion.precio || 0;
        let precioDivisa = edicion.precioDivisa || precioBCV;
        let nombreProducto = edicion.producto || 'Producto';

        if (!edicion.precio && !edicion.precioBcv) {
          const products = await getProducts(bcvRate.rate, db);
          const foundProduct = products.find(p =>
            p.nombre.toLowerCase().includes(productoNombre) ||
            productoNombre.includes(p.nombre.toLowerCase())
          );
          if (foundProduct) {
            precioBCV = foundProduct.precioUSD;
            precioDivisa = foundProduct.precioUSDDivisa || foundProduct.precioUSD;
            nombreProducto = foundProduct.nombre;
          }
        }

        let precioParaItem: number;
        let subtotalParaItem: number;

        if (modoPrecio === 'divisas') {
          precioParaItem = precioDivisa;
          subtotalParaItem = precioDivisa * cantidadAgregar;
        } else {
          precioParaItem = precioBCV;
          subtotalParaItem = precioBCV * cantidadAgregar;
        }

        const newItem = {
          nombre: nombreProducto,
          cantidad: cantidadAgregar,
          unidad: edicion.unidad || 'kg',
          precioUSD: precioParaItem,
          precioBs: precioParaItem * bcvRate.rate,
          subtotalUSD: subtotalParaItem,
          subtotalBs: subtotalParaItem * bcvRate.rate,
          precioUSDDivisa: modoPrecio === 'dual' ? precioDivisa : precioParaItem,
          subtotalUSDDivisa: modoPrecio === 'dual' ? precioDivisa * cantidadAgregar : subtotalParaItem
        };
        items.push(newItem);

        if (modoPrecio === 'divisas') {
          mensaje = `➕ *${newItem.nombre}* agregado: ${cantidadAgregar}${newItem.unidad} x $${precioDivisa.toFixed(2)} (DIV)`;
        } else if (modoPrecio === 'dual') {
          mensaje = `➕ *${newItem.nombre}* agregado: ${cantidadAgregar}${newItem.unidad} x $${precioBCV.toFixed(2)} / DIV: $${precioDivisa.toFixed(2)}`;
        } else {
          mensaje = `➕ *${newItem.nombre}* agregado: ${cantidadAgregar}${newItem.unidad} x $${precioBCV.toFixed(2)}`;
        }
        break;
      }

      case 'cantidad': {
        const producto = edicion.producto?.toLowerCase();
        let itemIndex = 0;
        if (producto) {
          itemIndex = items.findIndex((i: any) => i.nombre.toLowerCase().includes(producto));
          if (itemIndex === -1) return `❌ No encontré "${edicion.producto}"`;
        } else if (items.length > 1) {
          return `❓ Hay varios productos. Especifica cuál: "cambia la cantidad del [producto] a X"`;
        }

        const item = items[itemIndex];
        const oldQty = item.cantidad;
        item.cantidad = edicion.cantidad!;
        item.subtotalUSD = item.precioUSD * item.cantidad;
        item.subtotalBs = item.precioBs * item.cantidad;
        if (item.precioUSDDivisa) {
          item.subtotalUSDDivisa = item.precioUSDDivisa * item.cantidad;
        }

        mensaje = `✏️ Cantidad de *${item.nombre}* cambiada: ${oldQty} → ${edicion.cantidad}`;
        break;
      }

      case 'restar': {
        const productoRestar = edicion.producto?.toLowerCase();
        if (!productoRestar) return `❌ Especifica qué producto quieres restar`;

        const itemIdx = items.findIndex((i: any) =>
          i.nombre.toLowerCase().includes(productoRestar) ||
          productoRestar.includes(i.nombre.toLowerCase())
        );
        if (itemIdx === -1) return `❌ No encontré "${edicion.producto}" en el presupuesto`;

        const item = items[itemIdx];
        const cantidadRestar = edicion.cantidad || 1;
        const cantidadAnterior = item.cantidad;
        const nuevaCantidad = cantidadAnterior - cantidadRestar;

        if (nuevaCantidad <= 0) {
          items.splice(itemIdx, 1);
          mensaje = `🗑️ *${item.nombre}* eliminado (${cantidadAnterior} - ${cantidadRestar} = 0)`;
        } else {
          item.cantidad = nuevaCantidad;
          item.subtotalUSD = item.precioUSD * nuevaCantidad;
          item.subtotalBs = item.precioBs * nuevaCantidad;
          if (item.precioUSDDivisa) {
            item.subtotalUSDDivisa = item.precioUSDDivisa * nuevaCantidad;
          }
          mensaje = `➖ *${item.nombre}*: ${cantidadAnterior} - ${cantidadRestar} = ${nuevaCantidad}${item.unidad}`;
        }
        break;
      }

      case 'cliente': {
        await db.prepare(`UPDATE presupuestos SET customer_name = ? WHERE id = ?`).bind(edicion.nombre, budgetId).run();
        return `✅ Cliente de #${budgetId} cambiado a *${edicion.nombre}*`;
      }

      case 'delivery': {
        const nuevoDelivery = edicion.monto || 0;

        await db.prepare(`UPDATE presupuestos SET delivery = ? WHERE id = ?`).bind(nuevoDelivery, budgetId).run();

        const itemsTotal = items.reduce((sum: number, i: any) => sum + i.subtotalUSD, 0);
        const itemsTotalBs = items.reduce((sum: number, i: any) => sum + i.subtotalBs, 0);
        const itemsTotalDivisa = items.reduce((sum: number, i: any) => sum + (i.subtotalUSDDivisa || i.subtotalUSD), 0);

        const newTotalUSD = itemsTotal + nuevoDelivery;
        const newTotalBs = itemsTotalBs + (nuevoDelivery * bcvRate.rate);
        const newTotalDivisa = itemsTotalDivisa + nuevoDelivery;

        await db.prepare(`
          UPDATE presupuestos SET total_usd = ?, total_bs = ?, total_usd_divisa = ?
          WHERE id = ?
        `).bind(newTotalUSD, newTotalBs, budget.modo_precio !== 'bcv' ? newTotalDivisa : null, budgetId).run();

        await db.prepare(`
          UPDATE customer_transactions SET amount_usd = ?, amount_bs = ?, amount_usd_divisa = ?
          WHERE presupuesto_id = ?
        `).bind(newTotalUSD, newTotalBs, budget.modo_precio === 'dual' ? newTotalDivisa : null, budgetId).run();

        if (nuevoDelivery > 0) {
          mensaje = `🚗 Delivery actualizado: $${nuevoDelivery.toFixed(2)}`;
        } else {
          mensaje = `🚗 Delivery eliminado`;
        }
        mensaje += `\n\n📋 *Presupuesto #${budgetId}*`;
        if (budget.customer_name) mensaje += `\n👤 ${budget.customer_name}`;
        mensaje += `\n💵 Total: $${newTotalUSD.toFixed(2)}`;
        if (budget.modo_precio !== 'bcv') mensaje += ` / DIV: $${newTotalDivisa.toFixed(2)}`;

        return mensaje;
      }

      case 'sustituir': {
        const productoOriginal = edicion.productoOriginal?.toLowerCase();
        const productoNuevo = edicion.productoNuevo || '';

        let itemIndex = -1;
        if (productoOriginal) {
          itemIndex = items.findIndex((i: any) => i.nombre.toLowerCase().includes(productoOriginal));
        } else if (items.length === 1) {
          itemIndex = 0;
        }

        if (itemIndex === -1) {
          return `❌ No encontré "${edicion.productoOriginal || 'el producto'}" en el presupuesto`;
        }

        const item = items[itemIndex];
        const oldName = item.nombre;

        const products = await getProducts(bcvRate.rate, db);
        const newProduct = products.find(p =>
          p.nombre.toLowerCase().includes(productoNuevo.toLowerCase()) ||
          productoNuevo.toLowerCase().includes(p.nombre.toLowerCase())
        );

        if (newProduct) {
          const modoPrecioRaw = budget.modo_precio || 'bcv';
          const modoPrecio = modoPrecioRaw === 'divisa' ? 'divisas' : modoPrecioRaw;
          const precioBCV = newProduct.precioUSD;
          const precioDivisa = newProduct.precioUSDDivisa || newProduct.precioUSD;

          let precioParaItem: number;
          if (modoPrecio === 'divisas') {
            precioParaItem = precioDivisa;
          } else {
            precioParaItem = precioBCV;
          }

          item.nombre = newProduct.nombre;
          item.precioUSD = precioParaItem;
          item.precioBs = precioParaItem * bcvRate.rate;
          item.subtotalUSD = precioParaItem * item.cantidad;
          item.subtotalBs = precioParaItem * item.cantidad * bcvRate.rate;
          item.precioUSDDivisa = modoPrecio === 'dual' ? precioDivisa : precioParaItem;
          item.subtotalUSDDivisa = modoPrecio === 'dual' ? precioDivisa * item.cantidad : precioParaItem * item.cantidad;

          if (modoPrecio === 'divisas') {
            mensaje = `🔄 *${oldName}* → *${newProduct.nombre}*\n💰 Precio: $${precioDivisa.toFixed(2)} (DIV)`;
          } else if (modoPrecio === 'dual') {
            mensaje = `🔄 *${oldName}* → *${newProduct.nombre}*\n💰 Precio: $${precioBCV.toFixed(2)} / DIV: $${precioDivisa.toFixed(2)}`;
          } else {
            mensaje = `🔄 *${oldName}* → *${newProduct.nombre}*\n💰 Precio: $${precioBCV.toFixed(2)}`;
          }
        } else {
          item.nombre = productoNuevo;
          mensaje = `🔄 *${oldName}* → *${productoNuevo}*\n⚠️ Producto no encontrado en lista, precio sin cambios`;
        }
        break;
      }
    }

    const delivery = budget.delivery || 0;
    const itemsTotalUSD = items.reduce((sum: number, i: any) => sum + i.subtotalUSD, 0);
    const itemsTotalBs = items.reduce((sum: number, i: any) => sum + i.subtotalBs, 0);
    const itemsTotalDivisa = items.reduce((sum: number, i: any) => sum + (i.subtotalUSDDivisa || i.subtotalUSD), 0);

    const totalUSD = itemsTotalUSD + delivery;
    const totalBs = itemsTotalBs + (delivery * bcvRate.rate);
    const totalUSDDivisa = itemsTotalDivisa + delivery;

    await db.prepare(`
      UPDATE presupuestos SET items = ?, total_usd = ?, total_bs = ?, total_usd_divisa = ?
      WHERE id = ?
    `).bind(JSON.stringify(items), totalUSD, totalBs, budget.modo_precio !== 'bcv' ? totalUSDDivisa : null, budgetId).run();

    await db.prepare(`
      UPDATE customer_transactions SET amount_usd = ?, amount_bs = ?, amount_usd_divisa = ?
      WHERE presupuesto_id = ?
    `).bind(totalUSD, totalBs, budget.modo_precio === 'dual' ? totalUSDDivisa : null, budgetId).run();

    mensaje += `\n\n📋 *Presupuesto #${budgetId}*`;
    if (budget.customer_name) mensaje += `\n👤 ${budget.customer_name}`;
    const modoPrecioFinal = budget.modo_precio === 'divisa' ? 'divisas' : budget.modo_precio;
    if (modoPrecioFinal === 'divisas') {
      mensaje += `\n💵 Total: $${totalUSDDivisa.toFixed(2)} (DIV)`;
    } else if (modoPrecioFinal === 'dual') {
      mensaje += `\n💵 Total: $${totalUSD.toFixed(2)} / DIV: $${totalUSDDivisa.toFixed(2)}`;
    } else {
      mensaje += `\n💵 Total: $${totalUSD.toFixed(2)}`;
    }
    if (delivery > 0) mensaje += `\n🚗 (incl. delivery $${delivery.toFixed(2)})`;

    return mensaje;
  } catch (error) {
    console.error('[Telegram] Error editando presupuesto:', error);
    return `❌ Error: ${error}`;
  }
}

export async function sendBudgetWhatsApp(db: D1Database | null, budgetId: string, phone: string, baseUrl: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT * FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;
    const items = JSON.parse(budget.items);
    const digits = phone.replace(/\D/g, '');
    let formattedPhone: string;
    if (digits.startsWith('58') && digits.length === 12) formattedPhone = digits;
    else if (digits.startsWith('0') && digits.length === 11) formattedPhone = '58' + digits.substring(1);
    else if (digits.length === 10 && digits.startsWith('4')) formattedPhone = '58' + digits;
    else return `❌ Teléfono inválido: ${phone}`;

    const modoPrecio = budget.modo_precio === 'divisas' ? 'divisa' : (budget.modo_precio || 'bcv');
    const shouldIncludeBs = modoPrecio === 'bcv' || modoPrecio === 'dual';

    const bcvRate = await getBCVRate(db);
    const dynamicTotalBs = shouldIncludeBs ? budget.total_usd * bcvRate.rate : 0;

    const response = await fetch(`${baseUrl}/api/send-whatsapp-factura`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: formattedPhone,
        facturaId: budget.id,
        customerName: budget.customer_name || 'Cliente',
        items: items.map((item: any) => ({
          producto: item.nombre,
          cantidad: item.cantidad,
          unidad: item.unidad,
          precioUnit: item.precioUSD,
          subtotal: item.subtotalUSD,
          precioUnitDivisa: item.precioUSDDivisa,
          subtotalDivisa: item.subtotalUSDDivisa
        })),
        total: budget.total_usd,
        totalBs: dynamicTotalBs,
        totalUSDDivisa: budget.total_usd_divisa,
        date: new Date(budget.fecha).toLocaleDateString('es-VE'),
        isPaid: budget.estado === 'pagado',
        delivery: budget.delivery || 0,
        modoPrecio: modoPrecio
      }),
    });
    const result = await response.json();
    if (!result.success) return `❌ Error: ${result.error}`;
    return `✅ *PDF de presupuesto #${budgetId} enviado*\n📱 ${phone}`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

export async function linkBudgetToCustomer(db: D1Database | null, budgetId: string, customerNameOrId: string | number, existingBcvRate?: { rate: number }): Promise<{ success: boolean; message: string; customerId?: number }> {
  console.log('[linkBudgetToCustomer] START - budgetId:', budgetId, 'customer:', customerNameOrId);
  if (!db) return { success: false, message: '❌ No hay conexión a la base de datos' };

  try {
    console.log('[linkBudgetToCustomer] Checking budget...');
    const budget = await db.prepare(`SELECT * FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return { success: false, message: `❌ No encontré presupuesto #${budgetId}` };
    console.log('[linkBudgetToCustomer] Budget found');

    console.log('[linkBudgetToCustomer] Checking existing tx...');
    const existingTx = await db.prepare(`SELECT id FROM customer_transactions WHERE presupuesto_id = ?`).bind(budgetId).first();
    if (existingTx) return { success: false, message: `⚠️ Presupuesto #${budgetId} ya está asignado a una cuenta` };
    console.log('[linkBudgetToCustomer] No existing tx');

    let customer: any;
    if (typeof customerNameOrId === 'number') {
      customer = await db.prepare(`SELECT id, name FROM customers WHERE id = ? AND is_active = 1`).bind(customerNameOrId).first();
    } else {
      console.log('[linkBudgetToCustomer] Finding customer by name:', customerNameOrId);
      customer = await findCustomerByName(db, customerNameOrId);
    }
    console.log('[linkBudgetToCustomer] Customer found:', customer?.id, customer?.name);

    if (!customer) {
      console.log('[linkBudgetToCustomer] Customer NOT found, getting suggestions...');
      const suggestions = await findCustomerSuggestions(db, String(customerNameOrId), 5);
      let msg = `❌ No encontré cliente "${customerNameOrId}"`;
      if (suggestions.length > 0) {
        msg += `\n\n💡 _¿Quisiste decir?_\n` + suggestions.map(s => `• ${s.name}`).join('\n');
      }
      return { success: false, message: msg };
    }

    const items = JSON.parse(budget.items || '[]');
    const description = items.map((i: any) => `${i.nombre} ${i.cantidad}${i.unidad || 'kg'}`).join(', ') || `Presupuesto #${budgetId}`;
    const currencyType = (budget.modo_precio === 'divisas' || budget.modo_precio === 'divisa') ? 'divisas' : 'dolar_bcv';
    const bcvRate = existingBcvRate || await getBCVRate(db);
    const isPaid = budget.estado === 'pagado' ? 1 : 0;

    console.log('[linkBudgetToCustomer] Inserting transaction...');
    await db.prepare(`
      INSERT INTO customer_transactions
      (customer_id, type, date, description, amount_usd, amount_bs, amount_usd_divisa, currency_type, presupuesto_id, exchange_rate, is_paid)
      VALUES (?, 'purchase', datetime(?, 'localtime'), ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      customer.id,
      budget.fecha,
      description,
      budget.total_usd,
      budget.total_bs,
      budget.modo_precio === 'dual' ? budget.total_usd_divisa : null,
      currencyType,
      budgetId,
      bcvRate.rate,
      isPaid
    ).run();
    console.log('[linkBudgetToCustomer] Transaction inserted successfully');

    if (!budget.customer_name) {
      await db.prepare(`UPDATE presupuestos SET customer_name = ? WHERE id = ?`).bind(customer.name, budgetId).run();
    }

    return {
      success: true,
      message: `✅ Presupuesto #${budgetId} asignado a *${customer.name}*`,
      customerId: customer.id
    };
  } catch (error) {
    console.error('[Telegram] Error linking budget to customer:', error);
    return { success: false, message: `❌ Error: ${error}` };
  }
}

export async function createBudgetFromText(db: D1Database | null, text: string, mode: string, baseUrl: string, apiKey: string, adminSecret: string, hideRate: boolean = false): Promise<string> {
  console.log('[createBudgetFromText] START');
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    console.log('[createBudgetFromText] Getting BCV rate...');
    const bcvRate = await getBCVRate(db);
    console.log('[createBudgetFromText] BCV rate:', bcvRate.rate);

    console.log('[createBudgetFromText] Getting products...');
    const products = await getProducts(bcvRate.rate, db);
    console.log('[createBudgetFromText] Products count:', products.length);

    const productList = products.map(p => ({
      id: String(p.id), nombre: p.nombre, unidad: p.unidad, precioUSD: p.precioUSD, precioUSDDivisa: p.precioUSDDivisa
    }));

    console.log('[createBudgetFromText] Getting customers...');
    const customers = await db.prepare('SELECT id, name FROM customers WHERE is_active = 1').all<{ id: number; name: string }>();
    console.log('[createBudgetFromText] Customers count:', customers?.results?.length);

    // Llamada directa a Gemini (evita subrequest HTTP que falla en CF Workers)
    console.log('[createBudgetFromText] Calling parseOrderDirect...');
    const result = await parseOrderDirect(text, productList, customers?.results || [], apiKey);
    console.log('[createBudgetFromText] parseOrderDirect done, success:', result.success, 'customerName:', result.customerName);

    if (!result.success || !result.items?.length) {
      console.log('[Telegram] parse-order failed:', JSON.stringify(result));
      return `❌ No pude interpretar el pedido. ${result.error || 'Intenta reformularlo.'}`;
    }

    console.log('[Telegram] parse-order items:', JSON.stringify(result.items.map((i: any) => ({
      matched: i.matched, productId: i.productId, productName: i.productName,
      requestedName: i.requestedName, suggestedName: i.suggestedName, customPrice: i.customPrice, quantity: i.quantity
    }))));
    console.log('[Telegram] Available products:', products.slice(0, 5).map(p => ({ id: p.id, nombre: p.nombre })));

    const presupuestoItems: any[] = [];
    let totalUSD = 0, totalBs = 0, totalUSDDivisa = 0;
    const pricingMode = result.pricingMode || mode || 'bcv';

    for (const item of result.items) {
      if (item.matched && item.productId) {
        let product = products.find(p => String(p.id) === item.productId);
        if (!product && item.productName) {
          const nameLower = item.productName.toLowerCase();
          product = products.find(p => p.nombre.toLowerCase() === nameLower) ||
                    products.find(p => p.nombre.toLowerCase().includes(nameLower) || nameLower.includes(p.nombre.toLowerCase()));
        }
        if (!product) {
          console.log(`[Telegram] Product not found: id=${item.productId}, name=${item.productName}`);
          continue;
        }

        const precioBCV = item.customPrice ?? product.precioUSD;
        const precioDivisa = item.customPriceDivisa ?? product.precioUSDDivisa ?? precioBCV;

        const precioMain = pricingMode === 'divisas' ? precioDivisa : precioBCV;
        const subtotalMain = precioMain * item.quantity;
        const subtotalDivisa = precioDivisa * item.quantity;

        presupuestoItems.push({
          nombre: product.nombre, cantidad: item.quantity, unidad: item.unit || product.unidad,
          precioUSD: precioMain, precioBs: precioMain * bcvRate.rate,
          subtotalUSD: subtotalMain, subtotalBs: subtotalMain * bcvRate.rate,
          precioUSDDivisa: pricingMode === 'dual' ? precioDivisa : precioMain,
          subtotalUSDDivisa: pricingMode === 'dual' ? subtotalDivisa : subtotalMain
        });

        totalUSD += subtotalMain;
        totalBs += subtotalMain * bcvRate.rate;
        totalUSDDivisa += subtotalDivisa;
      }
      else if (!item.matched && item.suggestedName && item.customPrice) {
        const precioBCV = item.customPrice;
        const precioDivisa = item.customPriceDivisa ?? precioBCV;

        const precioMain = pricingMode === 'divisas' ? precioDivisa : precioBCV;
        const subtotalMain = precioMain * item.quantity;
        const subtotalDivisa = precioDivisa * item.quantity;

        presupuestoItems.push({
          nombre: item.suggestedName, cantidad: item.quantity, unidad: item.unit || 'kg',
          precioUSD: precioMain, precioBs: precioMain * bcvRate.rate,
          subtotalUSD: subtotalMain, subtotalBs: subtotalMain * bcvRate.rate,
          precioUSDDivisa: pricingMode === 'dual' ? precioDivisa : precioMain,
          subtotalUSDDivisa: pricingMode === 'dual' ? subtotalDivisa : subtotalMain
        });

        totalUSD += subtotalMain;
        totalBs += subtotalMain * bcvRate.rate;
        totalUSDDivisa += subtotalDivisa;
      }
      else if (item.productName || item.requestedName) {
        const rawName = (item.productName || item.requestedName || '').toLowerCase();
        const cleanedName = rawName
          .replace(/^\d+(\.\d+)?\s*(kg|kilo|kilos|gr|g|cj|cajas?|paquetes?|unidades?|k|lb|libras?)\s*(de\s+)?/i, '')
          .replace(/\s+a\s+\$?\d+.*$/i, '')
          .trim();
        const searchName = cleanedName || rawName;
        console.log(`[Telegram] Name search: raw="${rawName}", cleaned="${cleanedName}", search="${searchName}"`);

        const product = products.find(p =>
          p.nombre.toLowerCase().includes(searchName) ||
          searchName.includes(p.nombre.toLowerCase())
        );

        if (product) {
          const precioBCV = item.customPrice ?? product.precioUSD;
          const precioDivisa = item.customPriceDivisa ?? product.precioUSDDivisa ?? precioBCV;
          const precioMain = pricingMode === 'divisas' ? precioDivisa : precioBCV;
          const subtotalMain = precioMain * item.quantity;
          const subtotalDivisa = precioDivisa * item.quantity;

          presupuestoItems.push({
            nombre: product.nombre, cantidad: item.quantity, unidad: item.unit || product.unidad,
            precioUSD: precioMain, precioBs: precioMain * bcvRate.rate,
            subtotalUSD: subtotalMain, subtotalBs: subtotalMain * bcvRate.rate,
            precioUSDDivisa: pricingMode === 'dual' ? precioDivisa : precioMain,
            subtotalUSDDivisa: pricingMode === 'dual' ? subtotalDivisa : subtotalMain
          });

          totalUSD += subtotalMain;
          totalBs += subtotalMain * bcvRate.rate;
          totalUSDDivisa += subtotalDivisa;
        } else if (item.customPrice && (item.requestedName || item.productName)) {
          // Producto no en catálogo pero con precio: tratar como personalizado
          const suggestedName = item.suggestedName || (item.requestedName || item.productName || '')
            .replace(/^\d+(\.\d+)?\s*(kg|kilo|kilos|gr|g|cj|cajas?)\s*(de\s+)?/i, '')
            .replace(/\s+a\s+\$?\d+.*$/i, '')
            .trim()
            .replace(/^\w/, c => c.toUpperCase());
          const precioBCV = item.customPrice;
          const precioDivisa = item.customPriceDivisa ?? precioBCV;
          const precioMain = pricingMode === 'divisas' ? precioDivisa : precioBCV;
          const subtotalMain = precioMain * item.quantity;
          const subtotalDivisa = precioDivisa * item.quantity;
          presupuestoItems.push({
            nombre: suggestedName || 'Producto',
            cantidad: item.quantity,
            unidad: item.unit || 'kg',
            precioUSD: precioMain,
            precioBs: precioMain * bcvRate.rate,
            subtotalUSD: subtotalMain,
            subtotalBs: subtotalMain * bcvRate.rate,
            precioUSDDivisa: pricingMode === 'dual' ? precioDivisa : precioMain,
            subtotalUSDDivisa: pricingMode === 'dual' ? subtotalDivisa : subtotalMain
          });
          totalUSD += subtotalMain;
          totalBs += subtotalMain * bcvRate.rate;
          totalUSDDivisa += subtotalDivisa;
          console.log(`[Telegram] Added custom product: ${suggestedName} x ${item.quantity} @ $${precioBCV}`);
        } else {
          console.log(`[Telegram] Could not find product by name: ${searchName}`);
        }
      }
    }

    if (presupuestoItems.length === 0) {
      console.log('[Telegram] No valid items! Items received:', JSON.stringify(result.items));
      const itemSummary = result.items.map((i: any) =>
        `${i.productName || i.requestedName}: matched=${i.matched}, id=${i.productId}`
      ).join('; ');
      return `❌ No encontré productos válidos.\n\nRecibí: ${itemSummary || 'ningún item'}\n\nIntenta especificar el producto exacto.`;
    }

    if (result.delivery && result.delivery > 0) {
      totalUSD += result.delivery;
      totalUSDDivisa += result.delivery;
      totalBs += result.delivery * bcvRate.rate;
    }

    const id = String(Math.floor(10000 + Math.random() * 90000));
    const fechaPresupuesto = result.date ? `${result.date} 12:00:00` : null;
    const fechaSql = fechaPresupuesto ? `'${fechaPresupuesto}'` : `datetime('now', '-4 hours')`;
    const estado = result.isPaid ? 'pagado' : 'pendiente';

    await db.prepare(`
      INSERT INTO presupuestos (id, fecha, items, total_usd, total_bs, total_usd_divisa, modo_precio, delivery, hide_rate, estado, source, customer_name, customer_address)
      VALUES (?, ${fechaSql}, ?, ?, ?, ?, ?, ?, ?, ?, 'telegram', ?, ?)
    `).bind(
      id, JSON.stringify(presupuestoItems), totalUSD, totalBs,
      pricingMode !== 'bcv' ? totalUSDDivisa : null,
      pricingMode,
      result.delivery || 0,
      (hideRate || pricingMode === 'divisas') ? 1 : 0,
      estado,
      result.customerName || null,
      result.customerAddress || null
    ).run();

    console.log('[createBudgetFromText] Presupuesto inserted, id:', id);

    const shouldHideBs = hideRate || pricingMode === 'divisas';

    let responseText = `✅ *Presupuesto #${id}*\n`;
    if (result.customerName) responseText += `👤 ${result.customerName}\n`;
    if (result.date) responseText += `📅 Fecha: ${result.date}\n`;
    responseText += `📊 Modo: ${pricingMode.toUpperCase()}${shouldHideBs ? ' (sin Bs)' : ''}\n`;
    presupuestoItems.forEach(item => {
      responseText += `• ${item.nombre} x ${item.cantidad}: $${item.subtotalUSD.toFixed(2)}\n`;
    });
    if (result.delivery > 0) responseText += `• 🚗 Delivery: $${result.delivery.toFixed(2)}\n`;
    responseText += `\n*Total: $${totalUSD.toFixed(2)}*`;
    if (pricingMode === 'dual') responseText += ` / DIV: $${totalUSDDivisa.toFixed(2)}`;

    console.log('[createBudgetFromText] Getting admin URL...');
    const adminUrl = await getAdminPresupuestoUrl(id, adminSecret, 'https://rpym.net');
    responseText += `\n🔗 ${adminUrl}`;
    console.log('[createBudgetFromText] Admin URL added');

    // Vincular a cliente si se especificó nombre
    if (result.customerName) {
      console.log('[createBudgetFromText] Linking to customer:', result.customerName);
      try {
        const linkResult = await linkBudgetToCustomer(db, id, result.customerName, bcvRate);
        console.log('[createBudgetFromText] Link result:', linkResult.success, linkResult.message?.substring(0, 50));
        if (linkResult.success) {
          responseText += `\n\n📋 Vinculado a cuenta de *${result.customerName}*`;
        } else {
          responseText += `\n\n⚠️ ${linkResult.message}`;
        }
      } catch (linkError: any) {
        console.error('[createBudgetFromText] Link error:', linkError?.message || linkError);
        responseText += `\n\n⚠️ No se pudo vincular automáticamente`;
      }
    }

    console.log('[createBudgetFromText] SUCCESS - returning response, length:', responseText.length);
    return responseText;
  } catch (error: any) {
    console.error('[createBudgetFromText] FATAL ERROR:', error?.message || error);
    return `❌ Error: ${error?.message || error}`;
  }
}

export async function createCustomerPurchaseWithProducts(
  db: D1Database | null,
  text: string,
  mode: string,
  baseUrl: string,
  apiKey: string,
  adminSecret: string,
  hideRate: boolean = false
): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';

  try {
    const bcvRate = await getBCVRate(db);
    const products = await getProducts(bcvRate.rate, db);
    const pricingMode = mode || 'bcv';

    // Llamada directa a Gemini (evita subrequest HTTP que falla en CF Workers)
    const productList = products.map(p => ({
      id: String(p.id),
      nombre: p.nombre,
      unidad: p.unidad,
      precioUSD: p.precioUSD,
      precioUSDDivisa: p.precioUSDDivisa
    }));
    const result = await parseOrderDirect(text, productList, [], apiKey);
    console.log('[Telegram] parse-order result:', JSON.stringify(result).substring(0, 500));

    if (!result.success || !result.items?.length) {
      return `❌ ${result.error || 'No pude interpretar el pedido'}`;
    }

    let customer = null;
    if (result.customerName) {
      customer = await findCustomerByName(db, result.customerName);
    }

    if (!customer) {
      const name = result.customerName || 'sin nombre';
      const suggestions = await findCustomerSuggestions(db, name, 5);
      let msg = `❌ No encontré cliente "${name}". Créalo primero o especifica el nombre.`;
      if (suggestions.length > 0) {
        msg += `\n\n💡 _¿Quisiste decir?_\n` + suggestions.map(s => `• ${s.name}`).join('\n');
      }
      return msg;
    }

    const presupuestoItems: any[] = [];
    let totalUSD = 0, totalBs = 0, totalUSDDivisa = 0;

    for (const item of result.items) {
      if (item.matched && item.productId) {
        const product = products.find(p => String(p.id) === item.productId);
        if (!product) continue;

        const precioUSD = item.customPrice ?? product.precioUSD;
        const precioUSDDivisa = item.customPriceDivisa ?? product.precioUSDDivisa ?? precioUSD;

        const precioMain = pricingMode === 'divisas' ? precioUSDDivisa : precioUSD;
        const subtotalMain = precioMain * item.quantity;
        const subtotalUSDDivisa = precioUSDDivisa * item.quantity;

        presupuestoItems.push({
          nombre: product.nombre,
          cantidad: item.quantity,
          unidad: item.unit || product.unidad,
          precioUSD: precioMain,
          precioBs: precioMain * bcvRate.rate,
          subtotalUSD: subtotalMain,
          subtotalBs: subtotalMain * bcvRate.rate,
          precioUSDDivisa,
          subtotalUSDDivisa
        });

        totalUSD += subtotalMain;
        totalBs += subtotalMain * bcvRate.rate;
        totalUSDDivisa += subtotalUSDDivisa;
      }
      else if (!item.matched && item.suggestedName && item.customPrice) {
        const precioUSD = item.customPrice;
        const precioUSDDivisa = item.customPriceDivisa ?? precioUSD;
        const precioMain = pricingMode === 'divisas' ? precioUSDDivisa : precioUSD;
        const subtotalMain = precioMain * item.quantity;
        const subtotalUSDDivisa = precioUSDDivisa * item.quantity;

        presupuestoItems.push({
          nombre: item.suggestedName,
          cantidad: item.quantity,
          unidad: item.unit || 'kg',
          precioUSD: precioMain,
          precioBs: precioMain * bcvRate.rate,
          subtotalUSD: subtotalMain,
          subtotalBs: subtotalMain * bcvRate.rate,
          precioUSDDivisa,
          subtotalUSDDivisa
        });

        totalUSD += subtotalMain;
        totalBs += subtotalMain * bcvRate.rate;
        totalUSDDivisa += subtotalUSDDivisa;
      }
    }

    if (presupuestoItems.length === 0) {
      return `❌ No encontré productos válidos en el pedido`;
    }

    const description = presupuestoItems.map(i => `${i.nombre} ${i.cantidad}${i.unidad}`).join(', ');

    const presupuestoId = String(Math.floor(10000 + Math.random() * 90000));
    const fechaPresupuesto = result.date ? `${result.date} 12:00:00` : null;
    const fechaSql = fechaPresupuesto ? `'${fechaPresupuesto}'` : `datetime('now', '-4 hours')`;

    await db.prepare(`
      INSERT INTO presupuestos (id, fecha, items, total_usd, total_bs, total_usd_divisa, modo_precio, delivery, hide_rate, estado, source, customer_name)
      VALUES (?, ${fechaSql}, ?, ?, ?, ?, ?, ?, ?, 'pendiente', 'telegram', ?)
    `).bind(
      presupuestoId,
      JSON.stringify(presupuestoItems),
      totalUSD,
      totalBs,
      pricingMode !== 'bcv' ? totalUSDDivisa : null,
      pricingMode,
      result.delivery || 0,
      (hideRate || pricingMode === 'divisas') ? 1 : 0,
      customer.name
    ).run();

    const currencyType = pricingMode === 'divisas' ? 'divisas' : 'dolar_bcv';

    await db.prepare(`
      INSERT INTO customer_transactions
      (customer_id, type, date, description, amount_usd, amount_bs, amount_usd_divisa, currency_type, presupuesto_id, exchange_rate, is_paid)
      VALUES (?, 'purchase', ${fechaSql}, ?, ?, ?, ?, ?, ?, ?, 0)
    `).bind(
      customer.id,
      description,
      totalUSD,
      totalBs,
      pricingMode === 'dual' ? totalUSDDivisa : null,
      currencyType,
      presupuestoId,
      bcvRate.rate
    ).run();

    const balanceQuery = currencyType === 'divisas'
      ? `SELECT COALESCE(SUM(CASE WHEN type='purchase' AND COALESCE(is_paid,0)=0 THEN amount_usd ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN type='payment' THEN amount_usd ELSE 0 END), 0) AS balance FROM customer_transactions WHERE customer_id = ? AND currency_type = 'divisas'`
      : `SELECT COALESCE(SUM(CASE WHEN type='purchase' AND COALESCE(is_paid,0)=0 THEN amount_usd ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN type='payment' THEN amount_usd ELSE 0 END), 0) AS balance FROM customer_transactions WHERE customer_id = ? AND currency_type = 'dolar_bcv'`;
    const balanceResult = await db.prepare(balanceQuery).bind(customer.id).first();
    const newBalance = Number(balanceResult?.balance || 0);

    const curr = currencyType === 'divisas' ? 'DIV' : 'BCV';
    let responseText = `🛒 *Compra registrada*\n\n`;
    responseText += `👤 ${customer.name}\n`;
    if (result.date) {
      responseText += `📅 Fecha: ${result.date}\n`;
    }
    responseText += `📋 Presupuesto #${presupuestoId}\n\n`;

    presupuestoItems.forEach((item: any) => {
      responseText += `• ${item.nombre} x ${item.cantidad}: $${item.subtotalUSD.toFixed(2)}`;
      if (pricingMode === 'dual') {
        responseText += ` / $${item.subtotalUSDDivisa.toFixed(2)}`;
      }
      responseText += '\n';
    });

    responseText += `\n💵 *Total: $${totalUSD.toFixed(2)}* (${curr})`;
    if (pricingMode === 'dual') {
      responseText += ` / DIV: $${totalUSDDivisa.toFixed(2)}`;
    }
    responseText += `\n💼 Balance ${curr}: $${newBalance.toFixed(2)}`;
    const adminUrl = await getAdminPresupuestoUrl(presupuestoId, adminSecret, 'https://rpym.net');
    responseText += `\n\n🔗 ${adminUrl}`;

    return responseText;
  } catch (error) {
    console.error('[Telegram] Error en createCustomerPurchaseWithProducts:', error);
    return `❌ Error: ${error}`;
  }
}
