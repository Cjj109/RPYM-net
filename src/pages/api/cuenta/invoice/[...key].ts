import type { APIRoute } from 'astro';
import { getD1, getR2 } from '../../../../lib/d1-types';

export const prerender = false;

// GET /api/cuenta/invoice/:key?token=XXXX - Public endpoint to serve invoice images
// Validates that the token's customer owns a transaction with this invoice_image_key
export const GET: APIRoute = async ({ params, request, locals }) => {
  const db = getD1(locals);
  const r2 = getR2(locals);

  if (!db || !r2) {
    return new Response('Service unavailable', { status: 503 });
  }

  try {
    const key = params.key;
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!key || !token) {
      return new Response('Not found', { status: 404 });
    }

    // Validate token -> get customer
    const customer = await db.prepare(`
      SELECT id FROM customers WHERE share_token = ? AND is_active = 1
    `).bind(token).first<{ id: number }>();

    if (!customer) {
      return new Response('Forbidden', { status: 403 });
    }

    // Verify this customer has a transaction with this invoice_image_key
    const tx = await db.prepare(`
      SELECT id FROM customer_transactions
      WHERE customer_id = ? AND invoice_image_key = ?
      LIMIT 1
    `).bind(customer.id, key).first();

    if (!tx) {
      return new Response('Forbidden', { status: 403 });
    }

    const object = await r2.get(key);
    if (!object) {
      return new Response('Not found', { status: 404 });
    }

    const arrayBuffer = await object.arrayBuffer();

    let contentType = 'image/jpeg';
    if (key.endsWith('.png')) contentType = 'image/png';
    else if (key.endsWith('.webp')) contentType = 'image/webp';

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      }
    });
  } catch (error) {
    console.error('Error serving public invoice image:', error);
    return new Response('Internal server error', { status: 500 });
  }
};
