import type { APIRoute } from 'astro';
import { requireAuth } from '../../lib/require-auth';
import { getEnv } from '../../lib/env';
import type { D1Database } from '../../lib/d1-types';

export const prerender = false;

/**
 * Emite un token efímero para que el navegador abra el WebSocket de
 * transcripción en vivo directamente contra OpenAI.
 *
 * La llave real nunca sale del servidor: OpenAI devuelve una credencial que
 * vive cinco minutos y solo sirve para esta sesión de transcripción. El
 * vocabulario del negocio se fija acá, al crear la sesión, para que el cliente
 * no pueda alterarlo.
 */

const MODEL = 'gpt-live-transcribe';

/** Nombres propios que el reconocimiento debe preferir */
async function cargarKeywords(db: D1Database): Promise<string[]> {
  try {
    const [clientes, productos] = await db.batch([
      db.prepare('SELECT name FROM customers WHERE is_active = 1 ORDER BY name LIMIT 200'),
      db.prepare('SELECT nombre FROM products WHERE disponible = 1 ORDER BY nombre LIMIT 200'),
    ]);
    return [
      ...(clientes.results as Array<{ name: string }>).map(r => r.name),
      ...(productos.results as Array<{ nombre: string }>).map(r => r.nombre),
    ].filter(Boolean);
  } catch (e) {
    console.error('[realtime-token] No se pudo cargar el vocabulario:', e);
    return [];
  }
}

export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const apiKey = getEnv(locals).OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'Dictado en vivo no configurado' }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      });
    }

    const keywords = await cargarKeywords(db);

    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24000 },
              transcription: {
                model: MODEL,
                prompt: 'Nota de voz de una pescadería en Venezuela: pedidos de clientes con cantidades en kilos y abonos en dólares. Puede haber ruido de mercado.',
                keywords,
                languages: ['es'],
                delay: 'low',
              },
              // El corte de turno lo decide el cliente: ya tiene su propio
              // detector de silencio y un botón de "listo", y así el usuario
              // manda sobre cuándo termina la nota.
              turn_detection: null,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[realtime-token] Error ${response.status}:`, errorText.substring(0, 300));
      return new Response(JSON.stringify({ success: false, error: 'No se pudo iniciar el dictado en vivo' }), {
        status: 502, headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const value = data?.value;
    if (!value) {
      console.error('[realtime-token] Respuesta sin token:', JSON.stringify(data).substring(0, 300));
      return new Response(JSON.stringify({ success: false, error: 'Respuesta inválida de OpenAI' }), {
        status: 502, headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, token: value, model: MODEL }), {
      status: 200,
      // Es una credencial de un solo uso: nunca debe quedar en ninguna caché
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Error en realtime-token:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al iniciar el dictado' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
