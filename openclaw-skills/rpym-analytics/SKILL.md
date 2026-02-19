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
