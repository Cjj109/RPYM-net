import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';
import type { D1CustomerTransaction } from '../../../../lib/customer-types';
import { transformTransaction } from '../../../../lib/customer-types';

export const prerender = false;

// GET /api/customers/:id/transactions - List transactions for a customer
export const GET: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const customerId = params.id;

    const results = await db.prepare(`
      SELECT * FROM customer_transactions
      WHERE customer_id = ?
      ORDER BY date DESC, created_at DESC, id DESC
    `).bind(customerId).all<D1CustomerTransaction>();

    return new Response(JSON.stringify({
      success: true,
      transactions: results.results.map(transformTransaction)
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error listing transactions:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar movimientos' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};

// POST /api/customers/:id/transactions - Create a new transaction
export const POST: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const customerId = params.id;
    const body = await request.json();
    const { type, date, description, amountUsd, amountBs, amountUsdDivisa, presupuestoId, notes, currencyType, paymentMethod, exchangeRate } = body;

    // Validate required fields
    if (!type || !['purchase', 'payment'].includes(type)) {
      return new Response(JSON.stringify({ success: false, error: 'Tipo invalido (purchase o payment)' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }
    if (!date) {
      return new Response(JSON.stringify({ success: false, error: 'La fecha es requerida' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }
    if (!description || !description.trim()) {
      return new Response(JSON.stringify({ success: false, error: 'La descripcion es requerida' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const usd = parseFloat(amountUsd) || 0;
    const bs = parseFloat(amountBs) || 0;
    if (usd <= 0 && bs <= 0) {
      return new Response(JSON.stringify({ success: false, error: 'Al menos un monto debe ser mayor a 0' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate currency_type
    const validCurrencyTypes = ['divisas', 'dolar_bcv', 'euro_bcv'];
    const ct = currencyType && validCurrencyTypes.includes(currencyType) ? currencyType : 'divisas';

    // Validate payment_method (only for payments)
    const validPaymentMethods = ['efectivo', 'tarjeta', 'pago_movil', 'transferencia', 'zelle'];
    const pm = type === 'payment' && paymentMethod && validPaymentMethods.includes(paymentMethod) ? paymentMethod : null;

    const er = exchangeRate ? parseFloat(exchangeRate) : null;

    // Verify customer exists
    const customer = await db.prepare('SELECT id FROM customers WHERE id = ?').bind(customerId).first();
    if (!customer) {
      return new Response(JSON.stringify({ success: false, error: 'Cliente no encontrado' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }

    const usdDiv = amountUsdDivisa ? parseFloat(amountUsdDivisa) : null;

    const result = await db.prepare(`
      INSERT INTO customer_transactions (customer_id, type, date, description, amount_usd, amount_bs, amount_usd_divisa, presupuesto_id, notes, currency_type, payment_method, exchange_rate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      customerId,
      type,
      date,
      description.trim(),
      usd,
      bs,
      usdDiv,
      presupuestoId || null,
      notes?.trim() || null,
      ct,
      pm,
      er
    ).run();

    return new Response(JSON.stringify({
      success: true,
      id: result.meta.last_row_id
    }), {
      status: 201, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error creating transaction:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al crear movimiento' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
