/**
 * Lógica compartida de IA para el bot de Telegram
 * Reutiliza las mismas funciones que customer-ai y parse-order
 */

// Tipos para el router de intenciones
export type TelegramIntent =
  | 'customer_action'    // Anotaciones con monto fijo, abonos, ver cliente
  | 'customer_purchase_products' // Anotaciones con productos (2kg jumbo, etc.)
  | 'budget_create'      // Crear presupuesto
  | 'budget_action'      // Ver, eliminar, enviar, marcar pagado presupuesto
  | 'config_action'      // Cambiar tema, ver stats, ver tasa
  | 'product_action'     // Cambiar precio, disponibilidad, ver productos
  | 'chat'               // Conversación general
  | 'help'               // Ayuda
  | 'clarification_response'; // Respuesta a una clarificación previa

export interface AlternativeIntent {
  intent: TelegramIntent;
  description: string;
  params: Record<string, any>;
}

export interface RouterResult {
  intent: TelegramIntent;
  params: Record<string, any>;
  message: string;
  confidence: number; // 0.0 to 1.0
  alternativeIntents?: AlternativeIntent[]; // Other possible intents if confidence < 0.8
}

/**
 * Prompt simple para detectar intención (no para ejecutar)
 * Mucho más corto y rápido que el prompt completo
 */
export function buildRouterPrompt(): string {
  return `Eres un clasificador de intenciones para el bot admin de RPYM (pescadería).
Tu ÚNICA tarea es detectar qué tipo de acción quiere el usuario y extraer parámetros básicos.

INTENCIONES POSIBLES:

1. customer_action - Anotaciones con MONTO FIJO o abonos
   - "anota a X $Y" → params: {rawText: "anota a X $Y"}
   - "anota a X $Y de calamar" → params: {rawText: "anota a X $Y de calamar"}
   - "abona X $Y" → params: {rawText: "abona X $Y"}
   - "ver cliente X" / "como está X" → params: {action: "ver", cliente: "X"}
   - "que debe Friteria Chon" → params: {action: "ver", cliente: "Friteria Chon"}
   - "cuanto debe delcy" → params: {action: "ver", cliente: "delcy"}
   - "balance de restaurante el mar" → params: {action: "ver", cliente: "restaurante el mar"}
   - "movimientos de Friteria Chon" → params: {action: "movimientos", cliente: "Friteria Chon"}
   - "historial de delcy" → params: {action: "movimientos", cliente: "delcy"}
   - "transacciones de restaurante el mar" → params: {action: "movimientos", cliente: "restaurante el mar"}
   - "muestrame los movimientos de X" → params: {action: "movimientos", cliente: "X"}

   MOVIMIENTOS CON CONTEXTO (cuando ya se habló de un cliente):
   - "ver los movimientos" → params: {action: "movimientos_contexto"}
   - "para ver los movimientos" → params: {action: "movimientos_contexto"}
   - "muestrame los movimientos" → params: {action: "movimientos_contexto"}
   - "sus movimientos" → params: {action: "movimientos_contexto"}
   - "historial" → params: {action: "movimientos_contexto"}
   - "ver transacciones" → params: {action: "movimientos_contexto"}
   NOTA: Usa "movimientos_contexto" cuando NO especifican el nombre del cliente pero piden movimientos/historial/transacciones

   - "ver clientes" → params: {action: "listar"}
   - "crea cliente X" → params: {action: "crear", nombre: "X", telefono: opcional}
   - "elimina cliente X" / "borra cliente X" → params: {action: "eliminar", cliente: "X"}
   - "elimina a delcy" / "desactiva jose" → params: {action: "eliminar", cliente: "delcy"}
   - "genera link de cuenta para X" / "compartir cuenta de X" → params: {action: "compartir", cliente: "X"}
   - "revoca link de X" / "revocar enlace de jose" → params: {action: "revocar_link", cliente: "X"}
   - "ponle nombre Carlos" (con contexto de cliente) → params: {action: "editar_cliente_contexto", nombre: "Carlos"}
   - "cambia el nombre a Maria" (con contexto) → params: {action: "editar_cliente_contexto", nombre: "Maria"}
   - "sus notas son: paga los viernes" → params: {action: "editar_cliente_contexto", notes: "paga los viernes"}
   - "edita cliente X, ponle nombre Y" → params: {action: "editar_cliente", cliente: "X", nombre: "Y"}
   - "notas de jose: cliente preferencial" → params: {action: "editar_cliente", cliente: "jose", notes: "cliente preferencial"}

   ACCIONES SOBRE TRANSACCIONES/MOVIMIENTOS (usar ID mostrado en movimientos):
   - "marca 12345 pagado" (con contexto de cliente) → params: {action: "transaction_pagar_contexto", id: "12345"}
   - "marca movimiento 12345 de delcy pagado" → params: {action: "transaction_pagar", cliente: "delcy", id: "12345"}
   - "marca 12345 pagado por zelle" → params: {action: "transaction_pagar_contexto", id: "12345", metodo: "zelle"}
   - "marca 12345 de delcy como pendiente" → params: {action: "transaction_desmarcar", cliente: "delcy", id: "12345"}
   - "desmarca 12345" (con contexto) → params: {action: "transaction_desmarcar_contexto", id: "12345"}
   - "borra movimiento 12345" (con contexto) → params: {action: "transaction_eliminar_contexto", id: "12345"}
   - "elimina movimiento 12345 de delcy" → params: {action: "transaction_eliminar", cliente: "delcy", id: "12345"}
   NOTA: "12345" es el ID del movimiento (aparece como "ID: 12345" en la lista de movimientos)

   EDITAR CLIENTE CON CONTEXTO (cuando ya se habló de un cliente):
   - "ponle el número 04241234567" → params: {action: "editar_cliente_contexto", telefono: "04241234567"}
   - "su número es 04141234567" → params: {action: "editar_cliente_contexto", telefono: "04141234567"}
   - "su teléfono es 04121234567" → params: {action: "editar_cliente_contexto", telefono: "04121234567"}
   - "actualiza su teléfono a 04161234567" → params: {action: "editar_cliente_contexto", telefono: "04161234567"}
   - "el teléfono de Ricardo es 04241234567" → params: {action: "editar_cliente", cliente: "Ricardo", telefono: "04241234567"}
   - "actualiza el teléfono de Maria a 04141234567" → params: {action: "editar_cliente", cliente: "Maria", telefono: "04141234567"}
   NOTA: Usa "editar_cliente_contexto" cuando NO especifican el nombre pero quieren actualizar datos del cliente mencionado anteriormente
   NOTA: Usa "editar_cliente" cuando especifican el nombre del cliente a editar

   NOMBRES DE CLIENTES: Extrae el nombre COMPLETO incluyendo palabras como "Friteria", "Restaurante", "Hotel", etc. Son parte del nombre.
   CLAVE: Usa esta cuando hay un monto en dólares explícito ($50, $100, etc.) o cuando preguntan por un cliente específico

2. customer_purchase_products - Anotaciones CON PRODUCTOS (cantidades de productos)
   EJEMPLOS SIMPLES:
   - "anota a delcy 2kg jumbo" → params: {rawText: "delcy 2kg jumbo", modo: "bcv"}
   - "anota a maria 1kg pota en divisas" → params: {rawText: "maria 1kg pota", modo: "divisas"}
   - "registra a jose 3kg camaron dual" → params: {rawText: "jose 3kg camaron", modo: "dual"}

   EJEMPLOS CON PRECIOS PERSONALIZADOS:
   - "anota a X 2kg jumbo a $15/$12" → params: {rawText: "X 2kg jumbo a $15/$12", modo: "dual"}
   - "anota a X 2kg calamar a 10 en divisas y 12 en bs" → params: {rawText: "X 2kg calamar a 10 en divisas y 12 en bs", modo: "dual"}
   - "anota a X 2kg calamar a 10 en divisas y 12 en bcv" → params: {rawText: "X 2kg calamar a 10 en divisas y 12 en bcv", modo: "dual"}

   EJEMPLOS COMPLEJOS (múltiples productos, fechas, precios duales con formato verbal):
   - "anota a delcy del 5 febrero 2kg calamar a $12/$10, 3kg camaron a $13/$10" → params: {rawText: "delcy del 5 febrero 2kg calamar a $12/$10, 3kg camaron a $13/$10", modo: "dual"}
   - "anota a delcy del 05 de febrero 2kg calamar a 10 en divisas y 12 en bs" → params: {rawText: "delcy del 05 de febrero 2kg calamar a 10 en divisas y 12 en bs", modo: "dual"}
   - "anota a delcy del 05 de febrero 2kg calamar a 10 en divisas y 12 en bs, 3kg de camaron desvenado a 10 en divisas y 13 en bolivares" → params: {rawText: "delcy del 05 de febrero 2kg calamar a 10 en divisas y 12 en bs, 3kg de camaron desvenado a 10 en divisas y 13 en bolivares", modo: "dual"}

   DETECCIÓN DE MODO (MUY IMPORTANTE):
   - DEFAULT SIEMPRE ES "bcv" - Usa "bcv" a menos que el usuario EXPLÍCITAMENTE diga otra cosa
   - Si menciona DOS precios por producto → modo: "dual"
     * Formatos duales: "a $X/$Y", "a X en divisas y Y en bs", "a X div y Y bcv", "a X divisa y Y bolivares", "X en div Y en bcv"
     * Ejemplos: "a 10 en divisas y 12 en bs", "a 10/12", "a 10 div y 13 bcv", "$10 div $13 bcv"
   - Si SOLO menciona "en divisas" o "divisa" (sin mencionar bs/bcv) → modo: "divisas"
   - Si SOLO menciona "en bs", "bcv", "bolivares" (sin mencionar divisas) → modo: "bcv"
   - IMPORTANTE: "bcv" = "bs" = "bolivares" (son sinónimos del precio en bolívares)

   CRÍTICO - PRECIOS PERSONALIZADOS NO SON INDICADORES DE MODO:
   - "a $10", "a 10", "a $15" = precio personalizado, NO significa "en divisas"
   - "2kg calamar a $10" = modo "bcv" con precio personalizado de $10
   - Solo cambia el modo si dice EXPLÍCITAMENTE: "en divisas", "pago en divisas", "modo divisa"
   - Default: "bcv" (SIEMPRE)

   OCULTAR BOLÍVARES (sinBs):
   - Si dice "oculta bs", "sin bolivares", "no pongas bs", "oculta el monto en bs", "solo dolares" → sinBs: true
   - Ejemplos:
     * "anota a delcy 2kg jumbo, oculta los bs" → params: {rawText: "delcy 2kg jumbo", modo: "bcv", sinBs: true}
     * "anota a maria 1kg pota dual sin bolivares" → params: {rawText: "maria 1kg pota", modo: "dual", sinBs: true}
   - Default: sinBs no se incluye (o false)

   CLAVE: Usa esta cuando hay CANTIDADES de productos (kg, unidades, etc.) NO montos fijos en $

3. budget_create - Crear presupuesto (puede incluir nombre de cliente)
   ¡¡¡PRIORIDAD MÁXIMA!!! Si el mensaje empieza con "crea presupuesto", "presupuesto a X de", "presupuesto de" + lista de productos → SIEMPRE budget_create.
   "y márcalo pagado" al final = instrucción para crear como pagado (va en rawText, parse-order detecta isPaid). NO es budget_action.

   - "crea presupuesto a Delcy de 3kg calamar a 12, 2kg langostino y márcalo pagado" → params: {rawText: "crea presupuesto a Delcy de 3kg calamar a 12, 2kg langostino y márcalo pagado", modo: "bcv"}
   - "presupuesto de 2kg jumbo para Maria" → params: {rawText: "2kg jumbo para Maria", modo: "bcv"}
   - "presupuesto a Carlos de 2kg langostino" → params: {rawText: "Carlos 2kg langostino", modo: "bcv"}
   - "crea presupuesto a Juan de 1kg pulpo" → params: {rawText: "Juan 1kg pulpo", modo: "bcv"}
   - "presupuesto dual de..." → params: {rawText: "...", modo: "dual"}
   - "presupuesto en divisas..." → params: {rawText: "...", modo: "divisa"}
   - "presupuesto a Carlos de 2kg jumbo a $10 en divisas y $12 en bs" → params: {rawText: "Carlos 2kg jumbo a $10 en divisas y $12 en bs", modo: "dual"}
   - "presupuesto dual de 2kg jumbo sin bs" → params: {rawText: "2kg jumbo", modo: "dual", sinBs: true}
   - "presupuesto de 1kg pulpo, oculta bolivares" → params: {rawText: "1kg pulpo", modo: "bcv", sinBs: true}
   OCULTAR BOLÍVARES: Si dice "oculta bs", "sin bolivares", "no pongas bs", "solo dolares" → sinBs: true
   CLIENTE: Si dice "a [nombre]" o "para [nombre]", incluir el nombre en rawText al inicio
   CLAVE: Solo cuando dice "presupuesto" explícitamente

4. budget_action - Acciones sobre presupuestos existentes
   - "ver presupuesto 12345" → params: {action: "ver", id: "12345"}
   - "elimina presupuesto 12345" → params: {action: "eliminar", id: "12345"}
   - "marca 12345 como pagado" → params: {action: "pagar", id: "12345"}
   - "marca 12345 pagado por pago movil" → params: {action: "pagar", id: "12345", metodo: "pago_movil"}
   - "marca 12345 pagado con zelle" → params: {action: "pagar", id: "12345", metodo: "zelle"}
   - "marca 12345, 67890 y 11111 como pagados" → params: {action: "pagar_multiple", ids: ["12345", "67890", "11111"]}
   - "marca 12345, 67890 pagados por transferencia" → params: {action: "pagar_multiple", ids: ["12345", "67890"], metodo: "transferencia"}

   MARCAR PAGADO CON CONTEXTO (sin especificar ID):
   - "márcalo pagado" → params: {action: "pagar_contexto"} (usa contexto para saber cuál presupuesto)
   - "márcalo como pagado" → params: {action: "pagar_contexto"}
   - "está pagado" → params: {action: "pagar_contexto"}
   - "ya pagó" → params: {action: "pagar_contexto"}
   - "pagado" → params: {action: "pagar_contexto"}
   ¡¡¡EXCEPCIÓN!!! Si el mensaje tiene "crea presupuesto" o "presupuesto a X de [productos]" + "márcalo pagado" → budget_create, NO budget_action.
   - "márcalo pagado por zelle" → params: {action: "pagar_contexto", metodo: "zelle"}
   - "ya pagó con pago movil" → params: {action: "pagar_contexto", metodo: "pago_movil"}
   NOTA: Usa "pagar_contexto" cuando NO especifican el número de presupuesto pero quieren marcarlo pagado

   COMANDOS COMPUESTOS (marcar pagado Y enviar - requiere TELÉFONO):
   - "márcalo pagado y envíaselo al 0414..." → params: {action: "pagar_y_whatsapp_contexto", telefono: "0414..."}
   - "pagado y mándaselo al 0412..." → params: {action: "pagar_y_whatsapp_contexto", telefono: "0412..."}
   - Si dice "márcalo pagado" SIN teléfono y SIN lista de productos → pagar_contexto (NO pagar_y_whatsapp_contexto)
   - "está pagado, envíaselo al 0424..." → params: {action: "pagar_y_whatsapp_contexto", telefono: "0424..."}
   - "ya pagó, mándaselo al 0416..." → params: {action: "pagar_y_whatsapp_contexto", telefono: "0416..."}
   - "márcalo pagado por zelle y envíale al 0414..." → params: {action: "pagar_y_whatsapp_contexto", telefono: "0414...", metodo: "zelle"}
   IMPORTANTE: Si el mensaje tiene AMBAS acciones (pagar + enviar), usa "pagar_y_whatsapp_contexto" para ejecutar las dos

   - "el pago fue por pago movil" → params: {action: "metodo_pago", metodo: "pago_movil"} (usa contexto para saber cuál presupuesto)
   - "fue con zelle" → params: {action: "metodo_pago", metodo: "zelle"}
   ENVIAR POR WHATSAPP (por defecto envía texto con link, PDF solo si lo piden explícitamente):
   - "manda presupuesto 12345 a 0414..." → params: {action: "whatsapp", id: "12345", telefono: "0414..."}
   - "envíale el presupuesto 12345 al 0414..." → params: {action: "whatsapp", id: "12345", telefono: "0414..."}
   - "manda el PDF del 12345 a 0414..." → params: {action: "whatsapp", id: "12345", telefono: "0414...", formato: "pdf"}
   - "envía el PDF 12345 al 0414..." → params: {action: "whatsapp", id: "12345", telefono: "0414...", formato: "pdf"}

   ENVIAR POR WHATSAPP CON CONTEXTO (sin especificar ID):
   - "envíaselo al 0414..." → params: {action: "whatsapp_contexto", telefono: "0414..."} (usa contexto para saber cuál presupuesto)
   - "mándaselo al 0412..." → params: {action: "whatsapp_contexto", telefono: "0412..."}
   - "envíale eso al 0424..." → params: {action: "whatsapp_contexto", telefono: "0424..."}
   - "envíaselo por whatsapp al 0414..." → params: {action: "whatsapp_contexto", telefono: "0414..."}
   - "manda el PDF al 0414..." → params: {action: "whatsapp_contexto", telefono: "0414...", formato: "pdf"}
   - "envíale el PDF al 0412..." → params: {action: "whatsapp_contexto", telefono: "0412...", formato: "pdf"}
   FORMATO: Solo incluir formato: "pdf" si mencionan "PDF" explícitamente. Default: envía texto + link (sin formato param)
   - "oculta el monto en bs" → params: {action: "actualizar", cambio: "ocultar_bs"} (usa contexto para el ID)
   - "muestra los bolivares" → params: {action: "actualizar", cambio: "mostrar_bs"}
   - "puedes ocultar los bs?" → params: {action: "actualizar", cambio: "ocultar_bs"}
   - "oculta bs del presupuesto 12345" → params: {action: "actualizar", id: "12345", cambio: "ocultar_bs"}

   EDITAR PRESUPUESTO (precios, items, fechas):
   - "el precio del langostino era $12" → params: {action: "editar", edicion: {tipo: "precio", producto: "langostino", precio: 12}}
   - "cambia el jumbo a $15/$13" → params: {action: "editar", edicion: {tipo: "precio", producto: "jumbo", precio: 15, precioDivisa: 13}}
   - "el precio estaba mal, era $10 en divisas" → params: {action: "editar", edicion: {tipo: "precio_divisa", precio: 10}}
   - "cambia la fecha al 5 de febrero" → params: {action: "editar", edicion: {tipo: "fecha", fecha: "2026-02-05"}}
   - "era del 3 de febrero" → params: {action: "editar", edicion: {tipo: "fecha", fecha: "2026-02-03"}}
   - "quita el calamar" → params: {action: "editar", edicion: {tipo: "quitar", producto: "calamar"}}
   - "agrega 1kg de pulpo a $18" → params: {action: "editar", edicion: {tipo: "agregar", producto: "pulpo", cantidad: 1, unidad: "kg", precio: 18}}
   - "cambia la cantidad a 3kg" → params: {action: "editar", edicion: {tipo: "cantidad", producto: null, cantidad: 3}}
   - "ponle el nombre Carlos" → params: {action: "editar", edicion: {tipo: "cliente", nombre: "Carlos"}}
   - "ponle dirección Av. Principal 123" → params: {action: "editar", edicion: {tipo: "direccion", direccion: "Av. Principal 123"}}
   - "la dirección es Calle 5 con 6" → params: {action: "editar", edicion: {tipo: "direccion", direccion: "Calle 5 con 6"}}

   RESTAR CANTIDAD DE UN PRODUCTO (reducir sin eliminar):
   - "resta 1kg de langostino" → params: {action: "editar", edicion: {tipo: "restar", producto: "langostino", cantidad: 1}}
   - "quítale 2kg al calamar" → params: {action: "editar", edicion: {tipo: "restar", producto: "calamar", cantidad: 2}}
   - "restale medio kilo al pulpo" → params: {action: "editar", edicion: {tipo: "restar", producto: "pulpo", cantidad: 0.5}}
   - "el cliente no se llevó 1kg del langostino" → params: {action: "editar", edicion: {tipo: "restar", producto: "langostino", cantidad: 1}}
   - "baja 1kg al camaron" → params: {action: "editar", edicion: {tipo: "restar", producto: "camaron", cantidad: 1}}
   NOTA: "restar" reduce la cantidad existente. Si la cantidad restante es <= 0, elimina el producto.
   DIFERENCIA: "quita el calamar" = elimina todo el producto, "resta 1kg de calamar" = reduce la cantidad en 1kg

   SUSTITUIR PRODUCTO (cambiar un producto por otro):
   - "el calamar nacional era el grande" → params: {action: "editar", edicion: {tipo: "sustituir", productoOriginal: "calamar nacional", productoNuevo: "calamar nacional grande"}}
   - "era calamar grande, no nacional" → params: {action: "editar", edicion: {tipo: "sustituir", productoNuevo: "calamar grande"}}
   - "cambia el jumbo por langostino" → params: {action: "editar", edicion: {tipo: "sustituir", productoOriginal: "jumbo", productoNuevo: "langostino"}}
   - "el producto era pulpo, no calamar" → params: {action: "editar", edicion: {tipo: "sustituir", productoOriginal: "calamar", productoNuevo: "pulpo"}}
   - "era camarón desvenado, no entero" → params: {action: "editar", edicion: {tipo: "sustituir", productoOriginal: "camarón entero", productoNuevo: "camarón desvenado"}}
   NOTA: Usa "sustituir" cuando el usuario indica que un producto en el presupuesto debería ser otro diferente

   DELIVERY (cargo de envío - NO es un producto; monto SIEMPRE es número):
   - "agrega $5 de delivery" → params: {action: "editar", edicion: {tipo: "delivery", monto: 5}}
   - "súmale $5 de delivery" → params: {action: "editar", edicion: {tipo: "delivery", monto: 5}}
   - "suma $10 de delivery al presupuesto 56409" → params: {action: "editar", id: "56409", edicion: {tipo: "delivery", monto: 10}}
   - "suma $5 de delivery al presupuesto 25376" → params: {action: "editar", id: "25376", edicion: {tipo: "delivery", monto: 5}}
   - "agrega $5 de delivery al presupuesto 12345" → params: {action: "editar", id: "12345", edicion: {tipo: "delivery", monto: 5}}
   - "ponle delivery de $10" → params: {action: "editar", edicion: {tipo: "delivery", monto: 10}}
   - "quita el delivery" → params: {action: "editar", edicion: {tipo: "delivery", monto: 0}}
   - "sin delivery" → params: {action: "editar", edicion: {tipo: "delivery", monto: 0}}
   IMPORTANTE: Cuando el usuario menciona un número de presupuesto ("25376", "presupuesto 12345", "al 25376"), SIEMPRE incluir id en params.
   IMPORTANTE: "delivery" es un CARGO ESPECIAL, no un producto. Usar tipo: "delivery" cuando mencionan delivery/envío.

   MÚLTIPLES EDICIONES EN UN MENSAJE (MUY IMPORTANTE):
   Cuando el usuario pide VARIAS operaciones en un solo mensaje, "edicion" debe ser un ARRAY con TODAS las operaciones.
   NO pongas las operaciones adicionales en alternativeIntents - TODAS van en el array edicion.

   Ejemplos de múltiples ediciones:
   - "resta 1kg de tripa, agrega 1kg pepitona" → params: {action: "editar", edicion: [
       {tipo: "restar", producto: "tripa", cantidad: 1},
       {tipo: "agregar", producto: "pepitona", cantidad: 1, unidad: "kg"}
     ]}
   - "quita el pulpo y agrega 2kg langostino a $15" → params: {action: "editar", edicion: [
       {tipo: "quitar", producto: "pulpo"},
       {tipo: "agregar", producto: "langostino", cantidad: 2, unidad: "kg", precio: 15}
     ]}
   - "réstale 1kg de tripa de perla, súmale 1kg pepitona y 1kg más de mejillón pelado" → params: {action: "editar", edicion: [
       {tipo: "restar", producto: "tripa de perla", cantidad: 1},
       {tipo: "agregar", producto: "pepitona", cantidad: 1, unidad: "kg"},
       {tipo: "agregar", producto: "mejillón pelado", cantidad: 1, unidad: "kg"}
     ]}
   - "cambia el jumbo a $15 y ponle el nombre Juan" → params: {action: "editar", edicion: [
       {tipo: "precio", producto: "jumbo", precio: 15},
       {tipo: "cliente", nombre: "Juan"}
     ]}

   CRÍTICO: Si el usuario menciona varias acciones separadas por "y", comas, o puntos, TODAS deben ir en el array edicion.
   Una sola operación puede ser objeto simple: edicion: {...}
   Múltiples operaciones DEBEN ser array: edicion: [{...}, {...}, ...]

   EDITAR usa contexto para saber cuál presupuesto. Si especifica ID: "edita el 12345..."

   ASIGNAR PRESUPUESTO A CLIENTE (vincular a estado de cuenta):
   - "asígnaselo a su cuenta" → params: {action: "asignar_contexto"} (usa contexto para saber presupuesto y cliente)
   - "asígnalo a su estado de cuenta" → params: {action: "asignar_contexto"}
   - "vincúlalo a su cuenta" → params: {action: "asignar_contexto"}
   - "ponlo en su estado de cuenta" → params: {action: "asignar_contexto"}
   - "agrégalo a su cuenta" → params: {action: "asignar_contexto"}
   - "asigna 12345 a Delcy" → params: {action: "asignar", id: "12345", cliente: "Delcy"}
   - "vincula el presupuesto 12345 a Juan" → params: {action: "asignar", id: "12345", cliente: "Juan"}
   ASIGNAR usa contexto del presupuesto reciente y/o cliente mencionado. Si especifica ambos → usa esos

   MÉTODOS DE PAGO: pago_movil, transferencia, zelle, efectivo, tarjeta, usdt, binance
   - "presupuestos de Rodriguez" → params: {action: "buscar", cliente: "Rodriguez"}
   - "presupuestos pendientes de Friteria Chon" → params: {action: "buscar", cliente: "Friteria Chon"}
   - "pendientes de Delcy" → params: {action: "buscar", cliente: "Delcy"}
   - "presupuestos pendientes de Juan" → params: {action: "buscar", cliente: "Juan"}
   - "presupuestos del policia Rodriguez" → params: {action: "buscar", cliente: "policia Rodriguez"}
   - "presupuestos de la señora Maria" → params: {action: "buscar", cliente: "señora Maria"}
   BUSCAR PRESUPUESTOS: Cuando preguntan específicamente por "presupuestos" de un cliente.
   NOTA: "que debe X" va a customer_action (ver balance), "presupuestos de X" va aquí (buscar presupuestos)
   NOMBRES: Extrae el nombre COMPLETO incluyendo palabras como "Friteria", "Restaurante", "policia", etc.

4. config_action - Configuración del sitio
   - "tema navidad" / "tema normal" → params: {action: "tema", tema: "navidad"}
   - "como van las ventas" / "estadisticas" → params: {action: "stats"}
   - "cual es la tasa" / "tasa bcv" → params: {action: "tasa"}

5. product_action - Gestión de productos
   - "ver productos" / "lista de precios" → params: {action: "listar"}
   - "sube jumbo a $15" → params: {action: "precio", producto: "jumbo", precioBcv: 15}
   - "no hay pulpo" → params: {action: "disponibilidad", producto: "pulpo", disponible: false}

6. help - Ayuda
   - "ayuda" / "comandos" / "que puedes hacer" → params: {}

7. chat - Conversación general (cuando no encaja en nada)
   - Saludos, preguntas generales, etc. → params: {respuesta: "tu respuesta amigable"}

8. clarification_response - Respuesta a clarificación previa
   - Si el usuario responde "1", "2", "3", etc. y parece responder a una pregunta anterior
   - Si responde con palabras que claramente eligen una opción previamente ofrecida
   → params: {option: número de opción elegida (1, 2, 3...)}

NIVEL DE CONFIANZA (MUY IMPORTANTE):
Debes evaluar qué tan seguro estás de tu interpretación:
- 1.0 = Completamente seguro (mensaje claro y específico)
- 0.85-0.99 = Muy seguro (hay pequeña ambigüedad pero la interpretación es obvia)
- 0.7-0.84 = Moderadamente seguro (podría ser otra cosa pero es probable)
- 0.5-0.69 = Poco seguro (el mensaje es ambiguo, podría ser varias cosas)
- 0.0-0.49 = No tengo idea (necesito clarificación)

MENSAJES AMBIGUOS (baja confianza):
- "ponle 5 a delcy" → ¿agregar $5 de delivery? ¿anotar $5 de compra? ¿cambiar precio a $5?
- "borra eso" → ¿borrar presupuesto? ¿borrar cliente? ¿quitar producto?
- "cámbialo" → ¿cambiar qué exactamente?
- "el de Maria" → ¿presupuesto? ¿balance? ¿movimientos?

Si confidence < 0.8, incluye alternativeIntents con otras interpretaciones posibles.

RESPONDE SOLO JSON:
{
  "intent": "nombre_intencion",
  "params": { ... },
  "message": "mensaje corto para el usuario",
  "confidence": número de 0.0 a 1.0,
  "alternativeIntents": [
    {"intent": "otra_intencion", "description": "descripción amigable de esta opción", "params": {...}},
    ...
  ]
}

NOTAS:
- alternativeIntents solo se incluye si confidence < 0.8
- Cada alternativa debe tener una description clara en español para el usuario
- Si confidence >= 0.8, alternativeIntents puede omitirse o ser array vacío`;
}

/**
 * Prompt para customer-ai (reutilizado del original)
 */
export function buildCustomerAIPrompt(
  customerList: string,
  presupuestoList: string,
  todayISO: string,
  todayName: string
): string {
  return `Eres un asistente para un negocio de mariscos en Venezuela. Tu tarea es interpretar instrucciones rapidas del administrador para anotar transacciones de clientes.

FECHA ACTUAL: ${todayISO} (${todayName})

CLIENTES REGISTRADOS:
${customerList}

PRESUPUESTOS RECIENTES:
${presupuestoList}

REGLAS IMPORTANTES SOBRE TIPOS DE TRANSACCION:
1. DIVISAS (USD efectivo): Cuando el usuario dice "en divisas", "USD efectivo", "dolares cash", etc.
   - currencyType: "divisas"
   - amountUsd: el monto
   - amountUsdDivisa: null (SIEMPRE null para divisas simples)

2. BCV (pago en bolivares a tasa BCV): Es el valor por defecto, o cuando dice "a BCV", "en bolivares", etc.
   - currencyType: "dolar_bcv"
   - amountUsd: el monto
   - amountUsdDivisa: null (SIEMPRE null para BCV simple)

3. DUAL: SOLO cuando se asigna un presupuesto que ya es dual (tiene Total Divisa en la lista)
   - currencyType: "dolar_bcv"
   - amountUsd: Total BCV del presupuesto
   - amountUsdDivisa: Total Divisa del presupuesto (NO el mismo valor que amountUsd)

IMPORTANTE: amountUsdDivisa SOLO debe tener valor cuando se asigna un PRESUPUESTO DUAL de la lista.
Para transacciones manuales (sin presupuesto), amountUsdDivisa debe ser SIEMPRE null.

REGLAS DE INTERPRETACION:
- "anota/registra/apunta a [cliente] $X de [descripcion]" = purchase (compra)
- "abona/pago/paga [cliente] $X" = payment (abono)
- "cobra/cobro a [cliente] $X" = purchase (compra)
- Match nombres de clientes de forma fuzzy (ej: "deisy" = "Deisy", "jose" = "Jose Garcia")
- Si un cliente no existe en la lista, devolver customerId: null y el nombre tal como se escribio
- Extraer montos en dolares (ej: "$100", "100 dolares", "100$")
- Puede haber MULTIPLES acciones en un solo texto separadas por comas, puntos o lineas
- La descripcion debe ser concisa (ej: "Calamar", "Pedido", "Abono cuenta")

METODOS DE PAGO Y SU MONEDA (MUY IMPORTANTE):
- zelle, usdt, paypal, binance, cripto → currencyType: "divisas" (son pagos en USD)
- tarjeta, pago_movil, transferencia, debito → currencyType: "dolar_bcv" (son pagos en Bs)
- efectivo → depende del contexto:
  * "efectivo en divisas" / "USD efectivo" / "dolares cash" → divisas
  * "efectivo" solo, sin especificar → divisas (default en RPYM)
- Si el usuario dice explicitamente "en divisas" o "a BCV", usar eso independiente del metodo

FECHAS:
- Por defecto, date = null (significa hoy)
- Si el usuario menciona una fecha pasada, calcular la fecha exacta en formato YYYY-MM-DD
- Ejemplos:
  * "ayer" = fecha de ayer
  * "el lunes" / "el martes" = el ultimo dia de la semana mencionado (hacia atras)
  * "hace 2 dias" / "hace 3 dias" = restar esos dias a hoy
  * "el 15" / "el 20 de enero" = usar esa fecha del mes actual o anterior
  * "antier" / "anteayer" = hace 2 dias
- Si no se menciona fecha, usar date: null

PRESUPUESTOS:
- "anotale/registrale/cobrale el presupuesto XXXX a [cliente]" = purchase con presupuestoId
- Buscar en PRESUPUESTOS RECIENTES para obtener el monto
- Si el presupuesto tiene "(DUAL)", usar los DOS montos diferentes
- Si no es dual, usar SOLO amountUsd y amountUsdDivisa = null
- Si no encuentras el presupuesto en la lista, crear accion con amountUsd = 0 (se autollenara)

Responde SOLO con un JSON valido:
{
  "actions": [
    {
      "customerName": "nombre del cliente como aparece en la lista",
      "customerId": numero o null,
      "type": "purchase" | "payment",
      "amountUsd": numero,
      "amountUsdDivisa": numero o null,
      "description": "descripcion corta",
      "presupuestoId": "id" o null,
      "currencyType": "divisas" | "dolar_bcv" | "euro_bcv",
      "paymentMethod": "efectivo" | "pago_movil" | "transferencia" | "zelle" | "tarjeta" | null,
      "date": "YYYY-MM-DD" o null
    }
  ],
  "unmatchedCustomers": ["nombres que no se encontraron en la lista"]
}`;
}

export interface CustomerAction {
  customerName: string;
  customerId: number | null;
  type: 'purchase' | 'payment';
  amountUsd: number;
  amountUsdDivisa: number | null;
  description: string;
  presupuestoId: string | null;
  currencyType: 'divisas' | 'dolar_bcv' | 'euro_bcv';
  paymentMethod: string | null;
  date: string | null;
}

export interface CustomerAIResult {
  success: boolean;
  actions: CustomerAction[];
  unmatchedCustomers: string[];
  error?: string;
}

/**
 * Llama a Gemini para parsear acciones de cliente
 * Incluye retry silencioso para manejar errores temporales
 * (versión interna sin autenticación HTTP)
 */
export async function parseCustomerActions(
  text: string,
  customers: { id: number; name: string }[],
  presupuestos: { id: string; fecha: string; customerName: string; totalUSD: number; totalUSDDivisa: number | null }[],
  apiKey: string
): Promise<CustomerAIResult> {
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 1000;

  const customerList = customers.map(c => `- ID: ${c.id} | Nombre: "${c.name}"`).join('\n');
  const presupuestoList = presupuestos.length > 0
    ? presupuestos.map(p => `- ID: ${p.id} | Fecha: ${p.fecha} | Cliente: ${p.customerName || 'Sin nombre'} | Total BCV: $${p.totalUSD.toFixed(2)}${p.totalUSDDivisa ? ` | Total Divisa: $${p.totalUSDDivisa.toFixed(2)} (DUAL)` : ''}`).join('\n')
    : '(No hay presupuestos recientes)';

  const now = new Date();
  const todayISO = now.toISOString().split('T')[0];
  const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const todayName = dayNames[now.getDay()];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: buildCustomerAIPrompt(customerList, presupuestoList, todayISO, todayName) }] },
            contents: [{ role: 'user', parts: [{ text }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1024,
              responseMimeType: 'application/json',
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        const isRetryable = response.status === 503 || response.status === 429 ||
                           errorText.includes('high demand') || errorText.includes('overloaded');

        if (isRetryable && attempt < MAX_RETRIES) {
          console.log(`[TelegramAI] CustomerAI retry ${attempt + 1}/${MAX_RETRIES}...`);
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
          continue;
        }

        console.error('[TelegramAI] Gemini error:', errorText);
        return { success: false, actions: [], unmatchedCustomers: [], error: 'Error de API' };
      }

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          success: true,
          actions: parsed.actions || [],
          unmatchedCustomers: parsed.unmatchedCustomers || []
        };
      }

      return { success: false, actions: [], unmatchedCustomers: [], error: 'No se pudo parsear' };
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        console.log(`[TelegramAI] CustomerAI retry ${attempt + 1}/${MAX_RETRIES} after error...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
      console.error('[TelegramAI] Error:', error);
      return { success: false, actions: [], unmatchedCustomers: [], error: 'Error interno' };
    }
  }

  return { success: false, actions: [], unmatchedCustomers: [], error: 'Error interno' };
}

/**
 * Helper para esperar un tiempo
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Router de intenciones - detecta qué quiere hacer el usuario
 * Incluye retry silencioso para manejar errores temporales de Gemini
 * @param text - El mensaje del usuario
 * @param apiKey - API key de Gemini
 * @param historyContext - Contexto opcional con mensajes anteriores para memoria
 */
export async function detectIntent(
  text: string,
  apiKey: string,
  historyContext: string = ''
): Promise<RouterResult> {
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 1000;

  // Construir el prompt con contexto si está disponible
  const systemPrompt = buildRouterPrompt() + historyContext;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 512,
              responseMimeType: 'application/json',
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        const isRetryable = response.status === 503 || response.status === 429 ||
                           errorText.includes('high demand') || errorText.includes('overloaded');

        if (isRetryable && attempt < MAX_RETRIES) {
          console.log(`[TelegramAI] Retry ${attempt + 1}/${MAX_RETRIES} after ${response.status}...`);
          await sleep(RETRY_DELAY_MS * (attempt + 1)); // Backoff: 1s, 2s
          continue;
        }

        console.error('[TelegramAI] Router error:', response.status, errorText);
        return { intent: 'chat', params: { respuesta: 'No entendí. ¿Puedes reformular?' }, message: 'Error', confidence: 0.0, alternativeIntents: [] };
      }

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Ensure confidence has a default value
        return {
          intent: parsed.intent || 'chat',
          params: parsed.params || {},
          message: parsed.message || '',
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
          alternativeIntents: Array.isArray(parsed.alternativeIntents) ? parsed.alternativeIntents : []
        };
      }

      return { intent: 'chat', params: { respuesta: 'No entendí' }, message: '', confidence: 0.5, alternativeIntents: [] };
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        console.log(`[TelegramAI] Retry ${attempt + 1}/${MAX_RETRIES} after error...`);
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      console.error('[TelegramAI] Router error:', error);
      return { intent: 'chat', params: { respuesta: 'Error al procesar' }, message: '', confidence: 0.0, alternativeIntents: [] };
    }
  }

  return { intent: 'chat', params: { respuesta: 'Error al procesar' }, message: '', confidence: 0.0, alternativeIntents: [] };
}
