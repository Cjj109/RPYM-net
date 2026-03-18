import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../../../lib/require-auth';
import { getR2 } from '../../../../../../lib/d1-types';

export const prerender = false;

// PUT /api/pagos-proveedores/compras/:id/abonos/:abonoId - Update payment
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const { abonoId } = params;
    const body = await request.json();
    const { montoUsd, fecha, metodoPago, cuenta, notas, montoBs, tasaCambio, tasaParalela, removeImage } = body;

    if (!montoUsd || !fecha) {
      return new Response(JSON.stringify({ success: false, error: 'Monto y fecha son requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Remove image from R2 if requested
    if (removeImage) {
      const abono = await db.prepare(
        'SELECT imagen_key FROM abonos_proveedores WHERE id = ?'
      ).bind(abonoId).first<{ imagen_key: string | null }>();

      if (abono?.imagen_key) {
        const r2 = getR2(locals);
        if (r2) {
          try { await r2.delete(abono.imagen_key); } catch (e) { console.error('Error deleting R2 image:', e); }
        }
      }

      await db.prepare(
        "UPDATE abonos_proveedores SET imagen_key = NULL, updated_at = datetime('now') WHERE id = ?"
      ).bind(abonoId).run();
    }

    await db.prepare(`
      UPDATE abonos_proveedores
      SET monto_usd = ?, monto_bs = ?, tasa_cambio = ?, tasa_paralela = ?,
          fecha = ?, metodo_pago = ?, cuenta = ?, notas = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      Number(montoUsd),
      montoBs ? Number(montoBs) : null,
      tasaCambio ? Number(tasaCambio) : null,
      tasaParalela ? Number(tasaParalela) : null,
      fecha,
      metodoPago || 'pago_movil',
      cuenta || 'pa',
      notas?.trim() || null,
      abonoId
    ).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error updating abono:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al actualizar abono' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// DELETE /api/pagos-proveedores/compras/:id/abonos/:abonoId - Soft delete payment
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const { abonoId } = params;

    await db.prepare(
      "UPDATE abonos_proveedores SET is_active = 0, updated_at = datetime('now') WHERE id = ?"
    ).bind(abonoId).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error deleting abono:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al eliminar abono' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
