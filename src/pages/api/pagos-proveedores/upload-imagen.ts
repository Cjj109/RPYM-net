import type { APIRoute } from 'astro';
import { getR2 } from '../../../lib/d1-types';
import { requireAuth } from '../../../lib/require-auth';

export const prerender = false;

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

// POST /api/pagos-proveedores/upload-imagen - Upload payment proof image to R2
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
    const pagoId = formData.get('pagoId') as string | null;

    if (!imageFile || !pagoId) {
      return new Response(JSON.stringify({ success: false, error: 'Imagen y pagoId son requeridos' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    if (imageFile.size > MAX_IMAGE_SIZE) {
      return new Response(JSON.stringify({ success: false, error: 'La imagen es demasiado grande. Maximo 5MB.' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get payment to find proveedor_id and existing image
    const pago = await db.prepare(
      'SELECT proveedor_id, imagen_key FROM pagos_proveedores WHERE id = ?'
    ).bind(pagoId).first<{ proveedor_id: number; imagen_key: string | null }>();

    if (!pago) {
      return new Response(JSON.stringify({ success: false, error: 'Pago no encontrado' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Delete old image if exists
    if (pago.imagen_key) {
      try {
        await r2.delete(pago.imagen_key);
      } catch (e) {
        console.error('Error deleting old R2 image:', e);
      }
    }

    // Determine file extension
    const contentType = imageFile.type || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';

    // Generate R2 key
    const timestamp = Date.now();
    const r2Key = `pagos-proveedores/${pago.proveedor_id}/${pagoId}-${timestamp}.${ext}`;

    // Upload to R2
    const arrayBuffer = await imageFile.arrayBuffer();
    await r2.put(r2Key, arrayBuffer, {
      httpMetadata: { contentType }
    });

    // Update payment with image key
    await db.prepare(
      "UPDATE pagos_proveedores SET imagen_key = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(r2Key, pagoId).run();

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
