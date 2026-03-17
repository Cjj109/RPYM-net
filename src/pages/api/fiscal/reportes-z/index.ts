import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';
import { transformReporteZ, type D1FiscalReporteZ, type FiscalReporteZ } from '../../../../lib/fiscal-types';

export const prerender = false;

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Obtiene el día de semana (0=dom..6=sáb) de una fecha YYYY-MM-DD */
function getDayOfWeek(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

// GET /api/fiscal/reportes-z - List all Z reports with BCV rate and weekly comparison
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const url = new URL(request.url);
    const periodo = url.searchParams.get('periodo'); // YYYY-MM

    let query = `SELECT * FROM fiscal_reportes_z WHERE 1=1`;
    const params: unknown[] = [];

    if (periodo) {
      query += ` AND fecha LIKE ?`;
      params.push(`${periodo}%`);
    }

    query += ` ORDER BY fecha DESC`;

    const stmt = params.length > 0
      ? db.prepare(query).bind(...params)
      : db.prepare(query);
    const results = await stmt.all<D1FiscalReporteZ>();

    // Obtener tasas BCV para todas las fechas de los reportes
    const fechas = results.results.map(r => r.fecha);
    let bcvRatesMap: Record<string, number> = {};

    if (fechas.length > 0) {
      // Buscar tasas en bcv_rates
      const placeholders = fechas.map(() => '?').join(',');
      const ratesResult = await db.prepare(
        `SELECT date, usd_rate FROM bcv_rates WHERE date IN (${placeholders})`
      ).bind(...fechas).all<{ date: string; usd_rate: number }>();
      for (const r of ratesResult.results) {
        bcvRatesMap[r.date] = r.usd_rate;
      }

      // Para fechas sin tasa en bcv_rates, buscar la más cercana anterior
      for (const fecha of fechas) {
        if (!bcvRatesMap[fecha]) {
          const closest = await db.prepare(
            `SELECT usd_rate FROM bcv_rates WHERE date <= ? ORDER BY date DESC LIMIT 1`
          ).bind(fecha).first<{ usd_rate: number }>();
          if (closest) bcvRatesMap[fecha] = closest.usd_rate;
        }
      }
    }

    // Transformar y enriquecer reportes
    const reportes: FiscalReporteZ[] = results.results.map(transformReporteZ);

    // Calcular USD y día de semana para cada reporte
    for (const r of reportes) {
      const rate = bcvRatesMap[r.fecha] || null;
      r.bcvRate = rate;
      r.totalVentasUsd = rate ? r.totalVentas / rate : null;
      r.diaSemana = DIAS_SEMANA[getDayOfWeek(r.fecha)];
    }

    // Calcular variación vs mismo día de semana anterior
    // Ordenar por fecha ASC para recorrer cronológicamente
    const sortedByDate = [...reportes].sort((a, b) => a.fecha.localeCompare(b.fecha));
    // Mapa: día de semana → último total USD visto
    const lastByDay: Record<number, { totalUsd: number; fecha: string }> = {};

    for (const r of sortedByDate) {
      const dow = getDayOfWeek(r.fecha);
      const prev = lastByDay[dow];
      if (prev && r.totalVentasUsd != null && prev.totalUsd > 0) {
        r.variacionSemana = (r.totalVentasUsd - prev.totalUsd) / prev.totalUsd;
        r.totalVentasUsdAnterior = prev.totalUsd;
        r.fechaAnterior = prev.fecha;
      } else {
        r.variacionSemana = null;
        r.totalVentasUsdAnterior = null;
        r.fechaAnterior = null;
      }
      if (r.totalVentasUsd != null) {
        lastByDay[dow] = { totalUsd: r.totalVentasUsd, fecha: r.fecha };
      }
    }

    return new Response(JSON.stringify({
      success: true,
      reportes,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error listing reportes Z:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar reportes Z' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// POST /api/fiscal/reportes-z - Create new Z report
export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const body = await request.json();
    const {
      fecha,
      subtotalExento,
      subtotalGravable,
      ivaCobrado,
      baseImponibleIgtf,
      igtfVentas,
      totalVentas,
      numeracionFacturas,
      imageKey,
      ocrVerified,
      ocrRawData,
      notes,
    } = body;

    if (!fecha) {
      return new Response(JSON.stringify({ success: false, error: 'Fecha es requerida' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for duplicate date
    const existing = await db.prepare(
      'SELECT id FROM fiscal_reportes_z WHERE fecha = ?'
    ).bind(fecha).first();

    if (existing) {
      return new Response(JSON.stringify({ success: false, error: 'Ya existe un reporte Z para esa fecha' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await db.prepare(`
      INSERT INTO fiscal_reportes_z (
        fecha, subtotal_exento, subtotal_gravable, iva_cobrado,
        base_imponible_igtf, igtf_ventas, total_ventas,
        numeracion_facturas, image_key, ocr_verified, ocr_raw_data, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      fecha,
      subtotalExento || 0,
      subtotalGravable || 0,
      ivaCobrado || 0,
      baseImponibleIgtf || 0,
      igtfVentas || 0,
      totalVentas || 0,
      numeracionFacturas || null,
      imageKey || null,
      ocrVerified ? 1 : 0,
      ocrRawData || null,
      notes || null
    ).run();

    return new Response(JSON.stringify({
      success: true,
      id: result.meta.last_row_id,
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error creating reporte Z:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al crear reporte Z' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
