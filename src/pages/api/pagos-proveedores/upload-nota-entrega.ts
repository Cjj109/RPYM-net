import type { APIRoute } from 'astro';
import { getR2 } from '../../../lib/d1-types';
import { requireAuth } from '../../../lib/require-auth';

export const prerender = false;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// POST /api/pagos-proveedores/upload-nota-entrega - Upload delivery note to R2
export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;
  const r2 = getR2(locals);

  if (!r2) {
    return new Response(JSON.stringify({ success: false, error: 'Almacenamiento no disponible' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const compraId = formData.get('compraId') as string | null;

    if (!file || !compraId) {
      return new Response(JSON.stringify({ success: false, error: 'Archivo y compraId son requeridos' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    if (file.size > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({ success: false, error: 'El archivo es demasiado grande. Maximo 10MB.' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get compra to find proveedor_id and existing nota
    const compra = await db.prepare(
      'SELECT proveedor_id, nota_entrega_key FROM compras_proveedores WHERE id = ?'
    ).bind(compraId).first<{ proveedor_id: number; nota_entrega_key: string | null }>();

    if (!compra) {
      return new Response(JSON.stringify({ success: false, error: 'Compra no encontrada' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Delete old file if exists
    if (compra.nota_entrega_key) {
      try {
        await r2.delete(compra.nota_entrega_key);
      } catch (e) {
        console.error('Error deleting old nota entrega:', e);
      }
    }

    // Determine file extension
    const contentType = file.type || 'application/octet-stream';
    let ext = 'jpg';
    if (contentType.includes('pdf')) ext = 'pdf';
    else if (contentType.includes('png')) ext = 'png';
    else if (contentType.includes('webp')) ext = 'webp';

    // Generate R2 key
    const timestamp = Date.now();
    const r2Key = `compras-proveedores/nota-entrega/${compra.proveedor_id}/${compraId}-${timestamp}.${ext}`;

    // Upload to R2
    const arrayBuffer = await file.arrayBuffer();
    await r2.put(r2Key, arrayBuffer, {
      httpMetadata: { contentType }
    });

    // Update compra with nota entrega key
    await db.prepare(
      "UPDATE compras_proveedores SET nota_entrega_key = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(r2Key, compraId).run();

    return new Response(JSON.stringify({
      success: true,
      notaEntregaUrl: `/api/pagos-proveedores/nota-entrega/${r2Key}`
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error uploading nota entrega:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al subir nota de entrega' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
