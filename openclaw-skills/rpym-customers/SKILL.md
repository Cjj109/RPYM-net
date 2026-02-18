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
- Endpoint optimizado para analisis. Devuelve TODOS los clientes con:
  - Balances por tipo de moneda (divisas, BCV, euro)
  - `total_purchases`: Cantidad total de compras
  - `last_purchase_date`: Fecha de ultima compra
  - `last_payment_date`: Fecha de ultimo pago
- Respuesta incluye:
  - `totalCustomers` (number): Total de clientes activos
  - `customersWithDebt` (number): Clientes que deben algo (balance > $0.01)
  - `customers` (array): Lista completa

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
