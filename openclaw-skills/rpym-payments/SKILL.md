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
