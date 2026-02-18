import type { APIRoute } from 'astro';
import { requireBot2Auth } from '../../../../lib/require-bot2-auth';

export const prerender = false;

/** Patrones de pago de un cliente — read-only para Bot 2 */
export const GET: APIRoute = async ({ request, params, locals }) => {
  const auth = requireBot2Auth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  const { customerId } = params;
  if (!customerId) {
    return new Response(JSON.stringify({ success: false, error: 'customerId requerido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Datos del cliente
    const customer = await db.prepare(
      'SELECT id, name, phone, notes, rate_type, created_at FROM customers WHERE id = ? AND is_active = 1'
    ).bind(customerId).first();

    if (!customer) {
      return new Response(JSON.stringify({ success: false, error: 'Cliente no encontrado' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Transacciones con calculo de dias hasta pago (excluye cruzadas)
    const transactions = await db.prepare(`
      SELECT
        id,
        type,
        date,
        description,
        amount_usd,
        amount_bs,
        amount_usd_divisa,
        currency_type,
        payment_method,
        is_paid,
        paid_date,
        paid_method,
        presupuesto_id,
        is_crossed,
        created_at,
        CASE WHEN paid_date IS NOT NULL AND type = 'purchase'
          THEN CAST(julianday(paid_date) - julianday(date) AS INTEGER)
          ELSE NULL
        END AS days_to_pay
      FROM customer_transactions
      WHERE customer_id = ? AND is_crossed = 0
      ORDER BY date DESC
      LIMIT 100
    `).bind(customerId).all();

    // Calcular estadisticas de patron
    const purchases = transactions.results.filter((t: any) => t.type === 'purchase');
    const payments = transactions.results.filter((t: any) => t.type === 'payment');
    const paidPurchases = purchases.filter((t: any) => t.days_to_pay !== null);

    const unpaidPurchases = purchases.filter((t: any) => t.is_paid === 0 || t.is_paid === null);
    const totalUnpaidUSD = unpaidPurchases.reduce((sum: number, t: any) => sum + (t.amount_usd || 0), 0);

    const avgDaysToPay = paidPurchases.length > 0
      ? Math.round(paidPurchases.reduce((sum: number, t: any) => sum + t.days_to_pay, 0) / paidPurchases.length)
      : null;

    // Frecuencia de compra (dias entre compras)
    let avgDaysBetweenPurchases: number | null = null;
    if (purchases.length >= 2) {
      const purchaseDates = purchases.map((t: any) => new Date(t.date).getTime()).sort((a: number, b: number) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < purchaseDates.length; i++) {
        gaps.push(Math.round((purchaseDates[i] - purchaseDates[i - 1]) / (1000 * 60 * 60 * 24)));
      }
      avgDaysBetweenPurchases = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    }

    return new Response(JSON.stringify({
      success: true,
      customer,
      stats: {
        totalPurchases: purchases.length,
        totalPayments: payments.length,
        unpaidPurchases: unpaidPurchases.length,
        totalUnpaidUSD: Math.round(totalUnpaidUSD * 100) / 100,
        avgDaysToPay,
        avgDaysBetweenPurchases,
        lastPurchaseDate: purchases[0]?.date || null,
        lastPaymentDate: payments[0]?.date || null
      },
      transactions: transactions.results
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[Bot2 Patterns] Error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al analizar patrones de pago' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
