/**
 * Cliente compartido de Claude (Anthropic) con retry automático
 * Se usa como fallback cuando Gemini falla. Hace fetch directo a la API
 * de Anthropic (sin SDK), igual que gemini-client.ts con Google.
 */

export interface ClaudeRequest {
  systemPrompt: string;
  userMessage: string;
  apiKey: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  jsonMode?: boolean;
}

export interface ClaudeResponse {
  success: boolean;
  content: string;
  error?: string;
}

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Helper para esperar
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Determina si un error es recuperable con retry.
 * IMPORTANTE: 429 / rate_limit (límite de cuota) NO se reintenta — reintentar
 * no resuelve la cuota y gasta más solicitudes. Se falla de inmediato para que
 * el orquestador pase al siguiente proveedor.
 */
function isRetryableError(status: number, errorText: string): boolean {
  return status === 500 ||
         status === 503 ||
         status === 529 || // Anthropic: "overloaded"
         errorText.includes('overloaded');
}

/**
 * Llama a la API de Claude con retry automático.
 * En jsonMode usa prefill ("{") para forzar que la respuesta sea JSON puro,
 * ya que Claude no tiene un modo JSON nativo como Gemini.
 */
export async function callClaudeWithRetry(request: ClaudeRequest): Promise<ClaudeResponse> {
  const {
    systemPrompt,
    userMessage,
    apiKey,
    model = DEFAULT_MODEL,
    temperature = 0.1,
    maxOutputTokens = 1024,
    jsonMode = false,
  } = request;

  const url = 'https://api.anthropic.com/v1/messages';

  // Prefill con "{" obliga a Claude a continuar un objeto JSON
  const messages: Array<{ role: string; content: string }> = [
    { role: 'user', content: userMessage },
  ];
  if (jsonMode) {
    messages.push({ role: 'assistant', content: '{' });
  }

  const body = {
    model,
    max_tokens: maxOutputTokens,
    temperature,
    system: systemPrompt,
    messages,
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (isRetryableError(response.status, errorText) && attempt < MAX_RETRIES) {
          console.log(`[Claude] Retry ${attempt + 1}/${MAX_RETRIES} (status ${response.status})...`);
          await sleep(RETRY_DELAY_MS * (attempt + 1)); // Backoff: 1s, 2s
          continue;
        }

        console.error(`[Claude] Error ${response.status}:`, errorText.substring(0, 200));
        return { success: false, content: '', error: `API error: ${response.status}` };
      }

      const data = await response.json();
      let content = data.content?.[0]?.text || '';

      // Con prefill, Claude no repite el "{" inicial: lo anteponemos
      if (jsonMode && content) {
        content = '{' + content;
      }

      return { success: true, content };
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        console.log(`[Claude] Retry ${attempt + 1}/${MAX_RETRIES} after network error...`);
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      console.error('[Claude] Network error:', error);
      return { success: false, content: '', error: 'Network error' };
    }
  }

  return { success: false, content: '', error: 'Max retries exceeded' };
}
