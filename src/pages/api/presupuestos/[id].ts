import type { APIRoute } from 'astro';
import { getD1, type D1Presupuesto } from '../../../lib/d1-types';
import { linkBudgetToCustomer } from '../../../lib/services/telegram/budget-handlers';

export const prerender = false;

// Transform D1 row to API response format
function transformPresupuesto(row: D1Presupuesto) {
  return {
    id: row.id,
    fecha: row.fecha,
    items: JSON.parse(row.items),
    totalUSD: row.total_usd,
    totalBs: row.total_bs,
    totalUSDDivisa: row.total_usd_divisa,
    hideRate: row.hide_rate === 1,
    delivery: row.delivery || 0,
    modoPrecio: row.modo_precio || 'bcv',
    estado: row.estado,
    customerName: row.customer_name,
    customerAddress: row.customer_address,
    clientIP: row.client_ip,
    source: row.source,
    fechaPago: row.fecha_pago,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// GET: Get single presupuesto
export const GET: APIRoute = async ({ params, locals }) => {
  try {
    const db = getD1(locals);
    const { id } = params;

    if (!db) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Base de datos no configurada'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!id) {
      return new Response(JSON.stringify({
        success: false,
        error: 'ID requerido'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = await db.prepare(
      'SELECT * FROM presupuestos WHERE id = ?'
    ).bind(id).first<D1Presupuesto>();

    if (!result) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Presupuesto no encontrado'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      presupuesto: transformPresupuesto(result)
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error getting presupuesto:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al obtener presupuesto'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// PUT: Update presupuesto
export const PUT: APIRoute = async ({ params, request, locals }) => {
  try {
    const db = getD1(locals);
    const { id } = params;

    if (!db) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Base de datos no configurada'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!id) {
      return new Response(JSON.stringify({
        success: false,
        error: 'ID requerido'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();

    // Check what type of update this is
    if ('status' in body && Object.keys(body).length === 1) {
      // Status-only update
      const { status } = body;
      if (!['pendiente', 'pagado'].includes(status)) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Estado invalido'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const fechaPago = status === 'pagado' ? new Date().toISOString() : null;

      await db.prepare(`
        UPDATE presupuestos
        SET estado = ?, fecha_pago = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(status, fechaPago, id).run();
    } else if ('customerName' in body && Object.keys(body).length === 1) {
      // Customer name only update (when assigning presupuesto to customer)
      const { customerName } = body;

      // Try to link budget to customer account (creates transaction with correct is_paid status)
      if (customerName) {
        const linkResult = await linkBudgetToCustomer(db, id, customerName);
        if (!linkResult.success) {
          // If linking failed (customer not found, etc.), just update the name
          await db.prepare(`
            UPDATE presupuestos
            SET customer_name = ?, updated_at = datetime('now')
            WHERE id = ?
          `).bind(customerName, id).run();
        }
      } else {
        await db.prepare(`
          UPDATE presupuestos
          SET customer_name = ?, updated_at = datetime('now')
          WHERE id = ?
        `).bind(null, id).run();
      }
    } else {
      // Full update (items, totals, customer info)
      const { items, totalUSD, totalBs, totalUSDDivisa, hideRate, delivery, modoPrecio, customerName, customerAddress, fecha } = body;

      // Build update query - include fecha if provided
      // Normalize date to noon UTC to avoid timezone issues (YYYY-MM-DD → YYYY-MM-DDT12:00:00.000Z)
      const fechaNormalized = fecha && fecha.length === 10 ? `${fecha}T12:00:00.000Z` : fecha;
      if (fechaNormalized) {
        await db.prepare(`
          UPDATE presupuestos
          SET fecha = ?, items = ?, total_usd = ?, total_bs = ?, total_usd_divisa = ?, hide_rate = ?, delivery = ?, modo_precio = ?, customer_name = ?, customer_address = ?, updated_at = datetime('now')
          WHERE id = ?
        `).bind(
          fechaNormalized,
          JSON.stringify(items),
          totalUSD,
          totalBs,
          totalUSDDivisa || null,
          hideRate ? 1 : 0,
          delivery || 0,
          modoPrecio || 'bcv',
          customerName || null,
          customerAddress || null,
          id
        ).run();
      } else {
        await db.prepare(`
          UPDATE presupuestos
          SET items = ?, total_usd = ?, total_bs = ?, total_usd_divisa = ?, hide_rate = ?, delivery = ?, modo_precio = ?, customer_name = ?, customer_address = ?, updated_at = datetime('now')
          WHERE id = ?
        `).bind(
          JSON.stringify(items),
          totalUSD,
          totalBs,
          totalUSDDivisa || null,
          hideRate ? 1 : 0,
          delivery || 0,
          modoPrecio || 'bcv',
          customerName || null,
          customerAddress || null,
          id
        ).run();
      }

      // Also update any linked customer transactions
      const txUpdateFields = fecha
        ? 'date = ?, amount_usd = ?, amount_bs = ?, amount_usd_divisa = ?, description = ?'
        : 'amount_usd = ?, amount_bs = ?, amount_usd_divisa = ?, description = ?';
      const txParams = fecha
        ? [fecha.split('T')[0], totalUSD, totalBs, totalUSDDivisa || null, `Presupuesto ${id}`, id]
        : [totalUSD, totalBs, totalUSDDivisa || null, `Presupuesto ${id}`, id];

      await db.prepare(`
        UPDATE customer_transactions
        SET ${txUpdateFields}
        WHERE presupuesto_id = ? AND type = 'purchase'
      `).bind(...txParams).run();

      // If customerName is set, ensure budget is linked to the correct customer
      // (handles relinking if customer changed)
      if (customerName) {
        await linkBudgetToCustomer(db, id, customerName);
      }
    }

    return new Response(JSON.stringify({
      success: true
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating presupuesto:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al actualizar presupuesto'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// DELETE: Delete presupuesto
export const DELETE: APIRoute = async ({ params, locals }) => {
  try {
    const db = getD1(locals);
    const { id } = params;

    if (!db) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Base de datos no configurada'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!id) {
      return new Response(JSON.stringify({
        success: false,
        error: 'ID requerido'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if presupuesto is linked to customer transactions
    const linked = await db.prepare(`
      SELECT COUNT(*) as count FROM customer_transactions WHERE presupuesto_id = ?
    `).bind(id).first<{ count: number }>();

    if (linked && linked.count > 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No se puede eliminar: este presupuesto está vinculado a una cuenta de cliente'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await db.prepare('DELETE FROM presupuestos WHERE id = ?').bind(id).run();

    return new Response(JSON.stringify({
      success: true
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error deleting presupuesto:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al eliminar presupuesto'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
