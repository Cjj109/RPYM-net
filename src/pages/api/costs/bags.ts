/**
 * API: Bag prices CRUD
 * GET: List active bag prices
 * POST: Create/update bag price
 * DELETE: Deactivate bag price
 */
import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const { results } = await db.prepare(
      'SELECT * FROM bag_prices WHERE is_active = 1 ORDER BY bag_type'
    ).all();

    return new Response(JSON.stringify({ success: true, bags: results }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error cargando bolsas:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar bolsas' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const { id, bagType, pricePerThousand } = await request.json();

    if (!bagType || pricePerThousand == null) {
      return new Response(JSON.stringify({ success: false, error: 'bagType y pricePerThousand son requeridos' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const pricePerUnit = pricePerThousand / 1000;

    if (id) {
      // Update existing
      await db.prepare(`
        UPDATE bag_prices SET bag_type = ?, price_per_thousand_usd = ?, price_per_unit_usd = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(bagType, pricePerThousand, pricePerUnit, id).run();
    } else {
      // Create new
      await db.prepare(`
        INSERT INTO bag_prices (bag_type, price_per_thousand_usd, price_per_unit_usd)
        VALUES (?, ?, ?)
      `).bind(bagType, pricePerThousand, pricePerUnit).run();
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error guardando bolsa:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al guardar bolsa' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const { id } = await request.json();
    if (!id) {
      return new Response(JSON.stringify({ success: false, error: 'id requerido' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    await db.prepare('UPDATE bag_prices SET is_active = 0 WHERE id = ?').bind(id).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error eliminando bolsa:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al eliminar bolsa' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
