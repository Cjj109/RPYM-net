import type { APIRoute } from 'astro';
import { getD1, getR2 } from '../../../lib/d1-types';
import { validateSession, getSessionFromCookie } from '../../../lib/auth';

export const prerender = false;

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

// POST /api/customers/upload-invoice - Upload invoice image to R2
export const POST: APIRoute = async ({ request, locals }) => {
  const db = getD1(locals);
  const r2 = getR2(locals);

  if (!db) {
    return new Response(JSON.stringify({ success: false, error: 'Database no disponible' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!r2) {
    return new Response(JSON.stringify({ success: false, error: 'Almacenamiento de imagenes no disponible' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  const sessionId = getSessionFromCookie(request.headers.get('Cookie'));
  if (!sessionId) {
    return new Response(JSON.stringify({ success: false, error: 'No autenticado' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }
  const user = await validateSession(db, sessionId);
  if (!user) {
    return new Response(JSON.stringify({ success: false, error: 'Sesion invalida' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const formData = await request.formData();
    const imageFile = formData.get('image') as File | null;
    const transactionId = formData.get('transactionId') as string | null;

    if (!imageFile || !transactionId) {
      return new Response(JSON.stringify({ success: false, error: 'Imagen y transactionId son requeridos' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    if (imageFile.size > MAX_IMAGE_SIZE) {
      return new Response(JSON.stringify({ success: false, error: 'La imagen es demasiado grande. Maximo 5MB.' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get transaction to find customer_id
    const tx = await db.prepare(
      'SELECT customer_id, invoice_image_key FROM customer_transactions WHERE id = ?'
    ).bind(transactionId).first<{ customer_id: number; invoice_image_key: string | null }>();

    if (!tx) {
      return new Response(JSON.stringify({ success: false, error: 'Transaccion no encontrada' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Delete old image if exists
    if (tx.invoice_image_key) {
      try {
        await r2.delete(tx.invoice_image_key);
      } catch (e) {
        console.error('Error deleting old R2 image:', e);
      }
    }

    // Determine file extension
    const contentType = imageFile.type || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';

    // Generate R2 key
    const timestamp = Date.now();
    const r2Key = `invoices/${tx.customer_id}/${transactionId}-${timestamp}.${ext}`;

    // Upload to R2
    const arrayBuffer = await imageFile.arrayBuffer();
    await r2.put(r2Key, arrayBuffer, {
      httpMetadata: { contentType }
    });

    // Update transaction with image key
    await db.prepare(
      "UPDATE customer_transactions SET invoice_image_key = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(r2Key, transactionId).run();

    return new Response(JSON.stringify({
      success: true,
      imageUrl: `/api/customers/invoice/${r2Key}`
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error uploading invoice:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al subir la imagen' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
