/**
 * API: Cost management - Dashboard data
 * GET: Returns all products with costs, margins, and calculated prices
 * POST: Update cost settings (tasas, IVA, comisiones)
 */
import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';

export const prerender = false;

/** Calcula el $ real según la tasa de compra */
function calcRealUsd(costUsd: number, rateType: string, bcvRate: number, parallelRate: number): number {
  if (rateType === 'BCV') {
    return costUsd * (bcvRate / parallelRate);
  }
  return costUsd; // PARALELO = ya es el real
}

export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    // Get latest cost settings
    const settings = await db.prepare(
      'SELECT * FROM cost_settings ORDER BY id DESC LIMIT 1'
    ).first<any>();

    if (!settings) {
      return new Response(JSON.stringify({
        success: true,
        settings: null,
        products: [],
        bags: []
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Get all products with their costs
    const { results: products } = await db.prepare(`
      SELECT
        p.id, p.nombre, p.categoria, p.precio_usd, p.precio_usd_divisa, p.unidad, p.disponible,
        pc.cost_usd, pc.purchase_rate_type, pc.supplier, pc.notes as cost_notes, pc.updated_at as cost_updated_at
      FROM products p
      LEFT JOIN product_costs pc ON pc.product_id = p.id
      WHERE p.disponible = 1
      ORDER BY p.sort_order, p.nombre
    `).all();

    const bcv = settings.bcv_rate;
    const parallel = settings.parallel_rate;
    const iva = settings.iva_rate;
    const debitComm = settings.debit_commission;
    const creditComm = settings.credit_commission;

    // Calculate all derived values for each product
    const enrichedProducts = products.map((p: any) => {
      const saleUsd = p.precio_usd;
      const costUsd = p.cost_usd;
      const rateType = p.purchase_rate_type;

      if (costUsd == null) {
        return { ...p, calculated: null };
      }

      // Sale conversions
      const saleBsPm = saleUsd * parallel;
      const saleBsPunto = saleUsd * parallel * (1 + iva);
      const saleEquivBcv = saleUsd * (bcv / parallel);

      // Cost conversions
      const realCostUsd = calcRealUsd(costUsd, rateType, bcv, parallel);
      const costBsPm = rateType === 'BCV' ? costUsd * bcv : costUsd * parallel;
      const costBsDebit = costBsPm * (1 + iva + debitComm);
      const costBsCredit = costBsPm * (1 + iva + creditComm);

      // Margins
      const marginUsd = realCostUsd > 0 ? (saleUsd - realCostUsd) / realCostUsd : 0;
      const marginBsPm = costBsPm > 0 ? (saleBsPm - costBsPm) / costBsPm : 0;
      const marginBsIva = costBsDebit > 0 ? (saleBsPunto - costBsDebit) / costBsDebit : 0;

      // Real profit in $
      const profitRealPm = (saleBsPm - costBsPm) / parallel;
      const profitRealIva = (saleBsPunto - costBsDebit) / parallel;

      return {
        ...p,
        calculated: {
          realCostUsd,
          saleBsPm,
          saleBsPunto,
          saleEquivBcv,
          costBsPm,
          costBsDebit,
          costBsCredit,
          marginUsd,
          marginBsPm,
          marginBsIva,
          profitRealPm,
          profitRealIva
        }
      };
    });

    // Get bag prices
    const { results: bags } = await db.prepare(
      'SELECT * FROM bag_prices WHERE is_active = 1 ORDER BY bag_type'
    ).all();

    return new Response(JSON.stringify({
      success: true,
      settings: {
        id: settings.id,
        bcvRate: settings.bcv_rate,
        parallelRate: settings.parallel_rate,
        ivaRate: settings.iva_rate,
        debitCommission: settings.debit_commission,
        creditCommission: settings.credit_commission,
        createdAt: settings.created_at
      },
      products: enrichedProducts,
      bags
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error cargando datos de costos:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar datos de costos' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const body = await request.json();
    const { bcvRate, parallelRate, ivaRate, debitCommission, creditCommission, notes } = body;

    if (!bcvRate || !parallelRate) {
      return new Response(JSON.stringify({ success: false, error: 'Tasa BCV y Paralela son requeridas' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    await db.prepare(`
      INSERT INTO cost_settings (bcv_rate, parallel_rate, iva_rate, debit_commission, credit_commission, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      bcvRate,
      parallelRate,
      ivaRate ?? 0.08,
      debitCommission ?? 0.008,
      creditCommission ?? 0.032,
      notes ?? null
    ).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error guardando configuración de costos:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al guardar configuración' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
