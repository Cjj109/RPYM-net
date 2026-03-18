import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../lib/require-auth';

export const prerender = false;

// POST /api/pagos-proveedores/compras/merge - Merge multiple compras into one
export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const body = await request.json();
    const { sourceIds, targetId } = body as { sourceIds: number[]; targetId: number };

    if (!targetId || !sourceIds?.length) {
      return new Response(JSON.stringify({ success: false, error: 'targetId y sourceIds son requeridos' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Filter out targetId from sourceIds if included
    const filteredSourceIds = sourceIds.filter(id => id !== targetId);
    if (filteredSourceIds.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Debe haber al menos una compra fuente distinta a la destino' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verify target exists
    const target = await db.prepare(
      'SELECT id FROM compras_proveedores WHERE id = ? AND is_active = 1'
    ).bind(targetId).first();

    if (!target) {
      return new Response(JSON.stringify({ success: false, error: 'Compra destino no encontrada' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Move abonos and soft-delete sources atomically
    const statements = [];

    // Move all active abonos from sources to target
    for (const sourceId of filteredSourceIds) {
      statements.push(
        db.prepare(
          "UPDATE abonos_proveedores SET compra_id = ?, updated_at = datetime('now') WHERE compra_id = ? AND is_active = 1"
        ).bind(targetId, sourceId)
      );
    }

    // Soft-delete source compras
    const placeholders = filteredSourceIds.map(() => '?').join(',');
    statements.push(
      db.prepare(
        `UPDATE compras_proveedores SET is_active = 0, updated_at = datetime('now') WHERE id IN (${placeholders})`
      ).bind(...filteredSourceIds)
    );

    await db.batch(statements);

    return new Response(JSON.stringify({
      success: true,
      merged: filteredSourceIds.length,
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error merging compras:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al fusionar compras' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
