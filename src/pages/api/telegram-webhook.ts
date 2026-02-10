import type { APIRoute } from 'astro';
import { getProducts, getBCVRate } from '../../lib/sheets';
import { getD1 } from '../../lib/d1-types';
import { detectIntent, parseCustomerActions, type CustomerAction, type AlternativeIntent, type RouterResult } from '../../lib/telegram-ai';
import { getAdminPresupuestoUrl } from '../../lib/admin-token';

export const prerender = false;

/**
 * Normaliza texto removiendo acentos/tildes para búsqueda fuzzy
 * "Raúl" → "raul", "José" → "jose"
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// IDs de chat autorizados
const AUTHORIZED_CHAT_IDS = [
  863102137, // Carlos Julio
];

const ADMIN_NAMES: Record<number, string> = {
  863102137: 'Carlos',
};

// ═══════════════════════════════════════════════════════════════════
// SISTEMA DE CLARIFICACIÓN
// ═══════════════════════════════════════════════════════════════════

// Marcador para detectar mensajes de clarificación pendiente
const CLARIFICATION_MARKER = '🤔 *¿Qué quieres hacer?*';

// Emojis numerados para las opciones
const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

// Thresholds de confianza
const CONFIDENCE_THRESHOLD_EXECUTE = 0.7;  // Por debajo de esto, pedir clarificación
const CONFIDENCE_THRESHOLD_LOG = 0.85;     // Por debajo de esto, loggear como low confidence

/**
 * Construye un mensaje de clarificación amigable
 */
function buildClarificationMessage(
  originalText: string,
  primaryIntent: AlternativeIntent,
  alternatives: AlternativeIntent[]
): string {
  let message = CLARIFICATION_MARKER + '\n\n';
  message += `No estoy seguro qué quieres hacer con: "${originalText}"\n\n`;
  message += `Opciones:\n`;

  // Incluir el intent primario como primera opción
  const allOptions = [primaryIntent, ...alternatives].slice(0, 5); // Max 5 opciones

  for (let i = 0; i < allOptions.length; i++) {
    const opt = allOptions[i];
    message += `${NUMBER_EMOJIS[i]} ${opt.description}\n`;
  }

  message += `\n_Responde con el número o escribe más claro_`;
  return message;
}

/**
 * Detecta si hay una clarificación pendiente en el historial
 * y extrae las opciones si existe
 */
function getPendingClarification(chatHistory: ChatMessage[]): {
  hasPending: boolean;
  options: AlternativeIntent[];
  originalText: string;
} {
  // Buscar el último mensaje del bot que sea una clarificación
  const lastBotMessage = [...chatHistory].reverse().find(m =>
    m.role === 'assistant' && m.content.includes(CLARIFICATION_MARKER)
  );

  if (!lastBotMessage) {
    return { hasPending: false, options: [], originalText: '' };
  }

  // El último mensaje del usuario antes de la clarificación
  const lastUserBeforeClarification = chatHistory.find(m => m.role === 'user');
  const originalText = lastUserBeforeClarification?.content || '';

  // Extraer las opciones del mensaje de clarificación
  const options: AlternativeIntent[] = [];
  const lines = lastBotMessage.content.split('\n');

  for (const line of lines) {
    // Buscar líneas que empiecen con emoji numérico
    for (let i = 0; i < NUMBER_EMOJIS.length; i++) {
      if (line.includes(NUMBER_EMOJIS[i])) {
        const description = line.replace(NUMBER_EMOJIS[i], '').trim();
        options.push({
          intent: 'chat', // Se actualizará al parsear
          description,
          params: {}
        });
        break;
      }
    }
  }

  return { hasPending: true, options, originalText };
}

/**
 * Genera una descripción legible para una intención
 */
function getIntentDescription(intent: string, params: Record<string, any>): string {
  switch (intent) {
    case 'customer_action':
      if (params.action === 'ver') return `Ver balance de ${params.cliente || 'cliente'}`;
      if (params.action === 'movimientos') return `Ver movimientos de ${params.cliente || 'cliente'}`;
      if (params.action === 'crear') return `Crear cliente ${params.nombre || ''}`;
      if (params.action === 'listar') return 'Ver lista de clientes';
      if (params.rawText) return `Anotar transacción: ${params.rawText.substring(0, 30)}...`;
      return 'Acción de cliente';

    case 'customer_purchase_products':
      return `Anotar compra con productos a cliente`;

    case 'budget_create':
      return `Crear presupuesto${params.rawText ? `: ${params.rawText.substring(0, 30)}...` : ''}`;

    case 'budget_action':
      if (params.action === 'ver') return `Ver presupuesto #${params.id || '?'}`;
      if (params.action === 'eliminar') return `Eliminar presupuesto #${params.id || '?'}`;
      if (params.action === 'pagar') return `Marcar presupuesto #${params.id || '?'} como pagado`;
      if (params.action === 'whatsapp') return `Enviar presupuesto por WhatsApp`;
      if (params.action === 'editar') return `Editar presupuesto`;
      if (params.action === 'buscar') return `Buscar presupuestos de ${params.cliente || 'cliente'}`;
      return 'Acción sobre presupuesto';

    case 'config_action':
      if (params.action === 'tema') return `Cambiar tema a ${params.tema || '?'}`;
      if (params.action === 'stats') return 'Ver estadísticas';
      if (params.action === 'tasa') return 'Ver tasa BCV';
      return 'Configuración';

    case 'product_action':
      if (params.action === 'listar') return 'Ver lista de productos';
      if (params.action === 'precio') return `Cambiar precio de ${params.producto || 'producto'}`;
      return 'Acción de productos';

    case 'help':
      return 'Ver ayuda';

    case 'chat':
      return 'Conversación general';

    default:
      return 'Acción no especificada';
  }
}

/**
 * Verifica si el mensaje del usuario es una respuesta a clarificación (1, 2, 3...)
 */
function parseClarificationResponse(text: string): number | null {
  const trimmed = text.trim();

  // Verificar si es un número simple (1, 2, 3...)
  if (/^[1-5]$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  // Verificar si contiene emoji numérico
  for (let i = 0; i < NUMBER_EMOJIS.length; i++) {
    if (trimmed.includes(NUMBER_EMOJIS[i])) {
      return i + 1;
    }
  }

  // Verificar palabras que indican opción (primero, segundo, etc.)
  const wordMap: Record<string, number> = {
    'primero': 1, 'primera': 1, 'uno': 1,
    'segundo': 2, 'segunda': 2, 'dos': 2,
    'tercero': 3, 'tercera': 3, 'tres': 3,
    'cuarto': 4, 'cuarta': 4, 'cuatro': 4,
    'quinto': 5, 'quinta': 5, 'cinco': 5
  };

  const lower = trimmed.toLowerCase();
  for (const [word, num] of Object.entries(wordMap)) {
    if (lower === word || lower.startsWith(word + ' ')) {
      return num;
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════
// FUNCIONES DE HISTORIAL DE CHAT
// ═══════════════════════════════════════════════════════════════════

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function getChatHistory(db: any, chatId: number, limit: number = 6): Promise<ChatMessage[]> {
  if (!db) return [];
  try {
    // Obtener últimos N mensajes (3 intercambios = 6 mensajes)
    const rows = await db.prepare(`
      SELECT role, content FROM telegram_chat_history
      WHERE chat_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(chatId, limit).all();

    // Revertir para orden cronológico
    return (rows?.results || []).reverse().map((r: any) => ({
      role: r.role as 'user' | 'assistant',
      content: r.content
    }));
  } catch (error) {
    console.error('[Telegram] Error loading chat history:', error);
    return [];
  }
}

async function saveChatMessage(db: any, chatId: number, role: 'user' | 'assistant', content: string): Promise<void> {
  if (!db) return;
  try {
    await db.prepare(`
      INSERT INTO telegram_chat_history (chat_id, role, content)
      VALUES (?, ?, ?)
    `).bind(chatId, role, content).run();

    // Limpiar mensajes viejos (más de 1 hora) para este chat
    await db.prepare(`
      DELETE FROM telegram_chat_history
      WHERE chat_id = ? AND created_at < datetime('now', '-1 hour')
    `).bind(chatId).run();
  } catch (error) {
    console.error('[Telegram] Error saving chat message:', error);
  }
}

function formatHistoryForContext(history: ChatMessage[]): string {
  if (history.length === 0) return '';

  return '\n\nCONTEXTO - Mensajes recientes de esta conversación:\n' +
    history.map(m => `${m.role === 'user' ? 'Usuario' : 'Bot'}: ${m.content}`).join('\n') +
    '\n\nUSA ESTE CONTEXTO para entender referencias como "esos", "los 3", "el primero", etc.';
}

// ═══════════════════════════════════════════════════════════════════
// FUNCIONES DE TELEGRAM
// ═══════════════════════════════════════════════════════════════════

async function sendTelegramMessage(
  chatId: number,
  text: string,
  botToken: string,
  parseMode: 'Markdown' | 'HTML' = 'Markdown'
): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
    });
    return response.ok;
  } catch (error) {
    console.error('[Telegram] Error sending message:', error);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// FUNCIONES DE BASE DE DATOS
// ═══════════════════════════════════════════════════════════════════

/**
 * Busca un cliente por nombre con normalización de acentos
 * Primero intenta con LIKE normal, si falla busca con normalización
 */
async function findCustomerByName(db: any, searchName: string): Promise<{ id: number; name: string } | null> {
  if (!db) return null;

  // Primero intentar búsqueda normal con LIKE
  let customer = await db.prepare(`
    SELECT id, name FROM customers
    WHERE LOWER(name) LIKE ? AND is_active = 1
    ORDER BY CASE WHEN LOWER(name) = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(`%${searchName.toLowerCase()}%`, searchName.toLowerCase()).first();

  if (customer) return { id: customer.id, name: customer.name };

  // Si no encontró, buscar todos los clientes y comparar con normalización
  const allCustomers = await db.prepare(`SELECT id, name FROM customers WHERE is_active = 1`).all();
  const normalizedSearch = normalizeText(searchName);

  for (const c of allCustomers?.results || []) {
    const normalizedName = normalizeText(c.name);
    // Búsqueda parcial normalizada
    if (normalizedName.includes(normalizedSearch) || normalizedSearch.includes(normalizedName)) {
      return { id: c.id, name: c.name };
    }
  }

  return null;
}

async function getCustomersList(db: any): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const customers = await db.prepare(`
      SELECT c.id, c.name,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='divisas' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='divisas' THEN t.amount_usd ELSE 0 END), 0) AS balance_divisas,
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='dolar_bcv' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='dolar_bcv' THEN t.amount_usd ELSE 0 END), 0) AS balance_bcv
      FROM customers c
      LEFT JOIN customer_transactions t ON t.customer_id = c.id
      WHERE c.is_active = 1
      GROUP BY c.id ORDER BY c.name LIMIT 50
    `).all();
    if (!customers.results?.length) return '📋 No hay clientes registrados';
    let text = `👥 *Clientes RPYM*\n\n`;
    for (const c of customers.results) {
      const bal = [];
      if (c.balance_divisas !== 0) bal.push(`DIV: $${Number(c.balance_divisas).toFixed(2)}`);
      if (c.balance_bcv !== 0) bal.push(`BCV: $${Number(c.balance_bcv).toFixed(2)}`);
      text += `• ${c.name}${bal.length ? ` (${bal.join(', ')})` : ''}\n`;
    }
    return text;
  } catch (error) {
    console.error('[Telegram] Error en getCustomersList:', error);
    return '❌ Error al obtener clientes';
  }
}

async function getCustomerBalance(db: any, customerName: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    // Buscar cliente con normalización de acentos
    const foundCustomer = await findCustomerByName(db, customerName);
    if (!foundCustomer) return `❌ No encontré cliente "${customerName}"`;

    // Obtener balance y datos del cliente
    const customer = await db.prepare(`
      SELECT c.id, c.name, c.phone,
        -- Balance puro divisas (transacciones solo divisas, sin dual)
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='divisas' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='divisas' THEN t.amount_usd ELSE 0 END), 0) AS balance_divisas_puro,
        -- Balance puro BCV (transacciones BCV sin dual)
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='dolar_bcv' AND COALESCE(t.is_paid,0)=0 AND t.amount_usd_divisa IS NULL THEN t.amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='dolar_bcv' AND t.amount_usd_divisa IS NULL THEN t.amount_usd ELSE 0 END), 0) AS balance_bcv_puro,
        -- Balance dual BCV (parte BCV de transacciones duales)
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='dolar_bcv' AND COALESCE(t.is_paid,0)=0 AND t.amount_usd_divisa IS NOT NULL THEN t.amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='dolar_bcv' AND t.amount_usd_divisa IS NOT NULL THEN t.amount_usd ELSE 0 END), 0) AS balance_dual_bcv,
        -- Balance dual Divisas (parte Divisas de transacciones duales)
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='dolar_bcv' AND COALESCE(t.is_paid,0)=0 AND t.amount_usd_divisa IS NOT NULL THEN t.amount_usd_divisa ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='dolar_bcv' AND t.amount_usd_divisa IS NOT NULL THEN t.amount_usd_divisa ELSE 0 END), 0) AS balance_dual_divisa,
        -- Euro
        COALESCE(SUM(CASE WHEN t.type='purchase' AND t.currency_type='euro_bcv' AND COALESCE(t.is_paid,0)=0 THEN t.amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.type='payment' AND t.currency_type='euro_bcv' THEN t.amount_usd ELSE 0 END), 0) AS balance_euro
      FROM customers c
      LEFT JOIN customer_transactions t ON t.customer_id = c.id
      WHERE c.id = ?
      GROUP BY c.id
    `).bind(foundCustomer.id).first();

    const divisasPuro = Number(customer.balance_divisas_puro || 0);
    const bcvPuro = Number(customer.balance_bcv_puro || 0);
    const dualBcv = Number(customer.balance_dual_bcv || 0);
    const dualDivisa = Number(customer.balance_dual_divisa || 0);
    const euro = Number(customer.balance_euro || 0);

    let text = `👤 *${customer.name}*\n\n`;

    // Mostrar balance dual como alternativas (ó)
    if (dualBcv !== 0 || dualDivisa !== 0) {
      text += `💰 *Dual:* $${dualBcv.toFixed(2)} (BCV) ó $${dualDivisa.toFixed(2)} (Divisas)\n`;
    }
    // Balances puros (separados)
    if (divisasPuro !== 0) text += `💵 Divisas: $${divisasPuro.toFixed(2)}\n`;
    if (bcvPuro !== 0) text += `📊 BCV: $${bcvPuro.toFixed(2)}\n`;
    if (euro !== 0) text += `💶 Euro: €${euro.toFixed(2)}\n`;

    // Si no hay ningún balance
    if (dualBcv === 0 && dualDivisa === 0 && divisasPuro === 0 && bcvPuro === 0 && euro === 0) {
      text += `✅ Sin saldo pendiente\n`;
    }

    if (customer.phone) text += `📱 ${customer.phone}\n`;

    // Buscar presupuestos recientes del cliente (usar nombre exacto del cliente encontrado)
    const presupuestos = await db.prepare(`
      SELECT p.id, p.fecha, p.total_usd, p.total_usd_divisa, p.estado,
        (SELECT COUNT(*) FROM customer_transactions ct WHERE ct.presupuesto_id = p.id) as has_transaction
      FROM presupuestos p
      WHERE LOWER(p.customer_name) LIKE ?
      ORDER BY p.fecha DESC LIMIT 5
    `).bind(`%${foundCustomer.name.toLowerCase()}%`).all();

    if (presupuestos.results?.length > 0) {
      text += `\n📋 *Presupuestos recientes:*\n`;
      for (const p of presupuestos.results) {
        const fecha = new Date(p.fecha).toLocaleDateString('es-VE');
        const estado = p.estado === 'pagado' ? '✅' : '⏳';
        const dual = p.total_usd_divisa ? ` / $${Number(p.total_usd_divisa).toFixed(2)}` : '';
        text += `${estado} #${p.id} - $${Number(p.total_usd).toFixed(2)}${dual} (${fecha})\n`;
      }
      text += `\n💡 _"marca [ID] pagado" o "movimientos de ${customer.name}"_`;
    }

    return text;
  } catch (error) {
    console.error('[Telegram] Error en getCustomerBalance:', error);
    return '❌ Error al buscar cliente';
  }
}

async function getCustomerMovements(db: any, customerName: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    // Buscar cliente con normalización de acentos
    const customer = await findCustomerByName(db, customerName);

    if (!customer) return `❌ No encontré cliente "${customerName}"`;

    // Obtener transacciones del cliente (últimas 20)
    const transactions = await db.prepare(`
      SELECT t.*, p.modo_precio, p.total_usd_divisa as presupuesto_total_divisa
      FROM customer_transactions t
      LEFT JOIN presupuestos p ON t.presupuesto_id = p.id
      WHERE t.customer_id = ?
      ORDER BY t.date DESC
      LIMIT 20
    `).bind(customer.id).all();

    if (!transactions?.results?.length) {
      return `👤 *${customer.name}*\n\n📋 No hay movimientos registrados`;
    }

    // Calcular balance separando puros de duales
    const balances = await db.prepare(`
      SELECT
        -- Balance puro divisas
        COALESCE(SUM(CASE WHEN type='purchase' AND currency_type='divisas' AND COALESCE(is_paid,0)=0 THEN amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN type='payment' AND currency_type='divisas' THEN amount_usd ELSE 0 END), 0) AS balance_divisas_puro,
        -- Balance puro BCV (sin dual)
        COALESCE(SUM(CASE WHEN type='purchase' AND currency_type='dolar_bcv' AND COALESCE(is_paid,0)=0 AND amount_usd_divisa IS NULL THEN amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN type='payment' AND currency_type='dolar_bcv' AND amount_usd_divisa IS NULL THEN amount_usd ELSE 0 END), 0) AS balance_bcv_puro,
        -- Balance dual BCV
        COALESCE(SUM(CASE WHEN type='purchase' AND currency_type='dolar_bcv' AND COALESCE(is_paid,0)=0 AND amount_usd_divisa IS NOT NULL THEN amount_usd ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN type='payment' AND currency_type='dolar_bcv' AND amount_usd_divisa IS NOT NULL THEN amount_usd ELSE 0 END), 0) AS balance_dual_bcv,
        -- Balance dual Divisas
        COALESCE(SUM(CASE WHEN type='purchase' AND currency_type='dolar_bcv' AND COALESCE(is_paid,0)=0 AND amount_usd_divisa IS NOT NULL THEN amount_usd_divisa ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN type='payment' AND currency_type='dolar_bcv' AND amount_usd_divisa IS NOT NULL THEN amount_usd_divisa ELSE 0 END), 0) AS balance_dual_divisa
      FROM customer_transactions WHERE customer_id = ?
    `).bind(customer.id).first();

    const divisasPuro = Number(balances?.balance_divisas_puro || 0);
    const bcvPuro = Number(balances?.balance_bcv_puro || 0);
    const dualBcv = Number(balances?.balance_dual_bcv || 0);
    const dualDivisa = Number(balances?.balance_dual_divisa || 0);

    let text = `👤 *${customer.name}*\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;

    // Mostrar balances
    const hasBalance = divisasPuro !== 0 || bcvPuro !== 0 || dualBcv !== 0 || dualDivisa !== 0;
    if (hasBalance) {
      text += `📊 *Balance actual:*\n`;
      if (dualBcv !== 0 || dualDivisa !== 0) {
        text += `   💰 Dual: $${dualBcv.toFixed(2)} (BCV) ó $${dualDivisa.toFixed(2)} (DIV)\n`;
      }
      if (divisasPuro !== 0) text += `   💵 DIV: $${divisasPuro.toFixed(2)}\n`;
      if (bcvPuro !== 0) text += `   📊 BCV: $${bcvPuro.toFixed(2)}\n`;
      text += `\n`;
    }

    text += `📋 *Movimientos:*\n`;

    // Agrupar por fecha
    const byDate = new Map<string, any[]>();
    for (const t of transactions.results) {
      const dateStr = t.date ? t.date.split(' ')[0] : 'Sin fecha';
      if (!byDate.has(dateStr)) byDate.set(dateStr, []);
      byDate.get(dateStr)!.push(t);
    }

    for (const [dateStr, txs] of byDate) {
      // Formatear fecha bonita
      const date = new Date(dateStr);
      const fechaFormateada = date.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' });
      text += `\n📅 *${fechaFormateada}*\n`;

      for (const t of txs) {
        const isPurchase = t.type === 'purchase';
        const isPaid = t.is_paid === 1;
        const isDual = t.modo_precio === 'dual' && t.amount_usd_divisa;

        // Emoji según tipo y estado
        let emoji = isPurchase ? '🛒' : '💰';
        if (isPurchase && isPaid) emoji = '✅';

        // Descripción corta
        let desc = t.description || (isPurchase ? 'Compra' : 'Abono');
        if (desc.length > 30) desc = desc.substring(0, 27) + '...';

        // Mostrar monto según el modo de precio
        let montoStr = '';
        if (isDual) {
          // Dual: mostrar ambos precios claramente etiquetados
          montoStr = `💰 $${Number(t.amount_usd).toFixed(2)} (BCV) ó $${Number(t.amount_usd_divisa).toFixed(2)} (DIV)`;
        } else {
          // Normal: mostrar monto principal
          const currLabel = t.currency_type === 'divisas' ? 'DIV' : 'BCV';
          montoStr = `$${Number(t.amount_usd).toFixed(2)} (${currLabel})`;
        }

        // Estado de pago para compras
        let estadoStr = '';
        if (isPurchase) {
          if (isPaid) {
            estadoStr = t.payment_method ? ` - ${PAYMENT_METHOD_NAMES[t.payment_method] || t.payment_method}` : ' - Pagado';
          } else {
            estadoStr = ' - Pendiente';
          }
        }

        // Referencia a presupuesto si existe
        const presRef = t.presupuesto_id ? ` #${t.presupuesto_id}` : '';

        text += `${emoji} ${desc}${presRef}\n`;
        text += `   ${montoStr}${estadoStr}\n`;
      }
    }

    // Resumen final
    const totalCompras = transactions.results.filter((t: any) => t.type === 'purchase').length;
    const totalAbonos = transactions.results.filter((t: any) => t.type === 'payment').length;
    text += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📈 ${totalCompras} compra${totalCompras !== 1 ? 's' : ''}, ${totalAbonos} abono${totalAbonos !== 1 ? 's' : ''}`;

    return text;
  } catch (error) {
    console.error('[Telegram] Error en getCustomerMovements:', error);
    return '❌ Error al obtener movimientos';
  }
}

async function executeCustomerAction(db: any, action: CustomerAction): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';

  try {
    // Buscar cliente con normalización de acentos
    const customer = await findCustomerByName(db, action.customerName);

    if (!customer) {
      return `❌ No encontré cliente "${action.customerName}"`;
    }

    const bcvRate = await getBCVRate();
    const amountBs = action.amountUsd * bcvRate.rate;

    // Insertar transacción (los balances se calculan dinámicamente)
    await db.prepare(`
      INSERT INTO customer_transactions
      (customer_id, type, date, description, amount_usd, amount_bs, amount_usd_divisa, currency_type, presupuesto_id, exchange_rate, is_paid)
      VALUES (?, ?, datetime('now', '-4 hours'), ?, ?, ?, ?, ?, ?, ?, 0)
    `).bind(
      customer.id,
      action.type,
      action.description,
      action.amountUsd,
      amountBs,
      action.amountUsdDivisa || null,
      action.currencyType,
      action.presupuestoId || null,
      bcvRate.rate
    ).run();

    // Calcular nuevo balance después de insertar
    const balanceQuery = action.currencyType === 'divisas'
      ? `SELECT COALESCE(SUM(CASE WHEN type='purchase' AND COALESCE(is_paid,0)=0 THEN amount_usd ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN type='payment' THEN amount_usd ELSE 0 END), 0) AS balance FROM customer_transactions WHERE customer_id = ? AND currency_type = 'divisas'`
      : `SELECT COALESCE(SUM(CASE WHEN type='purchase' AND COALESCE(is_paid,0)=0 THEN amount_usd ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN type='payment' THEN amount_usd ELSE 0 END), 0) AS balance FROM customer_transactions WHERE customer_id = ? AND currency_type = 'dolar_bcv'`;

    const balanceResult = await db.prepare(balanceQuery).bind(customer.id).first();
    const newBalance = Number(balanceResult?.balance || 0);

    const emoji = action.type === 'purchase' ? '🛒' : '💰';
    const actionText = action.type === 'purchase' ? 'Compra' : 'Abono';
    const curr = action.currencyType === 'divisas' ? 'DIV' : 'BCV';

    let text = `${emoji} *${actionText} registrada*\n\n`;
    text += `👤 ${customer.name}\n`;
    text += `💵 $${action.amountUsd.toFixed(2)} (${curr})\n`;
    text += `📝 ${action.description}\n`;
    text += `\n💼 Nuevo balance ${curr}: $${newBalance.toFixed(2)}`;

    return text;
  } catch (error) {
    console.error('[Telegram] Error en executeCustomerAction:', error);
    return `❌ Error: ${error}`;
  }
}

async function createCustomer(db: any, name: string, phone?: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    // Verificar si ya existe con normalización de acentos
    const existing = await findCustomerByName(db, name);
    if (existing) return `⚠️ Ya existe cliente "${existing.name}"`;

    await db.prepare(`INSERT INTO customers (name, phone, is_active) VALUES (?, ?, 1)`).bind(name, phone || null).run();
    return `✅ *Cliente creado*\n\n👤 ${name}${phone ? `\n📱 ${phone}` : ''}`;
  } catch (error) {
    return `❌ Error al crear cliente: ${error}`;
  }
}

async function updateCustomerPhone(db: any, customerName: string, phone: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    // Buscar cliente con normalización de acentos
    const customer = await findCustomerByName(db, customerName);

    if (!customer) {
      return `❌ No encontré cliente "${customerName}"`;
    }

    await db.prepare(`UPDATE customers SET phone = ? WHERE id = ?`).bind(phone, customer.id).run();
    return `✅ *Teléfono actualizado*\n\n👤 ${customer.name}\n📱 ${phone}`;
  } catch (error) {
    return `❌ Error al actualizar teléfono: ${error}`;
  }
}

async function getProductsList(db: any): Promise<string> {
  const bcvRate = await getBCVRate();
  const products = await getProducts(bcvRate.rate, db);
  let text = `📋 *Productos RPYM*\n💱 Tasa: Bs. ${bcvRate.rate.toFixed(2)}\n\n`;
  const categorias = new Map<string, typeof products>();
  products.forEach(p => {
    const existing = categorias.get(p.categoria) || [];
    categorias.set(p.categoria, [...existing, p]);
  });
  categorias.forEach((prods, cat) => {
    text += `*${cat}*\n`;
    prods.forEach(p => {
      const status = p.disponible ? '✅' : '❌';
      if (p.precioUSDDivisa && p.precioUSDDivisa !== p.precioUSD) {
        text += `${status} ${p.nombre}: $${p.precioUSD.toFixed(2)}/${p.precioUSDDivisa.toFixed(2)}\n`;
      } else {
        text += `${status} ${p.nombre}: $${p.precioUSD.toFixed(2)}\n`;
      }
    });
    text += '\n';
  });
  return text;
}

async function updateProductPrice(db: any, productName: string, priceBcv: number, priceDivisa?: number): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const product = await db.prepare(`SELECT id, nombre, precio_usd FROM products WHERE LOWER(nombre) LIKE ? LIMIT 1`).bind(`%${productName.toLowerCase()}%`).first();
    if (!product) return `❌ No encontré producto "${productName}"`;
    if (priceDivisa !== undefined) {
      await db.prepare(`UPDATE products SET precio_usd = ?, precio_usd_divisa = ? WHERE id = ?`).bind(priceBcv, priceDivisa, product.id).run();
    } else {
      await db.prepare(`UPDATE products SET precio_usd = ? WHERE id = ?`).bind(priceBcv, product.id).run();
    }
    return `✅ *${product.nombre}* actualizado a $${priceBcv.toFixed(2)}${priceDivisa ? `/$${priceDivisa.toFixed(2)}` : ''}`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

async function updateProductAvailability(db: any, productName: string, available: boolean): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const product = await db.prepare(`SELECT id, nombre FROM products WHERE LOWER(nombre) LIKE ? LIMIT 1`).bind(`%${productName.toLowerCase()}%`).first();
    if (!product) return `❌ No encontré producto "${productName}"`;
    await db.prepare(`UPDATE products SET disponible = ? WHERE id = ?`).bind(available ? 1 : 0, product.id).run();
    return `${available ? '✅' : '❌'} *${product.nombre}* ${available ? 'DISPONIBLE' : 'NO DISPONIBLE'}`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

async function getStats(db: any): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const today = new Date().toISOString().split('T')[0];
    const todayStats = await db.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN estado = 'pagado' THEN 1 ELSE 0 END) as pagados,
             SUM(CASE WHEN estado = 'pagado' THEN total_usd ELSE 0 END) as vendido
      FROM presupuestos WHERE date(fecha) = ?
    `).bind(today).first();
    const bcvRate = await getBCVRate();
    let text = `📊 *Estadísticas Hoy*\n\n`;
    text += `• Presupuestos: ${todayStats?.total || 0}\n`;
    text += `• Pagados: ${todayStats?.pagados || 0}\n`;
    text += `• Vendido: $${(todayStats?.vendido || 0).toFixed(2)}\n`;
    text += `\n💱 Tasa: Bs. ${bcvRate.rate.toFixed(2)}`;
    return text;
  } catch (error) {
    return '❌ Error al obtener estadísticas';
  }
}

async function changeTheme(db: any, theme: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  const themeMap: Record<string, string> = {
    'normal': 'ocean', 'ocean': 'ocean', 'navidad': 'christmas', 'navideno': 'christmas',
    'navideño': 'christmas', 'christmas': 'christmas', 'carnaval': 'carnival', 'carnival': 'carnival',
    'sanvalentin': 'valentine', 'san valentin': 'valentine', 'valentine': 'valentine',
    'pascua': 'easter', 'easter': 'easter', 'mundial': 'mundial', 'halloween': 'halloween',
  };
  const themeLower = theme.toLowerCase().replace(/\s+/g, '');
  const mappedTheme = themeMap[themeLower];
  if (!mappedTheme) return `❌ Tema no válido. Opciones: normal, navidad, carnaval, sanvalentin, pascua, mundial, halloween`;
  try {
    await db.prepare("INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES ('theme', ?, datetime('now', '-4 hours'))").bind(mappedTheme).run();
    const emojis: Record<string, string> = { ocean: '🦐', christmas: '🎄', carnival: '🎭', valentine: '❤️', easter: '🐰', mundial: '⚽', halloween: '🎃' };
    const names: Record<string, string> = { ocean: 'NORMAL', christmas: 'NAVIDAD', carnival: 'CARNAVAL', valentine: 'SAN VALENTÍN', easter: 'PASCUA', mundial: 'MUNDIAL', halloween: 'HALLOWEEN' };
    return `${emojis[mappedTheme]} Tema cambiado a *${names[mappedTheme]}*`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

async function getBudget(db: any, budgetId: string, adminSecret: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT * FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;
    const items = JSON.parse(budget.items);
    const estado = budget.estado === 'pagado' ? '✅ PAGADO' : '⏳ PENDIENTE';
    let text = `📋 *Presupuesto #${budget.id}*\n${estado}\n`;
    if (budget.customer_name) text += `👤 ${budget.customer_name}\n`;
    text += `\n`;
    items.forEach((item: any) => text += `• ${item.nombre} x ${item.cantidad}: $${item.subtotalUSD.toFixed(2)}\n`);
    text += `\n*Total: $${budget.total_usd.toFixed(2)}*`;
    if (budget.total_usd_divisa) text += ` / DIV: $${budget.total_usd_divisa.toFixed(2)}`;
    const adminUrl = await getAdminPresupuestoUrl(budget.id, adminSecret, 'https://rpym.net');
    text += `\n🔗 ${adminUrl}`;
    return text;
  } catch (error) {
    return '❌ Error al obtener presupuesto';
  }
}

async function searchBudgetsByCustomer(db: any, customerName: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    // Buscar presupuestos pendientes que coincidan con el nombre (fuzzy match, case-insensitive)
    const searchTerm = customerName.toLowerCase();
    const budgets = await db.prepare(`
      SELECT id, fecha, customer_name, total_usd, total_usd_divisa, modo_precio
      FROM presupuestos
      WHERE estado = 'pendiente'
        AND LOWER(customer_name) LIKE ?
      ORDER BY fecha DESC
      LIMIT 10
    `).bind(`%${searchTerm}%`).all();

    if (!budgets?.results?.length) {
      return `📋 No encontré presupuestos pendientes para "*${customerName}*"`;
    }

    let text = `📋 *Presupuestos pendientes de "${customerName}"*\n\n`;
    let totalDeuda = 0;

    budgets.results.forEach((b: any) => {
      const fecha = b.fecha ? b.fecha.split(' ')[0] : 'Sin fecha';
      const isDual = b.modo_precio === 'dual' && b.total_usd_divisa;
      text += `• #${b.id} - ${fecha}\n`;
      text += `  💵 $${b.total_usd.toFixed(2)}${isDual ? ` / DIV: $${b.total_usd_divisa.toFixed(2)}` : ''}\n`;
      totalDeuda += b.total_usd;
    });

    text += `\n*Total pendiente: $${totalDeuda.toFixed(2)}* (${budgets.results.length} presupuesto${budgets.results.length > 1 ? 's' : ''})`;

    return text;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

async function deleteBudget(db: any, budgetId: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT id, customer_name, total_usd FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;
    await db.prepare(`DELETE FROM presupuestos WHERE id = ?`).bind(budgetId).run();
    return `🗑️ *Presupuesto #${budgetId} eliminado*\n${budget.customer_name ? `👤 ${budget.customer_name}\n` : ''}💵 $${budget.total_usd.toFixed(2)}`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

const PAYMENT_METHOD_NAMES: Record<string, string> = {
  pago_movil: 'Pago Móvil',
  transferencia: 'Transferencia',
  zelle: 'Zelle',
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  usdt: 'USDT',
  binance: 'Binance',
};

async function markBudgetPaid(db: any, budgetId: string, paymentMethod?: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT id, estado, customer_name, total_usd FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;
    if (budget.estado === 'pagado' && !paymentMethod) return `ℹ️ Presupuesto #${budgetId} ya está pagado`;

    // Marcar presupuesto como pagado (con método de pago si se especifica)
    if (paymentMethod) {
      await db.prepare(`UPDATE presupuestos SET estado = 'pagado', fecha_pago = datetime('now', '-4 hours'), payment_method = ? WHERE id = ?`).bind(paymentMethod, budgetId).run();
    } else {
      await db.prepare(`UPDATE presupuestos SET estado = 'pagado', fecha_pago = datetime('now', '-4 hours') WHERE id = ?`).bind(budgetId).run();
    }

    // También marcar la transacción asociada como pagada (si existe)
    const txResult = await db.prepare(`
      UPDATE customer_transactions
      SET is_paid = 1, paid_date = datetime('now', '-4 hours')${paymentMethod ? `, payment_method = '${paymentMethod}'` : ''}
      WHERE presupuesto_id = ?
    `).bind(budgetId).run();

    let response = `✅ *Presupuesto #${budgetId}* marcado como *PAGADO*`;
    if (paymentMethod) {
      response += ` (${PAYMENT_METHOD_NAMES[paymentMethod] || paymentMethod})`;
    }
    if (txResult?.meta?.changes > 0) {
      response += `\n💼 Transacción del cliente también marcada como pagada`;
    }
    if (budget.customer_name) {
      response += `\n👤 ${budget.customer_name}`;
    }
    return response;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

async function updatePaymentMethod(db: any, budgetId: string, paymentMethod: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT id, estado, customer_name FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;

    await db.prepare(`UPDATE presupuestos SET payment_method = ? WHERE id = ?`).bind(paymentMethod, budgetId).run();
    await db.prepare(`UPDATE customer_transactions SET payment_method = ? WHERE presupuesto_id = ?`).bind(paymentMethod, budgetId).run();

    return `✅ Método de pago de #${budgetId} actualizado a *${PAYMENT_METHOD_NAMES[paymentMethod] || paymentMethod}*`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

async function updateBudgetProperty(db: any, budgetId: string, change: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT id, customer_name, hide_rate FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;

    if (change === 'ocultar_bs') {
      await db.prepare(`UPDATE presupuestos SET hide_rate = 1 WHERE id = ?`).bind(budgetId).run();
      return `✅ Presupuesto #${budgetId} actualizado - *Bs ocultos*${budget.customer_name ? `\n👤 ${budget.customer_name}` : ''}`;
    } else if (change === 'mostrar_bs') {
      await db.prepare(`UPDATE presupuestos SET hide_rate = 0 WHERE id = ?`).bind(budgetId).run();
      return `✅ Presupuesto #${budgetId} actualizado - *Bs visibles*${budget.customer_name ? `\n👤 ${budget.customer_name}` : ''}`;
    }

    return `❓ Cambio no reconocido: ${change}`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

interface BudgetEdit {
  tipo: 'precio' | 'precio_divisa' | 'fecha' | 'quitar' | 'agregar' | 'cantidad' | 'cliente' | 'delivery' | 'sustituir' | 'restar';
  producto?: string;
  precio?: number;
  precioDivisa?: number;
  cantidad?: number;
  unidad?: string;
  fecha?: string;
  nombre?: string;
  monto?: number; // Para delivery
  productoOriginal?: string; // Para sustituir
  productoNuevo?: string; // Para sustituir
}

async function editBudget(db: any, budgetId: string, edicion: BudgetEdit): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`
      SELECT id, items, total_usd, total_bs, total_usd_divisa, customer_name, fecha, modo_precio, delivery
      FROM presupuestos WHERE id = ?
    `).bind(budgetId).first();

    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;

    let items = typeof budget.items === 'string' ? JSON.parse(budget.items) : budget.items;
    let mensaje = '';

    // Obtener tasa BCV actual para recalcular Bs
    const bcvRate = await getBCVRate();

    switch (edicion.tipo) {
      case 'precio': {
        // Cambiar precio de un producto específico
        const producto = edicion.producto?.toLowerCase();
        const itemIndex = items.findIndex((i: any) => i.nombre.toLowerCase().includes(producto || ''));
        if (itemIndex === -1) return `❌ No encontré "${edicion.producto}" en el presupuesto`;

        const item = items[itemIndex];
        const oldPrice = item.precioUSD;
        item.precioUSD = edicion.precio!;
        item.precioBs = edicion.precio! * bcvRate.rate;
        item.subtotalUSD = item.precioUSD * item.cantidad;
        item.subtotalBs = item.precioBs * item.cantidad;

        if (edicion.precioDivisa) {
          item.precioUSDDivisa = edicion.precioDivisa;
          item.subtotalUSDDivisa = edicion.precioDivisa * item.cantidad;
        } else if (item.precioUSDDivisa) {
          item.subtotalUSDDivisa = item.precioUSDDivisa * item.cantidad;
        }

        mensaje = `✏️ Precio de *${item.nombre}* cambiado: $${oldPrice.toFixed(2)} → $${edicion.precio!.toFixed(2)}`;
        break;
      }

      case 'precio_divisa': {
        // Cambiar precio divisa del primer/único producto
        if (items.length === 1) {
          const item = items[0];
          item.precioUSDDivisa = edicion.precio!;
          item.subtotalUSDDivisa = edicion.precio! * item.cantidad;
          mensaje = `✏️ Precio divisa de *${item.nombre}* cambiado a $${edicion.precio!.toFixed(2)}`;
        } else {
          return `❓ Hay varios productos. Especifica cuál: "el precio del [producto] era $X"`;
        }
        break;
      }

      case 'fecha': {
        await db.prepare(`UPDATE presupuestos SET fecha = ? WHERE id = ?`).bind(edicion.fecha + ' 12:00:00', budgetId).run();
        return `✅ Fecha de #${budgetId} cambiada a *${edicion.fecha}*`;
      }

      case 'quitar': {
        const producto = edicion.producto?.toLowerCase();
        const itemIndex = items.findIndex((i: any) => i.nombre.toLowerCase().includes(producto || ''));
        if (itemIndex === -1) return `❌ No encontré "${edicion.producto}" en el presupuesto`;

        const removed = items.splice(itemIndex, 1)[0];
        mensaje = `🗑️ *${removed.nombre}* eliminado del presupuesto`;
        break;
      }

      case 'agregar': {
        const modoPrecioRaw = budget.modo_precio || 'bcv';
        // Normalizar 'divisa' a 'divisas' para consistencia
        const modoPrecio = modoPrecioRaw === 'divisa' ? 'divisas' : modoPrecioRaw;
        const cantidadAgregar = edicion.cantidad || 1;
        const productoNombre = (edicion.producto || '').toLowerCase();

        // PRIMERO: Buscar si el producto ya existe en el presupuesto (para usar precio personalizado)
        const existingItemIndex = items.findIndex((i: any) =>
          i.nombre.toLowerCase().includes(productoNombre) ||
          productoNombre.includes(i.nombre.toLowerCase())
        );

        if (existingItemIndex !== -1 && !edicion.precio) {
          // El producto YA EXISTE en el presupuesto - aumentar cantidad con mismo precio
          const item = items[existingItemIndex];
          const oldQty = item.cantidad;
          item.cantidad += cantidadAgregar;
          item.subtotalUSD = item.precioUSD * item.cantidad;
          item.subtotalBs = item.precioBs * item.cantidad;
          if (item.precioUSDDivisa) {
            item.subtotalUSDDivisa = item.precioUSDDivisa * item.cantidad;
          }

          // Mensaje indicando que se sumó a existente
          if (modoPrecio === 'divisas') {
            mensaje = `➕ *${item.nombre}*: ${oldQty} + ${cantidadAgregar} = ${item.cantidad}${item.unidad} x $${item.precioUSD.toFixed(2)} (DIV)`;
          } else if (modoPrecio === 'dual') {
            mensaje = `➕ *${item.nombre}*: ${oldQty} + ${cantidadAgregar} = ${item.cantidad}${item.unidad} x $${item.precioUSD.toFixed(2)} / DIV: $${item.precioUSDDivisa.toFixed(2)}`;
          } else {
            mensaje = `➕ *${item.nombre}*: ${oldQty} + ${cantidadAgregar} = ${item.cantidad}${item.unidad} x $${item.precioUSD.toFixed(2)}`;
          }
          break;
        }

        // Producto NO existe o se especificó precio explícito - crear nuevo item
        let precioBCV = edicion.precio || 0;
        let precioDivisa = edicion.precioDivisa || edicion.precio || 0;
        let nombreProducto = edicion.producto || 'Producto';

        if (!edicion.precio) {
          const products = await getProducts(bcvRate.rate, db);
          const foundProduct = products.find(p =>
            p.nombre.toLowerCase().includes(productoNombre) ||
            productoNombre.includes(p.nombre.toLowerCase())
          );
          if (foundProduct) {
            precioBCV = foundProduct.precioUSD;
            precioDivisa = foundProduct.precioUSDDivisa || foundProduct.precioUSD;
            nombreProducto = foundProduct.nombre;
          }
        }

        // Determinar precio a usar según modo del presupuesto
        let precioParaItem: number;
        let subtotalParaItem: number;

        if (modoPrecio === 'divisas') {
          precioParaItem = precioDivisa;
          subtotalParaItem = precioDivisa * cantidadAgregar;
        } else {
          precioParaItem = precioBCV;
          subtotalParaItem = precioBCV * cantidadAgregar;
        }

        const newItem = {
          nombre: nombreProducto,
          cantidad: cantidadAgregar,
          unidad: edicion.unidad || 'kg',
          precioUSD: precioParaItem,
          precioBs: precioParaItem * bcvRate.rate,
          subtotalUSD: subtotalParaItem,
          subtotalBs: subtotalParaItem * bcvRate.rate,
          precioUSDDivisa: modoPrecio === 'dual' ? precioDivisa : precioParaItem,
          subtotalUSDDivisa: modoPrecio === 'dual' ? precioDivisa * cantidadAgregar : subtotalParaItem
        };
        items.push(newItem);

        // Mensaje según modo
        if (modoPrecio === 'divisas') {
          mensaje = `➕ *${newItem.nombre}* agregado: ${cantidadAgregar}${newItem.unidad} x $${precioDivisa.toFixed(2)} (DIV)`;
        } else if (modoPrecio === 'dual') {
          mensaje = `➕ *${newItem.nombre}* agregado: ${cantidadAgregar}${newItem.unidad} x $${precioBCV.toFixed(2)} / DIV: $${precioDivisa.toFixed(2)}`;
        } else {
          mensaje = `➕ *${newItem.nombre}* agregado: ${cantidadAgregar}${newItem.unidad} x $${precioBCV.toFixed(2)}`;
        }
        break;
      }

      case 'cantidad': {
        const producto = edicion.producto?.toLowerCase();
        let itemIndex = 0;
        if (producto) {
          itemIndex = items.findIndex((i: any) => i.nombre.toLowerCase().includes(producto));
          if (itemIndex === -1) return `❌ No encontré "${edicion.producto}"`;
        } else if (items.length > 1) {
          return `❓ Hay varios productos. Especifica cuál: "cambia la cantidad del [producto] a X"`;
        }

        const item = items[itemIndex];
        const oldQty = item.cantidad;
        item.cantidad = edicion.cantidad!;
        item.subtotalUSD = item.precioUSD * item.cantidad;
        item.subtotalBs = item.precioBs * item.cantidad;
        if (item.precioUSDDivisa) {
          item.subtotalUSDDivisa = item.precioUSDDivisa * item.cantidad;
        }

        mensaje = `✏️ Cantidad de *${item.nombre}* cambiada: ${oldQty} → ${edicion.cantidad}`;
        break;
      }

      case 'restar': {
        // Restar cantidad de un producto existente
        const productoRestar = edicion.producto?.toLowerCase();
        if (!productoRestar) return `❌ Especifica qué producto quieres restar`;

        const itemIdx = items.findIndex((i: any) =>
          i.nombre.toLowerCase().includes(productoRestar) ||
          productoRestar.includes(i.nombre.toLowerCase())
        );
        if (itemIdx === -1) return `❌ No encontré "${edicion.producto}" en el presupuesto`;

        const item = items[itemIdx];
        const cantidadRestar = edicion.cantidad || 1;
        const cantidadAnterior = item.cantidad;
        const nuevaCantidad = cantidadAnterior - cantidadRestar;

        if (nuevaCantidad <= 0) {
          // Si la cantidad es 0 o negativa, eliminar el producto
          items.splice(itemIdx, 1);
          mensaje = `🗑️ *${item.nombre}* eliminado (${cantidadAnterior} - ${cantidadRestar} = 0)`;
        } else {
          // Reducir la cantidad
          item.cantidad = nuevaCantidad;
          item.subtotalUSD = item.precioUSD * nuevaCantidad;
          item.subtotalBs = item.precioBs * nuevaCantidad;
          if (item.precioUSDDivisa) {
            item.subtotalUSDDivisa = item.precioUSDDivisa * nuevaCantidad;
          }
          mensaje = `➖ *${item.nombre}*: ${cantidadAnterior} - ${cantidadRestar} = ${nuevaCantidad}${item.unidad}`;
        }
        break;
      }

      case 'cliente': {
        await db.prepare(`UPDATE presupuestos SET customer_name = ? WHERE id = ?`).bind(edicion.nombre, budgetId).run();
        return `✅ Cliente de #${budgetId} cambiado a *${edicion.nombre}*`;
      }

      case 'delivery': {
        // Actualizar cargo de delivery (no es un producto, es un campo aparte)
        const nuevoDelivery = edicion.monto || 0;

        // Actualizar delivery en la base de datos
        await db.prepare(`UPDATE presupuestos SET delivery = ? WHERE id = ?`).bind(nuevoDelivery, budgetId).run();

        // Recalcular totales con el nuevo delivery
        const itemsTotal = items.reduce((sum: number, i: any) => sum + i.subtotalUSD, 0);
        const itemsTotalBs = items.reduce((sum: number, i: any) => sum + i.subtotalBs, 0);
        const itemsTotalDivisa = items.reduce((sum: number, i: any) => sum + (i.subtotalUSDDivisa || i.subtotalUSD), 0);

        const newTotalUSD = itemsTotal + nuevoDelivery;
        const newTotalBs = itemsTotalBs + (nuevoDelivery * bcvRate.rate);
        const newTotalDivisa = itemsTotalDivisa + nuevoDelivery;

        await db.prepare(`
          UPDATE presupuestos SET total_usd = ?, total_bs = ?, total_usd_divisa = ?
          WHERE id = ?
        `).bind(newTotalUSD, newTotalBs, budget.modo_precio !== 'bcv' ? newTotalDivisa : null, budgetId).run();

        // También actualizar la transacción si existe
        await db.prepare(`
          UPDATE customer_transactions SET amount_usd = ?, amount_bs = ?, amount_usd_divisa = ?
          WHERE presupuesto_id = ?
        `).bind(newTotalUSD, newTotalBs, budget.modo_precio === 'dual' ? newTotalDivisa : null, budgetId).run();

        if (nuevoDelivery > 0) {
          mensaje = `🚗 Delivery actualizado: $${nuevoDelivery.toFixed(2)}`;
        } else {
          mensaje = `🚗 Delivery eliminado`;
        }
        mensaje += `\n\n📋 *Presupuesto #${budgetId}*`;
        if (budget.customer_name) mensaje += `\n👤 ${budget.customer_name}`;
        mensaje += `\n💵 Total: $${newTotalUSD.toFixed(2)}`;
        if (budget.modo_precio !== 'bcv') mensaje += ` / DIV: $${newTotalDivisa.toFixed(2)}`;

        return mensaje;
      }

      case 'sustituir': {
        // Sustituir un producto por otro (cambiar variante o producto diferente)
        const productoOriginal = edicion.productoOriginal?.toLowerCase();
        const productoNuevo = edicion.productoNuevo || '';

        // Buscar el item a sustituir
        let itemIndex = -1;
        if (productoOriginal) {
          itemIndex = items.findIndex((i: any) => i.nombre.toLowerCase().includes(productoOriginal));
        } else if (items.length === 1) {
          // Si no especifica producto y solo hay uno, usar ese
          itemIndex = 0;
        }

        if (itemIndex === -1) {
          return `❌ No encontré "${edicion.productoOriginal || 'el producto'}" en el presupuesto`;
        }

        const item = items[itemIndex];
        const oldName = item.nombre;

        // Buscar el nuevo producto en la lista de productos para obtener su precio
        const products = await getProducts(bcvRate.rate, db);
        const newProduct = products.find(p =>
          p.nombre.toLowerCase().includes(productoNuevo.toLowerCase()) ||
          productoNuevo.toLowerCase().includes(p.nombre.toLowerCase())
        );

        if (newProduct) {
          // Determinar precio según modo del presupuesto
          const modoPrecioRaw = budget.modo_precio || 'bcv';
          const modoPrecio = modoPrecioRaw === 'divisa' ? 'divisas' : modoPrecioRaw;
          const precioBCV = newProduct.precioUSD;
          const precioDivisa = newProduct.precioUSDDivisa || newProduct.precioUSD;

          let precioParaItem: number;
          if (modoPrecio === 'divisas') {
            precioParaItem = precioDivisa;
          } else {
            precioParaItem = precioBCV;
          }

          // Actualizar con el nuevo producto y su precio
          item.nombre = newProduct.nombre;
          item.precioUSD = precioParaItem;
          item.precioBs = precioParaItem * bcvRate.rate;
          item.subtotalUSD = precioParaItem * item.cantidad;
          item.subtotalBs = precioParaItem * item.cantidad * bcvRate.rate;
          item.precioUSDDivisa = modoPrecio === 'dual' ? precioDivisa : precioParaItem;
          item.subtotalUSDDivisa = modoPrecio === 'dual' ? precioDivisa * item.cantidad : precioParaItem * item.cantidad;

          // Mensaje según modo
          if (modoPrecio === 'divisas') {
            mensaje = `🔄 *${oldName}* → *${newProduct.nombre}*\n💰 Precio: $${precioDivisa.toFixed(2)} (DIV)`;
          } else if (modoPrecio === 'dual') {
            mensaje = `🔄 *${oldName}* → *${newProduct.nombre}*\n💰 Precio: $${precioBCV.toFixed(2)} / DIV: $${precioDivisa.toFixed(2)}`;
          } else {
            mensaje = `🔄 *${oldName}* → *${newProduct.nombre}*\n💰 Precio: $${precioBCV.toFixed(2)}`;
          }
        } else {
          // Solo cambiar el nombre si no encontró el producto en la lista
          item.nombre = productoNuevo;
          mensaje = `🔄 *${oldName}* → *${productoNuevo}*\n⚠️ Producto no encontrado en lista, precio sin cambios`;
        }
        break;
      }
    }

    // Recalcular totales (incluyendo delivery si existe)
    const delivery = budget.delivery || 0;
    const itemsTotalUSD = items.reduce((sum: number, i: any) => sum + i.subtotalUSD, 0);
    const itemsTotalBs = items.reduce((sum: number, i: any) => sum + i.subtotalBs, 0);
    const itemsTotalDivisa = items.reduce((sum: number, i: any) => sum + (i.subtotalUSDDivisa || i.subtotalUSD), 0);

    const totalUSD = itemsTotalUSD + delivery;
    const totalBs = itemsTotalBs + (delivery * bcvRate.rate);
    const totalUSDDivisa = itemsTotalDivisa + delivery;

    // Guardar cambios
    await db.prepare(`
      UPDATE presupuestos SET items = ?, total_usd = ?, total_bs = ?, total_usd_divisa = ?
      WHERE id = ?
    `).bind(JSON.stringify(items), totalUSD, totalBs, budget.modo_precio !== 'bcv' ? totalUSDDivisa : null, budgetId).run();

    // También actualizar la transacción si existe
    await db.prepare(`
      UPDATE customer_transactions SET amount_usd = ?, amount_bs = ?, amount_usd_divisa = ?
      WHERE presupuesto_id = ?
    `).bind(totalUSD, totalBs, budget.modo_precio === 'dual' ? totalUSDDivisa : null, budgetId).run();

    mensaje += `\n\n📋 *Presupuesto #${budgetId}*`;
    if (budget.customer_name) mensaje += `\n👤 ${budget.customer_name}`;
    // Mostrar total según el modo de precio (normalizar 'divisa' a 'divisas')
    const modoPrecioFinal = budget.modo_precio === 'divisa' ? 'divisas' : budget.modo_precio;
    if (modoPrecioFinal === 'divisas') {
      mensaje += `\n💵 Total: $${totalUSDDivisa.toFixed(2)} (DIV)`;
    } else if (modoPrecioFinal === 'dual') {
      mensaje += `\n💵 Total: $${totalUSD.toFixed(2)} / DIV: $${totalUSDDivisa.toFixed(2)}`;
    } else {
      mensaje += `\n💵 Total: $${totalUSD.toFixed(2)}`;
    }
    if (delivery > 0) mensaje += `\n🚗 (incl. delivery $${delivery.toFixed(2)})`;

    return mensaje;
  } catch (error) {
    console.error('[Telegram] Error editando presupuesto:', error);
    return `❌ Error: ${error}`;
  }
}

async function sendBudgetWhatsApp(db: any, budgetId: string, phone: string, baseUrl: string): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const budget = await db.prepare(`SELECT * FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return `❌ No encontré presupuesto #${budgetId}`;
    const items = JSON.parse(budget.items);
    const digits = phone.replace(/\D/g, '');
    let formattedPhone: string;
    if (digits.startsWith('58') && digits.length === 12) formattedPhone = digits;
    else if (digits.startsWith('0') && digits.length === 11) formattedPhone = '58' + digits.substring(1);
    else if (digits.length === 10 && digits.startsWith('4')) formattedPhone = '58' + digits;
    else return `❌ Teléfono inválido: ${phone}`;

    // Normalizar modo_precio (divisa/divisas -> divisa)
    const modoPrecio = budget.modo_precio === 'divisas' ? 'divisa' : (budget.modo_precio || 'bcv');
    const shouldIncludeBs = modoPrecio === 'bcv' || modoPrecio === 'dual';

    // Obtener tasa BCV actual para cálculo dinámico (solo si es necesario)
    const bcvRate = await getBCVRate();
    const dynamicTotalBs = shouldIncludeBs ? budget.total_usd * bcvRate.rate : 0;

    const response = await fetch(`${baseUrl}/api/send-whatsapp-factura`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: formattedPhone,
        facturaId: budget.id,
        customerName: budget.customer_name || 'Cliente',
        items: items.map((item: any) => ({
          producto: item.nombre,
          cantidad: item.cantidad,
          unidad: item.unidad,
          precioUnit: item.precioUSD,
          subtotal: item.subtotalUSD,
          precioUnitDivisa: item.precioUSDDivisa,
          subtotalDivisa: item.subtotalUSDDivisa
        })),
        total: budget.total_usd,
        totalBs: dynamicTotalBs,
        totalUSDDivisa: budget.total_usd_divisa,
        date: new Date(budget.fecha).toLocaleDateString('es-VE'),
        isPaid: budget.estado === 'pagado',
        delivery: budget.delivery || 0,
        modoPrecio: modoPrecio
      }),
    });
    const result = await response.json();
    if (!result.success) return `❌ Error: ${result.error}`;
    return `✅ *PDF de presupuesto #${budgetId} enviado*\n📱 ${phone}`;
  } catch (error) {
    return `❌ Error: ${error}`;
  }
}

/**
 * Vincula un presupuesto existente a la cuenta de un cliente
 * Crea la transacción correspondiente
 */
async function linkBudgetToCustomer(db: any, budgetId: string, customerNameOrId: string | number): Promise<{ success: boolean; message: string; customerId?: number }> {
  if (!db) return { success: false, message: '❌ No hay conexión a la base de datos' };

  try {
    // Obtener presupuesto
    const budget = await db.prepare(`SELECT * FROM presupuestos WHERE id = ?`).bind(budgetId).first();
    if (!budget) return { success: false, message: `❌ No encontré presupuesto #${budgetId}` };

    // Verificar si ya tiene transacción vinculada
    const existingTx = await db.prepare(`SELECT id FROM customer_transactions WHERE presupuesto_id = ?`).bind(budgetId).first();
    if (existingTx) return { success: false, message: `⚠️ Presupuesto #${budgetId} ya está asignado a una cuenta` };

    // Buscar cliente (con normalización de acentos para búsqueda por nombre)
    let customer: any;
    if (typeof customerNameOrId === 'number') {
      customer = await db.prepare(`SELECT id, name FROM customers WHERE id = ? AND is_active = 1`).bind(customerNameOrId).first();
    } else {
      customer = await findCustomerByName(db, customerNameOrId);
    }

    if (!customer) return { success: false, message: `❌ No encontré cliente "${customerNameOrId}"` };

    // Crear transacción
    const items = JSON.parse(budget.items || '[]');
    const description = items.map((i: any) => `${i.nombre} ${i.cantidad}${i.unidad || 'kg'}`).join(', ') || `Presupuesto #${budgetId}`;
    const currencyType = (budget.modo_precio === 'divisas' || budget.modo_precio === 'divisa') ? 'divisas' : 'dolar_bcv';
    const bcvRate = await getBCVRate();

    await db.prepare(`
      INSERT INTO customer_transactions
      (customer_id, type, date, description, amount_usd, amount_bs, amount_usd_divisa, currency_type, presupuesto_id, exchange_rate, is_paid)
      VALUES (?, 'purchase', datetime(?, 'localtime'), ?, ?, ?, ?, ?, ?, ?, 0)
    `).bind(
      customer.id,
      budget.fecha,
      description,
      budget.total_usd,
      budget.total_bs,
      budget.modo_precio === 'dual' ? budget.total_usd_divisa : null,
      currencyType,
      budgetId,
      bcvRate.rate,
    ).run();

    // Actualizar nombre del cliente en presupuesto si no tiene
    if (!budget.customer_name) {
      await db.prepare(`UPDATE presupuestos SET customer_name = ? WHERE id = ?`).bind(customer.name, budgetId).run();
    }

    return {
      success: true,
      message: `✅ Presupuesto #${budgetId} asignado a *${customer.name}*`,
      customerId: customer.id
    };
  } catch (error) {
    console.error('[Telegram] Error linking budget to customer:', error);
    return { success: false, message: `❌ Error: ${error}` };
  }
}

async function createBudgetFromText(db: any, text: string, mode: string, baseUrl: string, apiKey: string, adminSecret: string, hideRate: boolean = false): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';
  try {
    const bcvRate = await getBCVRate();
    const products = await getProducts(bcvRate.rate, db);
    const productList = products.map(p => ({
      id: String(p.id), nombre: p.nombre, unidad: p.unidad, precioUSD: p.precioUSD, precioUSDDivisa: p.precioUSDDivisa
    }));

    // Llamar a parse-order
    const response = await fetch(`${baseUrl}/api/parse-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, products: productList }),
    });
    const result = await response.json();

    if (!result.success || !result.items?.length) {
      return `❌ No pude interpretar el pedido. ${result.error || 'Intenta reformularlo.'}`;
    }

    // Crear presupuesto
    const presupuestoItems: any[] = [];
    let totalUSD = 0, totalBs = 0, totalUSDDivisa = 0;
    const pricingMode = result.pricingMode || mode || 'bcv';

    for (const item of result.items) {
      // Producto del catálogo
      if (item.matched && item.productId) {
        const product = products.find(p => String(p.id) === item.productId);
        if (!product) continue;

        const precioBCV = item.customPrice ?? product.precioUSD;
        const precioDivisa = item.customPriceDivisa ?? product.precioUSDDivisa ?? precioBCV;

        // En modo divisas, usar precio divisa como principal (consistente con editBudget)
        const precioMain = pricingMode === 'divisas' ? precioDivisa : precioBCV;
        const subtotalMain = precioMain * item.quantity;
        const subtotalDivisa = precioDivisa * item.quantity;

        presupuestoItems.push({
          nombre: product.nombre, cantidad: item.quantity, unidad: item.unit || product.unidad,
          precioUSD: precioMain, precioBs: precioMain * bcvRate.rate,
          subtotalUSD: subtotalMain, subtotalBs: subtotalMain * bcvRate.rate,
          precioUSDDivisa: pricingMode === 'dual' ? precioDivisa : precioMain,
          subtotalUSDDivisa: pricingMode === 'dual' ? subtotalDivisa : subtotalMain
        });

        totalUSD += subtotalMain;
        totalBs += subtotalMain * bcvRate.rate;
        totalUSDDivisa += subtotalDivisa;
      }
      // Producto personalizado (no en catálogo pero con precio)
      else if (!item.matched && item.suggestedName && item.customPrice) {
        const precioBCV = item.customPrice;
        const precioDivisa = item.customPriceDivisa ?? precioBCV;

        // En modo divisas, usar precio divisa como principal
        const precioMain = pricingMode === 'divisas' ? precioDivisa : precioBCV;
        const subtotalMain = precioMain * item.quantity;
        const subtotalDivisa = precioDivisa * item.quantity;

        presupuestoItems.push({
          nombre: item.suggestedName, cantidad: item.quantity, unidad: item.unit || 'kg',
          precioUSD: precioMain, precioBs: precioMain * bcvRate.rate,
          subtotalUSD: subtotalMain, subtotalBs: subtotalMain * bcvRate.rate,
          precioUSDDivisa: pricingMode === 'dual' ? precioDivisa : precioMain,
          subtotalUSDDivisa: pricingMode === 'dual' ? subtotalDivisa : subtotalMain
        });

        totalUSD += subtotalMain;
        totalBs += subtotalMain * bcvRate.rate;
        totalUSDDivisa += subtotalDivisa;
      }
    }

    if (presupuestoItems.length === 0) {
      return `❌ No encontré productos válidos en el pedido`;
    }

    if (result.delivery && result.delivery > 0) {
      totalUSD += result.delivery;
      totalUSDDivisa += result.delivery;
      totalBs += result.delivery * bcvRate.rate;
    }

    const id = String(Math.floor(10000 + Math.random() * 90000));
    // Usar fecha parseada o fecha actual
    const fechaPresupuesto = result.date ? `${result.date} 12:00:00` : null;
    const fechaSql = fechaPresupuesto ? `'${fechaPresupuesto}'` : `datetime('now', '-4 hours')`;

    await db.prepare(`
      INSERT INTO presupuestos (id, fecha, items, total_usd, total_bs, total_usd_divisa, modo_precio, delivery, hide_rate, estado, source, customer_name)
      VALUES (?, ${fechaSql}, ?, ?, ?, ?, ?, ?, ?, 'pendiente', 'telegram', ?)
    `).bind(
      id, JSON.stringify(presupuestoItems), totalUSD, totalBs,
      pricingMode !== 'bcv' ? totalUSDDivisa : null,
      pricingMode,
      result.delivery || 0,
      (hideRate || pricingMode === 'divisas') ? 1 : 0,
      result.customerName || null
    ).run();

    // En modo divisas, siempre ocultamos Bs (no tiene sentido mostrar tasa BCV)
    const shouldHideBs = hideRate || pricingMode === 'divisas';

    let responseText = `✅ *Presupuesto #${id}*\n`;
    if (result.customerName) responseText += `👤 ${result.customerName}\n`;
    if (result.date) responseText += `📅 Fecha: ${result.date}\n`;
    responseText += `📊 Modo: ${pricingMode.toUpperCase()}${shouldHideBs ? ' (sin Bs)' : ''}\n`;
    presupuestoItems.forEach(item => {
      responseText += `• ${item.nombre} x ${item.cantidad}: $${item.subtotalUSD.toFixed(2)}\n`;
    });
    if (result.delivery > 0) responseText += `• 🚗 Delivery: $${result.delivery.toFixed(2)}\n`;
    responseText += `\n*Total: $${totalUSD.toFixed(2)}*`;
    if (pricingMode === 'dual') responseText += ` / DIV: $${totalUSDDivisa.toFixed(2)}`;
    const adminUrl = await getAdminPresupuestoUrl(id, adminSecret, 'https://rpym.net');
    responseText += `\n🔗 ${adminUrl}`;

    // Auto-vincular a cliente si existe
    if (result.customerName) {
      const linkResult = await linkBudgetToCustomer(db, id, result.customerName);
      if (linkResult.success) {
        responseText += `\n\n📋 Vinculado a cuenta de *${result.customerName}*`;
      }
      // Si no se vincula, no es error crítico - el presupuesto existe
    }

    return responseText;
  } catch (error) {
    console.error('[Telegram] Error creando presupuesto:', error);
    return `❌ Error: ${error}`;
  }
}

/**
 * Crear compra con productos para un cliente
 * Combina: parse productos → crear presupuesto → crear transacción
 * Usa parse-order directamente (sin autenticación requerida)
 */
async function createCustomerPurchaseWithProducts(
  db: any,
  text: string,
  mode: string,
  baseUrl: string,
  apiKey: string,
  adminSecret: string,
  hideRate: boolean = false
): Promise<string> {
  if (!db) return '❌ No hay conexión a la base de datos';

  try {
    const bcvRate = await getBCVRate();
    const products = await getProducts(bcvRate.rate, db);
    const pricingMode = mode || 'bcv';

    // Llamar a parse-order (igual que budget_create)
    const response = await fetch(`${baseUrl}/api/parse-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        products: products.map(p => ({
          id: String(p.id),
          nombre: p.nombre,
          unidad: p.unidad,
          precioUSD: p.precioUSD,
          precioUSDDivisa: p.precioUSDDivisa
        }))
      }),
    });

    const result = await response.json();
    console.log('[Telegram] parse-order result:', JSON.stringify(result).substring(0, 500));

    if (!result.success || !result.items?.length) {
      return `❌ ${result.error || 'No pude interpretar el pedido'}`;
    }

    // Buscar el cliente con normalización de acentos
    let customer = null;
    if (result.customerName) {
      customer = await findCustomerByName(db, result.customerName);
    }

    if (!customer) {
      return `❌ No encontré cliente "${result.customerName || 'sin nombre'}". Créalo primero o especifica el nombre.`;
    }

    // Construir items del presupuesto
    const presupuestoItems: any[] = [];
    let totalUSD = 0, totalBs = 0, totalUSDDivisa = 0;

    for (const item of result.items) {
      // Producto del catálogo
      if (item.matched && item.productId) {
        const product = products.find(p => String(p.id) === item.productId);
        if (!product) continue;

        const precioUSD = item.customPrice ?? product.precioUSD;
        const precioUSDDivisa = item.customPriceDivisa ?? product.precioUSDDivisa ?? precioUSD;

        // En modo divisas, usar precio divisa como principal
        const precioMain = pricingMode === 'divisas' ? precioUSDDivisa : precioUSD;
        const subtotalMain = precioMain * item.quantity;
        const subtotalUSDDivisa = precioUSDDivisa * item.quantity;

        presupuestoItems.push({
          nombre: product.nombre,
          cantidad: item.quantity,
          unidad: item.unit || product.unidad,
          precioUSD: precioMain,
          precioBs: precioMain * bcvRate.rate,
          subtotalUSD: subtotalMain,
          subtotalBs: subtotalMain * bcvRate.rate,
          precioUSDDivisa,
          subtotalUSDDivisa
        });

        totalUSD += subtotalMain;
        totalBs += subtotalMain * bcvRate.rate;
        totalUSDDivisa += subtotalUSDDivisa;
      }
      // Producto personalizado (no en catálogo pero con precio)
      else if (!item.matched && item.suggestedName && item.customPrice) {
        const precioUSD = item.customPrice;
        const precioUSDDivisa = item.customPriceDivisa ?? precioUSD;
        const precioMain = pricingMode === 'divisas' ? precioUSDDivisa : precioUSD;
        const subtotalMain = precioMain * item.quantity;
        const subtotalUSDDivisa = precioUSDDivisa * item.quantity;

        presupuestoItems.push({
          nombre: item.suggestedName,
          cantidad: item.quantity,
          unidad: item.unit || 'kg',
          precioUSD: precioMain,
          precioBs: precioMain * bcvRate.rate,
          subtotalUSD: subtotalMain,
          subtotalBs: subtotalMain * bcvRate.rate,
          precioUSDDivisa,
          subtotalUSDDivisa
        });

        totalUSD += subtotalMain;
        totalBs += subtotalMain * bcvRate.rate;
        totalUSDDivisa += subtotalUSDDivisa;
      }
    }

    if (presupuestoItems.length === 0) {
      return `❌ No encontré productos válidos en el pedido`;
    }

    // Crear descripción
    const description = presupuestoItems.map(i => `${i.nombre} ${i.cantidad}${i.unidad}`).join(', ');

    // Crear presupuesto
    const presupuestoId = String(Math.floor(10000 + Math.random() * 90000));
    // Usar fecha parseada o fecha actual (hora Caracas = UTC-4)
    const fechaPresupuesto = result.date ? `${result.date} 12:00:00` : null;
    const fechaSql = fechaPresupuesto ? `'${fechaPresupuesto}'` : `datetime('now', '-4 hours')`;

    await db.prepare(`
      INSERT INTO presupuestos (id, fecha, items, total_usd, total_bs, total_usd_divisa, modo_precio, delivery, hide_rate, estado, source, customer_name)
      VALUES (?, ${fechaSql}, ?, ?, ?, ?, ?, ?, ?, 'pendiente', 'telegram', ?)
    `).bind(
      presupuestoId,
      JSON.stringify(presupuestoItems),
      totalUSD,
      totalBs,
      pricingMode !== 'bcv' ? totalUSDDivisa : null,
      pricingMode,
      result.delivery || 0,
      (hideRate || pricingMode === 'divisas') ? 1 : 0,
      customer.name
    ).run();

    // Crear transacción del cliente
    const currencyType = pricingMode === 'divisas' ? 'divisas' : 'dolar_bcv';

    await db.prepare(`
      INSERT INTO customer_transactions
      (customer_id, type, date, description, amount_usd, amount_bs, amount_usd_divisa, currency_type, presupuesto_id, exchange_rate, is_paid)
      VALUES (?, 'purchase', ${fechaSql}, ?, ?, ?, ?, ?, ?, ?, 0)
    `).bind(
      customer.id,
      description,
      totalUSD,
      totalBs,
      pricingMode === 'dual' ? totalUSDDivisa : null,
      currencyType,
      presupuestoId,
      bcvRate.rate
    ).run();

    // Calcular nuevo balance
    const balanceQuery = currencyType === 'divisas'
      ? `SELECT COALESCE(SUM(CASE WHEN type='purchase' AND COALESCE(is_paid,0)=0 THEN amount_usd ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN type='payment' THEN amount_usd ELSE 0 END), 0) AS balance FROM customer_transactions WHERE customer_id = ? AND currency_type = 'divisas'`
      : `SELECT COALESCE(SUM(CASE WHEN type='purchase' AND COALESCE(is_paid,0)=0 THEN amount_usd ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN type='payment' THEN amount_usd ELSE 0 END), 0) AS balance FROM customer_transactions WHERE customer_id = ? AND currency_type = 'dolar_bcv'`;
    const balanceResult = await db.prepare(balanceQuery).bind(customer.id).first();
    const newBalance = Number(balanceResult?.balance || 0);

    // Construir respuesta
    const curr = currencyType === 'divisas' ? 'DIV' : 'BCV';
    let responseText = `🛒 *Compra registrada*\n\n`;
    responseText += `👤 ${customer.name}\n`;
    if (result.date) {
      responseText += `📅 Fecha: ${result.date}\n`;
    }
    responseText += `📋 Presupuesto #${presupuestoId}\n\n`;

    presupuestoItems.forEach((item: any) => {
      responseText += `• ${item.nombre} x ${item.cantidad}: $${item.subtotalUSD.toFixed(2)}`;
      if (pricingMode === 'dual') {
        responseText += ` / $${item.subtotalUSDDivisa.toFixed(2)}`;
      }
      responseText += '\n';
    });

    responseText += `\n💵 *Total: $${totalUSD.toFixed(2)}* (${curr})`;
    if (pricingMode === 'dual') {
      responseText += ` / DIV: $${totalUSDDivisa.toFixed(2)}`;
    }
    responseText += `\n💼 Balance ${curr}: $${newBalance.toFixed(2)}`;
    const adminUrl = await getAdminPresupuestoUrl(presupuestoId, adminSecret, 'https://rpym.net');
    responseText += `\n\n🔗 ${adminUrl}`;

    return responseText;
  } catch (error) {
    console.error('[Telegram] Error en createCustomerPurchaseWithProducts:', error);
    return `❌ Error: ${error}`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════════════

export const POST: APIRoute = async ({ request, locals, url }) => {
  try {
    const body = await request.json();
    const message = body.message;
    if (!message?.text) return new Response('OK', { status: 200 });

    const chatId = message.chat.id;
    const text = message.text.trim();
    const runtime = (locals as any).runtime;
    const botToken = runtime?.env?.TELEGRAM_BOT_TOKEN || import.meta.env.TELEGRAM_BOT_TOKEN;
    const geminiApiKey = runtime?.env?.GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY;
    const adminSecret = runtime?.env?.ADMIN_SECRET || 'rpym-default-secret-2024';

    if (!botToken) return new Response('OK', { status: 200 });
    if (!AUTHORIZED_CHAT_IDS.includes(chatId)) {
      await sendTelegramMessage(chatId, `🚫 No autorizado.\nTu chat ID: \`${chatId}\``, botToken);
      return new Response('OK', { status: 200 });
    }

    const adminName = ADMIN_NAMES[chatId] || 'Admin';
    const db = getD1(locals);

    // Comandos directos
    if (text === '/start') {
      await sendTelegramMessage(chatId, `¡Hola ${adminName}! 👋\n\nSoy el bot RPYM con IA. Ejemplos:\n\n` +
        `📋 "presupuesto de 2kg jumbo para Maria"\n` +
        `👥 "anota a delcy $5 de calamar"\n` +
        `⚙️ "tema navidad" / "ver stats"\n` +
        `💡 "ayuda" para más comandos`, botToken);
      return new Response('OK', { status: 200 });
    }

    if (!geminiApiKey) {
      await sendTelegramMessage(chatId, '❌ API de Gemini no configurada', botToken);
      return new Response('OK', { status: 200 });
    }

    // ═══════════════════════════════════════════════════════════════
    // COMANDO /debug - Prueba el router sin ejecutar la acción
    // ═══════════════════════════════════════════════════════════════
    if (text.startsWith('/debug ')) {
      const testText = text.replace('/debug ', '').trim();
      if (!testText) {
        await sendTelegramMessage(chatId, '❌ Uso: /debug <mensaje a probar>\n\nEjemplo: /debug ponle 5 a delcy', botToken);
        return new Response('OK', { status: 200 });
      }

      // Cargar historial para contexto (igual que en ejecución normal)
      const debugHistory = await getChatHistory(db, chatId, 6);
      const debugHistoryContext = formatHistoryForContext(debugHistory);

      // Detectar intención sin ejecutar
      const debugIntent = await detectIntent(testText, geminiApiKey, debugHistoryContext);

      // Formatear resultado
      let debugMsg = `📊 *DEBUG*\n\n`;
      debugMsg += `📝 *Texto:* "${testText}"\n`;
      debugMsg += `🎯 *Intent:* \`${debugIntent.intent}\`\n`;
      debugMsg += `📈 *Confianza:* ${(debugIntent.confidence * 100).toFixed(0)}%`;

      // Indicador visual de confianza
      if (debugIntent.confidence >= 0.85) {
        debugMsg += ` ✅ Alta\n`;
      } else if (debugIntent.confidence >= 0.7) {
        debugMsg += ` ⚠️ Media\n`;
      } else {
        debugMsg += ` ❌ Baja (pediría clarificación)\n`;
      }

      debugMsg += `\n📦 *Params:*\n\`\`\`\n${JSON.stringify(debugIntent.params, null, 2)}\n\`\`\``;

      // Mostrar alternativas si las hay
      if (debugIntent.alternativeIntents && debugIntent.alternativeIntents.length > 0) {
        debugMsg += `\n\n🔀 *Alternativas:*\n`;
        for (const alt of debugIntent.alternativeIntents) {
          debugMsg += `• ${alt.description}\n`;
        }
      }

      debugMsg += `\n\n_Este mensaje NO ejecutó ninguna acción_`;

      await sendTelegramMessage(chatId, debugMsg, botToken);
      return new Response('OK', { status: 200 });
    }

    // Cargar historial de conversación para contexto
    const chatHistory = await getChatHistory(db, chatId, 6);
    const historyContext = formatHistoryForContext(chatHistory);

    // ═══════════════════════════════════════════════════════════════
    // PASO 1: Verificar si es respuesta a clarificación pendiente
    // ═══════════════════════════════════════════════════════════════
    const pendingClarification = getPendingClarification(chatHistory);
    const clarificationOption = parseClarificationResponse(text);

    // Variable para almacenar el texto a procesar (puede ser modificado si es respuesta a clarificación)
    let textToProcess = text;

    if (pendingClarification.hasPending && clarificationOption !== null) {
      // El usuario respondió con un número a una clarificación previa
      console.log(`[Telegram] Clarification response: option ${clarificationOption}`);

      if (clarificationOption > 0 && clarificationOption <= pendingClarification.options.length) {
        // Re-procesar el texto original con la intención seleccionada
        // Agregar contexto explícito para que Gemini entienda mejor
        const selectedOption = pendingClarification.options[clarificationOption - 1];
        textToProcess = `${pendingClarification.originalText} (quiero: ${selectedOption.description})`;
        console.log(`[Telegram] Re-processing with clarified text: "${textToProcess}"`);
      } else {
        // Número inválido
        await saveChatMessage(db, chatId, 'user', text);
        const errorMsg = `❌ Opción inválida. Elige entre 1 y ${pendingClarification.options.length}, o escribe tu solicitud más claro.`;
        await sendTelegramMessage(chatId, errorMsg, botToken);
        await saveChatMessage(db, chatId, 'assistant', errorMsg);
        return new Response('OK', { status: 200 });
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // PASO 2: Detectar intención con IA
    // ═══════════════════════════════════════════════════════════════
    console.log(`[Telegram] ${adminName}: "${textToProcess}" (history: ${chatHistory.length} msgs)`);
    const intent = await detectIntent(textToProcess, geminiApiKey, historyContext);
    console.log(`[Telegram] Intent: ${intent.intent} (confidence: ${intent.confidence})`, JSON.stringify(intent.params));

    // ═══════════════════════════════════════════════════════════════
    // PASO 3: Verificar confianza y pedir clarificación si es necesario
    // ═══════════════════════════════════════════════════════════════
    if (intent.confidence < CONFIDENCE_THRESHOLD_EXECUTE && intent.alternativeIntents && intent.alternativeIntents.length > 0) {
      // Confianza baja - pedir clarificación en lugar de ejecutar
      console.log(`[Telegram] Low confidence (${intent.confidence}) - asking for clarification`);

      // Guardar mensaje del usuario
      await saveChatMessage(db, chatId, 'user', text);

      // Construir mensaje de clarificación
      const primaryOption: AlternativeIntent = {
        intent: intent.intent,
        description: intent.message || getIntentDescription(intent.intent, intent.params),
        params: intent.params
      };

      const clarificationMsg = buildClarificationMessage(text, primaryOption, intent.alternativeIntents);
      await sendTelegramMessage(chatId, clarificationMsg, botToken);
      await saveChatMessage(db, chatId, 'assistant', clarificationMsg);
      return new Response('OK', { status: 200 });
    }

    // Log si es confianza media
    if (intent.confidence < CONFIDENCE_THRESHOLD_LOG) {
      console.log(`[Telegram] Medium confidence (${intent.confidence}) - executing but logging`);
    }

    let response = intent.message;

    switch (intent.intent) {
      case 'customer_action':
        console.log('[Telegram] customer_action - params:', JSON.stringify(intent.params));
        if (intent.params.action === 'listar') {
          response = await getCustomersList(db);
        } else if (intent.params.action === 'ver' && intent.params.cliente) {
          response = await getCustomerBalance(db, intent.params.cliente);
        } else if (intent.params.action === 'movimientos' && intent.params.cliente) {
          response = await getCustomerMovements(db, intent.params.cliente);
        } else if (intent.params.action === 'movimientos_contexto') {
          // Buscar el último cliente mencionado en el contexto
          const lastCustomerMatch = [...chatHistory].reverse().find(m =>
            m.role === 'assistant' && m.content.includes('👤 *')
          );
          const customerMatch = lastCustomerMatch?.content.match(/👤 \*([^*]+)\*/);
          if (customerMatch) {
            response = await getCustomerMovements(db, customerMatch[1]);
          } else {
            response = '❓ No encontré un cliente reciente. Dime de quién: "movimientos de [nombre]"';
          }
        } else if (intent.params.action === 'crear' && intent.params.nombre) {
          response = await createCustomer(db, intent.params.nombre, intent.params.telefono);
        } else if (intent.params.action === 'editar_cliente_contexto' && intent.params.telefono) {
          // Buscar el último cliente mencionado en el contexto
          const lastCustomerMatch = [...chatHistory].reverse().find(m =>
            m.role === 'assistant' && (m.content.includes('👤 *') || m.content.includes('✅ Cliente creado:'))
          );
          const customerNameMatch = lastCustomerMatch?.content.match(/👤 \*([^*]+)\*/) ||
                                    lastCustomerMatch?.content.match(/Cliente creado: \*([^*]+)\*/);
          if (customerNameMatch) {
            const customerName = customerNameMatch[1];
            response = await updateCustomerPhone(db, customerName, intent.params.telefono);
          } else {
            response = '❓ No encontré un cliente reciente. Especifica: "el teléfono de [nombre] es [número]"';
          }
        } else if (intent.params.action === 'editar_cliente' && intent.params.cliente && intent.params.telefono) {
          response = await updateCustomerPhone(db, intent.params.cliente, intent.params.telefono);
        } else if (intent.params.rawText) {
          console.log('[Telegram] Parsing customer action with rawText');
          // Usar customer-ai para parsear la anotación
          const customers = await db?.prepare(`SELECT id, name FROM customers WHERE is_active = 1`).all();
          const presupuestos = await db?.prepare(`SELECT id, fecha, customer_name, total_usd, total_usd_divisa FROM presupuestos ORDER BY fecha DESC LIMIT 20`).all();
          console.log('[Telegram] Got customers:', customers?.results?.length, 'presupuestos:', presupuestos?.results?.length);

          const result = await parseCustomerActions(
            intent.params.rawText,
            customers?.results?.map((c: any) => ({ id: c.id, name: c.name })) || [],
            presupuestos?.results?.map((p: any) => ({ id: p.id, fecha: p.fecha, customerName: p.customer_name, totalUSD: p.total_usd, totalUSDDivisa: p.total_usd_divisa })) || [],
            geminiApiKey
          );
          console.log('[Telegram] parseCustomerActions result:', JSON.stringify(result));

          if (result.success && result.actions.length > 0) {
            const results: string[] = [];
            for (const action of result.actions) {
              console.log('[Telegram] Executing action:', JSON.stringify(action));
              const r = await executeCustomerAction(db, action);
              console.log('[Telegram] Action result:', r);
              results.push(r);
            }
            response = results.join('\n\n');
            if (result.unmatchedCustomers.length > 0) {
              response += `\n\n⚠️ No encontré: ${result.unmatchedCustomers.join(', ')}`;
            }
          } else {
            response = `❌ ${result.error || 'No pude interpretar la anotación'}`;
          }
        }
        break;

      case 'customer_purchase_products':
        console.log('[Telegram] customer_purchase_products - rawText:', intent.params.rawText, 'modo:', intent.params.modo, 'sinBs:', intent.params.sinBs);
        response = await createCustomerPurchaseWithProducts(db, intent.params.rawText || text, intent.params.modo || 'bcv', url.origin, geminiApiKey, adminSecret, intent.params.sinBs || false);
        break;

      case 'budget_create':
        console.log('[Telegram] budget_create - rawText:', intent.params.rawText, 'modo:', intent.params.modo, 'sinBs:', intent.params.sinBs);
        response = await createBudgetFromText(db, intent.params.rawText || text, intent.params.modo || 'bcv', url.origin, geminiApiKey, adminSecret, intent.params.sinBs || false);
        console.log('[Telegram] budget_create response:', response.substring(0, 200));
        break;

      case 'budget_action':
        if (intent.params.action === 'ver' && intent.params.id) {
          response = await getBudget(db, intent.params.id, adminSecret);
        } else if (intent.params.action === 'eliminar' && intent.params.id) {
          response = await deleteBudget(db, intent.params.id);
        } else if (intent.params.action === 'pagar' && intent.params.id) {
          response = await markBudgetPaid(db, intent.params.id, intent.params.metodo);
        } else if (intent.params.action === 'pagar_multiple' && intent.params.ids?.length) {
          // Marcar múltiples presupuestos como pagados
          const results: string[] = [];
          for (const id of intent.params.ids) {
            const r = await markBudgetPaid(db, id, intent.params.metodo);
            results.push(r);
          }
          response = results.join('\n\n');
        } else if (intent.params.action === 'pagar_contexto') {
          // Buscar el último presupuesto mencionado en el contexto para marcarlo como pagado
          const lastBudgetMatch = [...chatHistory].reverse().find(m =>
            m.role === 'assistant' && m.content.includes('Presupuesto #')
          );
          const idMatch = lastBudgetMatch?.content.match(/#(\d+)/);
          if (idMatch) {
            response = await markBudgetPaid(db, idMatch[1], intent.params.metodo);
          } else {
            response = '❓ No encontré un presupuesto reciente. Especifica el número: "marca 12345 como pagado"';
          }
        } else if (intent.params.action === 'pagar_y_whatsapp_contexto' && intent.params.telefono) {
          // Comando compuesto: marcar pagado Y enviar por WhatsApp
          const lastBudgetMatch = [...chatHistory].reverse().find(m =>
            m.role === 'assistant' && m.content.includes('Presupuesto #')
          );
          const idMatch = lastBudgetMatch?.content.match(/#(\d+)/);
          if (idMatch) {
            const budgetId = idMatch[1];
            // 1. Marcar como pagado
            const paidResponse = await markBudgetPaid(db, budgetId, intent.params.metodo);
            // 2. Enviar por WhatsApp
            const whatsappResponse = await sendBudgetWhatsApp(db, budgetId, intent.params.telefono, url.origin);
            // Combinar respuestas
            response = `${paidResponse}\n\n${whatsappResponse}`;
          } else {
            response = '❓ No encontré un presupuesto reciente. Especifica: "marca 12345 pagado y envíaselo al 0414..."';
          }
        } else if (intent.params.action === 'metodo_pago' && intent.params.metodo) {
          // Buscar el último presupuesto marcado como pagado en el contexto
          const lastPaidMatch = chatHistory.reverse().find(m =>
            m.role === 'assistant' && m.content.includes('marcado como *PAGADO*')
          );
          const idMatch = lastPaidMatch?.content.match(/#(\d+)/);
          if (idMatch) {
            response = await updatePaymentMethod(db, idMatch[1], intent.params.metodo);
          } else {
            response = '❓ No encontré un presupuesto reciente para actualizar. Especifica el ID: "el pago del 12345 fue por pago movil"';
          }
        } else if (intent.params.action === 'actualizar' && intent.params.cambio) {
          // Buscar ID del presupuesto en params o en contexto
          let budgetId = intent.params.id;
          if (!budgetId) {
            // Buscar el último presupuesto mencionado en el contexto
            const lastBudgetMatch = [...chatHistory].reverse().find(m =>
              m.role === 'assistant' && m.content.includes('Presupuesto #')
            );
            const idMatch = lastBudgetMatch?.content.match(/#(\d+)/);
            budgetId = idMatch?.[1];
          }
          if (budgetId) {
            response = await updateBudgetProperty(db, budgetId, intent.params.cambio);
          } else {
            response = '❓ No encontré un presupuesto reciente. Especifica el ID: "oculta bs del presupuesto 12345"';
          }
        } else if (intent.params.action === 'editar' && intent.params.edicion) {
          // Editar presupuesto (precio, cantidad, fecha, items)
          let budgetId = intent.params.id;
          if (!budgetId) {
            const lastBudgetMatch = [...chatHistory].reverse().find(m =>
              m.role === 'assistant' && m.content.includes('Presupuesto #')
            );
            const idMatch = lastBudgetMatch?.content.match(/#(\d+)/);
            budgetId = idMatch?.[1];
          }
          if (budgetId) {
            response = await editBudget(db, budgetId, intent.params.edicion);
          } else {
            response = '❓ No encontré un presupuesto reciente. Especifica el ID: "edita el presupuesto 12345..."';
          }
        } else if (intent.params.action === 'whatsapp' && intent.params.id && intent.params.telefono) {
          response = await sendBudgetWhatsApp(db, intent.params.id, intent.params.telefono, url.origin);
        } else if (intent.params.action === 'whatsapp_contexto' && intent.params.telefono) {
          // Buscar el último presupuesto mencionado en el contexto
          const lastBudgetMatch = [...chatHistory].reverse().find(m =>
            m.role === 'assistant' && m.content.includes('Presupuesto #')
          );
          const idMatch = lastBudgetMatch?.content.match(/#(\d+)/);
          if (idMatch) {
            response = await sendBudgetWhatsApp(db, idMatch[1], intent.params.telefono, url.origin);
          } else {
            response = '❓ No encontré un presupuesto reciente. Especifica: "envía el presupuesto 12345 al 0414..."';
          }
        } else if (intent.params.action === 'buscar' && intent.params.cliente) {
          response = await searchBudgetsByCustomer(db, intent.params.cliente);
        } else if (intent.params.action === 'asignar' && intent.params.id && intent.params.cliente) {
          // Asignar presupuesto explícito a cliente explícito
          const linkResult = await linkBudgetToCustomer(db, intent.params.id, intent.params.cliente);
          response = linkResult.message;
        } else if (intent.params.action === 'asignar_contexto') {
          // Buscar el último presupuesto y cliente mencionados en el contexto
          let budgetId = intent.params.id;
          let customerName = intent.params.cliente;

          // Si no hay ID, buscar el último presupuesto mencionado
          if (!budgetId) {
            const lastBudgetMatch = [...chatHistory].reverse().find(m =>
              m.role === 'assistant' && m.content.includes('Presupuesto #')
            );
            const idMatch = lastBudgetMatch?.content.match(/#(\d+)/);
            budgetId = idMatch?.[1];
          }

          // Si no hay cliente, buscar el último cliente mencionado o el del presupuesto
          if (!customerName && budgetId) {
            // Primero intentar obtener el nombre del cliente del presupuesto
            const budget = await db?.prepare(`SELECT customer_name FROM presupuestos WHERE id = ?`).bind(budgetId).first();
            if (budget?.customer_name) {
              customerName = budget.customer_name;
            } else {
              // Buscar en el historial
              const lastCustomerMatch = [...chatHistory].reverse().find(m =>
                m.role === 'assistant' && m.content.includes('👤')
              );
              const customerMatch = lastCustomerMatch?.content.match(/👤 \*?([^*\n]+)\*?/);
              if (customerMatch) {
                customerName = customerMatch[1].trim();
              }
            }
          }

          if (budgetId && customerName) {
            const linkResult = await linkBudgetToCustomer(db, budgetId, customerName);
            response = linkResult.message;
          } else if (!budgetId) {
            response = '❓ No encontré un presupuesto reciente. Especifica: "asigna el presupuesto 12345 a [cliente]"';
          } else {
            response = '❓ No encontré a qué cliente asignar. Especifica: "asígnalo a [cliente]"';
          }
        }
        break;

      case 'config_action':
        if (intent.params.action === 'tema' && intent.params.tema) {
          response = await changeTheme(db, intent.params.tema);
        } else if (intent.params.action === 'stats') {
          response = await getStats(db);
        } else if (intent.params.action === 'tasa') {
          const bcvRate = await getBCVRate();
          response = `💱 *Tasa BCV*\n\nBs. ${bcvRate.rate.toFixed(2)} por dólar\nFuente: ${bcvRate.source}`;
        }
        break;

      case 'product_action':
        if (intent.params.action === 'listar') {
          response = await getProductsList(db);
        } else if (intent.params.action === 'precio' && intent.params.producto) {
          response = await updateProductPrice(db, intent.params.producto, intent.params.precioBcv, intent.params.precioDivisa);
        } else if (intent.params.action === 'disponibilidad' && intent.params.producto !== undefined) {
          response = await updateProductAvailability(db, intent.params.producto, intent.params.disponible);
        }
        break;

      case 'help':
        response = `📖 *Comandos RPYM*\n\n` +
          `*Clientes*\n• "anota a X $Y de Z"\n• "abona X $Y"\n• "ver clientes" / "como está X"\n\n` +
          `*Presupuestos*\n• "presupuesto de 2kg jumbo para Maria"\n• "presupuesto dual de..."\n• "ver/eliminar presupuesto 12345"\n\n` +
          `*Productos*\n• "ver productos"\n• "sube jumbo a $15"\n• "no hay pulpo"\n\n` +
          `*Config*\n• "tema navidad/normal"\n• "estadísticas"\n• "tasa bcv"`;
        break;

      case 'chat':
      default:
        response = intent.params.respuesta || intent.message || '¿En qué te ayudo?';
        break;
    }

    // Guardar mensaje del usuario y respuesta para memoria
    await saveChatMessage(db, chatId, 'user', text);
    await saveChatMessage(db, chatId, 'assistant', response.substring(0, 500)); // Limitar tamaño

    await sendTelegramMessage(chatId, response, botToken);
    return new Response('OK', { status: 200 });

  } catch (error) {
    console.error('[Telegram] Error:', error);
    return new Response('OK', { status: 200 });
  }
};

export const GET: APIRoute = async ({ url, locals }) => {
  const testText = url.searchParams.get('test');
  const simulate = url.searchParams.get('simulate');

  const runtime = (locals as any).runtime;
  const geminiApiKey = runtime?.env?.GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY;
  const adminSecret = runtime?.env?.ADMIN_SECRET || 'rpym-default-secret-2024';
  const db = getD1(locals);

  // Simulación completa del flujo POST
  if (simulate) {
    if (!geminiApiKey) {
      return new Response(JSON.stringify({ error: 'No Gemini API key' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    try {
      const intent = await detectIntent(simulate, geminiApiKey);
      let response = intent.message;
      let executionLog: string[] = [];

      switch (intent.intent) {
        case 'customer_action':
          if (intent.params.rawText) {
            executionLog.push('Parsing customer action...');
            const customers = await db?.prepare(`SELECT id, name FROM customers WHERE is_active = 1`).all();
            const presupuestos = await db?.prepare(`SELECT id, fecha, customer_name, total_usd, total_usd_divisa FROM presupuestos ORDER BY fecha DESC LIMIT 20`).all();
            executionLog.push(`Found ${customers?.results?.length || 0} customers, ${presupuestos?.results?.length || 0} presupuestos`);

            const result = await parseCustomerActions(
              intent.params.rawText,
              customers?.results?.map((c: any) => ({ id: c.id, name: c.name })) || [],
              presupuestos?.results?.map((p: any) => ({ id: p.id, fecha: p.fecha, customerName: p.customer_name, totalUSD: p.total_usd, totalUSDDivisa: p.total_usd_divisa })) || [],
              geminiApiKey
            );
            executionLog.push(`parseCustomerActions: ${JSON.stringify(result)}`);

            if (result.success && result.actions.length > 0) {
              const results: string[] = [];
              for (const action of result.actions) {
                executionLog.push(`Executing: ${JSON.stringify(action)}`);
                const r = await executeCustomerAction(db, action);
                executionLog.push(`Result: ${r}`);
                results.push(r);
              }
              response = results.join('\n\n');
            } else {
              response = `❌ ${result.error || 'No pude interpretar'}`;
            }
          }
          break;

        case 'customer_purchase_products':
          executionLog.push(`Customer purchase with products: ${intent.params.rawText}, mode: ${intent.params.modo}, sinBs: ${intent.params.sinBs}`);
          response = await createCustomerPurchaseWithProducts(db, intent.params.rawText || simulate, intent.params.modo || 'bcv', url.origin, geminiApiKey, adminSecret, intent.params.sinBs || false);
          executionLog.push(`Response: ${response}`);
          break;

        case 'budget_create':
          executionLog.push(`Creating budget: ${intent.params.rawText}, mode: ${intent.params.modo}, sinBs: ${intent.params.sinBs}`);
          response = await createBudgetFromText(db, intent.params.rawText || simulate, intent.params.modo || 'bcv', url.origin, geminiApiKey, adminSecret, intent.params.sinBs || false);
          executionLog.push(`Response: ${response}`);
          break;
      }

      return new Response(JSON.stringify({ input: simulate, intent, response, executionLog }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error), stack: (error as any).stack }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // Test simple del router
  if (testText) {
    if (!geminiApiKey) {
      return new Response(JSON.stringify({ error: 'No Gemini API key' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    try {
      const intent = await detectIntent(testText, geminiApiKey);
      let parseResult = null;
      if (intent.intent === 'customer_action' && intent.params.rawText) {
        const customers = await db?.prepare(`SELECT id, name FROM customers WHERE is_active = 1`).all();
        const presupuestos = await db?.prepare(`SELECT id, fecha, customer_name, total_usd, total_usd_divisa FROM presupuestos ORDER BY fecha DESC LIMIT 20`).all();
        parseResult = await parseCustomerActions(
          intent.params.rawText,
          customers?.results?.map((c: any) => ({ id: c.id, name: c.name })) || [],
          presupuestos?.results?.map((p: any) => ({ id: p.id, fecha: p.fecha, customerName: p.customer_name, totalUSD: p.total_usd, totalUSDDivisa: p.total_usd_divisa })) || [],
          geminiApiKey
        );
      }
      return new Response(JSON.stringify({ input: testText, intent, parseResult, origin: url.origin }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  return new Response('Telegram webhook running', { status: 200 });
};
