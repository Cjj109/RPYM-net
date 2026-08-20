import type { APIRoute } from 'astro';
import { requireAuth } from '../../lib/require-auth';
import { getEnv } from '../../lib/env';

export const prerender = false;

/**
 * Transcripción de audio a texto para la anotación rápida hablada.
 *
 * Solo se usa donde el navegador no expone reconocimiento nativo — sobre todo
 * Safari iOS cuando la página corre instalada como PWA, que bloquea el
 * SpeechRecognition. En Android y escritorio el navegador transcribe solo y
 * este endpoint ni se llama.
 *
 * Usa gemini-3.5-flash y no el flash-lite: lite está afinado para throughput,
 * y aquí importa más acertar nombres de productos y clientes dictados en
 * español venezolano que el costo, porque el volumen de esta ruta es bajo.
 */

const MODEL = 'gemini-3.5-flash';
const MAX_AUDIO_BASE64 = 15 * 1024 * 1024; // Gemini corta en 20MB con todo y prompt

export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const env = getEnv(locals);
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'Transcripción no configurada' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    const audioBase64: string = body?.audioBase64 || '';

    if (!audioBase64) {
      return new Response(JSON.stringify({ success: false, error: 'No se recibió audio' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (audioBase64.length > MAX_AUDIO_BASE64) {
      return new Response(JSON.stringify({ success: false, error: 'La nota de voz es muy larga' }), {
        status: 413, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Se le pasan los nombres reales de clientes y productos como contexto: sin
    // esto el modelo escribe lo que oye fonéticamente ("Delsy", "calamares") y
    // la IA de anotaciones ya no logra matchearlos.
    let vocabulario = '';
    try {
      const [clientes, productos] = await db.batch([
        db.prepare('SELECT name FROM customers WHERE is_active = 1 ORDER BY name LIMIT 300'),
        db.prepare('SELECT nombre FROM products WHERE disponible = 1 ORDER BY nombre LIMIT 300'),
      ]);
      const nombresClientes = (clientes.results as Array<{ name: string }>).map(r => r.name);
      const nombresProductos = (productos.results as Array<{ nombre: string }>).map(r => r.nombre);
      if (nombresClientes.length) vocabulario += `\nCLIENTES: ${nombresClientes.join(', ')}`;
      if (nombresProductos.length) vocabulario += `\nPRODUCTOS: ${nombresProductos.join(', ')}`;
    } catch (e) {
      console.error('[transcribe] No se pudo cargar el vocabulario:', e);
    }

    const prompt = `Transcribe literalmente esta nota de voz en español venezolano de una pescadería.

Reglas:
- Devuelve SOLO la transcripción, sin comentarios ni comillas.
- Si un nombre que escuchas se parece a uno de la lista de abajo, escríbelo TAL CUAL aparece en la lista.
- Conserva las cantidades como se dijeron ("dos kilos", "kilo y medio", "medio kilo").
- Conserva los montos en dólares como se dijeron ("diez dólares", "veinte").
- Si el audio está vacío o no se entiende nada, devuelve una cadena vacía.${vocabulario}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'audio/wav', data: audioBase64 } },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 1024 },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[transcribe] Error ${response.status}:`, errorText.substring(0, 200));
      return new Response(JSON.stringify({ success: false, error: 'No se pudo transcribir el audio' }), {
        status: 502, headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

    return new Response(JSON.stringify({ success: true, text }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error en transcribe:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al transcribir' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
