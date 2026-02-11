import type { APIRoute } from 'astro';
import { getR2 } from '../../../../lib/d1-types';
import { requireAuth } from '../../../../lib/require-auth';

export const prerender = false;

// GET /api/customers/invoice/:key - Serve invoice image from R2
export const GET: APIRoute = async ({ params, request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const r2 = getR2(locals);

  if (!r2) {
    return new Response('Service unavailable', { status: 503 });
  }

  try {
    const key = params.key;
    if (!key) {
      return new Response('Not found', { status: 404 });
    }

    const object = await r2.get(key);
    if (!object) {
      return new Response('Not found', { status: 404 });
    }

    const arrayBuffer = await object.arrayBuffer();

    // Determine content type from key extension
    let contentType = 'image/jpeg';
    if (key.endsWith('.png')) contentType = 'image/png';
    else if (key.endsWith('.webp')) contentType = 'image/webp';

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      }
    });
  } catch (error) {
    console.error('Error serving invoice image:', error);
    return new Response('Internal server error', { status: 500 });
  }
};
