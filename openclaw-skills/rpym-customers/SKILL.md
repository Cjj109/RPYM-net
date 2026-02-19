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
