import type { APIRoute } from 'astro';
import { requireAuth } from '../../../../../../lib/require-auth';

export const prerender = false;

// POST /api/pagos-proveedores/compras/:id/abonos - Add payment to purchase
export const POST: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const compraId = params.id;
    const body = await request.json();
    const { montoUsd, fecha, metodoPago, cuenta, notas, montoBs, tasaCambio, tasaParalela } = body;

    if (!montoUsd || !fecha) {
      return new Response(JSON.stringify({ success: false, error: 'Monto y fecha son requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verify compra exists
    const compra = await db.prepare(
      'SELECT id, monto_total FROM compras_proveedores WHERE id = ? AND is_active = 1'
    ).bind(compraId).first<{ id: number; monto_total: number }>();

    if (!compra) {
      return new Response(JSON.stringify({ success: false, error: 'Compra no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await db.prepare(`
      INSERT INTO abonos_proveedores (compra_id, monto_usd, monto_bs, tasa_cambio, tasa_paralela, fecha, metodo_pago, cuenta, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      Number(compraId),
      Number(montoUsd),
      montoBs ? Number(montoBs) : null,
      tasaCambio ? Number(tasaCambio) : null,
      tasaParalela ? Number(tasaParalela) : null,
      fecha,
      metodoPago || 'pago_movil',
      cuenta || 'pa',
      notas?.trim() || null
    ).run();

    return new Response(JSON.stringify({
      success: true,
      id: result.meta.last_row_id,
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error creating abono:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al registrar abono' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
