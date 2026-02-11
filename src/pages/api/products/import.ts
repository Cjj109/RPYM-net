import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';
import { getSheetId } from '../../../lib/env';

export const prerender = false;

interface SheetRow {
  nombre: string;
  precio: number;
  disponible: boolean;
  categoria: string;
  unidad: string;
  descripcion: string;
}

/**
 * POST /api/products/import - Import products from Google Sheet
 * Admin only - one-time migration
 */
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const auth = await requireAuth(request, locals);
    if (auth instanceof Response) return auth;
    const { db } = auth;

    const sheetId = getSheetId(locals);
    if (!sheetId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'PUBLIC_SHEET_ID no configurado en variables de entorno'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if products already exist
    const existing = await db.prepare('SELECT COUNT(*) as count FROM products').first<{ count: number }>();
    if (existing && existing.count > 0) {
      return new Response(JSON.stringify({
        success: false,
        error: `Ya existen ${existing.count} productos en la base de datos. Eliminalos primero si quieres reimportar.`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Fetch data from Google Sheets
    console.log('Fetching data from Google Sheets...');
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch sheet: ${response.status}`);
    }

    const text = await response.text();

    // Parse JSONP response
    const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
    if (!jsonMatch) {
      throw new Error('Invalid response format from Google Sheets');
    }

    const data = JSON.parse(jsonMatch[1]);
    const rows = data.table.rows;

    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No se encontraron datos en el Sheet'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Parse rows from Sheet
    // Columns: A=Producto, D=Precio, E=Disponible, F=Categoria, G=Unidad, H=Descripcion
    const products: SheetRow[] = [];

    for (const row of rows) {
      const cells = row.c;
      if (!cells || !cells[0]?.v) continue; // Skip empty rows

      const nombre = String(cells[0]?.v || '').trim();
      if (!nombre) continue;

      // Column D (index 3) = Precio
      const precioRaw = cells[3]?.v;
      const precio = typeof precioRaw === 'number' ? precioRaw : parseFloat(String(precioRaw || '0'));

      // Column E (index 4) = Disponible (SI/NO)
      const disponibleRaw = String(cells[4]?.v || 'SI').toUpperCase();
      const disponible = disponibleRaw === 'SI' || disponibleRaw === 'YES' || disponibleRaw === '1';

      // Column F (index 5) = Categoria
      const categoria = String(cells[5]?.v || 'Otros').trim();

      // Column G (index 6) = Unidad
      const unidad = String(cells[6]?.v || 'kg').trim().toLowerCase();

      // Column H (index 7) = Descripcion
      const descripcion = String(cells[7]?.v || '').trim();

      if (precio > 0) {
        products.push({
          nombre,
          precio,
          disponible,
          categoria,
          unidad,
          descripcion
        });
      }
    }

    if (products.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No se encontraron productos validos en el Sheet'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Insert products into D1
    console.log(`Inserting ${products.length} products into D1...`);

    const statements = products.map((product, index) =>
      db.prepare(`
        INSERT INTO products (nombre, descripcion, categoria, precio_usd, unidad, disponible, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        product.nombre,
        product.descripcion || null,
        product.categoria,
        product.precio,
        product.unidad,
        product.disponible ? 1 : 0,
        index
      )
    );

    // Execute in batches of 50 (D1 batch limit)
    const batchSize = 50;
    let inserted = 0;

    for (let i = 0; i < statements.length; i += batchSize) {
      const batch = statements.slice(i, i + batchSize);
      await db.batch(batch);
      inserted += batch.length;
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Importados ${inserted} productos exitosamente`,
      count: inserted,
      products: products.map(p => ({ nombre: p.nombre, categoria: p.categoria, precio: p.precio }))
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error importing products:', error);
    return new Response(JSON.stringify({
      success: false,
      error: `Error al importar: ${error instanceof Error ? error.message : 'Unknown error'}`
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

/**
 * DELETE /api/products/import - Clear all products (for re-import)
 * Admin only
 */
export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const auth = await requireAuth(request, locals);
    if (auth instanceof Response) return auth;
    const { db } = auth;

    await db.prepare('DELETE FROM products').run();

    return new Response(JSON.stringify({
      success: true,
      message: 'Todos los productos eliminados'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error clearing products:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al eliminar productos'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
