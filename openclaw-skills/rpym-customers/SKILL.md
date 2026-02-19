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
