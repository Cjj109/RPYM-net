---
name: rpym-budgets
description: Gestiona presupuestos de RPYM — buscar, crear, editar y marcar como pagados
metadata: {"openclaw": {"requires": {"env": ["RPYM_API_KEY"]}, "primaryEnv": "RPYM_API_KEY", "emoji": "📋"}}
---

# rpym-budgets

Gestiona presupuestos (pedidos/facturas) de RPYM. Buscar, crear, editar, marcar pagados.

**Base URL:** `https://rpym.net`
**Auth:** `Authorization: Bearer {{RPYM_API_KEY}}` (solo endpoints /api/bot2/). SIEMPRE usar comillas DOBLES en curl: `-H "Authorization: Bearer $RPYM_API_KEY"` (comillas simples NO expanden la variable).

## Campos de un presupuesto

`id` (string 5 digitos), `fecha` (ISO), `items` (array), `totalUSD` (number), `totalBs` (number), `totalUSDDivisa` (number|null), `modoPrecio` ("bcv"|"divisa"|"dual"), `delivery` (number, USD), `hideRate` (boolean: ocultar Bs al cliente), `estado` ("pendiente"|"pagado"), `customerName`, `customerAddress`, `source` ("cliente"|"admin"|"telegram"), `fechaPago`, `isLinked` (solo en listado), `createdAt`, `updatedAt`.

## Endpoints

### Listar — `GET /api/presupuestos?status={estado}&search={texto}&limit={n}` (sin auth)
Filtros: `status` (pendiente|pagado|all), `search` (ID o nombre cliente), `limit` (default 100).
Respuesta: `{ success, presupuestos: [...] }` — incluye campo `isLinked`.

### Ver uno — `GET /api/presupuestos/{id}` (sin auth)
Respuesta: `{ success, presupuesto: {...} }` (singular, sin `isLinked`).

### Busqueda avanzada — `GET /api/bot2/presupuestos/search?customer=X&status=X&from=YYYY-MM-DD&to=YYYY-MM-DD&product=X&limit=50` (auth)
Filtros combinables. Respuesta en **snake_case**: `customer_name`, `total_usd`, `total_bs`, `total_usd_divisa`, `modo_precio`, `fecha_pago`, `created_at`.

### Presupuestos vencidos — `GET /api/bot2/presupuestos/overdue?days=15&limit=50` (auth)
Pendientes con mas de N dias. Respuesta: `{ count, totalOverdueUSD, presupuestos: [{ id, customer_name, total_usd, days_old, is_linked, linked_customer_id, items }] }`.

### Estadisticas — `GET /api/presupuestos/stats` (sin auth)
Respuesta: `{ totalHoy, vendidoHoyUSD, vendidoHoyBs, pendientes, totalGeneral }`.

### Crear — `POST /api/presupuestos` (sin auth, Content-Type: application/json)
Campos: `items` (REQUERIDO array), `totalUSD` (REQUERIDO number), `totalBs` (REQUERIDO number, usar 0 si divisa), `totalUSDDivisa`, `modoPrecio` (default "bcv"), `hideRate` (true=ocultar Bs), `delivery`, `customerName`, `customerAddress`, `source` (usar "telegram").
CRITICO: totalUSD y totalBs DEBEN ser numbers (4.50), NO strings ("4.50").
Respuesta: `{ success, id }`. **Siempre confirma con el usuario antes de crear.**

### Admin URL — `GET /api/bot2/presupuestos/admin-url/{id}` (sin auth)
Respuesta: `{ success, id, adminUrl }`. **SIEMPRE obtener y enviar la adminUrl despues de crear un presupuesto.**

### Editar — `PUT /api/presupuestos/{id}` (sin auth, Content-Type: application/json)
Soporta actualizacion PARCIAL: solo envia los campos que cambien. Campos: `items`, `totalUSD`, `totalBs`, `totalUSDDivisa`, `hideRate`, `delivery`, `modoPrecio`, `customerName`, `customerAddress`, `fecha` (YYYY-MM-DD).
Si esta vinculado a cliente, actualiza la transaccion asociada. **Confirma antes de editar.**
Para cambiar SOLO estado: enviar `{ "status": "pagado" }` (nada mas). Para asignar SOLO cliente: enviar `{ "customerName": "Nombre" }` (nada mas, vincula automaticamente).

### Eliminar — `DELETE /api/presupuestos/{id}` (sin auth)
No se puede eliminar si esta vinculado a cuenta de cliente. **Confirma antes de eliminar.**

## Items de presupuesto

Cada item: `{ nombre, cantidad, unidad, precioUSD, subtotalUSD, subtotalBs }`. Agregar `precioUSDDivisa` y `subtotalUSDDivisa` si modoPrecio es "divisa" o "dual".

## Modos de precio

- **bcv**: USD con tasa BCV (pago en Bs/transferencia). totalBs = totalUSD * tasa.
- **divisa**: USD efectivo/Zelle. totalBs = 0, usar totalUSDDivisa.
- **dual**: Muestra AMBOS precios (BCV y divisa).

## Tasa BCV — `GET /api/config/bcv-rate` (sin auth)
Respuesta: `{ rate, manual, source }`. Calcular Bs: totalUSD * rate.

## ERRORES COMUNES — NO COMETER

1. **NO usar "dual" a menos que el usuario lo pida explicitamente.** El modo por defecto es "bcv". Solo usar "dual" si el usuario dice "dual" o "ambos precios". Solo usar "divisa" si dice "divisa", "zelle", o "efectivo dolares".
2. **Para ocultar Bs: usar `hideRate: true`, NO poner totalBs en 0.** El campo `hideRate` es un booleano que se envia en el POST o PUT. La web calcula Bs automaticamente con la tasa BCV — poner totalBs=0 NO oculta nada, solo muestra "$0 Bs". El campo correcto es `"hideRate": true`.
3. **Para linkear a un cliente: incluir `customerName` en el POST.** La API automaticamente busca el cliente por nombre y lo vincula (crea transaccion de compra). NO existe campo `customer_id`. Si necesitas linkear un presupuesto YA existente, hacer PUT con `{ "customerName": "Nombre exacto" }` (nada mas).
4. **La API SI permite editar presupuestos.** `PUT /api/presupuestos/{id}` funciona perfectamente para edicion parcial. NUNCA digas que "la API no soporta edicion" — eso es falso.
5. **totalBs se calcula: totalUSD * tasa BCV.** Siempre calcular totalBs correctamente (no inventar, no poner 0 a menos que modoPrecio sea "divisa").

## Flujo de creacion
1. Preguntar productos y cantidades → 2. GET /api/products (precios) → 3. GET /api/config/bcv-rate → 4. Calcular totales → 5. Confirmar con usuario → 6. POST /api/presupuestos (incluir customerName para linkear automaticamente) → 7. GET admin-url y enviar link.
La respuesta del POST incluye `linked: true/false` — si linked es true, el presupuesto ya quedo vinculado a la cuenta del cliente.
