/**
 * RPYM - Middleware de autenticación para Bot 2 (OpenClaw)
 * Valida API key via header Authorization: Bearer {BOT2_API_KEY}
 * Solo permite acceso read-only a endpoints /api/bot2/*
 */

import type { D1Database } from './d1-types';
import { getD1 } from './d1-types';

export interface Bot2AuthResult {
  db: D1Database;
}

/**
 * Verifica autenticación de Bot 2 via API key.
 * Devuelve { db } si es válido, o Response 401/500 si falla.
 */
export function requireBot2Auth(
  request: Request,
  locals: App.Locals
): Bot2AuthResult | Response {
  const db = getD1(locals);
  if (!db) {
    return jsonResponse({ success: false, error: 'Database no disponible' }, 500);
  }

  const runtime = (locals as any).runtime;
  const expectedKey = runtime?.env?.BOT2_API_KEY;

  if (!expectedKey) {
    console.error('[Bot2 Auth] BOT2_API_KEY no configurada en environment');
    return jsonResponse({ success: false, error: 'Configuración de servidor incompleta' }, 500);
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ success: false, error: 'No autorizado' }, 401);
  }

  const providedKey = authHeader.slice(7); // Remove "Bearer "
  if (providedKey !== expectedKey) {
    return jsonResponse({ success: false, error: 'API key inválida' }, 401);
  }

  return { db };
}

function jsonResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
