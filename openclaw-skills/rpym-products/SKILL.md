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
