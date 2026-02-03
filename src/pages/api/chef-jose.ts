import type { APIRoute } from 'astro';

export const prerender = false;

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
  // Saludos comunes (dejar que José responda en personaje)
  'hola', 'jose', 'chef', 'buenas', 'buen dia', 'buenos dia'
];

function isFoodRelated(question: string): boolean {
  const normalized = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return FOOD_KEYWORDS.some(keyword => normalized.includes(keyword));
}

const SYSTEM_PROMPT = `Eres José, chef portugués especializado en mariscos, nacido y formado en Madeira, Portugal. Llevas más de 30 años en Venezuela trabajando en el Muelle Pesquero El Mosquero, Maiquetía.

REGLAS IMPORTANTES:
1. Respuestas CORTAS: máximo 3 oraciones. No des recetas paso a paso. Solo ingredientes clave y un consejo breve.
2. Habla SIEMPRE en español. Solo intercala 1-2 palabras portuguesas por respuesta como "meu amigo", "olha" o "está bom". NUNCA escribas oraciones completas en portugués. Los nombres de productos SIEMPRE en español (camarón, mejillón, calamar, pulpo, etc.)

Tu personalidad:
- Eres cálido, apasionado por los mariscos y orgulloso de tu herencia portuguesa
- Das consejos prácticos y directos
- Cuando recomiendes productos, usa estos nombres exactos: camarón vivito, camarón jumbo, camarón pelado, camarón desvenado, camarón precocido, calamar pota, calamar nacional, tentáculos de calamar, pulpo pequeño, pulpo mediano, pulpo grande, langostino, pepitona, mejillón, guacuco, almeja, viera, jaiba, pulpa de cangrejo, salmón, filete de merluza
- No digas "de RPYM" después del nombre del producto
- Incluye cantidades aproximadas cuando te pregunten para cuántas personas (ej: "unos 800g de camarón vivito")
- Si te piden revisar un pedido, evalúa brevemente si las cantidades tienen sentido`;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    // En Cloudflare Pages, las env vars se acceden via locals.runtime.env
    const runtime = (locals as any).runtime;
    const apiKey = runtime?.env?.CLAUDE_API_KEY || import.meta.env.CLAUDE_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({
        success: false,
        error: 'API key no configurada. Contacta al administrador.'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { question } = body as { question: string };

    if (!question || typeof question !== 'string' || question.trim().length < 3) {
      return new Response(JSON.stringify({
        success: false,
        error: 'La pregunta debe tener al menos 3 caracteres.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validación de contenido relacionado con comida
    if (!isFoodRelated(question)) {
      return new Response(JSON.stringify({
        success: true,
        answer: '¡Epa! Yo soy chef de mariscos, mi fuerte es la cocina. Pregúntame sobre recetas, preparaciones o cualquier duda con pescados y mariscos y con gusto te ayudo. 🦐'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Llamar a la API de Anthropic
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: question.trim()
          }
        ],
        system: SYSTEM_PROMPT
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error de API Claude (chef-jose):', response.status, errorText);

      let errorMessage = 'José no pudo responder en este momento. Intenta de nuevo.';
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.type === 'authentication_error' || errorJson.error?.type === 'invalid_api_key') {
          errorMessage = 'Error de autenticación con la API. Contacta al administrador.';
        } else if (errorJson.error?.type === 'rate_limit_error') {
          errorMessage = 'Muchas consultas al mismo tiempo. Espera un momento e intenta de nuevo.';
        }
      } catch {
        // Si no es JSON, usar el mensaje genérico
      }

      return new Response(JSON.stringify({
        success: false,
        error: errorMessage
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const claudeResponse = await response.json();
    const answer = claudeResponse.content[0]?.text || '';

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
