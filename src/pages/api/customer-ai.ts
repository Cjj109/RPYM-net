import type { APIRoute } from 'astro';
import { getD1 } from '../../lib/d1-types';
import { validateSession, getSessionFromCookie } from '../../lib/auth';

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
}

interface AIRequest {
  text: string;
  customers: CustomerInfo[];
  recentPresupuestos: PresupuestoInfo[];
}

export const POST: APIRoute = async ({ request, locals }) => {
  const db = getD1(locals);
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: 'Database no disponible' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  const sessionId = getSessionFromCookie(request.headers.get('Cookie'));
  if (!sessionId) {
    return new Response(JSON.stringify({ success: false, error: 'No autenticado' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }
  const user = await validateSession(db, sessionId);
  if (!user) {
    return new Response(JSON.stringify({ success: false, error: 'Sesion invalida' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const runtime = (locals as any).runtime;
    const apiKey = runtime?.env?.CLAUDE_API_KEY || import.meta.env.CLAUDE_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({
        success: false, error: 'API key no configurada'
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

    const systemPrompt = `Eres un asistente para un negocio de mariscos en Venezuela. Tu tarea es interpretar instrucciones rapidas del administrador para anotar transacciones de clientes.

CLIENTES REGISTRADOS:
${customerList}

PRESUPUESTOS RECIENTES:
${presupuestoList}

REGLAS DE INTERPRETACION:
- "anota/registra/apunta a [cliente] $X de [descripcion]" = purchase (compra)
- "abona/pago/paga [cliente] $X" = payment (abono)
- "cobra/cobro a [cliente] $X" = purchase (compra)
- Match nombres de clientes de forma fuzzy (ej: "deisy" = "Deisy", "jose" = "Jose Garcia")
- Si un cliente no existe en la lista, devolver customerId: null y el nombre tal como se escribio
- Extraer montos en dolares (ej: "$100", "100 dolares", "100$")
- Tipo de moneda por defecto es dolar_bcv (pago en bolivares a tasa BCV). Solo cambiar si se dice explicitamente: "en divisas/efectivo dolares" = divisas, "en euros" = euro_bcv
- Si se menciona metodo de pago para abonos: "efectivo", "pago movil", "transferencia", "zelle", "tarjeta"
- Puede haber MULTIPLES acciones en un solo texto separadas por comas, puntos o lineas
- La descripcion debe ser concisa (ej: "Mariscos", "Pedido semanal", "Abono cuenta")

PRESUPUESTOS:
- "anotale/registrale/cobrale el presupuesto XXXX a [cliente]" = purchase con presupuestoId
- Cuando se menciona un presupuesto por su ID, buscar en PRESUPUESTOS RECIENTES para obtener el monto correcto
- Si el presupuesto tiene "(DUAL)", usar amountUsd = Total BCV y amountUsdDivisa = Total Divisa, con currencyType = "dolar_bcv"
- Si el presupuesto NO es dual, usar amountUsd = Total BCV y amountUsdDivisa = null
- La descripcion para compras con presupuesto: "Pedido (presupuesto)" o similar
- Si no encuentras el presupuesto en la lista, aun asi crea la accion con el ID del presupuesto y amountUsd = 0 (se autollenara)

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
      "paymentMethod": "efectivo" | "pago_movil" | "transferencia" | "zelle" | "tarjeta" | null
    }
  ],
  "unmatchedCustomers": ["nombres que no se encontraron en la lista"]
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{ role: 'user', content: text }],
        system: systemPrompt
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error de API Claude:', response.status, errorText);
      let errorMessage = 'Error al procesar. Intenta de nuevo.';
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.type === 'rate_limit_error') {
          errorMessage = 'Demasiadas solicitudes. Espera un momento.';
        } else if (errorJson.error?.message) {
          errorMessage = `Error: ${errorJson.error.message}`;
        }
      } catch {}
      return new Response(JSON.stringify({ success: false, error: errorMessage }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    const claudeResponse = await response.json();
    const content = claudeResponse.content[0]?.text || '';

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
