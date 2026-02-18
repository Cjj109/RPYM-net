# Setup de OpenClaw Bot 2 en Mac mini M4

Guia paso a paso para instalar y configurar OpenClaw como Bot 2 de RPYM.

## Prerequisitos

Tener a mano:
- **BOT2_API_KEY**: La clave que ya agregaste en Cloudflare (secrets)
- **Token de Telegram**: Del bot que creaste con @BotFather
- **API Key de Gemini**: La que generaste en Google AI Studio

## Paso 1: Instalar Node.js 22+

```bash
# Instalar Homebrew si no lo tienes
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Instalar Node.js
brew install node@22

# Verificar
node --version   # Debe ser v22.x.x o mayor
npm --version
```

## Paso 2: Instalar OpenClaw

```bash
# Instalar OpenClaw globalmente
npm install -g @anthropic-ai/claude-code

# Verificar instalacion
claude --version
```

## Paso 3: Configurar OpenClaw

```bash
# Crear directorio de trabajo
mkdir -p ~/rpym-bot2
cd ~/rpym-bot2

# Inicializar OpenClaw con wizard
claude init
```

Durante el wizard:
1. **Model Provider**: Seleccionar **Gemini**
2. **API Key**: Pegar tu API key de Gemini
3. **Model**: `gemini-2.5-flash` (gratis, rapido)
4. **Channel**: Seleccionar **Telegram**
5. **Telegram Bot Token**: Pegar el token de @BotFather

## Paso 4: Copiar los Skills de RPYM

Copiar la carpeta `openclaw-skills/` de este repo a la Mac mini:

```bash
# Desde otra Mac (via AirDrop, USB, o SCP)
scp -r openclaw-skills/* usuario@mac-mini:~/rpym-bot2/skills/

# O si clonaste el repo directamente en la Mac mini:
cp -r /path/to/RPYM-net/openclaw-skills/* ~/rpym-bot2/skills/
```

La estructura debe quedar:
```
~/rpym-bot2/
  skills/
    rpym-customers/SKILL.md
    rpym-budgets/SKILL.md
    rpym-products/SKILL.md
    rpym-payments/SKILL.md
    rpym-analytics/SKILL.md
    rpym-web-monitor/SKILL.md
```

## Paso 5: Configurar variables de entorno

Crear archivo `.env` en el directorio de OpenClaw:

```bash
cat > ~/rpym-bot2/.env << 'EOF'
RPYM_API_KEY=tu_bot2_api_key_aqui
RPYM_BASE_URL=https://rpym.net
EOF
```

Reemplazar `tu_bot2_api_key_aqui` con la misma BOT2_API_KEY que pusiste en Cloudflare.

## Paso 6: Configurar System Prompt

Crear o editar el archivo de system prompt de OpenClaw:

```bash
cat > ~/rpym-bot2/CLAUDE.md << 'EOF'
# RPYM Bot 2 - Asistente Inteligente de Negocio

Eres el asistente inteligente de RPYM (El Rey de los Pescados y Mariscos), una pescaderia en Venezuela.

## Tu Rol
- Ayudar al dueno (Carlos) a gestionar su negocio
- Consultar y analizar datos de clientes, presupuestos y pagos
- Crear presupuestos y registrar pagos cuando se solicite
- Dar reportes y recomendaciones proactivas
- Monitorear la pagina web rpym.net

## Reglas
- Responder SIEMPRE en espanol
- Montos en USD: "$1,250.50" | Montos en Bs: "Bs 75,780.25"
- SIEMPRE confirmar con Carlos antes de: crear presupuestos, registrar pagos, crear/modificar clientes
- Nunca inventar datos — si no puedes obtener info de la API, decirlo
- Ser conciso pero informativo
- Cuando Carlos pregunte "como estamos" o "reporte", generar reporte completo del negocio

## Contexto del Negocio
- Pescaderia en Caracas, Venezuela
- Vende: camarones, pescados, mariscos
- Opera con multiples monedas: USD efectivo (divisas), USD via BCV (transferencia/pago movil), Euros
- Clientes tienen cuentas con balances por tipo de moneda
- Los presupuestos pueden ser "pendiente" o "pagado"
- La tasa BCV se actualiza automaticamente dos veces al dia
EOF
```

## Paso 7: Probar

```bash
cd ~/rpym-bot2
claude start
```

Luego abre Telegram y enviale al bot:
1. "hola" — debe responder
2. "que productos tienen?" — debe consultar la API y listar productos
3. "como estan los clientes?" — debe mostrar resumen de clientes con balances

## Paso 8: Auto-start con launchd

Para que OpenClaw arranque automaticamente al encender la Mac mini:

```bash
cat > ~/Library/LaunchAgents/com.rpym.bot2.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.rpym.bot2</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/claude</string>
        <string>start</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/TU_USUARIO/rpym-bot2</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/TU_USUARIO/rpym-bot2/logs/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/TU_USUARIO/rpym-bot2/logs/stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
EOF

# Reemplazar TU_USUARIO con tu nombre de usuario
sed -i '' "s/TU_USUARIO/$(whoami)/g" ~/Library/LaunchAgents/com.rpym.bot2.plist

# Crear directorio de logs
mkdir -p ~/rpym-bot2/logs

# Cargar el servicio
launchctl load ~/Library/LaunchAgents/com.rpym.bot2.plist
```

Para verificar que esta corriendo:
```bash
launchctl list | grep rpym
```

Para ver logs:
```bash
tail -f ~/rpym-bot2/logs/stdout.log
```

## Recuperacion tras cortes de luz

Con `KeepAlive: true` y `RunAtLoad: true`, launchd automaticamente:
- Inicia OpenClaw cuando la Mac enciende
- Reinicia OpenClaw si se cae por cualquier razon
- No necesitas hacer nada manual despues de un corte de luz

## Troubleshooting

### "Error: Browser not found"
```bash
npx playwright install chromium
```

### "API key invalida"
Verificar que el `.env` tiene la misma clave que esta en Cloudflare:
```bash
curl -H "Authorization: Bearer TU_KEY" https://rpym.net/api/bot2/health
```

### El bot no responde en Telegram
1. Verificar que OpenClaw esta corriendo: `launchctl list | grep rpym`
2. Ver logs: `tail -20 ~/rpym-bot2/logs/stderr.log`
3. Verificar internet: `ping rpym.net`

### Gemini rate limit
El free tier de Gemini permite 60 RPM y 1,000 RPD. Si ves errores de rate limit:
- Esperar 1 minuto y reintentar
- Si pasa frecuentemente, considerar el plan de pago (muy barato)
