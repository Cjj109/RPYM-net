/**
 * RPYM - Telegram handlers para clientes
 * Handlers que devuelven mensajes formateados para Telegram
 */

import type { D1Database } from '../../d1-types';
import { findCustomerByName, findCustomerSuggestions } from '../../repositories/customers';
import { getBCVRate } from '../../sheets';
import type { CustomerAction } from '../../telegram-ai';

const PAYMENT_METHOD_NAMES: Record<string, string> = {
  pago_movil: 'Pago Móvil',
  transferencia: 'Transferencia',
  zelle: 'Zelle',
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  usdt: 'USDT',
  binance: 'Binance',
};

export async function getCustomersList(db: D1Database | null): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const customers = await db.prepare(`
      SELECT c.id, c.name,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='divisas' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='divisas' THEN t.amount_usd ELSE 0 END), 0) AS balance_divisas,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='dolar_bcv' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='dolar_bcv' THEN t.amount_usd ELSE 0 END), 0) AS balance_bcv
      FROM customers c
      LEFT JOIN customer_transactions t ON t.customer_id = c.id
      WHERE c.is_active = 1
      GROUP BY c.id ORDER BY c.name LIMIT 50
    `).all<{ id: number; name: string; balance_divisas: number; balance_bcv: number }>();
    if (!customers.results?.length) return '📋 No hay clientes registrados';
    let text = `👥 *Clientes RPYM*\n\n`;
    for (const c of customers.results) {
      const bal = [];
      if (c.balance_divisas !== 0) bal.push(`DIV: $${Number(c.balance_divisas).toFixed(2)}`);
      if (c.balance_bcv !== 0) bal.push(`BCV: $${Number(c.balance_bcv).toFixed(2)}`);
      text += `• ${c.name}${bal.length ? ` (${bal.join(', ')})` : ''}\n`;
    }
    return text;
  } catch (error) {
    console.error('[Telegram] Error en getCustomersList:', error);
    return '❌ Error al obtener clientes';
  }
}

async function notFoundWithSuggestions(db: D1Database | null, customerName: string): Promise<string> {
  if (!db) return `❌ No encontré cliente "${customerName}"`;
  const suggestions = await findCustomerSuggestions(db, customerName, 5);
  let msg = `❌ No encontré cliente "${customerName}"`;
  if (suggestions.length > 0) {
    msg += `\n\n💡 _¿Quisiste decir?_\n` + suggestions.map(s => `• ${s.name}`).join('\n');
  }
  return msg;
}

export async function getCustomerBalance(db: D1Database | null, customerName: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const foundCustomer = await findCustomerByName(db, customerName);
    if (!foundCustomer) return await notFoundWithSuggestions(db, customerName);

    const customer = await db.prepare(`
      SELECT c.id, c.name, c.phone,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='divisas' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='divisas' THEN t.amount_usd ELSE 0 END), 0) AS balance_divisas_puro,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='dolar_bcv' AND COALESCE(t.is_paid,0)=0 AND t.amount_usd_divisa IS NULL THEN t.amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='dolar_bcv' AND t.amount_usd_divisa IS NULL THEN t.amount_usd ELSE 0 END), 0) AS balance_bcv_puro,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='dolar_bcv' AND COALESCE(t.is_paid,0)=0 AND t.amount_usd_divisa IS NOT NULL THEN t.amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='dolar_bcv' AND t.amount_usd_divisa IS NOT NULL THEN t.amount_usd ELSE 0 END), 0) AS balance_dual_bcv,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='dolar_bcv' AND COALESCE(t.is_paid,0)=0 AND t.amount_usd_divisa IS NOT NULL THEN t.amount_usd_divisa ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='dolar_bcv' AND t.amount_usd_divisa IS NOT NULL THEN t.amount_usd_divisa ELSE 0 END), 0) AS balance_dual_divisa,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='euro_bcv' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='euro_bcv' THEN t.amount_usd ELSE 0 END), 0) AS balance_euro
      FROM customers c
      LEFT JOIN customer_transactions t ON t.customer_id = c.id
      WHERE c.id = ?
      GROUP BY c.id
    `).bind(foundCustomer.id).first<{
      id: number; name: string; phone: string | null;
      balance_divisas_puro: number; balance_bcv_puro: number;
      balance_dual_bcv: number; balance_dual_divisa: number; balance_euro: number;
    }>();

    const divisasPuro = Number(customer?.balance_divisas_puro || 0);
    const bcvPuro = Number(customer?.balance_bcv_puro || 0);
    const dualBcv = Number(customer?.balance_dual_bcv || 0);
    const dualDivisa = Number(customer?.balance_dual_divisa || 0);
    const euro = Number(customer?.balance_euro || 0);

    let text = `👤 *${customer!.name}*\n\n`;
    if (dualBcv !== 0 || dualDivisa !== 0) {
      text += `💰 *Dual:* $${dualBcv.toFixed(2)} (BCV) ó $${dualDivisa.toFixed(2)} (Divisas)\n`;
    }
    if (divisasPuro !== 0) text += `💵 Divisas: $${divisasPuro.toFixed(2)}\n`;
    if (bcvPuro !== 0) text += `📊 BCV: $${bcvPuro.toFixed(2)}\n`;
    if (euro !== 0) text += `💶 Euro: €${euro.toFixed(2)}\n`;
    if (dualBcv === 0 && dualDivisa === 0 && divisasPuro === 0 && bcvPuro === 0 && euro === 0) {
      text += `✅ Sin saldo pendiente\n`;
    }
    if (customer!.phone) text += `📱 ${customer!.phone}\n`;

    const presupuestos = await db.prepare(`
      SELECT DISTINCT p.id, p.fecha, p.total_usd, p.total_usd_divisa, p.estado
      FROM presupuestos p
      LEFT JOIN customer_transactions ct ON ct.presupuesto_id = p.id AND ct.customer_id = ?
      WHERE LOWER(p.customer_name) LIKE ? OR ct.customer_id IS NOT NULL
      ORDER BY p.fecha DESC LIMIT 5
    `).bind(foundCustomer.id, `%${foundCustomer.name.toLowerCase()}%`).all();

    if (presupuestos.results?.length) {
      text += `\n📋 *Presupuestos recientes:*\n`;
      for (const p of presupuestos.results as { id: string; fecha: string; total_usd: number; total_usd_divisa: number | null; estado: string }[]) {
        const fecha = new Date(p.fecha).toLocaleDateString('es-VE');
        const estado = p.estado === 'pagado' ? '✅' : '⏳';
        const dual = p.total_usd_divisa ? ` / $${Number(p.total_usd_divisa).toFixed(2)}` : '';
        text += `${estado} #${p.id} - $${Number(p.total_usd).toFixed(2)}${dual} (${fecha})\n`;
      }
      text += `\n💡 _"marca [ID] pagado" o "movimientos de ${customer!.name}"_`;
    }
    return text;
  } catch (error) {
    console.error('[Telegram] Error en getCustomerBalance:', error);
    return '❌ Error al buscar cliente';
  }
}

interface TxRow {
  id: number;
  date: string;
  type: string;
  description: string;
  amount_usd: number;
  amount_usd_divisa: number | null;
  currency_type: string;
  is_paid: number;
  presupuesto_id: string | null;
  modo_precio: string | null;
  payment_method: string | null;
}

export async function getCustomerMovements(db: D1Database | null, customerName: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const customer = await findCustomerByName(db, customerName);
    if (!customer) return await notFoundWithSuggestions(db, customerName);

    const transactions = await db.prepare(`
      SELECT t.*, p.modo_precio, p.total_usd_divisa as presupuesto_total_divisa
      FROM customer_transactions t
      LEFT JOIN presupuestos p ON t.presupuesto_id = p.id
      WHERE t.customer_id = ?
      ORDER BY t.date DESC, t.created_at DESC, t.id DESC
      LIMIT 20
    `).bind(customer.id).all();

    if (!transactions?.results?.length) {
      return `👤 *${customer.name}*\n\n📋 No hay movimientos registrados`;
    }

    const balances = await db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type='purchase' AND currency_type='divisas' AND COALESCE(is_paid,0)=0 THEN amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN type='payment' AND currency_type='divisas' THEN amount_usd ELSE 0 END), 0) AS balance_divisas_puro,
        COALESCE(SUM(CASE WHEN type='purchase' AND currency_type='dolar_bcv' AND COALESCE(is_paid,0)=0 AND amount_usd_divisa IS NULL THEN amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN type='payment' AND currency_type='dolar_bcv' AND amount_usd_divisa IS NULL THEN amount_usd ELSE 0 END), 0) AS balance_bcv_puro,
        COALESCE(SUM(CASE WHEN type='purchase' AND currency_type='dolar_bcv' AND COALESCE(is_paid,0)=0 AND amount_usd_divisa IS NOT NULL THEN amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN type='payment' AND currency_type='dolar_bcv' AND amount_usd_divisa IS NOT NULL THEN amount_usd ELSE 0 END), 0) AS balance_dual_bcv,
        COALESCE(SUM(CASE WHEN type='purchase' AND currency_type='dolar_bcv' AND COALESCE(is_paid,0)=0 AND amount_usd_divisa IS NOT NULL THEN amount_usd_divisa ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN type='payment' AND currency_type='dolar_bcv' AND amount_usd_divisa IS NOT NULL THEN amount_usd_divisa ELSE 0 END), 0) AS balance_dual_divisa
      FROM customer_transactions WHERE customer_id = ?
    `).bind(customer.id).first();

    const divisasPuro = Number(balances?.balance_divisas_puro || 0);
    const bcvPuro = Number(balances?.balance_bcv_puro || 0);
    const dualBcv = Number(balances?.balance_dual_bcv || 0);
    const dualDivisa = Number(balances?.balance_dual_divisa || 0);

    let text = `👤 *${customer.name}*\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    const hasBalance = divisasPuro !== 0 || bcvPuro !== 0 || dualBcv !== 0 || dualDivisa !== 0;
    if (hasBalance) {
      text += `📊 *Balance actual:*\n`;
      if (dualBcv !== 0 || dualDivisa !== 0) {
        text += `   💰 Dual: $${dualBcv.toFixed(2)} (BCV) ó $${dualDivisa.toFixed(2)} (DIV)\n`;
      }
      if (divisasPuro !== 0) text += `   💵 DIV: $${divisasPuro.toFixed(2)}\n`;
      if (bcvPuro !== 0) text += `   📊 BCV: $${bcvPuro.toFixed(2)}\n`;
      text += `\n`;
    }
    text += `📋 *Movimientos:*\n`;

    const byDate = new Map<string, TxRow[]>();
    for (const t of transactions.results as TxRow[]) {
      const dateStr = t.date ? t.date.split(' ')[0] : 'Sin fecha';
      if (!byDate.has(dateStr)) byDate.set(dateStr, []);
      byDate.get(dateStr)!.push(t);
    }

    for (const [dateStr, txs] of byDate) {
      const date = new Date(dateStr);
      const fechaFormateada = date.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' });
      text += `\n📅 *${fechaFormateada}*\n`;
      for (const t of txs) {
        const isPurchase = t.type === 'purchase';
        const isPaid = t.is_paid === 1;
        const isDual = t.modo_precio === 'dual' && t.amount_usd_divisa;
        let emoji = isPurchase ? '🛒' : '💰';
        if (isPurchase && isPaid) emoji = '✅';
        let desc = t.description || (isPurchase ? 'Compra' : 'Abono');
        if (desc.length > 30) desc = desc.substring(0, 27) + '...';
        let montoStr = '';
        if (isDual) {
          montoStr = `💰 $${Number(t.amount_usd).toFixed(2)} (BCV) ó $${Number(t.amount_usd_divisa).toFixed(2)} (DIV)`;
        } else {
          const currLabel = t.currency_type === 'divisas' ? 'DIV' : 'BCV';
          montoStr = `$${Number(t.amount_usd).toFixed(2)} (${currLabel})`;
        }
        let estadoStr = '';
        if (isPurchase) {
          estadoStr = isPaid ? (t.payment_method ? ` - ${PAYMENT_METHOD_NAMES[t.payment_method] || t.payment_method}` : ' - Pagado') : ' - Pendiente';
        }
        const presRef = t.presupuesto_id ? ` #${t.presupuesto_id}` : '';
        text += `${emoji} ${desc}${presRef} _(ID: ${t.id})_\n`;
        text += `   ${montoStr}${estadoStr}\n`;
      }
    }

    const totalCompras = transactions.results.filter((t: TxRow) => t.type === 'purchase').length;
    const totalAbonos = transactions.results.filter((t: TxRow) => t.type === 'payment').length;
    text += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📈 ${totalCompras} compra${totalCompras !== 1 ? 's' : ''}, ${totalAbonos} abono${totalAbonos !== 1 ? 's' : ''}`;
    text += `\n\n💡 _"marca [ID] pagado" o "borra movimiento [ID]"_`;
    return text;
  } catch (error) {
    console.error('[Telegram] Error en getCustomerMovements:', error);
    return '❌ Error al obtener movimientos';
  }
}

export async function markTransactionPaid(
  db: D1Database | null,
  customerName: string,
  txId: string,
  metodo?: string
): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const customer = await findCustomerByName(db, customerName);
    if (!customer) return await notFoundWithSuggestions(db, customerName);

    const tx = await db.prepare(
      'SELECT id, presupuesto_id FROM customer_transactions WHERE id = ? AND customer_id = ?'
    ).bind(txId, customer.id).first<{ id: number; presupuesto_id: string | null }>();

    if (!tx) return `❌ No encontré movimiento #${txId} de ${customerName}`;

    const paymentMethod = metodo || null;
    const paidDate = new Date().toISOString().split('T')[0];

    await db.prepare(`
      UPDATE customer_transactions
      SET is_paid = 1, paid_method = ?, paid_date = ?, updated_at = datetime('now')
      WHERE id = ? AND customer_id = ?
    `).bind(paymentMethod, paidDate, txId, customer.id).run();

    if (tx.presupuesto_id) {
      await db.prepare(
        "UPDATE presupuestos SET estado = 'pagado', updated_at = datetime('now') WHERE id = ?"
      ).bind(tx.presupuesto_id).run();
    }

    const metodoStr = paymentMethod ? ` (${PAYMENT_METHOD_NAMES[paymentMethod] || paymentMethod})` : '';
    return `✅ *Movimiento #${txId}* marcado como *PAGADO*${metodoStr}\n👤 ${customer.name}`;
  } catch (error) {
    console.error('[Telegram] Error en markTransactionPaid:', error);
    return `❌ Error: ${error}`;
  }
}

export async function markTransactionUnpaid(
  db: D1Database | null,
  customerName: string,
  txId: string
): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const customer = await findCustomerByName(db, customerName);
    if (!customer) return await notFoundWithSuggestions(db, customerName);

    const tx = await db.prepare(
      'SELECT presupuesto_id FROM customer_transactions WHERE id = ? AND customer_id = ?'
    ).bind(txId, customer.id).first<{ presupuesto_id: string | null }>();

    if (!tx) return `❌ No encontré movimiento #${txId} de ${customerName}`;

    await db.prepare(`
      UPDATE customer_transactions
      SET is_paid = 0, paid_method = NULL, paid_date = NULL, updated_at = datetime('now')
      WHERE id = ? AND customer_id = ?
    `).bind(txId, customer.id).run();

    if (tx.presupuesto_id) {
      await db.prepare(
        "UPDATE presupuestos SET estado = 'pendiente', updated_at = datetime('now') WHERE id = ?"
      ).bind(tx.presupuesto_id).run();
    }

    return `✅ *Movimiento #${txId}* marcado como *PENDIENTE*\n👤 ${customer.name}`;
  } catch (error) {
    console.error('[Telegram] Error en markTransactionUnpaid:', error);
    return `❌ Error: ${error}`;
  }
}

export async function deleteTransaction(
  db: D1Database | null,
  customerName: string,
  txId: string
): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const customer = await findCustomerByName(db, customerName);
    if (!customer) return await notFoundWithSuggestions(db, customerName);

    const tx = await db.prepare(
      'SELECT id, type, description, amount_usd FROM customer_transactions WHERE id = ? AND customer_id = ?'
    ).bind(txId, customer.id).first<{ id: number; type: string; description: string; amount_usd: number }>();

    if (!tx) return `❌ No encontré movimiento #${txId} de ${customerName}`;

    await db.prepare('DELETE FROM customer_transactions WHERE id = ? AND customer_id = ?')
      .bind(txId, customer.id).run();

    const tipo = tx.type === 'purchase' ? 'Compra' : 'Abono';
    return `🗑️ *Movimiento #${txId} eliminado*\n\n👤 ${customer.name}\n${tipo}: $${Number(tx.amount_usd).toFixed(2)}`;
  } catch (error) {
    console.error('[Telegram] Error en deleteTransaction:', error);
    return `❌ Error: ${error}`;
  }
}

export async function deleteCustomer(db: D1Database | null, customerName: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const customer = await findCustomerByName(db, customerName);
    if (!customer) return await notFoundWithSuggestions(db, customerName);

    await db.prepare('UPDATE customers SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(customer.id).run();

    return `🗑️ *Cliente "${customer.name}" desactivado*`;
  } catch (error) {
    console.error('[Telegram] Error en deleteCustomer:', error);
    return `❌ Error: ${error}`;
  }
}

export async function updateCustomer(
  db: D1Database | null,
  customerName: string,
  updates: { nombre?: string; notes?: string }
): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const customer = await findCustomerByName(db, customerName);
    if (!customer) return await notFoundWithSuggestions(db, customerName);

    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.nombre !== undefined && updates.nombre.trim()) {
      fields.push('name = ?');
      values.push(updates.nombre.trim());
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?');
      values.push(updates.notes?.trim() || null);
    }
    if (fields.length === 0) return '❓ No hay cambios que aplicar';

    fields.push("updated_at = datetime('now')");
    values.push(customer.id);

    await db.prepare(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

    const changes: string[] = [];
    if (updates.nombre) changes.push(`nombre: ${updates.nombre}`);
    if (updates.notes !== undefined) changes.push(`notas: ${updates.notes || '(vacío)'}`);
    return `✅ *Cliente actualizado*\n\n👤 ${customer.name}\n📝 ${changes.join(', ')}`;
  } catch (error) {
    console.error('[Telegram] Error en updateCustomer:', error);
    return `❌ Error: ${error}`;
  }
}

function generateShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function generateShareLink(
  db: D1Database | null,
  customerName: string,
  baseUrl: string = 'https://rpym.net'
): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const customer = await findCustomerByName(db, customerName);
    if (!customer) return await notFoundWithSuggestions(db, customerName);

    const token = generateShareToken();
    await db.prepare('UPDATE customers SET share_token = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(token, customer.id).run();

    const url = `${baseUrl.replace(/\/$/, '')}/cuenta/${token}`;
    return `📤 *Link generado*\n\n👤 ${customer.name}\n🔗 ${url}\n\n_Envía este link al cliente para que vea su cuenta._`;
  } catch (error) {
    console.error('[Telegram] Error en generateShareLink:', error);
    return `❌ Error: ${error}`;
  }
}

export async function revokeShareLink(db: D1Database | null, customerName: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const customer = await findCustomerByName(db, customerName);
    if (!customer) return await notFoundWithSuggestions(db, customerName);

    await db.prepare('UPDATE customers SET share_token = NULL, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(customer.id).run();

    return `🔒 *Link revocado*\n\n👤 ${customer.name}\n\nEl cliente ya no podrá ver su cuenta con el enlace anterior.`;
  } catch (error) {
    console.error('[Telegram] Error en revokeShareLink:', error);
    return `❌ Error: ${error}`;
  }
}

export async function executeCustomerAction(db: D1Database | null, action: CustomerAction): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const customer = await findCustomerByName(db, action.customerName);
    if (!customer) return await notFoundWithSuggestions(db, action.customerName);

    const bcvRate = await getBCVRate(db);
    const amountBs = action.currencyType === 'divisas' ? 0 : action.amountUsd * bcvRate.rate;

    // Calculate Venezuela date (UTC-4) for consistent date storage
    let txDate: string;
    if (action.date) {
      txDate = action.date;
    } else {
      const now = new Date();
      const vzNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);
      txDate = vzNow.toISOString().split('T')[0];
    }

    const pm = action.paymentMethod || null;

    await db.prepare(`
      INSERT INTO customer_transactions
      (customer_id, type, date, description, amount_usd, amount_bs, amount_usd_divisa, currency_type, presupuesto_id, exchange_rate, is_paid, payment_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).bind(
      customer.id,
      action.type,
      txDate,
      action.description,
      action.amountUsd,
      amountBs,
      action.amountUsdDivisa || null,
      action.currencyType,
      action.presupuestoId || null,
      bcvRate.rate,
      pm
    ).run();

    const balanceQuery = action.currencyType === 'divisas'
      ? `SELECT COALESCE(SUM(CASE WHEN type='purchase' AND COALESCE(is_paid,0)=0 THEN amount_usd ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN type='payment' THEN amount_usd ELSE 0 END), 0) AS balance FROM customer_transactions WHERE customer_id = ? AND currency_type = 'divisas'`
      : `SELECT COALESCE(SUM(CASE WHEN type='purchase' AND COALESCE(is_paid,0)=0 THEN amount_usd ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN type='payment' THEN amount_usd ELSE 0 END), 0) AS balance FROM customer_transactions WHERE customer_id = ? AND currency_type = 'dolar_bcv'`;

    const balanceResult = await db.prepare(balanceQuery).bind(customer.id).first<{ balance: number }>();
    const newBalance = Number(balanceResult?.balance || 0);

    const emoji = action.type === 'purchase' ? '🛒' : '💰';
    const actionText = action.type === 'purchase' ? 'Compra' : 'Abono';
    const curr = action.currencyType === 'divisas' ? 'DIV' : 'BCV';
    const pmStr = pm ? ` (${PAYMENT_METHOD_NAMES[pm] || pm})` : '';

    return `${emoji} *${actionText} registrada*\n\n👤 ${customer.name}\n💵 $${action.amountUsd.toFixed(2)} (${curr})${pmStr}\n📝 ${action.description}\n\n💼 Nuevo balance ${curr}: $${newBalance.toFixed(2)}`;
  } catch (error) {
    console.error('[Telegram] Error en executeCustomerAction:', error);
    return `❌ Error: ${error}`;
  }
}

export async function createCustomer(db: D1Database | null, name: string, phone?: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const existing = await findCustomerByName(db, name);
    if (existing) return `⚠️ Ya existe cliente "${existing.name}"`;
    await db.prepare(`INSERT INTO customers (name, phone, is_active) VALUES (?, ?, 1)`).bind(name, phone || null).run();
    return `✅ *Cliente creado*\n\n👤 ${name}${phone ? `\n📱 ${phone}` : ''}`;
  } catch (error) {
    return `❌ Error al crear cliente: ${error}`;
  }
}

export async function updateCustomerPhone(db: D1Database | null, customerName: string, phone: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const customer = await findCustomerByName(db, customerName);
    if (!customer) return await notFoundWithSuggestions(db, customerName);
    await db.prepare(`UPDATE customers SET phone = ? WHERE id = ?`).bind(phone, customer.id).run();
    return `✅ *Teléfono actualizado*\n\n👤 ${customer.name}\n📱 ${phone}`;
  } catch (error) {
    return `❌ Error al actualizar teléfono: ${error}`;
  }
}
