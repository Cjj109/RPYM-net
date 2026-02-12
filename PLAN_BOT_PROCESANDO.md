# Plan de acción: Bot se queda en "Procesando presupuesto..."

## Diagnóstico

Después de revisar el flujo completo del bot de Telegram, **la causa más probable del bloqueo es un timeout** del request en Cloudflare Workers/Pages.

### Flujo actual (budget_create)

1. **detectIntent** → llama a Gemini (~3-8 s)
2. Envía "Procesando presupuesto..." ✓
3. **createBudgetFromText**:
   - `getBCVRate()` → 2 fetches HTTP a APIs externas (~1-3 s)
   - `getProducts()` → D1 o Google Sheets (~0.5-2 s)
   - `parseOrderText()` → **segunda llamada a Gemini** (~5-25 s con retries)
   - Crear presupuesto en DB (~0.5 s)

**Tiempo total estimado: 15-35 segundos**

Cloudflare Workers/Pages tiene un límite de **30 segundos** por request. Si se supera, el worker se termina y **no se envía la respuesta final** al usuario.

### Otras causas posibles

1. **parse-order-core tiene un prompt más corto** que la API `/api/parse-order`. No especifica la estructura exacta del JSON de `items` (productId, productName, quantity, unit, matched, suggestedName, customPrice, etc.). Gemini podría devolver un formato distinto que rompa la lógica de `createBudgetFromText`.

2. **Errores silenciosos**: Si `parseOrderText` devuelve `success: false` o items vacíos, el usuario debería ver un mensaje de error. Que no vea nada sugiere que el request se corta antes de llegar al `return`.

---

## Plan de acción

### Prioridad 1: Responder rápido y procesar en background (waitUntil)

**Objetivo**: Responder 200 OK a Telegram lo antes posible y procesar el presupuesto en segundo plano.

1. Enviar "Procesando presupuesto..." inmediatamente.
2. **Devolver 200 OK** al webhook de Telegram (para que no reintente).
3. Usar `ctx.waitUntil()` de Cloudflare para ejecutar `createBudgetFromText` en background.
4. Cuando termine, enviar el resultado (o error) por Telegram.

**Requisito**: Verificar si Astro + Cloudflare expone `executionContext` / `ctx` en `locals.runtime` para usar `waitUntil`.

**Archivos**: `src/pages/api/telegram-webhook.ts`

---

### Prioridad 2: Alinear parse-order-core con la API

**Objetivo**: Asegurar que `parse-order-core` pida el mismo schema JSON que usa `budget-handlers`.

El prompt de `parse-order-core` debe incluir explícitamente la estructura de cada item:

```json
{
  "productId": "id o null",
  "productName": "nombre exacto o null",
  "requestedName": "texto del usuario",
  "suggestedName": "para productos personalizados",
  "quantity": número,
  "unit": "kg" | "caja" | "paquete",
  "matched": true|false,
  "customPrice": número o null,
  "customPriceDivisa": número o null
}
```

**Archivos**: `src/lib/parse-order-core.ts`

---

### Prioridad 3: Reducir tiempo total (si waitUntil no es viable)

1. **Ejecutar en paralelo**: `getBCVRate` → luego `getProducts` y `customers` en paralelo.
2. **Reducir timeout de Gemini**: Bajar de 25s a 15s en `parse-order-core` (menos retries).
3. **Cache de BCV**: Si hay tabla `config` con tasa BCV, usarla primero y actualizar en background.

---

### Prioridad 4: Diagnóstico local

Para confirmar el diagnóstico:

1. Probar con `/api/telegram-webhook?simulate=<texto>` (GET) y medir tiempos.
2. Revisar logs en Cloudflare Dashboard (duración del request, errores).
3. Añadir logs antes/después de `parseOrderText` y `createBudgetFromText` para ver hasta dónde llega.

---

## Resumen de pasos inmediatos

| Paso | Acción |
|------|--------|
| 1 | Verificar si `locals.runtime.ctx` (o similar) expone `waitUntil` en Astro Cloudflare |
| 2 | Si sí: refactorizar `budget_create` para responder 200 y procesar en background |
| 3 | Si no: completar Prioridad 2 y 3 (alinear parse-order-core y optimizar tiempos) |
| 4 | Añadir schema JSON explícito al prompt de `parse-order-core` |
