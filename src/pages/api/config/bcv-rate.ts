import type { APIRoute } from 'astro';
import { getD1 } from '../../../lib/d1-types';
import { obtenerTasaSegunPreferencia } from '../../../lib/bcv-fuentes';
import { getEnv } from '../../../lib/env';

export const prerender = false;

/**
 * Obtiene la tasa fresca respetando la fuente elegida en el panel.
 * El orden y las fuentes viven en lib/bcv-fuentes.ts.
 */
async function fetchFreshBCVRate(db: any, locals: any) {
  const env = getEnv(locals) as Record<string, string | undefined>;
  return obtenerTasaSegunPreferencia(db, env.COTIZAVE_API_KEY, env.JINA_API_KEY);
}

export const GET: APIRoute = async ({ locals }) => {
  try {
    const db = getD1(locals);

    if (!db) {
      // Sin DB, intentar obtener tasa fresca
      const freshRate = await fetchFreshBCVRate(null, locals);
      return new Response(JSON.stringify({
        rate: freshRate?.rate || 70.00,
        manual: false,
        source: freshRate?.source || 'fallback',
        updatedAt: new Date().toISOString()
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    }

    // Get all BCV-related config values
    const results = await db.prepare(
      "SELECT key, value, updated_at FROM site_config WHERE key IN ('bcv_rate', 'bcv_rate_manual', 'bcv_rate_updated_at', 'bcv_rate_auto', 'bcv_rate_source', 'bcv_rate_date')"
    ).all<{ key: string; value: string; updated_at: string }>();

    const config: Record<string, string> = {};
    let latestUpdate = new Date().toISOString();

    for (const row of results.results) {
      config[row.key] = row.value;
      if (row.updated_at > latestUpdate) {
        latestUpdate = row.updated_at;
      }
    }

    const isManual = config.bcv_rate_manual === 'true';
    const manualRate = parseFloat(config.bcv_rate || '0');

    // Si es modo manual, usar tasa manual
    if (isManual && manualRate > 0) {
      return new Response(JSON.stringify({
        rate: manualRate,
        manual: true,
        source: 'manual',
        autoRate: null,
        manualRate: manualRate,
        rateDate: config.bcv_rate_date || null,
        updatedAt: config.bcv_rate_updated_at || latestUpdate
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    }

    // Modo automático: se consulta la fuente elegida en el panel (se pasa db
    // para poder leer esa preferencia)
    const freshRate = await fetchFreshBCVRate(db, locals);

    if (freshRate) {
      // Actualizar la tasa en D1 para mantenerla sincronizada (fire and forget)
      const today = new Date().toISOString().split('T')[0];
      try {
        await db.batch([
          db.prepare(
            "INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES ('bcv_rate_auto', ?, datetime('now'))"
          ).bind(freshRate.rate.toFixed(4)),
          db.prepare(
            "INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES ('bcv_rate_source', ?, datetime('now'))"
          ).bind(freshRate.source),
          db.prepare(
            "INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES ('bcv_rate_date', ?, datetime('now'))"
          ).bind(freshRate.date),
          db.prepare(
            'INSERT OR REPLACE INTO bcv_rates (date, usd_rate) VALUES (?, ?)'
          ).bind(today, freshRate.rate),
        ]);
      } catch (_) { /* ignore errors */ }

      return new Response(JSON.stringify({
        rate: freshRate.rate,
        manual: false,
        source: freshRate.source,
        autoRate: freshRate.rate,
        manualRate: manualRate > 0 ? manualRate : null,
        rateDate: freshRate.date,
        updatedAt: new Date().toISOString()
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    }

    // Fallback: usar tasa almacenada si no se pudo obtener fresca
    const autoRate = parseFloat(config.bcv_rate_auto || '0');
    return new Response(JSON.stringify({
      rate: autoRate > 0 ? autoRate : 70.00,
      manual: false,
      source: autoRate > 0 ? (config.bcv_rate_source || 'D1') : 'fallback',
      autoRate: autoRate > 0 ? autoRate : null,
      manualRate: manualRate > 0 ? manualRate : null,
      rateDate: config.bcv_rate_date || null,
      updatedAt: config.bcv_rate_updated_at || latestUpdate
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  } catch (error) {
    console.error('Error getting BCV rate config:', error);
    // Intentar obtener tasa fresca como último recurso
    const freshRate = await fetchFreshBCVRate(null, locals);
    return new Response(JSON.stringify({
      rate: freshRate?.rate || 70.00,
      manual: false,
      source: freshRate?.source || 'fallback',
      updatedAt: new Date().toISOString()
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const db = getD1(locals);

    if (!db) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Base de datos no configurada'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { manual, rate } = body;

    // Validate rate if manual is true
    if (manual && (typeof rate !== 'number' || rate <= 0)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Tasa invalida'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update config values
    const statements = [
      db.prepare(
        "INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES ('bcv_rate_manual', ?, datetime('now'))"
      ).bind(manual ? 'true' : 'false'),
      db.prepare(
        "INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES ('bcv_rate_updated_at', datetime('now'), datetime('now'))"
      )
    ];

    if (manual && rate) {
      statements.push(
        db.prepare(
          "INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES ('bcv_rate', ?, datetime('now'))"
        ).bind(rate.toFixed(2))
      );
    }

    await db.batch(statements);

    return new Response(JSON.stringify({
      success: true,
      manual,
      rate: manual ? rate : null
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating BCV rate config:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al guardar la configuracion'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
