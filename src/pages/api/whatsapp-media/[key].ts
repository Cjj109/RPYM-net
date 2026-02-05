import type { APIRoute } from 'astro';
import { getR2 } from '../../../lib/d1-types';

export const prerender = false;

/**
 * Public endpoint to serve WhatsApp media images from R2
 * No auth required - Meta WhatsApp Cloud API fetches this URL to send the image
 * Images are stored with random UUID keys for security
 * Only serves files from the 'whatsapp/' prefix in R2
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const r2 = getR2(locals);

  if (!r2) {
    return new Response('Service unavailable', { status: 503 });
  }

  try {
    const key = params.key;
    if (!key) {
      return new Response('Not found', { status: 404 });
    }

    // Only serve files from the whatsapp/ prefix for security
    const r2Key = `whatsapp/${key}`;
    const object = await r2.get(r2Key);
    if (!object) {
      return new Response('Not found', { status: 404 });
    }

    const arrayBuffer = await object.arrayBuffer();

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      }
    });
  } catch (error) {
    console.error('Error serving WhatsApp media:', error);
    return new Response('Internal server error', { status: 500 });
  }
};
