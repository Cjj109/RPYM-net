import type { APIRoute } from 'astro';
import { getD1 } from '../../../lib/d1-types';
import { validateSession, getSessionFromCookie } from '../../../lib/auth';

export const prerender = false;

interface ProductRow {
  id: number;
  nombre: string;
  descripcion: string | null;
  descripcion_corta: string | null;
  descripcion_home: string | null;
  categoria: string;
  precio_usd: number;
  precio_usd_divisa: number | null;
  unidad: string;
  disponible: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/products/[id] - Get a single product
 * Public endpoint
 */
export const GET: APIRoute = async ({ params, locals }) => {
  try {
    const db = getD1(locals);
    const { id } = params;

    if (!db) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Database not configured'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = await db.prepare(`
      SELECT * FROM products WHERE id = ?
    `).bind(id).first<ProductRow>();

    if (!result) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Producto no encontrado'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      product: {
        id: result.id,
        nombre: result.nombre,
        descripcion: result.descripcion || '',
        descripcionCorta: result.descripcion_corta || '',
        descripcionHome: result.descripcion_home || '',
        categoria: result.categoria,
        precioUSD: result.precio_usd,
        precioUSDDivisa: result.precio_usd_divisa,
        unidad: result.unidad,
        disponible: result.disponible === 1,
        sortOrder: result.sort_order
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error fetching product:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error fetching product'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

/**
 * PUT /api/products/[id] - Update a product
 * Admin only
 */
export const PUT: APIRoute = async ({ params, request, locals }) => {
  try {
    const db = getD1(locals);
    const { id } = params;

    if (!db) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Database not configured'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify admin auth
    const sessionId = getSessionFromCookie(request.headers.get('Cookie'));
    if (!sessionId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No autenticado'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const user = await validateSession(db, sessionId);
    if (!user) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Sesion invalida'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { nombre, descripcion, descripcionCorta, descripcionHome, categoria, precioUSD, precioUSDDivisa, unidad, disponible, sortOrder } = body;

    // Build dynamic update query
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (nombre !== undefined) {
      updates.push('nombre = ?');
      values.push(nombre);
    }
    if (descripcion !== undefined) {
      updates.push('descripcion = ?');
      values.push(descripcion || null);
    }
    if (descripcionCorta !== undefined) {
      updates.push('descripcion_corta = ?');
      values.push(descripcionCorta || null);
    }
    if (descripcionHome !== undefined) {
      updates.push('descripcion_home = ?');
      values.push(descripcionHome || null);
    }
    if (categoria !== undefined) {
      updates.push('categoria = ?');
      values.push(categoria);
    }
    if (precioUSD !== undefined) {
      updates.push('precio_usd = ?');
      values.push(precioUSD);
    }
    if (precioUSDDivisa !== undefined) {
      updates.push('precio_usd_divisa = ?');
      values.push(precioUSDDivisa === null || precioUSDDivisa === '' ? null : precioUSDDivisa);
    }
    if (unidad !== undefined) {
      updates.push('unidad = ?');
      values.push(unidad);
    }
    if (disponible !== undefined) {
      updates.push('disponible = ?');
      values.push(disponible ? 1 : 0);
    }
    if (sortOrder !== undefined) {
      updates.push('sort_order = ?');
      values.push(sortOrder);
    }

    if (updates.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No hay campos para actualizar'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    updates.push("updated_at = datetime('now')");
    values.push(id!);

    await db.prepare(`
      UPDATE products SET ${updates.join(', ')} WHERE id = ?
    `).bind(...values).run();

    return new Response(JSON.stringify({
      success: true,
      message: 'Producto actualizado'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error updating product:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al actualizar producto'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

/**
 * DELETE /api/products/[id] - Delete a product
 * Admin only
 */
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  try {
    const db = getD1(locals);
    const { id } = params;

    if (!db) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Database not configured'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify admin auth
    const sessionId = getSessionFromCookie(request.headers.get('Cookie'));
    if (!sessionId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No autenticado'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const user = await validateSession(db, sessionId);
    if (!user) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Sesion invalida'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await db.prepare(`
      DELETE FROM products WHERE id = ?
    `).bind(id).run();

    return new Response(JSON.stringify({
      success: true,
      message: 'Producto eliminado'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error deleting product:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al eliminar producto'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
