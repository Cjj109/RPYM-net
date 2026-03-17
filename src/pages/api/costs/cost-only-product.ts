/**
 * API: Crear, actualizar y eliminar productos solo-costo
 * POST: Crea un producto que solo existe en la sección de costos
 * PUT: Actualiza precios de venta de un producto solo-costo
 * DELETE: Elimina un producto solo-costo
 */
import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const { nombre, categoria, unidad, costUsd, purchaseRateType, precioUsd, precioUsdDivisa } = await request.json();

    if (!nombre?.trim() || !categoria?.trim()) {
      return new Response(JSON.stringify({ success: false, error: 'Nombre y categoría son requeridos' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    if (costUsd == null || isNaN(costUsd) || costUsd < 0) {
      return new Response(JSON.stringify({ success: false, error: 'Costo USD inválido' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!['BCV', 'PARALELO'].includes(purchaseRateType)) {
      return new Response(JSON.stringify({ success: false, error: 'Tipo de tasa inválido' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Crear producto con solo_costos = 1, disponible = 0
    const productResult = await db.prepare(`
      INSERT INTO products (nombre, categoria, unidad, precio_usd, precio_usd_divisa, disponible, solo_costos, sort_order)
      VALUES (?, ?, ?, ?, ?, 0, 1, 9999)
    `).bind(
      nombre.trim(),
      categoria.trim(),
      unidad || 'kg',
      precioUsd ?? 0,
      precioUsdDivisa ?? null
    ).run();

    const productId = productResult.meta.last_row_id;

    // Crear registro de costo
    await db.prepare(`
      INSERT INTO product_costs (product_id, cost_usd, purchase_rate_type)
      VALUES (?, ?, ?)
    `).bind(productId, costUsd, purchaseRateType).run();

    // Registrar en historial
    const settings = await db.prepare(
      'SELECT bcv_rate, parallel_rate FROM cost_settings ORDER BY id DESC LIMIT 1'
    ).first<any>();

    if (settings) {
      const realUsd = purchaseRateType === 'BCV'
        ? costUsd * (settings.bcv_rate / settings.parallel_rate)
        : costUsd;
      await db.prepare(`
        INSERT INTO purchase_price_history
          (product_id, product_name, old_cost_usd, new_cost_usd, old_rate_type, new_rate_type,
           bcv_rate_at_change, parallel_rate_at_change, old_real_usd, new_real_usd, notes)
        VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, NULL, ?, 'Producto creado (solo costo)')
      `).bind(
        productId, nombre.trim(), costUsd, purchaseRateType,
        settings.bcv_rate, settings.parallel_rate, realUsd
      ).run();
    }

    return new Response(JSON.stringify({ success: true, id: productId }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error creando producto solo-costo:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al crear producto' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const { productId, precioUsd, precioUsdDivisa } = await request.json();

    if (!productId) {
      return new Response(JSON.stringify({ success: false, error: 'productId es requerido' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    await db.prepare(`
      UPDATE products SET precio_usd = ?, precio_usd_divisa = ?, updated_at = datetime('now')
      WHERE id = ? AND solo_costos = 1
    `).bind(precioUsd ?? 0, precioUsdDivisa ?? null, productId).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error actualizando precios solo-costo:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al actualizar precios' }), {
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

    // Verificar que sea solo_costos
    const product = await db.prepare(
      'SELECT id, solo_costos FROM products WHERE id = ?'
    ).bind(id).first<any>();

    if (!product) {
      return new Response(JSON.stringify({ success: false, error: 'Producto no encontrado' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }

    if (product.solo_costos !== 1) {
      return new Response(JSON.stringify({ success: false, error: 'Solo se pueden eliminar productos solo-costo desde aquí' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    await db.batch([
      db.prepare('DELETE FROM purchase_price_history WHERE product_id = ?').bind(id),
      db.prepare('DELETE FROM product_costs WHERE product_id = ?').bind(id),
      db.prepare('DELETE FROM products WHERE id = ?').bind(id),
    ]);

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error eliminando producto solo-costo:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al eliminar producto' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
