import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/require-auth';
import { getEnv } from '../../../lib/env';
import {
  getAIPreference,
  saveAIPreference,
  ALL_PROVIDERS,
  PROVIDER_META,
  isAIProvider,
} from '../../../lib/ai-config';

export const prerender = false;

const jsonHeaders = { 'Content-Type': 'application/json' };

/**
 * Devuelve la preferencia actual de IA y qué proveedores tienen API key
 * configurada en el entorno (para deshabilitar opciones sin key en la UI).
 */
export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const env = getEnv(locals);
    const keyPresent: Record<string, boolean> = {
      gemini: !!env.GEMINI_API_KEY,
      claude: !!env.CLAUDE_API_KEY,
      openai: !!env.OPENAI_API_KEY,
    };

    const { primary, fallback } = await getAIPreference(db);

    const providers = ALL_PROVIDERS.map((id) => ({
      id,
      label: PROVIDER_META[id].label,
      available: keyPresent[id] ?? false,
    }));

    return new Response(JSON.stringify({ success: true, primary, fallback, providers }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error('Error al cargar configuración de IA:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al cargar la configuración de IA' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
};

/**
 * Guarda la preferencia de IA (proveedor principal y de respaldo).
 */
export const PUT: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const body = await request.json();
    const { primary, fallback } = body;

    if (!isAIProvider(primary) || !isAIProvider(fallback)) {
      return new Response(JSON.stringify({ success: false, error: 'Proveedor de IA inválido' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    await saveAIPreference(db, primary, fallback);

    return new Response(JSON.stringify({ success: true, primary, fallback }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error('Error al guardar configuración de IA:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al guardar la configuración de IA' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
};
