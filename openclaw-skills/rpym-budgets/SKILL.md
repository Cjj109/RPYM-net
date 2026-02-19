---
name: rpym-budgets
description: Gestiona presupuestos de RPYM — buscar, crear, editar y marcar como pagados
metadata: {"openclaw": {"requires": {"env": ["RPYM_API_KEY"]}, "primaryEnv": "RPYM_API_KEY", "emoji": "📋"}}
---

# rpym-budgets

## Description
Gestiona los presupuestos (pedidos/facturas) de RPYM. Puede buscar presupuestos por cliente, estado, fecha o producto. Puede crear presupuestos nuevos, actualizar existentes, y marcarlos como pagados.

## API Base
`https://rpym.net`

## Authentication
Header requerido para endpoints con auth:
```
Authorization: Bearer {{RPYM_API_KEY}}
```
Nota: Algunos endpoints de presupuestos NO requieren auth (GET /api/presupuestos, GET /api/presupuestos/:id, POST /api/presupuestos).

## Endpoints Disponibles

### 1. Listar presupuestos
```
GET /api/presupuestos?status={estado}&search={texto}&limit={n}
```
- `status` (opcional): `"pendiente"`, `"pagado"`, o `"all"` (default: todos)
- `search` (opcional): Buscar por ID o nombre de cliente
- `limit` (opcional): Maximo resultados, default 100
- NO requiere auth
- Respuesta: `{ success: true, presupuestos: [...] }`
- Cada presupuesto tiene:
  - `id` (string): ID de 5 digitos (ej: "45123")
  - `fecha` (string): Fecha ISO del presupuesto
  - `items` (array): Lista de productos con cantidades y precios
  - `totalUSD` (number): Total en USD
  - `totalBs` (number): Total en Bolivares
  - `totalUSDDivisa` (number|null): Total en USD divisa (si aplica)
  - `modoPrecio` (string): `"bcv"`, `"divisa"`, o `"dual"`
  - `delivery` (number): Costo de delivery en USD (0 si no aplica)
  - `hideRate` (boolean): Si ocultar la tasa al cliente
  - `estado` (string): `"pendiente"` o `"pagado"`
  - `customerName` (string|null): Nombre del cliente
  - `customerAddress` (string|null): Direccion de entrega
  - `source` (string): `"cliente"`, `"admin"`, o `"telegram"`
  - `fechaPago` (string|null): Fecha en que fue pagado
  - `isLinked` (boolean): Si esta vinculado a cuenta de cliente
  - `createdAt`, `updatedAt` (string): Timestamps

### 2. Ver un presupuesto especifico
```
GET /api/presupuestos/{id}
```
- NO requiere auth
- Respuesta: `{ success: true, presupuesto: {...} }`
- NOTA: La respuesta usa `presupuesto` (singular), no `presupuestos`. Los campos son los mismos que arriba EXCEPTO `isLinked` que NO esta presente en este endpoint.

### 3. Busqueda avanzada (Bot 2 Analytics)
```
GET /api/bot2/presupuestos/search?customer={nombre}&status={estado}&from={fecha}&to={fecha}&product={producto}&limit={n}
```
- Requiere auth (Bearer token)
- Filtros combinables:
  - `customer`: Nombre parcial del cliente
  - `status`: `"pendiente"` o `"pagado"`
  - `from`, `to`: Rango de fechas (YYYY-MM-DD)
  - `product`: Buscar producto en los items del presupuesto
  - `limit`: Maximo resultados, default 50
- Respuesta: `{ success: true, count: N, filters: {...}, presupuestos: [...] }`
- Los `items` ya vienen parseados como array de objetos
- ATENCION: Este endpoint devuelve campos en **snake_case** (a diferencia de `/api/presupuestos`):
  - `customer_name` (no `customerName`), `total_usd`, `total_bs`, `total_usd_divisa`
  - `modo_precio`, `fecha_pago`, `created_at`
  - Los campos coinciden con los del endpoint overdue (ver abajo)

### 4. Presupuestos pendientes vencidos (Bot 2 Analytics)
```
GET /api/bot2/presupuestos/overdue?days={N}&limit={n}
```
- Requiere auth (Bearer token)
- `days` (opcional): Dias minimos desde creacion, default 15
- `limit` (opcional): Maximo resultados, default 50
- Respuesta:
  ```json
  {
    "success": true,
    "count": 5,
    "totalOverdueUSD": 1250.75,
    "minDays": 15,
    "presupuestos": [
      {
        "id": "45123",
        "customer_name": "Delcy Rodriguez",
        "total_usd": 250.00,
        "days_old": 32,
        "is_linked": 1,
        "linked_customer_id": 15,
        "items": [...]
      }
    ]
  }
  ```

### 5. Estadisticas generales
```
GET /api/presupuestos/stats
```
- NO requiere auth
- Respuesta:
  ```json
  {
    "totalHoy": 3,
    "vendidoHoyUSD": "125.50",
    "vendidoHoyBs": "7530.00",
    "pendientes": 12,
    "totalGeneral": 450
  }
  ```

### 6. Crear un presupuesto nuevo
```
POST /api/presupuestos
Content-Type: application/json
```
- NO requiere auth
- `items` (REQUERIDO): Array de objetos con los productos
- `totalUSD` (REQUERIDO): Total en USD — DEBE ser number, NO string
- `totalBs` (REQUERIDO): Total en Bs — DEBE ser number, NO string (usar 0 si modoPrecio es "divisa")
- `totalUSDDivisa` (opcional): Total en USD divisa
- `modoPrecio` (opcional): `"bcv"`, `"divisa"`, o `"dual"`, default `"bcv"`
- `customerName` (opcional): Nombre del cliente
- `source` (opcional): Usar `"telegram"` cuando se crea desde Bot 2
- Respuesta: `{ success: true, id: "45123" }`
- IMPORTANTE: Siempre confirma con el usuario antes de crear un presupuesto

#### Ejemplo curl: Presupuesto en modo DIVISA
```bash
curl -s -X POST -H "Content-Type: application/json" -d '{"items":[{"nombre":"Mejillon Pelado","cantidad":0.5,"unidad":"kg","precioUSD":9.00,"subtotalUSD":4.50,"subtotalBs":0,"precioUSDDivisa":9.00,"subtotalUSDDivisa":4.50}],"totalUSD":4.50,"totalBs":0,"totalUSDDivisa":4.50,"modoPrecio":"divisa","source":"telegram","customerName":"Delcy"}' https://rpym.net/api/presupuestos
```

#### Ejemplo curl: Presupuesto en modo BCV
```bash
curl -s -X POST -H "Content-Type: application/json" -d '{"items":[{"nombre":"Camaron Jumbo","cantidad":2,"unidad":"kg","precioUSD":12.00,"subtotalUSD":24.00,"subtotalBs":9570.00}],"totalUSD":24.00,"totalBs":9570.00,"modoPrecio":"bcv","source":"telegram","customerName":"Juan"}' https://rpym.net/api/presupuestos
```

CRITICO: En el JSON de curl, los valores totalUSD y totalBs DEBEN ser numeros (4.50) NO strings ("4.50"). Si se envian como strings, la API responde "Totales invalidos".

### 7. Actualizar estado de un presupuesto
```
PUT /api/presupuestos/{id}
Content-Type: application/json

{ "status": "pagado" }
```
- NO requiere auth
- Solo `"pendiente"` o `"pagado"` son validos
- Al marcar como pagado, se guarda `fechaPago` automaticamente

### 8. Asignar presupuesto a un cliente
```
PUT /api/presupuestos/{id}
Content-Type: application/json

{ "customerName": "Nombre exacto del cliente" }
```
- Automaticamente vincula el presupuesto a la cuenta del cliente (crea transaccion de compra)
- El nombre debe coincidir con un cliente existente
- IMPORTANTE: Confirma con el usuario antes de vincular

### 9. Eliminar un presupuesto
```
DELETE /api/presupuestos/{id}
```
- NO se puede eliminar si esta vinculado a una cuenta de cliente
- Respuesta: `{ success: true }` o error si esta vinculado
- IMPORTANTE: Siempre confirma con el usuario antes de eliminar

## Reglas de Negocio

### Items de Presupuesto
Cada item en el array `items` debe tener:
```json
{
  "nombre": "Nombre del producto",
  "cantidad": 2.5,
  "unidad": "kg",
  "precioUSD": 15.00,
  "totalUSD": 37.50,
  "totalBs": 2250.00
}
```
Los campos `precioUSDDivisa` y `totalUSDDivisa` solo son necesarios si `modoPrecio` es `"divisa"` o `"dual"`.

### Modos de Precio
- **bcv**: Precios en USD con tasa BCV (pago en Bs o transferencia)
- **divisa**: Precios en USD efectivo/Zelle (tasa del mercado)
- **dual**: Muestra AMBOS precios (BCV y divisa) en el presupuesto

### Tasa BCV
Para obtener la tasa BCV actual:
```
GET /api/config/bcv-rate
```
Respuesta: `{ rate: 60.50, manual: false, source: "BCV" }`
- `rate` es la tasa actual (Bs por USD)
- Para calcular Bs: `totalBs = totalUSD * rate`

### Flujo de Creacion de Presupuesto
1. Pedir al usuario que productos quiere (nombre, cantidad)
2. Consultar `GET /api/products` para obtener precios actuales
3. Consultar `GET /api/config/bcv-rate` para obtener tasa BCV
4. Calcular totales: totalUSD, totalBs (= totalUSD * tasa)
5. Confirmar con el usuario antes de crear
6. POST /api/presupuestos con todos los datos
