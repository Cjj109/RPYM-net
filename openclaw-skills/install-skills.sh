#!/bin/bash
set -e

SKILLS_DIR="$HOME/.openclaw/skills"
INSTALLED=0

echo "=== Instalando RPYM OpenClaw Skills ==="
echo ""

# --- 1. rpym-customers ---
echo "[1/6] Instalando rpym-customers..."
mkdir -p "$SKILLS_DIR/rpym-customers"
cat > "$SKILLS_DIR/rpym-customers/SKILL.md" << 'SKILLEOF'
---
name: rpym-customers
description: Gestiona clientes de RPYM — buscar, ver balances, crear y actualizar clientes
metadata: {"openclaw": {"requires": {"env": ["RPYM_API_KEY"]}, "primaryEnv": "RPYM_API_KEY", "emoji": "👥"}}
---

# rpym-customers

## Description
Gestiona los clientes de RPYM (El Rey de los Pescados y Mariscos). Puede buscar clientes, ver sus balances y deudas, crear clientes nuevos, y actualizar información de clientes existentes.

## API Base
`https://rpym.net`

## Authentication
Todas las peticiones requieren el header:
```
Authorization: Bearer {{RPYM_API_KEY}}
```

## CRITICO: Sintaxis curl para Authorization
Cuando ejecutes curl con el header de autorizacion, SIEMPRE usa comillas DOBLES para que la variable se expanda:
```bash
# CORRECTO (comillas dobles - la variable se expande):
curl -s -H "Authorization: Bearer $RPYM_API_KEY" https://rpym.net/api/customers

# INCORRECTO (comillas simples - envia literal "$RPYM_API_KEY"):
curl -s -H 'Authorization: Bearer $RPYM_API_KEY' https://rpym.net/api/customers
```
Si recibes error "API key invalida", verifica que estas usando comillas DOBLES en el header.

## Endpoints Disponibles

### 1. Listar clientes con balances
```
GET /api/customers?search={nombre}
```
- `search` (opcional): Filtrar por nombre (parcial, case-insensitive)
- Respuesta: `{ success: true, customers: [...] }`
- Cada cliente tiene:
  - `id` (number): ID unico
  - `name` (string): Nombre del cliente
  - `phone` (string|null): Telefono
  - `notes` (string|null): Notas
  - `rateType` (string): Tipo de tasa — `"dolar_bcv"`, `"divisas"`, `"euro_bcv"`, o `"manual"`
  - `customRate` (number|null): Tasa personalizada (solo si rateType es "manual")
  - `shareToken` (string|null): Token para compartir cuenta publica del cliente
  - `isActive` (boolean): Si el cliente esta activo
  - `balanceDivisas` (number): Balance en USD divisas (positivo = debe)
  - `balanceBcv` (number): Balance en USD dolar BCV (positivo = debe)
  - `balanceEuro` (number): Balance en euros (positivo = debe)
  - `createdAt`, `updatedAt` (string): Timestamps ISO

### 2. Ver un cliente especifico
```
GET /api/customers/{id}
```
- Respuesta: `{ success: true, customer: {...} }` (mismos campos que arriba)
- Error 404 si no existe: `{ success: false, error: "Cliente no encontrado" }`

### 3. Crear un cliente nuevo
```
POST /api/customers
Content-Type: application/json

{
  "name": "Nombre del Cliente",      // REQUERIDO
  "phone": "+58 414 1234567",        // Opcional
  "notes": "Notas sobre el cliente", // Opcional
  "rateType": "dolar_bcv",           // Opcional, default: "dolar_bcv"
  "customRate": null                  // Solo si rateType es "manual"
}
```
- Respuesta exitosa: `{ success: true, id: 123 }`
- Valores validos para `rateType`: `"dolar_bcv"`, `"divisas"`, `"euro_bcv"`, `"manual"`
- IMPORTANTE: Siempre confirma con el usuario antes de crear un cliente nuevo

### 4. Actualizar un cliente
```
PUT /api/customers/{id}
Content-Type: application/json

{
  "name": "Nuevo Nombre",            // Opcional
  "phone": "+58 414 9999999",        // Opcional
  "notes": "Nuevas notas",           // Opcional
  "rateType": "divisas",             // Opcional
  "customRate": 42.50,               // Opcional
  "isActive": false                  // Opcional (false = desactivar/eliminar)
}
```
- Solo incluir los campos que se quieren cambiar
- Respuesta: `{ success: true }`
- IMPORTANTE: Siempre confirma con el usuario antes de modificar un cliente

### 5. Desactivar un cliente (soft delete)
```
DELETE /api/customers/{id}
```
- No borra fisicamente, solo marca `is_active = 0`
- Respuesta: `{ success: true }`
- IMPORTANTE: Siempre confirma con el usuario antes de desactivar

### 6. Resumen de todos los clientes con estadisticas (Bot 2 Analytics)
```
GET /api/bot2/customers/summary?search={nombre}
```
- Endpoint optimizado para analisis. Devuelve TODOS los clientes activos.
- ATENCION: Este endpoint devuelve campos en **snake_case** (diferente a `/api/customers` que usa camelCase).
- Respuesta:
  ```json
  {
    "success": true,
    "totalCustomers": 25,
    "customersWithDebt": 8,
    "customers": [
      {
        "id": 15,
        "name": "Delcy Rodriguez",
        "phone": "+58 414 ...",
        "notes": "Cliente frecuente",
        "rate_type": "dolar_bcv",
        "custom_rate": null,
        "is_active": 1,
        "created_at": "2025-06-15T...",
        "balance_divisas": 150.50,
        "balance_bcv": 200.00,
        "balance_euro": 0,
        "total_purchases": 25,
        "last_purchase_date": "2026-02-10",
        "last_payment_date": "2026-02-15"
      }
    ]
  }
  ```
- `totalCustomers`: Total de clientes activos
- `customersWithDebt`: Clientes que deben algo (balance > $0.01 en cualquier moneda)
- Campos del cliente son snake_case: `rate_type` (no `rateType`), `is_active` (entero 0/1, no boolean), etc.

## Reglas de Negocio

### Sistema Multi-Moneda
RPYM opera con tres tipos de moneda:
- **divisas**: Dolares en efectivo o Zelle (tasa del mercado paralelo)
- **dolar_bcv**: Dolares calculados con tasa oficial BCV (transferencia, pago movil)
- **euro_bcv**: Euros calculados con tasa oficial BCV

Cada cliente tiene un `rateType` que define su moneda por defecto. Los balances se calculan separadamente por moneda.

### Interpretacion de Balances
- Balance **positivo** = el cliente DEBE dinero a RPYM
- Balance **cero o negativo** = el cliente esta al dia o tiene credito
- Los balances se calculan: compras no pagadas - pagos realizados

### Formato de Comunicacion
- Siempre reportar montos en USD con 2 decimales: "$45.50"
- Mencionar el tipo de moneda cuando sea relevante: "$45.50 (divisas)", "$30.00 (BCV)"
- Cuando el usuario pregunte "cuanto debe X", reportar TODOS los balances que sean > 0
SKILLEOF
INSTALLED=$((INSTALLED + 1))
echo "      rpym-customers instalado."

# --- 2. rpym-budgets ---
echo "[2/6] Instalando rpym-budgets..."
mkdir -p "$SKILLS_DIR/rpym-budgets"
cat > "$SKILLS_DIR/rpym-budgets/SKILL.md" << 'SKILLEOF'
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

## CRITICO: Sintaxis curl para Authorization
Cuando ejecutes curl con el header de autorizacion, SIEMPRE usa comillas DOBLES para que la variable se expanda:
```bash
# CORRECTO (comillas dobles - la variable se expande):
curl -s -H "Authorization: Bearer $RPYM_API_KEY" https://rpym.net/api/bot2/...

# INCORRECTO (comillas simples - envia literal "$RPYM_API_KEY"):
curl -s -H 'Authorization: Bearer $RPYM_API_KEY' https://rpym.net/api/bot2/...
```
Si recibes error "API key invalida", verifica que estas usando comillas DOBLES en el header.

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
- `hideRate` (opcional): `true` para OCULTAR el monto en Bs en el presupuesto. Usar cuando el cliente paga en divisas y no necesita ver Bs.
- `delivery` (opcional): Costo de delivery en USD (default 0)
- `customerName` (opcional): Nombre del cliente
- `customerAddress` (opcional): Direccion de entrega del cliente
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

### 7. Obtener URL admin de un presupuesto
```
GET /api/bot2/presupuestos/admin-url/{id}
```
- Requiere auth (Bearer token)
- Respuesta: `{ success: true, id: "38719", adminUrl: "https://rpym.net/presupuesto/admin?id=38719&token=abc123..." }`
- IMPORTANTE: Despues de crear un presupuesto, SIEMPRE llama este endpoint y envia la adminUrl al usuario
- Ejemplo curl:
```bash
curl -s -H "Authorization: Bearer $RPYM_API_KEY" https://rpym.net/api/bot2/presupuestos/admin-url/38719
```

### 8. Editar un presupuesto completo (no requiere auth)
```
PUT /api/presupuestos/{id}
Content-Type: application/json

{
  "items": [...],
  "totalUSD": 24.00,
  "totalBs": 0,
  "totalUSDDivisa": 24.00,
  "modoPrecio": "divisa",
  "hideRate": true,
  "delivery": 0,
  "customerName": "Delcy",
  "customerAddress": "Calle 1",
  "fecha": "2026-02-18"
}
```
- NO requiere auth
- Envia TODOS los campos del presupuesto (items, totales, etc.)
- `hideRate: true` oculta el monto en Bs del presupuesto
- `fecha` (opcional): Cambiar la fecha (formato YYYY-MM-DD)
- Si el presupuesto esta vinculado a un cliente, tambien actualiza la transaccion asociada
- IMPORTANTE: Siempre confirma con el usuario antes de editar
- NOTA: Si solo quieres cambiar el estado o asignar cliente, usa los endpoints simplificados abajo (9 y 10)

#### Ejemplo curl: Editar presupuesto existente
```bash
curl -s -X PUT -H "Content-Type: application/json" -d '{"items":[{"nombre":"Mejillon Pelado","cantidad":0.5,"unidad":"kg","precioUSD":9.00,"subtotalUSD":4.50,"subtotalBs":0,"precioUSDDivisa":9.00,"subtotalUSDDivisa":4.50}],"totalUSD":4.50,"totalBs":0,"totalUSDDivisa":4.50,"modoPrecio":"divisa","hideRate":true,"source":"telegram","customerName":"Delcy"}' https://rpym.net/api/presupuestos/95917
```

### 9. Actualizar estado de un presupuesto (no requiere auth)
```
PUT /api/presupuestos/{id}
Content-Type: application/json

{ "status": "pagado" }
```
- NO requiere auth
- Solo `"pendiente"` o `"pagado"` son validos
- Al marcar como pagado, se guarda `fechaPago` automaticamente
- NOTA: Enviar SOLO `{ "status": "..." }` sin otros campos

### 10. Asignar presupuesto a un cliente
```
PUT /api/presupuestos/{id}
Content-Type: application/json

{ "customerName": "Nombre exacto del cliente" }
```
- Automaticamente vincula el presupuesto a la cuenta del cliente (crea transaccion de compra)
- El nombre debe coincidir con un cliente existente
- NOTA: Enviar SOLO `{ "customerName": "..." }` sin otros campos
- IMPORTANTE: Confirma con el usuario antes de vincular

### 11. Eliminar un presupuesto
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
SKILLEOF
INSTALLED=$((INSTALLED + 1))
echo "      rpym-budgets instalado."

# --- 3. rpym-products ---
echo "[3/6] Instalando rpym-products..."
mkdir -p "$SKILLS_DIR/rpym-products"
cat > "$SKILLS_DIR/rpym-products/SKILL.md" << 'SKILLEOF'
---
name: rpym-products
description: Catalogo de productos RPYM — ver precios, disponibilidad y crear productos
metadata: {"openclaw": {"requires": {"env": ["RPYM_API_KEY"]}, "primaryEnv": "RPYM_API_KEY", "emoji": "🐟"}}
---

# rpym-products

## Description
Consulta y gestiona el catalogo de productos de RPYM (pescados, mariscos, camarones, etc.). Puede ver precios actuales, disponibilidad, y crear o actualizar productos.

## API Base
`https://rpym.net`

## Authentication
- `GET /api/products` es PUBLICO (no requiere auth)
- `POST /api/products` requiere auth: `Authorization: Bearer {{RPYM_API_KEY}}`

## Endpoints Disponibles

### 1. Listar todos los productos
```
GET /api/products
```
- NO requiere auth
- Respuesta: `{ success: true, products: [...], count: N }`
- Cada producto tiene:
  - `id` (number): ID del producto
  - `nombre` (string): Nombre del producto (ej: "Camaron Jumbo")
  - `descripcion` (string): Descripcion larga
  - `descripcionCorta` (string): Descripcion corta para listas
  - `descripcionHome` (string): Descripcion para la pagina principal
  - `categoria` (string): Categoria — `"camaron"`, `"pescado"`, `"marisco"`, `"otro"`
  - `precioUSD` (number): Precio en USD (tasa BCV)
  - `precioUSDDivisa` (number|null): Precio en USD divisa (si tiene doble precio)
  - `unidad` (string): Unidad de medida — normalmente `"kg"`
  - `disponible` (boolean): Si esta disponible para venta
  - `sortOrder` (number): Orden de aparicion en el catalogo

### 2. Crear un producto nuevo
```
POST /api/products
Content-Type: application/json

{
  "nombre": "Pulpo Fresco",              // REQUERIDO
  "categoria": "marisco",                 // REQUERIDO: camaron, pescado, marisco, otro
  "precioUSD": 18.50,                     // REQUERIDO: Precio USD (BCV)
  "precioUSDDivisa": 17.00,              // Opcional: Precio USD divisa
  "descripcion": "Pulpo fresco del Caribe", // Opcional
  "descripcionCorta": "Pulpo fresco",      // Opcional
  "descripcionHome": "Pulpo del Caribe",   // Opcional
  "unidad": "kg",                          // Opcional, default: "kg"
  "disponible": true,                      // Opcional, default: true
  "sortOrder": 10                          // Opcional, default: 0
}
```
- Requiere auth (Bearer token)
- Respuesta: `{ success: true, id: 15, message: "Producto creado" }`
- IMPORTANTE: Confirma con el usuario antes de crear un producto

## Reglas de Negocio

### Categorias
- `camaron`: Camarones (jumbo, grande, mediano, etc.)
- `pescado`: Pescados (pargo, mero, corvina, etc.)
- `marisco`: Mariscos (pulpo, calamar, langosta, mejillones, etc.)
- `otro`: Otros productos (empanadas, salsas, etc.)

### Doble Precio
Muchos productos tienen dos precios:
- `precioUSD`: Precio para pagos via transferencia/pago movil (calculado con tasa BCV)
- `precioUSDDivisa`: Precio para pagos en efectivo USD/Zelle (generalmente un poco menor)

Si el usuario pregunta precios, mencionar AMBOS si el producto tiene doble precio:
- "Camaron Jumbo: $15.00/kg (BCV) o $14.00/kg (divisas)"

### Disponibilidad
- Productos con `disponible: false` no aparecen en la pagina publica pero siguen en la base de datos
- Siempre indicar al usuario si un producto NO esta disponible cuando lo consulte

### Formato de Respuesta
Al listar productos, agrupar por categoria y mostrar claramente:
```
CAMARONES:
- Camaron Jumbo: $15.00/kg (BCV) | $14.00/kg (divisas) - Disponible
- Camaron Grande: $12.00/kg (BCV) | $11.00/kg (divisas) - Disponible

PESCADOS:
- Pargo Rojo: $10.00/kg (BCV) - Disponible
- Mero: $8.50/kg (BCV) - No disponible
```
SKILLEOF
INSTALLED=$((INSTALLED + 1))
echo "      rpym-products instalado."

# --- 4. rpym-payments ---
echo "[4/6] Instalando rpym-payments..."
mkdir -p "$SKILLS_DIR/rpym-payments"
cat > "$SKILLS_DIR/rpym-payments/SKILL.md" << 'SKILLEOF'
---
name: rpym-payments
description: Gestiona pagos y transacciones de RPYM — registrar pagos, marcar pagado, analizar patrones
metadata: {"openclaw": {"requires": {"env": ["RPYM_API_KEY"]}, "primaryEnv": "RPYM_API_KEY", "emoji": "💰"}}
---

# rpym-payments

## Description
Gestiona pagos y transacciones de clientes de RPYM. Puede registrar pagos, ver historial de transacciones, marcar compras como pagadas, y analizar patrones de pago.

## API Base
`https://rpym.net`

## Authentication
Todas las peticiones requieren:
```
Authorization: Bearer {{RPYM_API_KEY}}
```

## CRITICO: Sintaxis curl para Authorization
Cuando ejecutes curl con el header de autorizacion, SIEMPRE usa comillas DOBLES para que la variable se expanda:
```bash
# CORRECTO (comillas dobles - la variable se expande):
curl -s -H "Authorization: Bearer $RPYM_API_KEY" https://rpym.net/api/customers/1/transactions

# INCORRECTO (comillas simples - envia literal "$RPYM_API_KEY"):
curl -s -H 'Authorization: Bearer $RPYM_API_KEY' https://rpym.net/api/customers/1/transactions
```
Si recibes error "API key invalida", verifica que estas usando comillas DOBLES en el header.

## Endpoints Disponibles

### 1. Ver transacciones de un cliente
```
GET /api/customers/{customerId}/transactions
```
- Respuesta: `{ success: true, transactions: [...] }`
- Cada transaccion tiene:
  - `id` (number): ID de la transaccion
  - `customerId` (number): ID del cliente
  - `type` (string): `"purchase"` (compra) o `"payment"` (pago)
  - `date` (string): Fecha YYYY-MM-DD
  - `description` (string): Descripcion del movimiento
  - `amountUsd` (number): Monto en USD
  - `amountBs` (number): Monto en Bs
  - `amountUsdDivisa` (number|null): Monto USD divisa
  - `currencyType` (string): `"divisas"`, `"dolar_bcv"`, o `"euro_bcv"`
  - `paymentMethod` (string|null): Metodo de pago (solo para type="payment")
  - `isPaid` (boolean): Si la compra ya fue pagada
  - `paidDate` (string|null): Fecha de pago
  - `paidMethod` (string|null): Metodo usado para pagar
  - `isCrossed` (boolean): Si esta tachada/anulada visualmente
  - `presupuestoId` (string|null): ID del presupuesto vinculado
  - `notes` (string|null): Notas adicionales
  - `exchangeRate` (number|null): Tasa de cambio usada
  - `invoiceImageUrl` (string|null): URL de imagen de factura (ej: "/api/customers/invoice/{key}")
  - `createdAt`, `updatedAt` (string): Timestamps
- Transacciones vienen ordenadas por fecha DESC

### 2. Registrar un pago
```
POST /api/customers/{customerId}/transactions
Content-Type: application/json

{
  "type": "payment",                      // REQUERIDO: "payment"
  "date": "2026-02-18",                   // REQUERIDO: Fecha YYYY-MM-DD
  "description": "Pago parcial",          // REQUERIDO
  "amountUsd": 50.00,                     // REQUERIDO (al menos uno > 0)
  "amountBs": 3025.00,                    // Opcional si amountUsd > 0
  "currencyType": "divisas",              // Opcional, default: "divisas"
  "paymentMethod": "efectivo",            // Opcional para pagos
  "notes": "Pago en efectivo",            // Opcional
  "exchangeRate": 60.50                   // Opcional
}
```
- Valores validos para `currencyType`: `"divisas"`, `"dolar_bcv"`, `"euro_bcv"`
- Valores validos para `paymentMethod`: `"efectivo"`, `"tarjeta"`, `"pago_movil"`, `"transferencia"`, `"zelle"`
- Respuesta: `{ success: true, id: 456 }`
- IMPORTANTE: Siempre confirma con el usuario antes de registrar un pago

### 3. Registrar una compra
```
POST /api/customers/{customerId}/transactions
Content-Type: application/json

{
  "type": "purchase",                     // REQUERIDO: "purchase"
  "date": "2026-02-18",                   // REQUERIDO: Fecha YYYY-MM-DD
  "description": "Presupuesto 45123",     // REQUERIDO
  "amountUsd": 120.00,                    // REQUERIDO
  "amountBs": 7260.00,                    // Opcional
  "amountUsdDivisa": 110.00,             // Opcional (precio divisa)
  "currencyType": "dolar_bcv",            // Opcional
  "presupuestoId": "45123",              // Opcional: vincular a presupuesto
  "notes": "Pedido de camaron"            // Opcional
}
```
- NOTA: Las compras normalmente se crean automaticamente al vincular un presupuesto a un cliente. Solo crear manualmente si es necesario.

### 4. Marcar una compra como pagada
```
PUT /api/customers/{customerId}/transactions/{txId}
Content-Type: application/json

{
  "markPaid": true,
  "paidMethod": "efectivo",               // Opcional
  "paidDate": "2026-02-18",              // Opcional, default: hoy
  "paidNotes": "Pago completo"           // Opcional
}
```
- Si la transaccion tiene un presupuesto vinculado, el presupuesto tambien se marca como pagado
- Respuesta: `{ success: true }`

### 5. Desmarcar una compra como pagada
```
PUT /api/customers/{customerId}/transactions/{txId}
Content-Type: application/json

{
  "markUnpaid": true
}
```
- Revierte el presupuesto vinculado a "pendiente"

### 6. Actualizar una transaccion
```
PUT /api/customers/{customerId}/transactions/{txId}
Content-Type: application/json

{
  "date": "2026-02-15",
  "description": "Descripcion corregida",
  "amountUsd": 55.00,
  "currencyType": "divisas",
  "paymentMethod": "zelle",
  "notes": "Nota actualizada"
}
```
- Solo incluir campos que se quieren cambiar
- IMPORTANTE: Confirma antes de modificar

### 7. Eliminar una transaccion
```
DELETE /api/customers/{customerId}/transactions/{txId}
```
- Elimina permanentemente la transaccion
- IMPORTANTE: Pedir confirmacion explicita antes de eliminar

### 8. Patrones de pago (Bot 2 Analytics)
```
GET /api/bot2/payment-patterns/{customerId}
```
- Respuesta detallada con analisis de patron de pago:
  ```json
  {
    "success": true,
    "customer": {
      "id": 15,
      "name": "Delcy Rodriguez",
      "phone": "+58 414 ...",
      "notes": "Cliente frecuente",
      "rate_type": "dolar_bcv",
      "created_at": "2025-06-15T..."
    },
    "stats": {
      "totalPurchases": 25,
      "totalPayments": 18,
      "unpaidPurchases": 3,
      "totalUnpaidUSD": 450.75,
      "avgDaysToPay": 12,
      "avgDaysBetweenPurchases": 8,
      "lastPurchaseDate": "2026-02-10",
      "lastPaymentDate": "2026-02-15"
    },
    "transactions": [...]
  }
  ```
- `avgDaysToPay`: Promedio de dias que tarda en pagar (null si no hay datos)
- `avgDaysBetweenPurchases`: Promedio de dias entre compras (null si < 2 compras)
- Las transacciones cruzadas (`is_crossed = 1`) son EXCLUIDAS del analisis
- Transacciones vienen ordenadas por fecha DESC, maximo 100
- ATENCION: Las transacciones en este endpoint usan **snake_case** (diferente a `/api/customers/{id}/transactions` que usa camelCase):
  - `amount_usd`, `amount_bs`, `amount_usd_divisa` (no `amountUsd`)
  - `currency_type`, `payment_method` (no `currencyType`)
  - `is_paid` (entero 0/1, no boolean), `paid_date`, `paid_method`
  - `presupuesto_id`, `is_crossed`, `created_at`
  - `days_to_pay` (campo calculado: dias entre fecha y fecha de pago)

## Reglas de Negocio

### Flujo de Registro de Pago
1. Primero buscar al cliente: `GET /api/bot2/customers/summary?search={nombre}`
2. Verificar el balance actual del cliente
3. Confirmar monto, moneda y metodo de pago con el usuario
4. Registrar el pago: `POST /api/customers/{id}/transactions`
5. Confirmar que el pago se registro exitosamente

### Metodos de Pago
- `efectivo`: Pago en dolares en efectivo
- `zelle`: Transferencia Zelle (USD)
- `pago_movil`: Pago movil (Bs) — sistema bancario venezolano
- `transferencia`: Transferencia bancaria (Bs)
- `tarjeta`: Pago con tarjeta de debito/credito (Bs)

### Tipos de Moneda (currency_type)
IMPORTANTE: El `currencyType` de la transaccion debe coincidir con como paga el cliente:
- `divisas`: Pago en dolares efectivo o Zelle — NO se calcula con tasa BCV
- `dolar_bcv`: Pago en Bs referenciado a tasa BCV del dolar
- `euro_bcv`: Pago en Bs referenciado a tasa BCV del euro

### Interpretacion de Patrones
Al analizar patrones de pago de un cliente:
- `avgDaysToPay` < 7: Buen pagador, paga rapido
- `avgDaysToPay` 7-15: Pagador normal
- `avgDaysToPay` 15-30: Pagador lento, considerar seguimiento
- `avgDaysToPay` > 30: Pagador problematico, alertar
- `unpaidPurchases` > 3: Cliente con muchas compras sin pagar
- Comparar `totalUnpaidUSD` con historial para determinar riesgo
SKILLEOF
INSTALLED=$((INSTALLED + 1))
echo "      rpym-payments instalado."

# --- 5. rpym-analytics ---
echo "[5/6] Instalando rpym-analytics..."
mkdir -p "$SKILLS_DIR/rpym-analytics"
cat > "$SKILLS_DIR/rpym-analytics/SKILL.md" << 'SKILLEOF'
---
name: rpym-analytics
description: Analisis inteligente del negocio RPYM — reportes, morosos, alertas y recomendaciones
metadata: {"openclaw": {"requires": {"env": ["RPYM_API_KEY"]}, "primaryEnv": "RPYM_API_KEY", "emoji": "📊"}}
---

# rpym-analytics

## Description
Analisis inteligente del negocio RPYM. Combina datos de clientes, presupuestos y transacciones para generar reportes, detectar anomalias, y dar recomendaciones proactivas al dueno del negocio.

## API Base
`https://rpym.net`

## Authentication
Todas las peticiones requieren:
```
Authorization: Bearer {{RPYM_API_KEY}}
```

## CRITICO: Sintaxis curl para Authorization
Cuando ejecutes curl con el header de autorizacion, SIEMPRE usa comillas DOBLES para que la variable se expanda:
```bash
# CORRECTO (comillas dobles - la variable se expande):
curl -s -H "Authorization: Bearer $RPYM_API_KEY" https://rpym.net/api/bot2/health

# INCORRECTO (comillas simples - envia literal "$RPYM_API_KEY"):
curl -s -H 'Authorization: Bearer $RPYM_API_KEY' https://rpym.net/api/bot2/health
```
Si recibes error "API key invalida", verifica que estas usando comillas DOBLES en el header.

## Endpoints para Analisis

### 1. Health Check
```
GET /api/bot2/health
```
- Verifica que la API y base de datos estan funcionando
- Respuesta: `{ success: true, ok: true, timestamp: "...", dbOk: true }`
- Usar al inicio de cada sesion o si hay errores

### 2. Resumen de Clientes
```
GET /api/bot2/customers/summary
```
- Todos los clientes activos con balances y estadisticas
- Respuesta clave:
  - `totalCustomers`: Clientes activos
  - `customersWithDebt`: Clientes que deben algo (balance > $0.01 en cualquier moneda)
  - `customers[]`: Cada cliente con `balance_divisas`, `balance_bcv`, `balance_euro`, `total_purchases`, `last_purchase_date`, `last_payment_date`

### 3. Presupuestos Vencidos
```
GET /api/bot2/presupuestos/overdue?days=15&limit=50
```
- Presupuestos pendientes que llevan mas de N dias sin pagarse
- Respuesta clave:
  - `count`: Cantidad de presupuestos vencidos
  - `totalOverdueUSD`: Monto total vencido en USD
  - `presupuestos[]`: Cada uno con `days_old`, `is_linked`, `linked_customer_id`, `items`

### 4. Busqueda de Presupuestos
```
GET /api/bot2/presupuestos/search?customer=nombre&status=pendiente&from=2026-01-01&to=2026-02-18&product=camaron
```
- Busqueda avanzada con multiples filtros combinables
- Permite buscar por producto dentro de los items JSON

### 5. Patrones de Pago por Cliente
```
GET /api/bot2/payment-patterns/{customerId}
```
- Analisis detallado del comportamiento de pago de un cliente especifico
- Incluye: promedio dias para pagar, frecuencia de compra, deuda pendiente

### 6. Estadisticas Generales
```
GET /api/presupuestos/stats
```
- NO requiere auth
- Dashboard rapido: presupuestos de hoy, vendido hoy, pendientes total

### 7. Tasa BCV Actual
```
GET /api/config/bcv-rate
```
- NO requiere auth
- Respuesta: `{ rate: 60.50, manual: false, source: "BCV" }`

## Reportes que Puedes Generar

### Reporte Matutino
Cuando el usuario diga "como estamos", "reporte del dia", "como va el negocio", etc.:
1. Llamar `GET /api/bot2/health` para verificar conectividad
2. Llamar estos en paralelo:
   - `GET /api/presupuestos/stats`
   - `GET /api/bot2/customers/summary`
   - `GET /api/bot2/presupuestos/overdue?days=7`
   - `GET /api/config/bcv-rate`
3. Generar reporte con:
   - Tasa BCV actual
   - Presupuestos de hoy y ventas
   - Clientes con deuda (top 5 por monto)
   - Presupuestos vencidos que necesitan atencion
   - Resumen de cobranza pendiente total

Formato de reporte:
```
REPORTE RPYM - 18 Feb 2026

Tasa BCV: Bs 60.50/USD

HOY:
- 3 presupuestos creados
- Vendido: $125.50 (Bs 7,592.75)
- Pendientes totales: 12

COBRANZA:
- 8 clientes con deuda activa
- Total pendiente: $2,450.00
- Top morosos:
  1. Juan Garcia - $580.00 (30 dias sin pagar)
  2. Maria Lopez - $320.00 (15 dias)

ALERTAS:
- 3 presupuestos vencidos (>15 dias)
- Presupuesto #45123 de Delcy lleva 32 dias pendiente
```

### Analisis de Cliente
Cuando el usuario pregunte sobre un cliente especifico:
1. `GET /api/bot2/customers/summary?search={nombre}` para encontrar el cliente
2. `GET /api/bot2/payment-patterns/{id}` para analisis de patron
3. Reportar:
   - Balance actual (por tipo de moneda)
   - Patron de pago (rapido/normal/lento)
   - Frecuencia de compra
   - Compras sin pagar
   - Recomendacion (cobrar, esperar, ofrecer plan de pago)

### Analisis de Producto
Cuando pregunten sobre un producto:
1. `GET /api/bot2/presupuestos/search?product={nombre}`
2. Analizar:
   - Cuantos presupuestos incluyen ese producto
   - Volumen total vendido (sumar cantidades de items)
   - Monto total generado
   - Tendencia (mas o menos pedidos con el tiempo)

### Analisis de Presupuestos Vencidos
Para gestionar presupuestos viejos pendientes:
1. `GET /api/bot2/presupuestos/overdue?days=15`
2. Clasificar por riesgo:
   - **Alto riesgo** (>30 dias, montos altos): Necesitan accion inmediata
   - **Riesgo medio** (15-30 dias): Recordatorio al cliente
   - **Riesgo bajo** (<15 dias): Monitorear
3. Si un presupuesto vencido NO esta vinculado a cliente (`is_linked: 0`):
   - Sugerir contactar al cliente para confirmar si quieren el pedido
   - O sugerir eliminarlo si ya no aplica

## Reglas de Comunicacion

### Tono
- Hablar como asistente de negocio profesional pero cercano
- Usar numeros concretos, no generalidades
- Siempre incluir montos en USD con 2 decimales
- Cuando haya problemas, dar recomendaciones accionables

### Moneda
- USD siempre con formato: $1,250.50
- Bs siempre con formato: Bs 75,780.25
- Incluir tipo de moneda si es relevante: "$450 (divisas)", "$300 (BCV)"

### Alertas
Alertar proactivamente sobre:
- Clientes con deuda > $500 sin pagar hace > 15 dias
- Presupuestos vencidos > 30 dias (sugerir accion)
- Clientes que dejaron de comprar (ultimo pedido hace > 30 dias cuando compran semanalmente)
- Pagos grandes recibidos (buenas noticias tambien)
SKILLEOF
INSTALLED=$((INSTALLED + 1))
echo "      rpym-analytics instalado."

# --- 6. rpym-web-monitor ---
echo "[6/6] Instalando rpym-web-monitor..."
mkdir -p "$SKILLS_DIR/rpym-web-monitor"
cat > "$SKILLS_DIR/rpym-web-monitor/SKILL.md" << 'SKILLEOF'
---
name: rpym-web-monitor
description: Monitorea rpym.net — verificar disponibilidad, precios y tasa BCV
metadata: {"openclaw": {"emoji": "🌐"}}
---

# rpym-web-monitor

## Description
Monitorea la pagina web publica de RPYM (rpym.net) para verificar que funciona correctamente, que los productos se muestran bien, y que los precios estan actualizados.

## URLs a Monitorear

### Pagina Principal
```
https://rpym.net
```
- Debe mostrar: logo, productos destacados, precios, boton de WhatsApp
- Verificar que los precios coinciden con los de la API

### Pagina de Presupuestos (Calculadora)
```
https://rpym.net/presupuesto
```
- Calculadora publica donde los clientes crean presupuestos
- Debe mostrar todos los productos disponibles con precios
- Verificar que la tasa BCV se muestra correctamente

### Lista de Precios
```
https://rpym.net/lista
```
- Lista de precios publica con busqueda interactiva
- Muestra todos los productos disponibles agrupados por categoria
- Los precios se actualizan en tiempo real con la tasa BCV

### API Health
```
https://rpym.net/api/bot2/health
```
- Verificar con Bearer token que la API responde
- Si falla, la pagina puede estar caida

## Verificaciones

### 1. Consistencia de Precios
Comparar precios de la API con los que se muestran en la web:
1. `GET /api/products` -- obtener precios de la base de datos
2. Navegar a `https://rpym.net` con el browser
3. Verificar que los precios mostrados coinciden
4. Reportar discrepancias si las hay

### 2. Disponibilidad de la Pagina
1. Navegar a `https://rpym.net`
2. Verificar que la pagina carga correctamente (no error 500, no pagina en blanco)
3. Verificar que se ven productos
4. Tomar screenshot si el usuario lo pide

### 3. Tasa BCV Actualizada
1. `GET /api/config/bcv-rate` -- obtener tasa actual
2. Verificar en la pagina que la tasa mostrada coincide
3. Alertar si la tasa no se ha actualizado en mas de 24 horas

## Cuando Ejecutar

- Cuando el usuario diga "revisa la pagina", "como se ve la web", "verifica rpym.net"
- Cuando haya errores en otras peticiones a la API (puede indicar problemas en el sitio)
- Como parte del reporte matutino si el usuario lo solicita

## Formato de Reporte

```
ESTADO DE rpym.net

Pagina principal: OK (carga en 1.2s)
Calculadora: OK
API: OK (D1 conectada)
Tasa BCV: Bs 60.50 (actualizada hace 2h)
Productos visibles: 15/15
Precios: Coinciden con base de datos

Sin problemas detectados.
```

Si hay problemas:
```
ALERTA rpym.net

Pagina principal: OK
Calculadora: ERROR - No muestra precios
API: OK
Tasa BCV: DESACTUALIZADA (ultima actualizacion hace 26h)

ACCIONES RECOMENDADAS:
1. La tasa BCV no se actualizo hoy - verificar cron job de GitHub Actions
2. La calculadora tiene un error - revisar consola del navegador
```
SKILLEOF
INSTALLED=$((INSTALLED + 1))
echo "      rpym-web-monitor instalado."

echo ""
echo "=== Instalacion completada: $INSTALLED/6 skills instalados ==="
echo "Directorio: $SKILLS_DIR"
echo ""
echo "Skills instalados:"
echo "  1. rpym-customers"
echo "  2. rpym-budgets"
echo "  3. rpym-products"
echo "  4. rpym-payments"
echo "  5. rpym-analytics"
echo "  6. rpym-web-monitor"
