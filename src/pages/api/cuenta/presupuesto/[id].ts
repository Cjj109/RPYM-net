import type { APIRoute } from 'astro';
import { getD1, type D1Presupuesto } from '../../../../lib/d1-types';

export const prerender = false;

// GET /api/cuenta/presupuesto/:id?token=XXXX
// Public endpoint - validates that the presupuesto belongs to the customer's transactions
export const GET: APIRoute = async ({ params, request, locals }) => {
  const db = getD1(locals);
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: 'Servicio no disponible' }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const presupuestoId = params.id;
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!presupuestoId || !token) {
      return new Response(JSON.stringify({ success: false, error: 'Parametros invalidos' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate token -> get customer
    const customer = await db.prepare(`
      SELECT id FROM customers WHERE share_token = ? AND is_active = 1
    `).bind(token).first<{ id: number }>();

    if (!customer) {
      return new Response(JSON.stringify({ success: false, error: 'Enlace no valido' }), {
        status: 403, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify this customer has a transaction linked to this presupuesto
    const linked = await db.prepare(`
      SELECT id FROM customer_transactions
      WHERE customer_id = ? AND presupuesto_id = ?
      LIMIT 1
    `).bind(customer.id, presupuestoId).first();

    if (!linked) {
      return new Response(JSON.stringify({ success: false, error: 'Presupuesto no encontrado' }), {
        status: 403, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get the presupuesto
    const result = await db.prepare(
      'SELECT * FROM presupuestos WHERE id = ?'
    ).bind(presupuestoId).first<D1Presupuesto>();

    if (!result) {
      return new Response(JSON.stringify({ success: false, error: 'Presupuesto no encontrado' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      presupuesto: {
        id: result.id,
        fecha: result.fecha,
        items: JSON.parse(result.items),
        totalUSD: result.total_usd,
        totalBs: result.total_bs,
        totalUSDDivisa: result.total_usd_divisa,
        estado: result.estado,
        customerName: result.customer_name,
        customerAddress: result.customer_address,
      }
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error loading public presupuesto:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar presupuesto' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
