import type { APIRoute } from 'astro';
import { getD1, type ThemeName } from '../../../lib/d1-types';

export const prerender = false;

const VALID_THEMES: ThemeName[] = ['ocean', 'carnival', 'christmas', 'easter', 'valentine', 'mundial', 'halloween'];

export const GET: APIRoute = async ({ locals }) => {
  try {
    const db = getD1(locals);

    if (!db) {
      // Fallback when D1 is not configured (dev mode without D1)
      return new Response(JSON.stringify({
        theme: 'ocean',
        updatedAt: new Date().toISOString()
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    }

    const result = await db.prepare(
      "SELECT value, updated_at FROM site_config WHERE key = 'theme'"
    ).first<{ value: string; updated_at: string }>();

    return new Response(JSON.stringify({
      theme: result?.value || 'ocean',
      updatedAt: result?.updated_at || new Date().toISOString()
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  } catch (error) {
    console.error('Error getting theme:', error);
    return new Response(JSON.stringify({
      theme: 'ocean',
      updatedAt: new Date().toISOString()
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const db = getD1(locals);

    if (!db) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Base de datos no configurada'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const theme = body.theme as ThemeName;

    if (!VALID_THEMES.includes(theme)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Tema invalido'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await db.prepare(
      "INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES ('theme', ?, datetime('now'))"
    ).bind(theme).run();

    return new Response(JSON.stringify({
      success: true,
      theme
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating theme:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error al guardar el tema'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
