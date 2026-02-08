import type { APIRoute } from 'astro';
import { getD1 } from '../../../lib/d1-types';
import type { D1CustomerTransaction } from '../../../lib/customer-types';

export const prerender = false;

interface D1CustomerPublic {
  id: number;
  name: string;
  rate_type: string;
}

// GET /api/cuenta/:token - Public endpoint (no auth) - Get customer balance and transactions
export const GET: APIRoute = async ({ params, locals }) => {
  const db = getD1(locals);
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: 'Servicio no disponible' }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const token = params.token;
    if (!token) {
      return new Response(JSON.stringify({ success: false, error: 'Token invalido' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Find customer by share token
    const customer = await db.prepare(`
      SELECT id, name, rate_type FROM customers
      WHERE share_token = ? AND is_active = 1
    `).bind(token).first<D1CustomerPublic>();

    if (!customer) {
      return new Response(JSON.stringify({ success: false, error: 'Enlace no valido o expirado' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get balance per currency type
    // balance_divisas: pure divisas only (frontend handles dual view toggle)
    // balance_bcv: all dolar_bcv including dual transactions
    const balance = await db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type='purchase' AND currency_type='divisas' AND COALESCE(is_paid,0)=0 THEN amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN type='payment' AND currency_type='divisas' THEN amount_usd ELSE 0 END), 0) AS balance_divisas,
        COALESCE(SUM(CASE WHEN type='purchase' AND currency_type='dolar_bcv' AND COALESCE(is_paid,0)=0 THEN amount_usd ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type='payment' AND currency_type='dolar_bcv' THEN amount_usd ELSE 0 END), 0) AS balance_bcv,
        COALESCE(SUM(CASE WHEN type='purchase' AND currency_type='euro_bcv' AND COALESCE(is_paid,0)=0 THEN amount_usd ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type='payment' AND currency_type='euro_bcv' THEN amount_usd ELSE 0 END), 0) AS balance_euro
      FROM customer_transactions
      WHERE customer_id = ?
    `).bind(customer.id).first<{ balance_divisas: number; balance_bcv: number; balance_euro: number }>();

    // Get transactions
    const transactions = await db.prepare(`
      SELECT id, type, date, description, amount_usd, amount_bs, amount_usd_divisa, presupuesto_id, invoice_image_key, currency_type, payment_method, exchange_rate, is_paid, paid_method, paid_date, notes, created_at
      FROM customer_transactions
      WHERE customer_id = ?
      ORDER BY date DESC, id DESC
    `).bind(customer.id).all<{
      id: number;
      type: string;
      date: string;
      description: string;
      amount_usd: number;
      amount_bs: number;
      amount_usd_divisa: number | null;
      presupuesto_id: string | null;
      invoice_image_key: string | null;
      currency_type: string;
      payment_method: string | null;
      exchange_rate: number | null;
      is_paid: number;
      paid_method: string | null;
      paid_date: string | null;
      notes: string | null;
      created_at: string;
    }>();

    return new Response(JSON.stringify({
      success: true,
      customer: {
        name: customer.name,
        rateType: customer.rate_type,
        balanceDivisas: balance?.balance_divisas || 0,
        balanceBcv: balance?.balance_bcv || 0,
        balanceEuro: balance?.balance_euro || 0,
      },
      transactions: transactions.results.map(t => ({
        id: t.id,
        type: t.type,
        date: t.date,
        description: t.description,
        amountUsd: t.amount_usd,
        amountBs: t.amount_bs,
        amountUsdDivisa: t.amount_usd_divisa,
        presupuestoId: t.presupuesto_id,
        invoiceImageUrl: t.invoice_image_key ? `/api/cuenta/invoice/${t.invoice_image_key}?token=${token}` : null,
        currencyType: t.currency_type,
        paymentMethod: t.payment_method,
        exchangeRate: t.exchange_rate,
        isPaid: t.is_paid === 1,
        paidMethod: t.paid_method,
        paidDate: t.paid_date,
        notes: t.notes,
        createdAt: t.created_at,
      }))
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error loading public cuenta:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar datos' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
