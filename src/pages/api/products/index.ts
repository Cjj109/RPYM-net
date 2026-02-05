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
 * GET /api/products - List all products
 * Public endpoint - no auth required
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

    const results = await db.prepare(`
      SELECT * FROM products ORDER BY sort_order ASC, categoria ASC, nombre ASC
    `).all<ProductRow>();

    const products = results.results.map(row => ({
      id: row.id,
      nombre: row.nombre,
      descripcion: row.descripcion || '',
      descripcionCorta: row.descripcion_corta || '',
      descripcionHome: row.descripcion_home || '',
      categoria: row.categoria,
      precioUSD: row.precio_usd,
      precioUSDDivisa: row.precio_usd_divisa,
      unidad: row.unidad,
      disponible: row.disponible === 1,
      sortOrder: row.sort_order
    }));

    return new Response(JSON.stringify({
      success: true,
      products,
      count: products.length
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });

  } catch (error) {
    console.error('Error fetching products:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error fetching products'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

/**
 * POST /api/products - Create a new product
 * Admin only
 */
export const POST: APIRoute = async ({ request, locals }) => {
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

    // Validate required fields
    if (!nombre || !categoria || precioUSD === undefined) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Nombre, categoria y precio son requeridos'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = await db.prepare(`
      INSERT INTO products (nombre, descripcion, descripcion_corta, descripcion_home, categoria, precio_usd, precio_usd_divisa, unidad, disponible, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      nombre,
      descripcion || null,
      descripcionCorta || null,
      descripcionHome || null,
      categoria,
      precioUSD,
      precioUSDDivisa != null ? precioUSDDivisa : null,
      unidad || 'kg',
      disponible !== false ? 1 : 0,
      sortOrder || 0
    ).run();

    return new Response(JSON.stringify({
      success: true,
      id: result.meta.last_row_id,
      message: 'Producto creado'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error creating product:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al crear producto'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
