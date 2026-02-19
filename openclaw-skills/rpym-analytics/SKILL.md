---
name: rpym-analytics
description: Analisis inteligente del negocio RPYM — reportes, morosos, alertas y recomendaciones
metadata: {"openclaw": {"requires": {"env": ["RPYM_API_KEY"]}, "primaryEnv": "RPYM_API_KEY", "emoji": "📊"}}
---

# rpym-analytics

Analisis inteligente del negocio RPYM. Reportes, morosos, alertas, recomendaciones.

**Base URL:** `https://rpym.net`
**Auth:** Endpoints /api/bot2/ requieren `Authorization: Bearer {{RPYM_API_KEY}}`. SIEMPRE comillas DOBLES en curl: `-H "Authorization: Bearer $RPYM_API_KEY"`.

## Endpoints para analisis

- **Health:** `GET /api/bot2/health` (auth) — `{ ok, dbOk, timestamp }`
- **Clientes:** `GET /api/bot2/customers/summary` (auth) — todos los clientes con balances y stats
- **Vencidos:** `GET /api/bot2/presupuestos/overdue?days=15` (auth) — presupuestos pendientes viejos
- **Busqueda:** `GET /api/bot2/presupuestos/search?customer=X&product=X&from=X&to=X` (auth) — busqueda avanzada
- **Patrones:** `GET /api/bot2/payment-patterns/{customerId}` (auth) — comportamiento de pago
- **Stats hoy:** `GET /api/presupuestos/stats` (sin auth) — dashboard rapido
- **Tasa BCV:** `GET /api/config/bcv-rate` (sin auth) — `{ rate, source }`

## Reporte matutino ("como estamos", "reporte", "como va el negocio")

Llamar en paralelo: stats, customers/summary, overdue?days=7, bcv-rate. Reportar:
- Tasa BCV actual
- Presupuestos y ventas de hoy
- Top 5 clientes con deuda (por monto)
- Presupuestos vencidos que necesitan atencion
- Total cobranza pendiente

## Analisis de cliente

1. GET customers/summary?search=nombre → 2. GET payment-patterns/{id} → Reportar: balance por moneda, patron de pago (rapido/normal/lento), frecuencia de compra, compras sin pagar, recomendacion.

## Analisis de producto

GET presupuestos/search?product=nombre → Cuantos presupuestos lo incluyen, volumen vendido, monto generado, tendencia.

## Presupuestos vencidos

GET overdue?days=15 → Clasificar: >30 dias = alto riesgo (accion inmediata), 15-30 = medio (recordatorio), <15 = bajo (monitorear). Si is_linked=0: sugerir contactar cliente o eliminar.

## Reglas de comunicacion

- Hablar como asistente de negocio profesional pero cercano
- Usar numeros concretos: "$1,250.50", "Bs 75,780.25"
- Incluir tipo de moneda: "$450 (divisas)", "$300 (BCV)"
- Dar recomendaciones accionables ante problemas
- Alertar: deuda >$500 sin pagar >15 dias, vencidos >30 dias, clientes inactivos >30 dias (cuando compran semanalmente)
