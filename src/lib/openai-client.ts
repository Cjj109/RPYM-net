/**
 * Cliente compartido de OpenAI (ChatGPT) con retry automático.
 * Se usa como uno de los proveedores intercambiables de IA.
 * Hace fetch directo a la API de OpenAI (sin SDK), igual que gemini-client.ts.
 */

export interface OpenAIRequest {
  systemPrompt: string;
  userMessage: string;
  apiKey: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  jsonMode?: boolean;
}

export interface OpenAIResponse {
  success: boolean;
  content: string;
  error?: string;
}

const DEFAULT_MODEL = 'gpt-5.6-luna';

/**
 * La familia GPT-5 es "sustractiva": rechaza `temperature` con 400 y renombró
 * `max_tokens` a `max_completion_tokens`. Se detecta por prefijo en vez de
 * hardcodear el modelo, para que el cliente siga funcionando si se vuelve a
 * fijar un gpt-4 desde el panel.
 */
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o[1-9])/i.test(model);
}
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Helper para esperar
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Determina si un error es recuperable con retry.
 * IMPORTANTE: 429 / rate limit (límite de cuota) NO se reintenta — reintentar
 * no resuelve la cuota y gasta más solicitudes. Se falla de inmediato para que
 * el orquestador pase al siguiente proveedor.
 */
function isRetryableError(status: number, errorText: string): boolean {
  return status === 500 ||
         status === 502 ||
         status === 503 ||
         errorText.includes('overloaded');
}

/**
 * Llama a la API de Chat Completions de OpenAI con retry automático.
 * En jsonMode usa response_format nativo (el prompt ya menciona "JSON").
 */
export async function callOpenAIWithRetry(request: OpenAIRequest): Promise<OpenAIResponse> {
  const {
    systemPrompt,
    userMessage,
    apiKey,
    model = DEFAULT_MODEL,
    temperature = 0.1,
    maxOutputTokens = 1024,
    jsonMode = false,
  } = request;

  const url = 'https://api.openai.com/v1/chat/completions';

  const reasoning = isReasoningModel(model);

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    ...(reasoning
      ? {
          // El presupuesto incluye los tokens de razonamiento, así que se le da
          // holgura: si se agota razonando, la respuesta vuelve vacía. Con
          // effort bajo el modelo casi no razona, que es lo que queremos para
          // extracción de JSON.
          max_completion_tokens: maxOutputTokens * 4,
          reasoning_effort: 'low',
        }
      : {
          temperature,
          max_tokens: maxOutputTokens,
        }),
    ...(jsonMode && { response_format: { type: 'json_object' } }),
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (isRetryableError(response.status, errorText) && attempt < MAX_RETRIES) {
          console.log(`[OpenAI] Retry ${attempt + 1}/${MAX_RETRIES} (status ${response.status})...`);
          await sleep(RETRY_DELAY_MS * (attempt + 1)); // Backoff: 1s, 2s
          continue;
        }

        console.error(`[OpenAI] Error ${response.status}:`, errorText.substring(0, 200));
        return { success: false, content: '', error: `API error: ${response.status}` };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      // Un modelo de razonamiento puede agotar el presupuesto pensando y
      // devolver contenido vacío con finish_reason 'length'. ai-fallback ya lo
      // trata como fallo y pasa al siguiente proveedor; se registra para poder
      // distinguirlo de una caída real de la API.
      if (!content.trim()) {
        const finish = data.choices?.[0]?.finish_reason ?? 'desconocido';
        console.warn(`[OpenAI] Respuesta vacía (finish_reason: ${finish}, modelo: ${model})`);
      }

      return { success: true, content };
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        console.log(`[OpenAI] Retry ${attempt + 1}/${MAX_RETRIES} after network error...`);
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      console.error('[OpenAI] Network error:', error);
      return { success: false, content: '', error: 'Network error' };
    }
  }

  return { success: false, content: '', error: 'Max retries exceeded' };
}
