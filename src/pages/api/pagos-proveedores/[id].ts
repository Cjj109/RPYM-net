import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';
import { getR2 } from '../../../lib/d1-types';

export const prerender = false;

// PUT /api/pagos-proveedores/:id - Update payment
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;
    const body = await request.json();
    const { proveedorId, montoUsd, producto, fecha, metodoPago, cuenta, notas, montoBs, tasaCambio, removeImage } = body;

    if (!proveedorId || !montoUsd || !producto?.trim() || !fecha) {
      return new Response(JSON.stringify({ success: false, error: 'Proveedor, monto, producto y fecha son requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Remove image from R2 if requested
    if (removeImage) {
      const pago = await db.prepare(
        'SELECT imagen_key FROM pagos_proveedores WHERE id = ?'
      ).bind(id).first<{ imagen_key: string | null }>();

      if (pago?.imagen_key) {
        const r2 = getR2(locals);
        if (r2) {
          try { await r2.delete(pago.imagen_key); } catch (e) { console.error('Error deleting R2 image:', e); }
        }
      }

      await db.prepare(
        "UPDATE pagos_proveedores SET imagen_key = NULL, updated_at = datetime('now') WHERE id = ?"
      ).bind(id).run();
    }

    await db.prepare(`
      UPDATE pagos_proveedores
      SET proveedor_id = ?, monto_usd = ?, monto_bs = ?, tasa_cambio = ?, producto = ?, fecha = ?,
          metodo_pago = ?, cuenta = ?, notas = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      Number(proveedorId),
      Number(montoUsd),
      montoBs ? Number(montoBs) : null,
      tasaCambio ? Number(tasaCambio) : null,
      producto.trim(),
      fecha,
      metodoPago || 'pago_movil',
      cuenta || 'pa',
      notas?.trim() || null,
      id
    ).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error updating pago proveedor:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al actualizar pago' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// DELETE /api/pagos-proveedores/:id - Soft delete payment
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const id = params.id;

    // Get image key before deleting
    const pago = await db.prepare(
      'SELECT imagen_key FROM pagos_proveedores WHERE id = ?'
    ).bind(id).first<{ imagen_key: string | null }>();

    // Delete image from R2 if exists
    if (pago?.imagen_key) {
      const r2 = getR2(locals);
      if (r2) {
        try {
          await r2.delete(pago.imagen_key);
        } catch (e) {
          console.error('Error deleting R2 image:', e);
        }
      }
    }

    await db.prepare(
      "UPDATE pagos_proveedores SET is_active = 0, updated_at = datetime('now') WHERE id = ?"
    ).bind(id).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error deleting pago proveedor:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al eliminar pago' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
