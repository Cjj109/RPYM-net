# RPYM - El Rey de los Pescados y Mariscos

Sitio web para el negocio familiar de venta de pescados y mariscos con mas de 30 anos de tradicion, ubicado en el Muelle Pesquero "El Mosquero" en Maiquetia, Venezuela.

## Caracteristicas

- Lista de precios dinamica conectada a Google Sheets
- Calculadora de presupuesto interactiva
- Diseno responsivo con tema marino
- Optimizado para Cloudflare Pages

## Tecnologias

- **Framework**: [Astro](https://astro.build/) 5.x
- **Estilos**: [Tailwind CSS](https://tailwindcss.com/) 4.x
- **Interactividad**: [React](https://react.dev/) 19
- **Datos**: Google Sheets (API publica)
- **Hosting**: Cloudflare Pages

## Desarrollo Local

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm run dev

# El sitio estara disponible en http://localhost:4321
```

## Configurar Google Sheets

1. Crea un Google Sheet con las siguientes columnas:
   - **Producto**: Nombre del producto
   - **Categoria**: Categoria (Pescados, Camarones, Mariscos, Especiales)
   - **Precio**: Precio numerico
   - **Unidad**: Unidad de medida (kg, unidad, etc.)
   - **Disponible**: "Si" o "No"
   - **Descripcion**: (Opcional) Descripcion del producto

2. Comparte el Sheet como "Cualquier persona con el enlace puede ver"

3. Copia el ID del Sheet desde la URL:
   ```
   https://docs.google.com/spreadsheets/d/[ESTE_ES_EL_ID]/edit
   ```

4. En Cloudflare Pages, agrega la variable de entorno:
   ```
   PUBLIC_SHEET_ID=tu_sheet_id_aqui
   ```

## Deploy en Cloudflare Pages

### Configuracion inicial

1. Crea un nuevo proyecto en Cloudflare Pages
2. Conecta tu repositorio de GitHub
3. Configura el build:
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Node.js version**: 20

### Variables de entorno

| Variable | Descripcion |
|----------|-------------|
| `PUBLIC_SHEET_ID` | ID de tu Google Sheet con los precios |

### Actualizar precios

Para actualizar los precios en el sitio:

1. Edita tu Google Sheet con los nuevos precios
2. En Cloudflare Pages, haz clic en "Retry deployment" o haz un push a GitHub

## Estructura del Proyecto

```
rpym-net/
├── src/
│   ├── components/     # Componentes reutilizables
│   ├── layouts/        # Layout principal
│   ├── lib/            # Utilidades (conexion a Sheets)
│   ├── pages/          # Paginas del sitio
│   └── styles/         # Estilos globales
├── public/             # Assets estaticos
└── astro.config.mjs    # Configuracion de Astro
```

## Comandos

| Comando | Descripcion |
|---------|-------------|
| `npm run dev` | Inicia servidor de desarrollo |
| `npm run build` | Compila el sitio para produccion |
| `npm run preview` | Previsualiza el build localmente |

## Licencia

Todos los derechos reservados - RPYM El Rey de los Pescados y Mariscos
