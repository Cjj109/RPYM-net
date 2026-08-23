/**
 * Cliente de OpenRouter (DeepSeek Flash) con retry automático.
 * OpenRouter expone una API compatible con OpenAI Chat Completions, así que
 * la forma del request/response es la misma que openai-client.ts. DeepSeek
 * V4 Flash SÍ es un modelo de razonamiento (soporta `reasoning.effort`): se
 * fuerza a 'low' y se amplía el presupuesto de tokens, igual que
 * openai-client.ts hace con GPT-5, para que el razonamiento no se coma todo
 * el `max_tokens` y devuelva contenido vacío.
 */

export interface OpenRouterRequest {
  systemPrompt: string;
  userMessage: string;
  apiKey: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  jsonMode?: boolean;
}

export interface OpenRouterResponse {
  success: boolean;
  content: string;
  error?: string;
}

const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
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
 * Llama a la API de Chat Completions de OpenRouter con retry automático.
 */
export async function callOpenRouterWithRetry(request: OpenRouterRequest): Promise<OpenRouterResponse> {
  const {
    systemPrompt,
    userMessage,
    apiKey,
    model = DEFAULT_MODEL,
    temperature = 0.1,
    maxOutputTokens = 1024,
    jsonMode = false,
  } = request;

  const url = 'https://openrouter.ai/api/v1/chat/completions';

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature,
    // El presupuesto incluye los tokens de razonamiento, así que se le da
    // holgura (x4): con effort bajo el modelo casi no razona, que es lo que
    // queremos para extracción de JSON, pero si razona más de lo esperado
    // igual queda espacio para la respuesta final.
    max_tokens: maxOutputTokens * 4,
    reasoning: { effort: 'low' },
    ...(jsonMode && { response_format: { type: 'json_object' } }),
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://rpym.net',
          'X-Title': 'RPYM-net',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (isRetryableError(response.status, errorText) && attempt < MAX_RETRIES) {
          console.log(`[OpenRouter] Retry ${attempt + 1}/${MAX_RETRIES} (status ${response.status})...`);
          await sleep(RETRY_DELAY_MS * (attempt + 1)); // Backoff: 1s, 2s
          continue;
        }

        console.error(`[OpenRouter] Error ${response.status}:`, errorText.substring(0, 200));
        return { success: false, content: '', error: `API error: ${response.status}` };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      if (!content.trim()) {
        const finish = data.choices?.[0]?.finish_reason ?? 'desconocido';
        console.warn(`[OpenRouter] Respuesta vacía (finish_reason: ${finish}, modelo: ${model})`);
      }

      return { success: true, content };
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        console.log(`[OpenRouter] Retry ${attempt + 1}/${MAX_RETRIES} after network error...`);
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      console.error('[OpenRouter] Network error:', error);
      return { success: false, content: '', error: 'Network error' };
    }
  }

  return { success: false, content: '', error: 'Max retries exceeded' };
}
