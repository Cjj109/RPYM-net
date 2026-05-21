/**
 * Orquestador de IA con fallback configurable.
 * Recibe un orden de proveedores (principal primero) y los intenta en cascada,
 * saltando los que no tengan API key. El primero que responde con contenido gana.
 * El orden lo decide el administrador desde Configuración (ver ai-config.ts).
 */

import { callGeminiWithRetry } from './gemini-client';
import { callClaudeWithRetry } from './claude-client';
import { callOpenAIWithRetry } from './openai-client';
import type { AIProvider } from './ai-config';

export interface AIFallbackRequest {
  systemPrompt: string;
  userMessage: string;
  /** Orden de proveedores a intentar (principal primero) */
  providerOrder: AIProvider[];
  /** API keys por proveedor; un proveedor sin key se omite */
  apiKeys: Partial<Record<AIProvider, string | undefined>>;
  temperature?: number;
  maxOutputTokens?: number;
  jsonMode?: boolean;
}

export interface AIFallbackResponse {
  success: boolean;
  content: string;
  error?: string;
  /** Proveedor que resolvió la petición (para logging/diagnóstico) */
  provider: AIProvider | 'none';
}

/**
 * Intenta cada proveedor en orden hasta obtener una respuesta con contenido.
 * Una respuesta "success" pero vacía se trata como fallo (p. ej. Gemini puede
 * devolver 200 sin candidatos por filtros de seguridad).
 */
export async function callAIWithFallback(request: AIFallbackRequest): Promise<AIFallbackResponse> {
  const {
    systemPrompt,
    userMessage,
    providerOrder,
    apiKeys,
    temperature = 0.1,
    maxOutputTokens = 1024,
    jsonMode = false,
  } = request;

  let lastError = 'Ningún proveedor de IA disponible';

  for (const provider of providerOrder) {
    const apiKey = apiKeys[provider];
    if (!apiKey) continue;

    const args = { systemPrompt, userMessage, apiKey, temperature, maxOutputTokens, jsonMode };

    let result;
    if (provider === 'gemini') {
      result = await callGeminiWithRetry(args);
    } else if (provider === 'claude') {
      result = await callClaudeWithRetry(args);
    } else {
      result = await callOpenAIWithRetry(args);
    }

    if (result.success && result.content.trim()) {
      return { success: true, content: result.content, provider };
    }

    lastError = result.error || 'respuesta vacía';
    console.warn(`[AI Fallback] ${provider} no respondió (${lastError}), probando siguiente proveedor...`);
  }

  return { success: false, content: '', error: lastError, provider: 'none' };
}
