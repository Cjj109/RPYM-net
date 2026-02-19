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
