import type { APIRoute } from 'astro';
import { requireAuth } from '../../lib/require-auth';
import { getEnv } from '../../lib/env';

export const prerender = false;

/**
 * Transcripción de audio para la anotación rápida hablada.
 *
 * El reconocimiento nativo del navegador no sirve para este negocio: no conoce
 * los nombres de los clientes ni del catálogo, así que escribe lo que oye
 * fonéticamente ("Delsi", "bibito"), y en el mercado el ruido lo empeora.
 * Por eso el audio se transcribe acá, sesgando el modelo con el vocabulario
 * real antes de que escuche.
 *
 * Orden: OpenAI gpt-transcribe primero, porque su parámetro `prompt` no tiene
 * el límite de 224 tokens de whisper-1 y le cabe el catálogo entero, y porque
 * aguanta mejor el ruido de fondo. Gemini queda de respaldo si no hay llave de
 * OpenAI o si falla.
 */

const OPENAI_MODEL = 'gpt-transcribe';
const GEMINI_MODEL = 'gemini-3.5-flash';
const MAX_AUDIO_BASE64 = 15 * 1024 * 1024;

/** Arma la lista de nombres propios con la que se sesga el reconocimiento */
async function cargarVocabulario(db: D1Database): Promise<{ clientes: string[]; productos: string[] }> {
  try {
    const [clientes, productos] = await db.batch([
      db.prepare('SELECT name FROM customers WHERE is_active = 1 ORDER BY name LIMIT 400'),
      db.prepare('SELECT nombre FROM products WHERE disponible = 1 ORDER BY nombre LIMIT 400'),
    ]);
    return {
      clientes: (clientes.results as Array<{ name: string }>).map(r => r.name),
      productos: (productos.results as Array<{ nombre: string }>).map(r => r.nombre),
    };
  } catch (e) {
    console.error('[transcribe] No se pudo cargar el vocabulario:', e);
    return { clientes: [], productos: [] };
  }
}

/** Decodifica base64 a bytes sin cargar el string entero en memoria dos veces */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function transcribirConOpenAI(
  audio: Uint8Array,
  apiKey: string,
  vocabulario: { clientes: string[]; productos: string[] }
): Promise<string | null> {
  // El prompt no es una instrucción para gpt-transcribe: es contexto que sesga
  // el reconocimiento hacia estas palabras. Por eso se listan los nombres tal
  // cual, sin pedirle nada.
  const prompt = [
    'Nota de voz de una pescadería en Venezuela. Pedidos y abonos de clientes.',
    vocabulario.clientes.length ? `Clientes: ${vocabulario.clientes.join(', ')}.` : '',
    vocabulario.productos.length ? `Productos: ${vocabulario.productos.join(', ')}.` : '',
    'Cantidades como "medio kilo", "dos kilos", "kilo y medio". Montos en dólares.',
  ].filter(Boolean).join(' ');

  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'nota.wav');
  form.append('model', OPENAI_MODEL);
  form.append('prompt', prompt);
  form.append('languages', JSON.stringify(['es']));

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[transcribe/openai] Error ${response.status}:`, errorText.substring(0, 200));
    return null;
  }

  const data = await response.json();
  return (data.text || '').trim();
}

async function transcribirConGemini(
  audioBase64: string,
  apiKey: string,
  vocabulario: { clientes: string[]; productos: string[] }
): Promise<string | null> {
  let listas = '';
  if (vocabulario.clientes.length) listas += `\nCLIENTES: ${vocabulario.clientes.join(', ')}`;
  if (vocabulario.productos.length) listas += `\nPRODUCTOS: ${vocabulario.productos.join(', ')}`;

  const prompt = `Transcribe esta nota de voz en español venezolano de una pescadería.
Puede estar grabada en un mercado con ruido de fondo: concentrate en la voz cercana
e ignora conversaciones lejanas y ruido ambiente.

Reglas:
- Devuelve SOLO la transcripción, sin comentarios ni comillas.
- Si un nombre que escuchas se parece a uno de las listas, escríbelo TAL CUAL aparece ahí.
- Conserva las cantidades como se dijeron ("dos kilos", "kilo y medio", "medio kilo").
- Conserva los montos en dólares como se dijeron ("diez dólares", "veinte").
- Si no se entiende nada, devuelve una cadena vacía.${listas}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
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
    console.error(`[transcribe/gemini] Error ${response.status}:`, errorText.substring(0, 200));
    return null;
  }

  const data = await response.json();
  return (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

export const POST: APIRoute = async ({ request, locals }) => {
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db } = auth;

  try {
    const env = getEnv(locals);
    const openaiKey = env.OPENAI_API_KEY;
    const geminiKey = env.GEMINI_API_KEY;

    if (!openaiKey && !geminiKey) {
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

    const vocabulario = await cargarVocabulario(db);

    let text: string | null = null;
    let proveedor = '';

    if (openaiKey) {
      try {
        text = await transcribirConOpenAI(base64ToBytes(audioBase64), openaiKey, vocabulario);
        if (text) proveedor = 'openai';
      } catch (e) {
        console.error('[transcribe] OpenAI falló:', e);
      }
    }

    if (!text && geminiKey) {
      try {
        text = await transcribirConGemini(audioBase64, geminiKey, vocabulario);
        if (text) proveedor = 'gemini';
      } catch (e) {
        console.error('[transcribe] Gemini falló:', e);
      }
    }

    if (text === null) {
      return new Response(JSON.stringify({ success: false, error: 'No se pudo transcribir el audio' }), {
        status: 502, headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`[transcribe] Transcrito con: ${proveedor || 'ninguno (vacío)'}`);
    return new Response(JSON.stringify({ success: true, text, proveedor }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error en transcribe:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error al transcribir' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
