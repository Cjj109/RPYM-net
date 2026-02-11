import type { APIRoute } from 'astro';
import { getAuthOptional } from '../../../lib/require-auth';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const auth = await getAuthOptional(request, locals);

    if (!auth.user) {
      return new Response(JSON.stringify({ authenticated: false }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      authenticated: true,
      user: {
        username: auth.user.username,
        displayName: auth.user.displayName,
        role: auth.user.role
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Auth check error:', error);
    return new Response(JSON.stringify({ authenticated: false }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
