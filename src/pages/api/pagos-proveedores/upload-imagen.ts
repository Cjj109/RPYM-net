import type { APIRoute } from 'astro';
import { getR2 } from '../../../lib/d1-types';
import { requireAuth } from '../../../lib/require-auth';

export const prerender = false;

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

// POST /api/pagos-proveedores/upload-imagen - Upload payment proof image to R2
// Now works with abonos_proveedores table
export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;
  const r2 = getR2(locals);

  if (!r2) {
    return new Response(JSON.stringify({ success: false, error: 'Almacenamiento de imagenes no disponible' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const formData = await request.formData();
    const imageFile = formData.get('image') as File | null;
    const abonoId = formData.get('abonoId') as string | null;

    if (!imageFile || !abonoId) {
      return new Response(JSON.stringify({ success: false, error: 'Imagen y abonoId son requeridos' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    if (imageFile.size > MAX_IMAGE_SIZE) {
      return new Response(JSON.stringify({ success: false, error: 'La imagen es demasiado grande. Maximo 5MB.' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get abono + compra to find proveedor_id and existing image
    const abono = await db.prepare(`
      SELECT a.imagen_key, c.proveedor_id
      FROM abonos_proveedores a
      JOIN compras_proveedores c ON a.compra_id = c.id
      WHERE a.id = ?
    `).bind(abonoId).first<{ imagen_key: string | null; proveedor_id: number }>();

    if (!abono) {
      return new Response(JSON.stringify({ success: false, error: 'Abono no encontrado' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Delete old image if exists
    if (abono.imagen_key) {
      try {
        await r2.delete(abono.imagen_key);
      } catch (e) {
        console.error('Error deleting old R2 image:', e);
      }
    }

    // Determine file extension
    const contentType = imageFile.type || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';

    // Generate R2 key
    const timestamp = Date.now();
    const r2Key = `pagos-proveedores/${abono.proveedor_id}/${abonoId}-${timestamp}.${ext}`;

    // Upload to R2
    const arrayBuffer = await imageFile.arrayBuffer();
    await r2.put(r2Key, arrayBuffer, {
      httpMetadata: { contentType }
    });

    // Update abono with image key
    await db.prepare(
      "UPDATE abonos_proveedores SET imagen_key = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(r2Key, abonoId).run();

    return new Response(JSON.stringify({
      success: true,
      imagenUrl: `/api/pagos-proveedores/imagen/${r2Key}`
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error uploading payment image:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al subir la imagen' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
