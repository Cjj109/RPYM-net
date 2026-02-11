import type { APIRoute } from 'astro';
import { getR2 } from '../../../../../lib/d1-types';
import { requireAuth } from '../../../../../lib/require-auth';

export const prerender = false;

// PUT /api/customers/:id/transactions/:txId - Update a transaction
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const { id: customerId, txId } = params;
    const body = await request.json();

    // Handle markPaid / markUnpaid
    if (body.markPaid) {
      await db.prepare(`
        UPDATE customer_transactions
        SET is_paid = 1, paid_method = ?, paid_date = ?, notes = COALESCE(?, notes), updated_at = datetime('now')
        WHERE id = ? AND customer_id = ?
      `).bind(
        body.paidMethod || null,
        body.paidDate || new Date().toISOString().split('T')[0],
        body.paidNotes || null,
        txId, customerId
      ).run();

      // Also update linked presupuesto estado to 'pagado'
      const tx = await db.prepare(
        'SELECT presupuesto_id FROM customer_transactions WHERE id = ? AND customer_id = ?'
      ).bind(txId, customerId).first<{ presupuesto_id: string | null }>();
      if (tx?.presupuesto_id) {
        await db.prepare(
          "UPDATE presupuestos SET estado = 'pagado', updated_at = datetime('now') WHERE id = ?"
        ).bind(tx.presupuesto_id).run();
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }

    if (body.markUnpaid) {
      // Get presupuesto_id before unmarking
      const tx = await db.prepare(
        'SELECT presupuesto_id FROM customer_transactions WHERE id = ? AND customer_id = ?'
      ).bind(txId, customerId).first<{ presupuesto_id: string | null }>();

      await db.prepare(`
        UPDATE customer_transactions
        SET is_paid = 0, paid_method = NULL, paid_date = NULL, updated_at = datetime('now')
        WHERE id = ? AND customer_id = ?
      `).bind(txId, customerId).run();

      // Revert linked presupuesto estado to 'pendiente'
      if (tx?.presupuesto_id) {
        await db.prepare(
          "UPDATE presupuestos SET estado = 'pendiente', updated_at = datetime('now') WHERE id = ?"
        ).bind(tx.presupuesto_id).run();
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }

    const { type, date, description, amountUsd, amountBs, amountUsdDivisa, presupuestoId, notes, removeImage, currencyType, paymentMethod, exchangeRate } = body;

    // Handle image removal
    if (removeImage) {
      const tx = await db.prepare(
        'SELECT invoice_image_key FROM customer_transactions WHERE id = ? AND customer_id = ?'
      ).bind(txId, customerId).first<{ invoice_image_key: string | null }>();

      if (tx?.invoice_image_key) {
        const r2 = getR2(locals);
        if (r2) {
          try { await r2.delete(tx.invoice_image_key); } catch (e) { console.error('Error deleting R2 image:', e); }
        }
        await db.prepare(
          "UPDATE customer_transactions SET invoice_image_key = NULL, updated_at = datetime('now') WHERE id = ? AND customer_id = ?"
        ).bind(txId, customerId).run();
      }

      // If removeImage is the only field, return early
      if (type === undefined && date === undefined && description === undefined &&
          amountUsd === undefined && amountBs === undefined && amountUsdDivisa === undefined && presupuestoId === undefined && notes === undefined &&
          currencyType === undefined && paymentMethod === undefined && exchangeRate === undefined) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    if (type !== undefined) {
      if (!['purchase', 'payment'].includes(type)) {
        return new Response(JSON.stringify({ success: false, error: 'Tipo invalido' }), {
          status: 400, headers: { 'Content-Type': 'application/json' }
        });
      }
      fields.push('type = ?'); values.push(type);
    }
    if (date !== undefined) { fields.push('date = ?'); values.push(date); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description.trim()); }
    if (amountUsd !== undefined) { fields.push('amount_usd = ?'); values.push(parseFloat(amountUsd) || 0); }
    if (amountBs !== undefined) { fields.push('amount_bs = ?'); values.push(parseFloat(amountBs) || 0); }
    if (presupuestoId !== undefined) { fields.push('presupuesto_id = ?'); values.push(presupuestoId || null); }
    if (notes !== undefined) { fields.push('notes = ?'); values.push(notes?.trim() || null); }
    if (currencyType !== undefined) {
      const validCurrencyTypes = ['divisas', 'dolar_bcv', 'euro_bcv'];
      if (validCurrencyTypes.includes(currencyType)) {
        fields.push('currency_type = ?'); values.push(currencyType);
      }
    }
    if (amountUsdDivisa !== undefined) { fields.push('amount_usd_divisa = ?'); values.push(amountUsdDivisa ? parseFloat(amountUsdDivisa) : null); }
    if (paymentMethod !== undefined) { fields.push('payment_method = ?'); values.push(paymentMethod || null); }
    if (exchangeRate !== undefined) { fields.push('exchange_rate = ?'); values.push(exchangeRate ? parseFloat(exchangeRate) : null); }

    if (fields.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No hay campos para actualizar' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    fields.push("updated_at = datetime('now')");
    values.push(txId, customerId);

    await db.prepare(`
      UPDATE customer_transactions SET ${fields.join(', ')}
      WHERE id = ? AND customer_id = ?
    `).bind(...values).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating transaction:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al actualizar movimiento' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};

// DELETE /api/customers/:id/transactions/:txId - Delete a transaction
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const { id: customerId, txId } = params;

    // Check if transaction has an image to delete from R2
    const tx = await db.prepare(
      'SELECT invoice_image_key FROM customer_transactions WHERE id = ? AND customer_id = ?'
    ).bind(txId, customerId).first<{ invoice_image_key: string | null }>();

    if (tx?.invoice_image_key) {
      const r2 = getR2(locals);
      if (r2) {
        try {
          await r2.delete(tx.invoice_image_key);
        } catch (e) {
          console.error('Error deleting R2 image:', e);
        }
      }
    }

    await db.prepare(
      'DELETE FROM customer_transactions WHERE id = ? AND customer_id = ?'
    ).bind(txId, customerId).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al eliminar movimiento' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
