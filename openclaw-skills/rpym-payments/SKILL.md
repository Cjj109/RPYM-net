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
