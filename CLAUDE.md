# RPYM-net — El Rey de los Pescados y Mariscos

Sitio web + sistema administrativo para negocio de pescados y mariscos. Incluye catálogo público, panel admin, presupuestos, sistema fiscal, y bots de Telegram/WhatsApp.

## Stack

- **Astro 5** (hybrid: SSG por defecto, `prerender = false` en endpoints dinámicos)
- **React 19** para componentes interactivos (.tsx)
- **Tailwind CSS v4** via `@tailwindcss/vite`
- **Cloudflare Pages** con D1 (SQLite) y R2 (object storage)
- **TypeScript** estricto (`astro/tsconfigs/strict`)
- **Vitest** para tests unitarios

## Arquitectura

```
src/
  components/       # .astro (server) y .tsx (React interactivo)
  layouts/          # Layout.astro
  pages/
    api/            # Endpoints dinámicos (prerender = false)
    admin/          # Panel administrativo
    cuenta/         # Portal del cliente
    presupuesto/    # Vistas de presupuestos
  lib/
    auth.ts         # PBKDF2 hashing, sesiones en D1
    require-auth.ts # Middleware auth para endpoints
    d1-types.ts     # Interfaces D1/R2 + helpers getD1(), getR2()
    env.ts          # getEnv() — runtime.env → import.meta.env fallback
    format.ts       # Formateo de moneda, fechas (locale es-VE)
    repositories/   # Acceso a datos puro (recibe D1Database)
    services/
      telegram/     # Handlers del bot por dominio
      whatsapp/     # Handlers + integración Gemini AI
    __tests__/      # Tests unitarios
migrations/         # SQL secuenciales (0001_initial.sql ... 0018_...)
```

## Convenciones de código

### Idioma mixto (español/inglés)
- **Funciones y variables:** inglés — `findCustomerByName`, `requireAuth`
- **Tipos de dominio:** español — `Presupuesto`, `PresupuestoItem`
- **Columnas DB:** español snake_case — `fecha_pago`, `total_usd`, `modo_precio`
- **Mensajes de error:** español — `'Error al cargar clientes'`
- **Comentarios JSDoc:** español — `/** Guarda un presupuesto en D1 */`
- **Archivos:** inglés genérico (`auth.ts`), español dominio (`presupuesto-storage.ts`)

### Acceso a bindings de Cloudflare
```typescript
// D1 y R2 via locals
const db = getD1(locals);   // de d1-types.ts
const r2 = getR2(locals);   // de d1-types.ts

// Env vars (API keys, tokens)
const env = getEnv(locals);  // de env.ts — fallback a import.meta.env
```

### Patrón de API endpoints
```typescript
export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  // Endpoints protegidos
  const auth = await requireAuth(request, locals);
  if (auth instanceof Response) return auth;
  const { db, user } = auth;

  try {
    // ... lógica
    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error en operación:', error);
    return new Response(JSON.stringify({ success: false, error: 'Mensaje en español' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

### Respuestas API
- Siempre incluyen `success: boolean`
- Errores incluyen `error: string` en español
- Content-Type siempre `application/json`

### Repositorios
- Funciones puras que reciben `D1Database` como primer parámetro
- Sin HTTP ni Response — solo acceso a datos
- Ejemplo: `findCustomerByName(db, searchName)`

### Servicios (bots)
- Organizados por integración: `telegram/`, `whatsapp/`
- Cada carpeta tiene `index.ts` como barrel export
- Sub-módulos por dominio: `customer-handlers.ts`, `budget-handlers.ts`, etc.

### Componentes
- `.astro` para componentes server-rendered
- `.tsx` (React) para componentes interactivos del cliente
- Layout wrapper: `Layout.astro`

## Base de datos (D1)

### Convenciones de schema
- `TEXT` para fechas (ISO), IDs, JSON
- `REAL` para montos monetarios
- `INTEGER` para booleans (0/1)
- `created_at TEXT DEFAULT (datetime('now'))` en toda tabla
- Soft delete con `is_active INTEGER NOT NULL DEFAULT 1`
- Foreign keys con `ON DELETE CASCADE`
- Índices: `idx_tablename_column`

### Migraciones
- Archivos en `migrations/` con formato `NNNN_descripcion.sql`
- Ejecutar: `wrangler d1 execute rpym-db --file=./migrations/NNNN_name.sql`

### Multi-moneda
Tres modos de precio: `bcv`, `divisa`, `dual`. Se manejan USD, Bolívares (Bs) y Euros. La tasa BCV se actualiza automáticamente vía GitHub Actions.

## Temas visuales

Sistema de temas via CSS custom properties y atributo `data-theme`:
- `ocean` (default), `carnival`, `christmas`, `easter`, `valentine`, `mundial`, `halloween`
- Variables: `--theme-primary-{50-950}`, `--theme-accent-{100,300-600}`, `--theme-bg-from/to`
- Tema se guarda en tabla `site_config` de D1

## Tests

```bash
npm test          # vitest run
npm run test:watch # vitest (watch mode)
```

- Tests en `src/lib/__tests__/{module}.test.ts`
- Mocks de D1 como objetos planos
- `describe`/`it`/`expect`/`vi` de vitest
- Coverage solo de `src/lib/**/*.ts`

## Desarrollo

```bash
npm run dev       # Astro dev server
npm run build     # Build para producción
npm run preview   # Preview del build
```

## Deploy

**Este proyecto es un repositorio Git conectado a Cloudflare Pages con deploy automático.** Cada push a `main` dispara un build y deploy en producción automáticamente. Cuando el usuario pida "push", "sube los cambios", "deploy", o similar — hacer commit y `git push origin main` directamente. No preguntar si quiere pushear, no explicar qué es un push — simplemente hacerlo.

```bash
git add <archivos> && git commit -m "mensaje" && git push origin main
```

El único workflow de GitHub Actions (`daily-rebuild.yml`) actualiza la tasa BCV dos veces al día.

## Reglas para el agente

### Comunicación
- Responder siempre en español
- **Cuando el usuario pida push/deploy:** commit + push a main sin preguntas innecesarias

### Memoria (Engram MCP)
- **Al inicio de sesión:** usar `mem_context` para ver qué se hizo en sesiones anteriores
- **Al completar trabajo significativo:** guardar con `mem_save` (bugfixes, decisiones, cambios de arquitectura)
- **Al final de la sesión o antes de un push:** guardar resumen con `mem_session_summary`

### Código
- No modificar `.env` ni `.dev.vars` — contienen secretos reales
- Los mensajes de error de la API siempre en español
- Al crear endpoints nuevos: incluir `export const prerender = false`
- Al crear migraciones: seguir numeración secuencial existente
- Al trabajar con montos: respetar el sistema multi-moneda (bcv/divisa/dual)
- Preferir `getD1(locals)` y `getR2(locals)` para acceder a bindings
- Los repositorios nunca retornan Response — solo datos o null
- Tests van en `src/lib/__tests__/` con el patrón `{module}.test.ts`
