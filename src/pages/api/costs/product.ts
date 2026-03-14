/**
 * API: Update product cost
 * PUT: Update or create cost for a product (auto-generates history)
 */
import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';

export const prerender = false;

export const PUT: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const body = await request.json();
    const { productId, costUsd, purchaseRateType, supplier, notes } = body;

    if (!productId || costUsd == null || !purchaseRateType) {
      return new Response(JSON.stringify({
        success: false, error: 'productId, costUsd y purchaseRateType son requeridos'
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (!['BCV', 'PARALELO'].includes(purchaseRateType)) {
      return new Response(JSON.stringify({
        success: false, error: 'purchaseRateType debe ser BCV o PARALELO'
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Get product name
    const product = await db.prepare('SELECT nombre FROM products WHERE id = ?').bind(productId).first<any>();
    if (!product) {
      return new Response(JSON.stringify({ success: false, error: 'Producto no encontrado' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get current cost settings for history
    const settings = await db.prepare(
      'SELECT bcv_rate, parallel_rate FROM cost_settings ORDER BY id DESC LIMIT 1'
    ).first<any>();

    if (!settings) {
      return new Response(JSON.stringify({
        success: false, error: 'Configura las tasas primero antes de asignar costos'
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const bcv = settings.bcv_rate;
    const parallel = settings.parallel_rate;

    // Get existing cost (if any)
    const existing = await db.prepare(
      'SELECT cost_usd, purchase_rate_type FROM product_costs WHERE product_id = ?'
    ).bind(productId).first<any>();

    // Calculate real USD values
    const calcReal = (cost: number, rateType: string) =>
      rateType === 'BCV' ? cost * (bcv / parallel) : cost;

    const newRealUsd = calcReal(costUsd, purchaseRateType);
    const oldRealUsd = existing ? calcReal(existing.cost_usd, existing.purchase_rate_type) : null;

    // Calculate variations
    const variationNominal = existing ? (costUsd - existing.cost_usd) / existing.cost_usd : null;
    const variationReal = oldRealUsd ? (newRealUsd - oldRealUsd) / oldRealUsd : null;

    // Use batch for atomicity
    const statements = [];

    // Upsert product cost
    statements.push(
      db.prepare(`
        INSERT INTO product_costs (product_id, cost_usd, purchase_rate_type, supplier, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(product_id) DO UPDATE SET
          cost_usd = excluded.cost_usd,
          purchase_rate_type = excluded.purchase_rate_type,
          supplier = COALESCE(excluded.supplier, product_costs.supplier),
          notes = excluded.notes,
          updated_at = datetime('now')
      `).bind(productId, costUsd, purchaseRateType, supplier ?? null, notes ?? null)
    );

    // Record history (always, even for first entry)
    statements.push(
      db.prepare(`
        INSERT INTO purchase_price_history
          (product_id, product_name, old_cost_usd, new_cost_usd, old_rate_type, new_rate_type,
           bcv_rate_at_change, parallel_rate_at_change, old_real_usd, new_real_usd,
           variation_nominal, variation_real, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        productId, product.nombre,
        existing?.cost_usd ?? null, costUsd,
        existing?.purchase_rate_type ?? null, purchaseRateType,
        bcv, parallel,
        oldRealUsd, newRealUsd,
        variationNominal, variationReal,
        notes ?? null
      )
    );

    await db.batch(statements);

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error actualizando costo de producto:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al actualizar costo' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
