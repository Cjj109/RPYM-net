/**
 * Cliente compartido de Gemini con retry automático
 * Maneja errores temporales (503, 429, high demand) silenciosamente
 */

export interface GeminiRequest {
  systemPrompt: string;
  userMessage: string;
  apiKey: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  jsonMode?: boolean;
  inlineData?: { mimeType: string; data: string }; // Para imágenes
}

export interface GeminiResponse {
  success: boolean;
  content: string;
  error?: string;
}

const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Helper para esperar
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Determina si un error es recuperable con retry.
 * IMPORTANTE: 429 y RESOURCE_EXHAUSTED (límite de cuota) NO se reintentan —
 * reintentar no resuelve la cuota y solo gasta más solicitudes. Ante esos
 * errores se falla de inmediato para que el orquestador pase al siguiente proveedor.
 */
function isRetryableError(status: number, errorText: string): boolean {
  return status === 503 ||
         errorText.includes('high demand') ||
         errorText.includes('overloaded');
}

/**
 * Llama a la API de Gemini con retry automático
 */
export async function callGeminiWithRetry(request: GeminiRequest): Promise<GeminiResponse> {
  const {
    systemPrompt,
    userMessage,
    apiKey,
    model = DEFAULT_MODEL,
    temperature = 0.1,
    maxOutputTokens = 1024,
    jsonMode = false,
    inlineData
  } = request;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Construir parts del contenido
  const userParts: any[] = [{ text: userMessage }];
  if (inlineData) {
    userParts.unshift({ inline_data: inlineData });
  }

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: userParts }],
    generationConfig: {
      temperature,
      maxOutputTokens,
      ...(jsonMode && { responseMimeType: 'application/json' }),
    },
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (isRetryableError(response.status, errorText) && attempt < MAX_RETRIES) {
          console.log(`[Gemini] Retry ${attempt + 1}/${MAX_RETRIES} (status ${response.status})...`);
          await sleep(RETRY_DELAY_MS * (attempt + 1)); // Backoff: 1s, 2s
          continue;
        }

        console.error(`[Gemini] Error ${response.status}:`, errorText.substring(0, 200));
        return { success: false, content: '', error: `API error: ${response.status}` };
      }

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      return { success: true, content };
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        console.log(`[Gemini] Retry ${attempt + 1}/${MAX_RETRIES} after network error...`);
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      console.error('[Gemini] Network error:', error);
      return { success: false, content: '', error: 'Network error' };
    }
  }

  return { success: false, content: '', error: 'Max retries exceeded' };
}

/**
 * Versión simplificada para llamadas con historial (WhatsApp)
 */
export async function callGeminiChat(
  systemPrompt: string,
  contents: Array<{ role: string; parts: Array<{ text: string }> }>,
  apiKey: string,
  model: string = 'gemini-2.0-flash-lite'
): Promise<GeminiResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 512,
    },
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (isRetryableError(response.status, errorText) && attempt < MAX_RETRIES) {
          console.log(`[Gemini Chat] Retry ${attempt + 1}/${MAX_RETRIES}...`);
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }

        console.error(`[Gemini Chat] Error ${response.status}`);
        return { success: false, content: '', error: `API error: ${response.status}` };
      }

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      return { success: true, content };
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        console.log(`[Gemini Chat] Retry ${attempt + 1}/${MAX_RETRIES} after error...`);
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      console.error('[Gemini Chat] Error:', error);
      return { success: false, content: '', error: 'Network error' };
    }
  }

  return { success: false, content: '', error: 'Max retries exceeded' };
}
