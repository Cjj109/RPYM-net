# RPYM - Sistema de Gestión de Presupuestos

Guía completa para configurar el sistema de guardado automático de presupuestos.

## Resumen del Sistema

- **Guardado automático**: Cada presupuesto se guarda en Google Sheets cuando el cliente hace clic en "Ver Presupuesto"
- **Panel de administración**: `/admin/presupuestos` para ver y gestionar todos los presupuestos
- **Vista pública**: `/presupuesto/ver?id=XXX` para compartir presupuestos con clientes
- **Estados**: Pendiente → Pagado

---

## PASO 1: Crear Google Sheet

1. Ve a [Google Sheets](https://sheets.google.com/)
2. Crea una nueva hoja de cálculo
3. Nómbrala: `RPYM - Presupuestos`
4. **Copia el ID del Sheet** de la URL:
   ```
   https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit
   ```
   El ID es la parte entre `/d/` y `/edit`

---

## PASO 2: Crear Google Apps Script

1. Ve a [Google Apps Script](https://script.google.com/)
2. Crea un nuevo proyecto
3. Nómbralo: `RPYM Presupuestos API`
4. **Borra todo el contenido** del archivo `Code.gs`
5. **Copia y pega** todo el contenido del archivo `google-apps-script.js` de este proyecto
6. **Edita la línea 15** y reemplaza `TU_SHEET_ID_AQUI` con el ID de tu Google Sheet:
   ```javascript
   const SHEET_ID = 'tu_id_real_aqui';
   ```
7. Guarda el proyecto (Ctrl+S)

---

## PASO 3: Desplegar el Apps Script

1. En el editor de Apps Script, haz clic en **Deploy** (Implementar)
2. Selecciona **New deployment** (Nueva implementación)
3. Haz clic en el engranaje ⚙️ y selecciona **Web app**
4. Configura:
   - **Description**: `API Presupuestos v1`
   - **Execute as**: `Me` (tu cuenta)
   - **Who has access**: `Anyone` (Cualquiera)
5. Haz clic en **Deploy**
6. **Autoriza** la aplicación cuando te lo pida (es seguro, usa tu propia cuenta)
7. **COPIA LA URL** que aparece. Se verá algo así:
   ```
   https://script.google.com/macros/s/AKfycby.../exec
   ```

---

## PASO 4: Configurar la URL en el Código

1. Abre el archivo `src/lib/presupuesto-storage.ts`
2. **Edita la línea 11** y reemplaza la URL placeholder:
   ```typescript
   const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/TU_URL_REAL/exec';
   ```
3. Guarda el archivo

---

## PASO 5: Desplegar en Cloudflare

1. Haz commit de los cambios:
   ```bash
   git add -A
   git commit -m "feat: sistema de gestión de presupuestos"
   git push
   ```
2. Espera a que Cloudflare Pages despliegue automáticamente

---

## Acceso al Panel de Administración

- **URL**: `https://www.rpym.net/admin/presupuestos`
- **Contraseña**: `rpym2026`

### Funcionalidades del Panel:
- Ver todos los presupuestos
- Filtrar por estado (Todos / Pendientes / Pagados)
- Marcar presupuestos como pagados
- Ver detalle de cada presupuesto
- Eliminar presupuestos
- Estadísticas del día (presupuestos, ventas)
- Auto-actualización cada 30 segundos

---

## Probar el Sistema

### 1. Verificar guardado automático
1. Ve a `https://www.rpym.net/presupuesto`
2. Selecciona algunos productos
3. Haz clic en **"Ver Presupuesto"**
4. Abre tu Google Sheet - debe aparecer una nueva fila

### 2. Verificar panel de admin
1. Ve a `https://www.rpym.net/admin/presupuestos`
2. Ingresa la contraseña: `rpym2026`
3. Debe aparecer el presupuesto que acabas de crear

### 3. Verificar marcar como pagado
1. En el panel admin, encuentra el presupuesto
2. Haz clic en ✅ para marcar como pagado
3. Verifica en el Sheet que el estado cambió

### 4. Verificar vista pública
1. En el panel admin, haz clic en 🔗 junto a un presupuesto
2. Se abre la vista pública con el estado visible
3. El cliente puede confirmar por WhatsApp desde ahí

### 5. Verificar eliminación
1. En el panel admin, haz clic en 🗑️
2. Confirma la eliminación
3. El presupuesto desaparece de la lista y del Sheet

---

## Estructura del Google Sheet

El script crea automáticamente la hoja `Presupuestos` con estas columnas:

| Columna | Contenido |
|---------|-----------|
| A | ID (RPYM-AAMMDD-XXX) |
| B | Fecha/hora ISO |
| C | Items (JSON) |
| D | Total USD |
| E | Total Bs |
| F | Estado (pendiente/pagado) |
| G | IP del cliente |
| H | Fecha de pago |
| I | Nombre cliente |
| J | Dirección |

---

## Solución de Problemas

### El presupuesto no se guarda
1. Verifica que la URL del Apps Script esté correcta en `presupuesto-storage.ts`
2. Verifica que el SHEET_ID esté correcto en el Apps Script
3. Revisa la consola del navegador (F12) por errores

### Error de permisos en Apps Script
1. Vuelve a hacer deploy
2. Asegúrate de seleccionar "Anyone" en "Who has access"
3. Autoriza la aplicación nuevamente

### El panel admin no carga
1. Verifica que la URL del Apps Script esté correcta
2. Prueba acceder directamente a la URL del script en el navegador
3. Debe devolver JSON (aunque sea un error)

### Los presupuestos no aparecen en el Sheet
1. En Apps Script, ejecuta la función `testCreate()` manualmente
2. Verifica que se crea una fila en el Sheet
3. Si funciona, el problema está en la comunicación frontend-backend

---

## Seguridad

- **Panel admin**: Protegido por contraseña (almacenada en sessionStorage)
- **Apps Script**: Solo tu cuenta puede ver/editar el código
- **Sheet**: Solo accesible por el Apps Script
- **Guardado**: Silencioso para el cliente (no bloquea si falla)

---

## Cambiar la Contraseña del Admin

Edita el archivo `src/components/AdminPanel.tsx`, línea 13:
```typescript
const ADMIN_PASSWORD = 'tu_nueva_contraseña';
```

---

## Archivos del Sistema

```
src/
├── lib/
│   └── presupuesto-storage.ts    # Módulo de comunicación con Apps Script
├── components/
│   ├── BudgetCalculator.tsx      # Modificado para auto-guardar
│   ├── AdminPanel.tsx            # Panel de administración
│   └── PresupuestoViewer.tsx     # Vista pública de presupuesto
├── pages/
│   ├── admin/
│   │   └── presupuestos.astro    # Página del panel admin
│   └── presupuesto/
│       └── ver.astro             # Página de vista pública

google-apps-script.js             # Código para Google Apps Script
SETUP-PRESUPUESTOS.md             # Esta guía
```

---

## Contacto

Si tienes problemas con la configuración, revisa:
1. La consola del navegador (F12 > Console)
2. Los logs del Apps Script (View > Logs)
3. El formato de los datos en el Sheet
