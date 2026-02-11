/**
 * RPYM - Centralizado de variables de entorno
 * Unifica acceso a runtime.env (Cloudflare) e import.meta.env
 */

export interface EnvVars {
  GEMINI_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
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
    TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
    WHATSAPP_ACCESS_TOKEN: env.WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: env.WHATSAPP_PHONE_NUMBER_ID,
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
 * Obtiene PUBLIC_SHEET_ID - nunca devuelve hardcodeado por seguridad
 */
export function getSheetId(locals?: App.Locals): string | undefined {
  return getEnv(locals).PUBLIC_SHEET_ID;
}
