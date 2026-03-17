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

    // Get all products with their costs (include cost-only products)
    const { results: products } = await db.prepare(`
      SELECT
        p.id, p.nombre, p.categoria, p.precio_usd, p.precio_usd_divisa, p.unidad, p.disponible, p.cost_only,
        pc.cost_usd, pc.purchase_rate_type, pc.supplier, pc.notes as cost_notes, pc.updated_at as cost_updated_at
      FROM products p
      LEFT JOIN product_costs pc ON pc.product_id = p.id
      WHERE p.disponible = 1 OR p.cost_only = 1
      ORDER BY p.cost_only ASC, p.sort_order, p.nombre
    `).all();

    const bcv = settings.bcv_rate;
    const parallel = settings.parallel_rate;
    const iva = settings.iva_rate;
    const debitComm = settings.debit_commission;
    const creditComm = settings.credit_commission;

    // Calculate all derived values for each product
    //
    // Dos sistemas de precios:
    //   1. BCV: precio_usd es el precio en "dólares BCV" → cliente paga precio_usd × tasa_bcv Bs
    //   2. Divisa: precio_usd_divisa es el precio en dólares cash
    //
    // Costos se convierten al sistema correspondiente:
    //   - $ Real (paralelo): para comparar vs precio divisa
    //   - $ BCV equiv: para comparar vs precio BCV
    //     PARALELO → costo × tasa_paralela / tasa_bcv (lo que cuesta en "dólares BCV")
    //     BCV → costo tal cual (ya está en BCV)
    //
    const enrichedProducts = products.map((p: any) => {
      const precioBcv = p.precio_usd;                                              // Precio venta BCV
      const precioDivisa = p.precio_usd_divisa ?? (precioBcv * (bcv / parallel));  // Precio divisa (o equivalente)
      const costUsd = p.cost_usd;
      const rateType = p.purchase_rate_type;

      if (costUsd == null) {
        return { ...p, calculated: null };
      }

      // === Costo en $ Real (paralelo) — para comparar vs precio divisa ===
      const realCostUsd = calcRealUsd(costUsd, rateType, bcv, parallel);

      // === Costo en $ BCV equivalente — para comparar vs precio BCV ===
      // PARALELO: costo × tasa_paralela / tasa_bcv (convierte a dólares BCV)
      // BCV: costo tal cual
      const costBcvEquiv = rateType === 'PARALELO' ? costUsd * (parallel / bcv) : costUsd;

      // Costo BCV equiv con IVA + comisiones
      const costBcvDebit = costBcvEquiv * (1 + iva + debitComm);
      const costBcvCredit = costBcvEquiv * (1 + iva + creditComm);

      // === Márgenes ===
      // % GAN $ = margen en dólares divisa ($ real vs precio divisa)
      const marginUsd = realCostUsd > 0 ? (precioDivisa - realCostUsd) / realCostUsd : 0;
      // % GAN Bs = margen en dólares BCV pago móvil (precio BCV vs costo BCV equiv)
      const marginBsPm = costBcvEquiv > 0 ? (precioBcv - costBcvEquiv) / costBcvEquiv : 0;
      // % GAN IVA = margen punto de venta: IVA va al SENIAT y comisión al banco
      // Ganancia = precio - costo - IVA (SENIAT) - comisión débito
      const profitBsIva = precioBcv - costBcvEquiv - precioBcv * (iva + debitComm);
      const marginBsIva = costBcvDebit > 0 ? profitBsIva / costBcvDebit : 0;

      // Ganancia real en $ paralelo (lo que realmente gano convertido)
      // PM: (precioBcv - costBcvEquiv) en BCV dollars → × bcv / parallel para $ real
      const profitRealPm = (precioBcv - costBcvEquiv) * (bcv / parallel);
      const profitRealIva = profitBsIva * (bcv / parallel);

      return {
        ...p,
        calculated: {
          precioDivisa,
          precioBcv,
          realCostUsd,
          costBcvEquiv,
          costBcvDebit,
          costBcvCredit,
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
