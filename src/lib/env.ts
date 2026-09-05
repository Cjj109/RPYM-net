/**
 * RPYM - Centralizado de variables de entorno
 * Unifica acceso a runtime.env (Cloudflare) e import.meta.env
 */

export interface EnvVars {
  GEMINI_API_KEY?: string;
  CLAUDE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  /** Clave de Cotizave, una de las fuentes de la tasa BCV (ver bcv-fuentes.ts) */
  COTIZAVE_API_KEY?: string;
  /** Clave de jina.ai: sube el límite del proxy que lee la página del BCV */
  JINA_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  /** Secreto que Telegram reenvía como cabecera para probar el origen del webhook */
  TELEGRAM_WEBHOOK_SECRET?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  /** App Secret de Meta — valida la firma X-Hub-Signature-256 del webhook */
  WHATSAPP_APP_SECRET?: string;
  /** Clave para firmar los tokens HMAC de administración de presupuestos */
  ADMIN_SECRET?: string;
  PUBLIC_SHEET_ID?: string;
}

/**
 * Obtiene variables de entorno desde el runtime de Cloudflare o import.meta.env
 * @param locals - Astro App.Locals (opcional, para runtime.env)
 */
export function getEnv(locals?: App.Locals): EnvVars {
  const runtime = (locals as any)?.runtime;
  const env = runtime?.env ?? (typeof import.meta !== 'undefined' ? import.meta.env : {});

  return {
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    CLAUDE_API_KEY: env.CLAUDE_API_KEY,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
    COTIZAVE_API_KEY: env.COTIZAVE_API_KEY,
    JINA_API_KEY: env.JINA_API_KEY,
    TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: env.TELEGRAM_WEBHOOK_SECRET,
    WHATSAPP_ACCESS_TOKEN: env.WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: env.WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_APP_SECRET: env.WHATSAPP_APP_SECRET,
    ADMIN_SECRET: env.ADMIN_SECRET,
    PUBLIC_SHEET_ID: env.PUBLIC_SHEET_ID
  };
}

/**
 * Obtiene GEMINI_API_KEY (para endpoints que solo necesitan esto)
 */
export function getGeminiApiKey(locals?: App.Locals): string | undefined {
  return getEnv(locals).GEMINI_API_KEY;
}

/**
 * Obtiene CLAUDE_API_KEY (Anthropic — usada como fallback de IA)
 */
export function getClaudeApiKey(locals?: App.Locals): string | undefined {
  return getEnv(locals).CLAUDE_API_KEY;
}

/**
 * Obtiene OPENAI_API_KEY (ChatGPT — proveedor de IA intercambiable)
 */
export function getOpenaiApiKey(locals?: App.Locals): string | undefined {
  return getEnv(locals).OPENAI_API_KEY;
}

/**
 * Obtiene OPENROUTER_API_KEY (DeepSeek vía OpenRouter — proveedor de IA intercambiable)
 */
export function getOpenrouterApiKey(locals?: App.Locals): string | undefined {
  return getEnv(locals).OPENROUTER_API_KEY;
}

/**
 * Obtiene PUBLIC_SHEET_ID - nunca devuelve hardcodeado por seguridad
 */
export function getSheetId(locals?: App.Locals): string | undefined {
  return getEnv(locals).PUBLIC_SHEET_ID;
}
