# rpym-web-monitor

## Description
Monitorea la pagina web publica de RPYM (rpym.net) para verificar que funciona correctamente, que los productos se muestran bien, y que los precios estan actualizados.

## URLs a Monitorear

### Pagina Principal
```
https://rpym.net
```
- Debe mostrar: logo, productos destacados, precios, boton de WhatsApp
- Verificar que los precios coinciden con los de la API

### Pagina de Presupuestos (Calculadora)
```
https://rpym.net/presupuesto
```
- Calculadora publica donde los clientes crean presupuestos
- Debe mostrar todos los productos disponibles con precios
- Verificar que la tasa BCV se muestra correctamente

### Lista de Precios
```
https://rpym.net/lista
```
- Lista de precios publica con busqueda interactiva
- Muestra todos los productos disponibles agrupados por categoria
- Los precios se actualizan en tiempo real con la tasa BCV

### API Health
```
https://rpym.net/api/bot2/health
```
- Verificar con Bearer token que la API responde
- Si falla, la pagina puede estar caida

## Verificaciones

### 1. Consistencia de Precios
Comparar precios de la API con los que se muestran en la web:
1. `GET /api/products` -- obtener precios de la base de datos
2. Navegar a `https://rpym.net` con el browser
3. Verificar que los precios mostrados coinciden
4. Reportar discrepancias si las hay

### 2. Disponibilidad de la Pagina
1. Navegar a `https://rpym.net`
2. Verificar que la pagina carga correctamente (no error 500, no pagina en blanco)
3. Verificar que se ven productos
4. Tomar screenshot si el usuario lo pide

### 3. Tasa BCV Actualizada
1. `GET /api/config/bcv-rate` -- obtener tasa actual
2. Verificar en la pagina que la tasa mostrada coincide
3. Alertar si la tasa no se ha actualizado en mas de 24 horas

## Cuando Ejecutar

- Cuando el usuario diga "revisa la pagina", "como se ve la web", "verifica rpym.net"
- Cuando haya errores en otras peticiones a la API (puede indicar problemas en el sitio)
- Como parte del reporte matutino si el usuario lo solicita

## Formato de Reporte

```
ESTADO DE rpym.net

Pagina principal: OK (carga en 1.2s)
Calculadora: OK
API: OK (D1 conectada)
Tasa BCV: Bs 60.50 (actualizada hace 2h)
Productos visibles: 15/15
Precios: Coinciden con base de datos

Sin problemas detectados.
```

Si hay problemas:
```
ALERTA rpym.net

Pagina principal: OK
Calculadora: ERROR - No muestra precios
API: OK
Tasa BCV: DESACTUALIZADA (ultima actualizacion hace 26h)

ACCIONES RECOMENDADAS:
1. La tasa BCV no se actualizo hoy - verificar cron job de GitHub Actions
2. La calculadora tiene un error - revisar consola del navegador
```
