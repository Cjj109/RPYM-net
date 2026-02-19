#!/bin/bash
set -e

SKILLS_DIR="$HOME/.openclaw/skills"
INSTALLED=0

echo "=== Instalando RPYM OpenClaw Skills (compactos) ==="
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

Gestiona clientes de RPYM (El Rey de los Pescados y Mariscos). Buscar, ver balances/deudas, crear, actualizar.

**Base URL:** `https://rpym.net`
**Auth:** Todos los endpoints requieren `Authorization: Bearer {{RPYM_API_KEY}}`. SIEMPRE usar comillas DOBLES en curl: `-H "Authorization: Bearer $RPYM_API_KEY"`.

## Campos de un cliente

`id` (number), `name`, `phone`, `notes`, `rateType` ("dolar_bcv"|"divisas"|"euro_bcv"|"manual"), `customRate` (solo si manual), `shareToken`, `isActive` (boolean), `balanceDivisas` (USD divisas), `balanceBcv` (USD BCV), `balanceEuro` (EUR), `createdAt`, `updatedAt`.

**Balances:** positivo = el cliente DEBE dinero a RPYM. Cero o negativo = al dia o tiene credito.

## Endpoints

### Listar — `GET /api/customers?search={nombre}` (auth)
Respuesta camelCase: `{ success, customers: [...] }`.

### Ver uno — `GET /api/customers/{id}` (auth)
Respuesta: `{ success, customer: {...} }`.

### Crear — `POST /api/customers` (auth, Content-Type: application/json)
Body: `{ name (REQUERIDO), phone, notes, rateType (default "dolar_bcv"), customRate }`.
Respuesta: `{ success, id }`. **Confirma antes de crear.**

### Actualizar — `PUT /api/customers/{id}` (auth, Content-Type: application/json)
Solo incluir campos a cambiar: `name`, `phone`, `notes`, `rateType`, `customRate`, `isActive`. **Confirma antes de modificar.**

### Desactivar — `DELETE /api/customers/{id}` (auth)
Soft delete (marca is_active=0). **Confirma antes de desactivar.**

### Resumen analytics — `GET /api/bot2/customers/summary?search={nombre}` (auth)
Respuesta **snake_case**: `{ totalCustomers, customersWithDebt, customers: [{ id, name, phone, notes, rate_type, balance_divisas, balance_bcv, balance_euro, total_purchases, last_purchase_date, last_payment_date }] }`.

## Sistema multi-moneda

- **divisas**: Dolares efectivo/Zelle (tasa mercado paralelo)
- **dolar_bcv**: Dolares con tasa oficial BCV (transferencia, pago movil)
- **euro_bcv**: Euros con tasa oficial BCV

Cada cliente tiene un `rateType` que define su moneda por defecto. Balances se calculan por separado por moneda.

## Formato de comunicacion

- Montos USD con 2 decimales: "$45.50"
- Mencionar tipo de moneda: "$45.50 (divisas)", "$30.00 (BCV)"
- Al preguntar "cuanto debe X": reportar TODOS los balances > 0
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

## Flujo de creacion
1. Preguntar productos y cantidades → 2. GET /api/products (precios) → 3. GET /api/config/bcv-rate → 4. Calcular totales → 5. Confirmar con usuario → 6. POST /api/presupuestos → 7. GET admin-url y enviar link.
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

Catalogo de productos RPYM (pescados, mariscos, camarones). Ver precios, disponibilidad, crear/actualizar.

**Base URL:** `https://rpym.net`

## Endpoints

### Listar — `GET /api/products` (sin auth)
Respuesta: `{ success, products: [...], count }`.
Campos: `id`, `nombre`, `descripcion`, `descripcionCorta`, `descripcionHome`, `categoria` ("camaron"|"pescado"|"marisco"|"otro"), `precioUSD` (BCV), `precioUSDDivisa` (efectivo/Zelle, puede ser null), `unidad` ("kg"), `disponible` (boolean), `sortOrder`.

### Crear — `POST /api/products` (auth: `Authorization: Bearer {{RPYM_API_KEY}}`, Content-Type: application/json)
Body: `{ nombre (REQ), categoria (REQ), precioUSD (REQ), precioUSDDivisa, descripcion, descripcionCorta, descripcionHome, unidad, disponible, sortOrder }`.
**Confirma antes de crear.**

## Doble precio

Muchos productos tienen dos precios:
- `precioUSD`: Para pagos via transferencia/pago movil (calculado con tasa BCV)
- `precioUSDDivisa`: Para pagos en efectivo USD/Zelle (generalmente menor)

Al listar precios, mostrar AMBOS si existen: "Camaron Jumbo: $15.00/kg (BCV) | $14.00/kg (divisas)"

## Categorias
- camaron: Camarones (jumbo, grande, mediano, etc.)
- pescado: Pescados (pargo, mero, corvina, etc.)
- marisco: Mariscos (pulpo, calamar, langosta, mejillones, etc.)
- otro: Otros (empanadas, salsas, etc.)

Agrupar por categoria al listar. Indicar si un producto NO esta disponible.
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

Gestiona pagos y transacciones de clientes RPYM. Registrar pagos, ver historial, marcar compras pagadas, analizar patrones.

**Base URL:** `https://rpym.net`
**Auth:** Todos los endpoints requieren `Authorization: Bearer {{RPYM_API_KEY}}`. SIEMPRE usar comillas DOBLES en curl: `-H "Authorization: Bearer $RPYM_API_KEY"`.

## Campos de una transaccion

`id`, `customerId`, `type` ("purchase"|"payment"), `date` (YYYY-MM-DD), `description`, `amountUsd`, `amountBs`, `amountUsdDivisa`, `currencyType` ("divisas"|"dolar_bcv"|"euro_bcv"), `paymentMethod` (solo payments), `isPaid` (boolean), `paidDate`, `paidMethod`, `isCrossed` (anulada visualmente), `presupuestoId`, `notes`, `exchangeRate`, `invoiceImageUrl`, `createdAt`, `updatedAt`.
Ordenadas por fecha DESC.

## Endpoints

### Ver transacciones — `GET /api/customers/{customerId}/transactions` (auth)
Respuesta camelCase: `{ success, transactions: [...] }`.

### Registrar pago — `POST /api/customers/{customerId}/transactions` (auth, Content-Type: application/json)
Body: `{ type: "payment", date: "YYYY-MM-DD", description, amountUsd, amountBs, currencyType, paymentMethod, notes, exchangeRate }`.
`paymentMethod`: "efectivo", "tarjeta", "pago_movil", "transferencia", "zelle".
**Confirma antes de registrar.**

### Registrar compra — `POST /api/customers/{customerId}/transactions` (auth)
Body: `{ type: "purchase", date, description, amountUsd, amountBs, amountUsdDivisa, currencyType, presupuestoId, notes }`.
NOTA: Las compras normalmente se crean automaticamente al vincular presupuesto a cliente.

### Marcar pagada — `PUT /api/customers/{customerId}/transactions/{txId}` (auth)
Body: `{ markPaid: true, paidMethod, paidDate, paidNotes }`. Si tiene presupuesto vinculado, tambien lo marca pagado.

### Desmarcar pagada — `PUT .../{txId}` con `{ markUnpaid: true }`. Revierte presupuesto a pendiente.

### Actualizar — `PUT .../{txId}` con campos a cambiar: `date`, `description`, `amountUsd`, `currencyType`, `paymentMethod`, `notes`. **Confirma antes.**

### Eliminar — `DELETE /api/customers/{customerId}/transactions/{txId}` (auth)
Eliminacion permanente. **Pedir confirmacion explicita.**

### Patrones de pago — `GET /api/bot2/payment-patterns/{customerId}` (auth)
Respuesta **snake_case**: `{ customer: {...}, stats: { totalPurchases, totalPayments, unpaidPurchases, totalUnpaidUSD, avgDaysToPay, avgDaysBetweenPurchases, lastPurchaseDate, lastPaymentDate }, transactions: [...] }`.
Transacciones cruzadas (is_crossed=1) excluidas del analisis. Campos snake_case: `amount_usd`, `currency_type`, `is_paid` (0/1), `days_to_pay`.

## Flujo de registro de pago
1. Buscar cliente: GET /api/bot2/customers/summary?search=nombre → 2. Verificar balance → 3. Confirmar monto/moneda/metodo → 4. POST transaccion → 5. Confirmar exito.

## Tipos de moneda (currencyType)
- `divisas`: Dolares efectivo/Zelle — NO usa tasa BCV
- `dolar_bcv`: Bs referenciado a tasa BCV del dolar
- `euro_bcv`: Bs referenciado a tasa BCV del euro

## Interpretacion de patrones
- avgDaysToPay <7: Buen pagador | 7-15: Normal | 15-30: Lento, hacer seguimiento | >30: Problematico, alertar
- unpaidPurchases >3: Muchas compras sin pagar
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

Analisis inteligente del negocio RPYM. Reportes, morosos, alertas, recomendaciones.

**Base URL:** `https://rpym.net`
**Auth:** Endpoints /api/bot2/ requieren `Authorization: Bearer {{RPYM_API_KEY}}`. SIEMPRE comillas DOBLES en curl: `-H "Authorization: Bearer $RPYM_API_KEY"`.

## Endpoints para analisis

- **Health:** `GET /api/bot2/health` (auth) — `{ ok, dbOk, timestamp }`
- **Clientes:** `GET /api/bot2/customers/summary` (auth) — todos los clientes con balances y stats
- **Vencidos:** `GET /api/bot2/presupuestos/overdue?days=15` (auth) — presupuestos pendientes viejos
- **Busqueda:** `GET /api/bot2/presupuestos/search?customer=X&product=X&from=X&to=X` (auth) — busqueda avanzada
- **Patrones:** `GET /api/bot2/payment-patterns/{customerId}` (auth) — comportamiento de pago
- **Stats hoy:** `GET /api/presupuestos/stats` (sin auth) — dashboard rapido
- **Tasa BCV:** `GET /api/config/bcv-rate` (sin auth) — `{ rate, source }`

## Reporte matutino ("como estamos", "reporte", "como va el negocio")

Llamar en paralelo: stats, customers/summary, overdue?days=7, bcv-rate. Reportar:
- Tasa BCV actual
- Presupuestos y ventas de hoy
- Top 5 clientes con deuda (por monto)
- Presupuestos vencidos que necesitan atencion
- Total cobranza pendiente

## Analisis de cliente

1. GET customers/summary?search=nombre → 2. GET payment-patterns/{id} → Reportar: balance por moneda, patron de pago (rapido/normal/lento), frecuencia de compra, compras sin pagar, recomendacion.

## Analisis de producto

GET presupuestos/search?product=nombre → Cuantos presupuestos lo incluyen, volumen vendido, monto generado, tendencia.

## Presupuestos vencidos

GET overdue?days=15 → Clasificar: >30 dias = alto riesgo (accion inmediata), 15-30 = medio (recordatorio), <15 = bajo (monitorear). Si is_linked=0: sugerir contactar cliente o eliminar.

## Reglas de comunicacion

- Hablar como asistente de negocio profesional pero cercano
- Usar numeros concretos: "$1,250.50", "Bs 75,780.25"
- Incluir tipo de moneda: "$450 (divisas)", "$300 (BCV)"
- Dar recomendaciones accionables ante problemas
- Alertar: deuda >$500 sin pagar >15 dias, vencidos >30 dias, clientes inactivos >30 dias (cuando compran semanalmente)
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

Monitorea la web publica de RPYM para verificar funcionamiento, productos y precios.

## URLs

- **Principal:** `https://rpym.net` — logo, productos destacados, precios, boton WhatsApp
- **Calculadora:** `https://rpym.net/presupuesto` — clientes crean presupuestos
- **Lista precios:** `https://rpym.net/lista` — precios con busqueda interactiva
- **API Health:** `https://rpym.net/api/bot2/health` (auth Bearer) — verificar API

## Verificaciones

1. **Consistencia de precios:** GET /api/products vs precios mostrados en web
2. **Disponibilidad:** Navegar a rpym.net, verificar que carga (no 500, no vacia), se ven productos
3. **Tasa BCV:** GET /api/config/bcv-rate, verificar que coincide con web, alertar si >24h sin actualizar

## Cuando ejecutar

- Usuario dice "revisa la pagina", "como se ve la web", "verifica rpym.net"
- Errores en otras peticiones API (puede indicar problemas)
- Como parte del reporte matutino si se solicita
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
