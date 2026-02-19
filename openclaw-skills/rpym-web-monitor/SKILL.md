---
name: rpym-web-monitor
description: Monitorea rpym.net — verificar disponibilidad, precios y tasa BCV
metadata: {"openclaw": {"emoji": "🌐"}}
---

# rpym-web-monitor

Monitorea la web publica de RPYM para verificar funcionamiento, productos y precios.

## URLs

- **Principal:** `https://rpym.net` — logo, productos destacados, precios, boton WhatsApp
- **Calculadora:** `https://rpym.net/presupuesto` — clientes crean presupuestos
- **Lista precios:** `https://rpym.net/lista` — precios con busqueda interactiva
- **API Health:** `https://rpym.net/api/bot2/health` (auth Bearer) — verificar API

## Verificaciones

1. **Consistencia de precios:** GET /api/products vs precios mostrados en web
2. **Disponibilidad:** Navegar a rpym.net, verificar que carga (no 500, no vacia), se ven productos
3. **Tasa BCV:** GET /api/config/bcv-rate, verificar que coincide con web, alertar si >24h sin actualizar

## Cuando ejecutar

- Usuario dice "revisa la pagina", "como se ve la web", "verifica rpym.net"
- Errores en otras peticiones API (puede indicar problemas)
- Como parte del reporte matutino si se solicita
