/**
 * RPYM - Middleware global de Astro
 *
 * Refresca la cookie de sesión (expiración deslizante) en cada respuesta
 * dinámica donde requireAuth/getAuthOptional validaron una sesión por cookie.
 * Las páginas prerenderizadas no tienen request real, así que se ignoran.
 */

import { defineMiddleware } from 'astro:middleware';
import { applySessionCookie } from './lib/require-auth';

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  if (context.isPrerendered) return response;
  return applySessionCookie(context.locals, response);
});
