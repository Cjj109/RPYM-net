import type { APIRoute } from 'astro';
import { getD1 } from '../../../lib/d1-types';

export const prerender = false;

/**
 * External API endpoint for updating BCV rate
 * Called by GitHub Actions or external services
 *
 * Requires Authorization header with Bearer token
 * Token should be set as RPYM_API_SECRET in Cloudflare environment
 */
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    // Verify authorization
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Authorization required'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.slice(7); // Remove 'Bearer '

    // Get the secret from environment
    const runtime = (locals as any).runtime;
    const apiSecret = runtime?.env?.RPYM_API_SECRET;

    // If no secret configured, use a default for initial setup
    // IMPORTANT: Set RPYM_API_SECRET in Cloudflare environment variables for production
    const expectedSecret = apiSecret || 'rpym-bcv-update-2026';

    if (token !== expectedSecret) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid token'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = getD1(locals);
    if (!db) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Database not configured'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { rate, source, date } = body;

    if (!rate || typeof rate !== 'number' || rate <= 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Valid rate is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update the BCV rate in site_config
    // This will be used when manual mode is OFF
    await db.batch([
      db.prepare(`
        INSERT OR REPLACE INTO site_config (key, value, updated_at)
        VALUES ('bcv_rate_auto', ?, datetime('now'))
      `).bind(rate.toFixed(4)),
      db.prepare(`
        INSERT OR REPLACE INTO site_config (key, value, updated_at)
        VALUES ('bcv_rate_source', ?, datetime('now'))
      `).bind(source || 'API'),
      db.prepare(`
        INSERT OR REPLACE INTO site_config (key, value, updated_at)
        VALUES ('bcv_rate_date', ?, datetime('now'))
      `).bind(date || new Date().toISOString().split('T')[0])
    ]);

    return new Response(JSON.stringify({
      success: true,
      message: `BCV rate updated to ${rate.toFixed(4)}`,
      rate: rate,
      source: source || 'API',
      date: date || new Date().toISOString().split('T')[0]
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Update BCV rate error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Server error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

/**
 * GET endpoint to check current stored rate
 */
export const GET: APIRoute = async ({ locals }) => {
  try {
    const db = getD1(locals);
    if (!db) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Database not configured'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const results = await db.batch([
      db.prepare("SELECT value FROM site_config WHERE key = 'bcv_rate_auto'"),
      db.prepare("SELECT value FROM site_config WHERE key = 'bcv_rate_source'"),
      db.prepare("SELECT value FROM site_config WHERE key = 'bcv_rate_date'"),
      db.prepare("SELECT value FROM site_config WHERE key = 'bcv_rate_manual'"),
      db.prepare("SELECT value FROM site_config WHERE key = 'bcv_rate'")
    ]);

    const autoRate = (results[0].results[0] as any)?.value;
    const source = (results[1].results[0] as any)?.value || 'unknown';
    const date = (results[2].results[0] as any)?.value || 'unknown';
    const isManual = (results[3].results[0] as any)?.value === 'true';
    const manualRate = (results[4].results[0] as any)?.value;

    return new Response(JSON.stringify({
      success: true,
      autoRate: autoRate ? parseFloat(autoRate) : null,
      manualRate: manualRate ? parseFloat(manualRate) : null,
      isManual,
      activeRate: isManual && manualRate ? parseFloat(manualRate) : (autoRate ? parseFloat(autoRate) : null),
      source,
      date
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Get BCV rate error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Server error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
