import type { APIRoute } from 'astro';
import { getD1 } from '../../../lib/d1-types';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    const db = getD1(locals);

    if (!db) {
      // Fallback when D1 is not configured
      return new Response(JSON.stringify({
        rate: 70.00,
        manual: false,
        source: 'fallback',
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
    const autoRate = parseFloat(config.bcv_rate_auto || '0');

    // Priority: manual rate > auto rate from D1 > fallback
    let activeRate = 70.00;
    let source = 'fallback';

    if (isManual && manualRate > 0) {
      activeRate = manualRate;
      source = 'manual';
    } else if (autoRate > 0) {
      activeRate = autoRate;
      source = config.bcv_rate_source || 'D1';
    }

    // Save today's rate to bcv_rates history (fire and forget)
    if (activeRate > 0) {
      const today = new Date().toISOString().split('T')[0];
      try {
        await db.prepare(
          'INSERT OR IGNORE INTO bcv_rates (date, usd_rate) VALUES (?, ?)'
        ).bind(today, activeRate).run();
      } catch (_) { /* ignore - table may not exist yet */ }
    }

    return new Response(JSON.stringify({
      rate: activeRate,
      manual: isManual,
      source,
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
    return new Response(JSON.stringify({
      rate: 70.00,
      manual: false,
      source: 'fallback',
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
