import type { APIRoute } from 'astro';
import { requireAuth } from '../../lib/require-auth';
import { getGeminiApiKey } from '../../lib/env';
import { callGeminiWithRetry } from '../../lib/gemini-client';

export const prerender = false;

interface CustomerInfo {
  id: number;
  name: string;
}

interface PresupuestoInfo {
  id: string;
  fecha: string;
  customerName: string;
  totalUSD: number;
  totalUSDDivisa: number | null;
}

interface AIAction {
  customerName: string;
  customerId: number | null;
  type: 'purchase' | 'payment';
  amountUsd: number;
  amountUsdDivisa: number | null;
  description: string;
  presupuestoId: string | null;
  currencyType: 'divisas' | 'dolar_bcv' | 'euro_bcv';
  paymentMethod: string | null;
  date: string | null; // YYYY-MM-DD format, null = today
}

interface AIRequest {
  text: string;
  customers: CustomerInfo[];
  recentPresupuestos: PresupuestoInfo[];
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

    const body: AIRequest = await request.json();
    const { text, customers, recentPresupuestos } = body;

    if (!text || !text.trim()) {
      return new Response(JSON.stringify({
        success: false, error: 'Texto no proporcionado'
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const customerList = customers.map(c => `- ID: ${c.id} | Nombre: "${c.name}"`).join('\n');

    const presupuestoList = recentPresupuestos.length > 0
      ? recentPresupuestos.map(p => `- ID: ${p.id} | Fecha: ${p.fecha} | Cliente: ${p.customerName || 'Sin nombre'} | Total BCV: $${p.totalUSD.toFixed(2)}${p.totalUSDDivisa ? ` | Total Divisa: $${p.totalUSDDivisa.toFixed(2)} (DUAL)` : ''}`).join('\n')
      : '(No hay presupuestos recientes)';

    // Get current date info for date parsing
    const now = new Date();
    const todayISO = now.toISOString().split('T')[0];
    const dayOfWeek = now.getDay(); // 0=Sunday, 1=Monday, ...
    const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const todayName = dayNames[dayOfWeek];

    const systemPrompt = `Eres un asistente para un negocio de mariscos en Venezuela. Tu tarea es interpretar instrucciones rapidas del administrador para anotar transacciones de clientes.

FECHA ACTUAL: ${todayISO} (${todayName})

CLIENTES REGISTRADOS:
${customerList}

PRESUPUESTOS RECIENTES:
${presupuestoList}

REGLAS IMPORTANTES SOBRE TIPOS DE TRANSACCION:
1. DIVISAS (USD efectivo): Cuando el usuario dice "en divisas", "USD efectivo", "dolares cash", etc.
   - currencyType: "divisas"
   - amountUsd: el monto
   - amountUsdDivisa: null (SIEMPRE null para divisas simples)

2. BCV (pago en bolivares a tasa BCV): Es el valor por defecto, o cuando dice "a BCV", "en bolivares", etc.
   - currencyType: "dolar_bcv"
   - amountUsd: el monto
   - amountUsdDivisa: null (SIEMPRE null para BCV simple)

3. DUAL: SOLO cuando se asigna un presupuesto que ya es dual (tiene Total Divisa en la lista)
   - currencyType: "dolar_bcv"
   - amountUsd: Total BCV del presupuesto
   - amountUsdDivisa: Total Divisa del presupuesto (NO el mismo valor que amountUsd)

IMPORTANTE: amountUsdDivisa SOLO debe tener valor cuando se asigna un PRESUPUESTO DUAL de la lista.
Para transacciones manuales (sin presupuesto), amountUsdDivisa debe ser SIEMPRE null.

REGLAS DE INTERPRETACION:
- "anota/registra/apunta a [cliente] $X de [descripcion]" = purchase (compra)
- "abona/pago/paga [cliente] $X" = payment (abono)
- "cobra/cobro a [cliente] $X" = purchase (compra)
- Match nombres de clientes de forma fuzzy (ej: "deisy" = "Deisy", "jose" = "Jose Garcia")
- Si un cliente no existe en la lista, devolver customerId: null y el nombre tal como se escribio
- Extraer montos en dolares (ej: "$100", "100 dolares", "100$")
- Puede haber MULTIPLES acciones en un solo texto separadas por comas, puntos o lineas
- La descripcion debe ser concisa (ej: "Calamar", "Pedido", "Abono cuenta")

METODOS DE PAGO Y SU MONEDA (MUY IMPORTANTE):
- zelle, usdt, paypal, binance, cripto → currencyType: "divisas" (son pagos en USD)
- tarjeta, pago_movil, transferencia, debito → currencyType: "dolar_bcv" (son pagos en Bs)
- efectivo → depende del contexto:
  * "efectivo en divisas" / "USD efectivo" / "dolares cash" → divisas
  * "efectivo" solo, sin especificar → dolar_bcv (default)
- Si el usuario dice explicitamente "en divisas" o "a BCV", usar eso independiente del metodo

FECHAS:
- Por defecto, date = null (significa hoy)
- Si el usuario menciona una fecha pasada, calcular la fecha exacta en formato YYYY-MM-DD
- Ejemplos:
  * "ayer" = fecha de ayer
  * "el lunes" / "el martes" = el ultimo dia de la semana mencionado (hacia atras)
  * "hace 2 dias" / "hace 3 dias" = restar esos dias a hoy
  * "el 15" / "el 20 de enero" = usar esa fecha del mes actual o anterior
  * "antier" / "anteayer" = hace 2 dias
- Si no se menciona fecha, usar date: null

PRESUPUESTOS:
- "anotale/registrale/cobrale el presupuesto XXXX a [cliente]" = purchase con presupuestoId
- Buscar en PRESUPUESTOS RECIENTES para obtener el monto
- Si el presupuesto tiene "(DUAL)", usar los DOS montos diferentes
- Si no es dual, usar SOLO amountUsd y amountUsdDivisa = null
- Si no encuentras el presupuesto en la lista, crear accion con amountUsd = 0 (se autollenara)

Responde SOLO con un JSON valido:
{
  "actions": [
    {
      "customerName": "nombre del cliente como aparece en la lista",
      "customerId": numero o null,
      "type": "purchase" | "payment",
      "amountUsd": numero,
      "amountUsdDivisa": numero o null,
      "description": "descripcion corta",
      "presupuestoId": "id" o null,
      "currencyType": "divisas" | "dolar_bcv" | "euro_bcv",
      "paymentMethod": "efectivo" | "pago_movil" | "transferencia" | "zelle" | "tarjeta" | null,
      "date": "YYYY-MM-DD" o null
    }
  ],
  "unmatchedCustomers": ["nombres que no se encontraron en la lista"]
}`;

    const geminiResult = await callGeminiWithRetry({
      systemPrompt,
      userMessage: text,
      apiKey,
      temperature: 0.1,
      maxOutputTokens: 1024,
      jsonMode: true,
    });

    if (!geminiResult.success) {
      console.error('Error de API Gemini:', geminiResult.error);
      return new Response(JSON.stringify({ success: false, error: 'Error al procesar. Intenta de nuevo.' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    const content = geminiResult.content;

    let parsedResult;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found');
      }
    } catch {
      console.error('Error parsing AI response:', content);
      return new Response(JSON.stringify({
        success: false, error: 'Error interpretando la respuesta. Reformula tu texto.'
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: true,
      actions: parsedResult.actions || [],
      unmatchedCustomers: parsedResult.unmatchedCustomers || []
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error en customer-ai:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error interno del servidor' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
