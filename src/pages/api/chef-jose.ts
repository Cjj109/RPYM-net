import type { APIRoute } from 'astro';
import { callGeminiWithRetry, type GeminiHistoryTurn } from '../../lib/gemini-client';

export const prerender = false;

/** Cuántos turnos previos se conservan (3 idas y vueltas). */
const MAX_HISTORY_TURNS = 6;
/** Recorte por turno, para acotar el tamaño del prompt. */
const MAX_HISTORY_CHARS = 1000;

const FOOD_KEYWORDS = [
  // Cocina y preparación
  'cocin', 'receta', 'prepar', 'hacer', 'hago', 'haga',
  'frit', 'herv', 'hornear', 'parrilla', 'asado', 'asar', 'guisar',
  'sazon', 'condiment', 'adob', 'marin',
  // Productos del mar
  'maris', 'camaron', 'pescado', 'pulpo', 'calamar', 'langost',
  'almeja', 'mejill', 'pepitona', 'guacuco', 'jaiba', 'cangrejo',
  'viera', 'salmon', 'filete', 'merluza', 'tinta', 'tentacul',
  'atun', 'pargo', 'mero', 'trucha', 'bacalao', 'bacalhau',
  // Platos y comida
  'salsa', 'arroz', 'ceviche', 'sopa', 'comer', 'comida', 'plato',
  'ingrediente', 'paella', 'pasta', 'risotto', 'crema', 'ensalad',
  'tacos', 'empanada', 'arepa', 'croqueta', 'cazuela', 'estofado',
  'menu', 'cena', 'almuerzo', 'desayuno',
  // Platos específicos y acompañamientos
  'fideua', 'fidegua', 'potencia', 'sancocho', 'fosforera', 'encurtid',
  'escabech', 'gratina', 'tartar', 'carpaccio', 'caldo', 'fumet',
  'cocktail', 'coctel',
  // Cantidades y pedidos
  'cuanto', 'persona', 'porcion', 'kilo', 'gramo',
  'como hago', 'como se hace', 'como se cocin',
  'recomien', 'sugier', 'consejo', 'tip',
  // Pedido / revisar
  'pedido', 'pedir', 'revisa', 'comprar', 'llevar',
  'precio', 'product', 'disponib',
  // Contexto social / ocasiones
  'amante', 'novia', 'novio', 'esposa', 'esposo', 'cita', 'impresion',
  'sorprend', 'romanc', 'conquist', 'enamor', 'celebr', 'fiesta',
  'reunion', 'invitad', 'cumplean', 'aniversar',
  // Saludos comunes (dejar que José responda en personaje)
  'hola', 'jose', 'chef', 'buenas', 'buen dia', 'buenos dia'
];

function isFoodRelated(question: string): boolean {
  const normalized = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return FOOD_KEYWORDS.some(keyword => normalized.includes(keyword));
}

const SYSTEM_PROMPT = `Eres José, chef portugués especializado en mariscos, nacido en Madeira, Portugal. Llevas más de 30 años en Venezuela trabajando en el Muelle Pesquero El Mosquero, Maiquetía.

IDIOMA OBLIGATORIO:
- Habla en ESPAÑOL. Solo intercala 2-3 palabras o expresiones cortas portuguesas por respuesta máximo: "meu amigo", "caramba", "olha", "ai ai ai", "pois é".
- NUNCA escribas oraciones completas en portugués. La respuesta debe ser entendible por alguien que solo habla español.
- Ejemplo CORRECTO: "¡Ai, meu amigo! Para esa paella necesitas unos 400g de camarón vivito y 300g de calamar pota. El secreto está en el sofrito, caramba!"
- Ejemplo INCORRECTO: "Você vai precisar de uns 800g de arroz bomba, um bom sofrito com tomate rallado"

REGLAS:
1. Responde en 3-5 oraciones en ESPAÑOL. Sé expresivo y con personalidad. No hagas listas con guiones.
2. Sé gracioso: usa dichos, exageraciones ("¡eso queda divino!"), comentarios pícaros cuando aplique.
3. CRÍTICO - Al final de CADA respuesta donde menciones productos, agrega el JSON con TODOS los productos que recomendaste:
|||PRODUCTOS|||[{"nombre":"camarón vivito","kg":0.4},{"nombre":"calamar pota","kg":0.3}]|||FIN|||
- "nombre" debe ser EXACTAMENTE de esta lista (copia y pega):
  camarón vivito, camarón jumbo, camarón pelado, camarón desvenado, camarón precocido, calamar pota, calamar nacional, tentáculos de calamar, cuerpo de calamar limpio, pulpo pequeño, pulpo mediano, pulpo grande, langostino, pepitona, mejillón, guacuco, almeja, viera, jaiba, pulpa de cangrejo, salmón, filete de merluza
- "kg" = cantidad en kilos (0.3 = 300g, 0.5 = 500g, 1 = 1kg)
- INCLUYE TODOS los productos que mencionaste en tu respuesta, no omitas ninguno

Tu personalidad:
- Apasionado y dramático con la comida. Te emocionas hablando de mariscos.
- Cómplice total si mencionan citas, impresionar a alguien, etc. Le sigues el juego.
- Das cantidades específicas (ej: "unos 400g de calamar pota").
- Bromeas que en Portugal todo es mejor pero el marisco venezolano "no está nada mal".

NO digas "de RPYM" después del producto.`;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    // En Cloudflare Pages, las env vars se acceden via locals.runtime.env
    const runtime = (locals as any).runtime;
    const apiKey = runtime?.env?.GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({
        success: false,
        error: 'API key de Gemini no configurada. Contacta al administrador.'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { question, history: rawHistory } = body as {
      question: string;
      history?: { role: string; text: string }[];
    };

    // El historial lo manda el cliente, así que se acota y se valida: solo los
    // últimos turnos, con roles conocidos y texto recortado.
    const history: GeminiHistoryTurn[] = Array.isArray(rawHistory)
      ? rawHistory
          .filter(t => t && (t.role === 'user' || t.role === 'model') && typeof t.text === 'string')
          .slice(-MAX_HISTORY_TURNS)
          .map(t => ({
            role: t.role as 'user' | 'model',
            text: t.text.slice(0, MAX_HISTORY_CHARS),
          }))
      : [];

    if (!question || typeof question !== 'string' || question.trim().length < 3) {
      return new Response(JSON.stringify({
        success: false,
        error: 'La pregunta debe tener al menos 3 caracteres.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validación de contenido relacionado con comida.
    // Se mira también la conversación previa: un seguimiento natural como
    // "¿qué más puedo agregar?" no contiene ninguna palabra de comida y antes
    // quedaba bloqueado, rompiendo el hilo con la respuesta enlatada.
    const conversacionEsDeComida =
      isFoodRelated(question) || history.some(turn => isFoodRelated(turn.text));

    if (!conversacionEsDeComida) {
      return new Response(JSON.stringify({
        success: true,
        answer: '¡Epa! Yo soy chef de mariscos, mi fuerte es la cocina. Pregúntame sobre recetas, preparaciones o cualquier duda con pescados y mariscos y con gusto te ayudo. 🦐'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Llamar a Gemini con retry automático
    const geminiResult = await callGeminiWithRetry({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: question.trim(),
      apiKey,
      temperature: 0.85,
      maxOutputTokens: 400,
      history,
    });

    if (!geminiResult.success) {
      console.error('Error de API Gemini (chef-jose):', geminiResult.error);
      return new Response(JSON.stringify({
        success: false,
        error: 'José no pudo responder en este momento. Intenta de nuevo.'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const answer = geminiResult.content;

    if (!answer) {
      return new Response(JSON.stringify({
        success: false,
        error: 'José no pudo generar una respuesta. Intenta reformular tu pregunta.'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      answer
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error en chef-jose:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error interno del servidor. Intenta de nuevo.'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
