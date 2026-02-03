import { useState, useRef, useEffect } from 'react';
import type { Product } from '../lib/sheets';

// --- Cache ---
const CACHE_KEY = 'rpym_chef_jose_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  question: string;
  answer: string;
  timestamp: number;
}

function getCachedAnswer(question: string): string | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const entries: CacheEntry[] = JSON.parse(raw);
    const now = Date.now();

    const valid = entries.filter(e => now - e.timestamp < CACHE_TTL);
    if (valid.length !== entries.length) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(valid));
    }

    const normalized = question.trim().toLowerCase();
    const found = valid.find(e => e.question === normalized);
    return found ? found.answer : null;
  } catch {
    return null;
  }
}

function setCachedAnswer(question: string, answer: string): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const entries: CacheEntry[] = raw ? JSON.parse(raw) : [];
    const now = Date.now();

    const valid = entries.filter(e => now - e.timestamp < CACHE_TTL);
    valid.push({
      question: question.trim().toLowerCase(),
      answer,
      timestamp: now
    });

    localStorage.setItem(CACHE_KEY, JSON.stringify(valid));
  } catch {
    // Silently fail
  }
}

// --- Usage tracking ---
const USAGE_KEY = 'rpym_chef_jose_usage';

interface UsageData {
  count: number;
  date: string;
}

function getToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function trackUsage(): void {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    const today = getToday();
    let usage: UsageData = raw ? JSON.parse(raw) : { count: 0, date: today };

    if (usage.date !== today) {
      usage = { count: 0, date: today };
    }

    usage.count += 1;
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch {
    // Silently fail
  }
}

// --- Normalize for matching ---
function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// --- Types ---
interface Message {
  role: 'user' | 'jose';
  text: string;
  matchedProducts?: Product[];
}

interface SelectedItem {
  product: Product;
  quantity: number;
}

interface Props {
  products: Product[];
  selectedItems: Map<string, SelectedItem>;
  onAddItem: (product: Product) => void;
}

// --- Component ---
export default function ChefJose({ products, selectedItems, onAddItem }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [reviewPending, setReviewPending] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll within the chat container only (not the whole page)
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  // Find products mentioned in José's response using keyword matching
  const findMentionedProducts = (text: string): Product[] => {
    const normalizedText = normalize(text);
    const matched: Product[] = [];
    const stopWords = new Set(['en', 'de', 'con', 'la', 'el', 'las', 'los', 'y', 'o', 'a', 'kg', 'por', 'caja']);

    for (const product of products) {
      if (!product.disponible) continue;

      // Try full name match first
      const normalizedName = normalize(product.nombre);
      if (normalizedText.includes(normalizedName)) {
        matched.push(product);
        continue;
      }

      // Keyword matching: remove parenthetical info and numbers, extract meaningful words
      const cleanName = product.nombre.replace(/\(.*?\)/g, '').replace(/\d+[\/\d]*/g, '').trim();
      const words = normalize(cleanName).split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));

      if (words.length === 0) continue;

      // Check how many keywords appear in the text (substring match handles plural forms:
      // "camaron" matches "camarones", "pelado" matches "pelados", etc.)
      const matchCount = words.filter(word => normalizedText.includes(word)).length;

      if (words.length === 1 && matchCount === 1) {
        matched.push(product);
      } else if (words.length >= 2 && matchCount >= 2) {
        matched.push(product);
      }
    }

    return matched;
  };

  // Build order summary for review
  const buildOrderSummary = (): string => {
    if (selectedItems.size === 0) return '';
    const items: string[] = [];
    selectedItems.forEach(({ product, quantity }) => {
      items.push(`${product.nombre} ${quantity} ${product.unidad}`);
    });
    return items.join(', ');
  };

  const handleSubmit = async (overrideQuestion?: string) => {
    const question = (overrideQuestion || input).trim();
    if (!question || question.length < 3 || isLoading) return;

    // If waiting for review context, redirect to submitReview
    if (reviewPending && !overrideQuestion) {
      setMessages(prev => [...prev, { role: 'user', text: question }]);
      setInput('');
      submitReview(question);
      return;
    }

    // Add user message
    setMessages(prev => [...prev, { role: 'user', text: question }]);
    if (!overrideQuestion) setInput('');

    // Check cache (skip for review questions that include order data)
    const isReview = question.includes('Tengo en mi pedido:');
    if (!isReview) {
      const cached = getCachedAnswer(question);
      if (cached) {
        const matchedProducts = findMentionedProducts(cached);
        setMessages(prev => [...prev, { role: 'jose', text: cached, matchedProducts }]);
        return;
      }
    }

    // Call API
    setIsLoading(true);
    try {
      const response = await fetch('/api/chef-jose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      });

      const data = await response.json();

      if (data.success && data.answer) {
        const matchedProducts = findMentionedProducts(data.answer);
        setMessages(prev => [...prev, { role: 'jose', text: data.answer, matchedProducts }]);
        if (!isReview) setCachedAnswer(question, data.answer);
        trackUsage();
      } else {
        setMessages(prev => [...prev, {
          role: 'jose',
          text: data.error || 'Disculpa, no pude responder en este momento. Intenta de nuevo.'
        }]);
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'jose',
        text: 'Error de conexion. Verifica tu internet e intenta de nuevo.'
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleReviewOrder = () => {
    const summary = buildOrderSummary();
    if (!summary) {
      setMessages(prev => [...prev, {
        role: 'jose',
        text: 'No tienes productos en tu pedido todavia. Agrega algunos productos y luego me pides que lo revise.'
      }]);
      return;
    }
    // Ask for context before reviewing
    setReviewPending(true);
    setMessages(prev => [...prev, {
      role: 'jose',
      text: 'Que vas a preparar con eso? Asi te digo si te falta algo o te recomiendo cambios.'
    }]);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const submitReview = (context: string) => {
    const summary = buildOrderSummary();
    setReviewPending(false);
    const question = `Voy a preparar: ${context}. Tengo en mi pedido: ${summary}. Revisa si esta bien para lo que quiero hacer, si me falta algo o si me recomiendas algun cambio.`;
    handleSubmit(question);
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-ocean-200 overflow-hidden">
      {/* Header */}
      <div className="bg-ocean-800 px-4 py-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-coral-400 flex-shrink-0">
          <img
            src="/camaronchef-sm.webp"
            alt="Chef Jose"
            className="w-[130%] h-[130%] object-cover object-top"
          />
        </div>
        <div className="flex-1">
          <h3 className="text-white font-semibold text-sm leading-tight">Consulta a Jose</h3>
          <p className="text-ocean-300 text-xs">Chef de mariscos — recetas, porciones y recomendaciones</p>
        </div>
        {selectedItems.size > 0 && (
          <button
            onClick={handleReviewOrder}
            disabled={isLoading}
            className="px-3 py-1.5 bg-coral-500 hover:bg-coral-600 disabled:bg-ocean-600 text-white text-xs font-medium rounded-lg transition-colors flex-shrink-0"
          >
            Revisar pedido
          </button>
        )}
      </div>

      {/* Messages area */}
      <div ref={containerRef} className="overflow-y-auto p-4 space-y-3 min-h-[200px] max-h-[350px]">
        {messages.length === 0 && !isLoading && (
          <div className="text-center py-6 px-2">
            <div className="w-16 h-16 rounded-full mx-auto mb-3 border-2 border-coral-200 overflow-hidden">
              <img
                src="/camaronchef-sm.webp"
                alt="Chef Jose"
                className="w-[130%] h-[130%] object-cover object-top"
              />
            </div>
            <p className="text-ocean-700 text-sm font-medium">
              Hola! Soy Jose
            </p>
            <p className="text-ocean-500 text-xs mt-1">
              Preguntame sobre recetas y te recomiendo que agregar a tu pedido
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                onClick={() => handleSubmit('Como preparo camarones al ajillo?')}
                disabled={isLoading}
                className="text-xs bg-ocean-50 text-ocean-700 px-3 py-1.5 rounded-full hover:bg-ocean-100 transition-colors"
              >
                Camarones al ajillo
              </button>
              <button
                onClick={() => handleSubmit('Como hago un ceviche de pescado?')}
                disabled={isLoading}
                className="text-xs bg-ocean-50 text-ocean-700 px-3 py-1.5 rounded-full hover:bg-ocean-100 transition-colors"
              >
                Ceviche de pescado
              </button>
              <button
                onClick={() => handleSubmit('Cuanto pulpo necesito para 6 personas?')}
                disabled={isLoading}
                className="text-xs bg-ocean-50 text-ocean-700 px-3 py-1.5 rounded-full hover:bg-ocean-100 transition-colors"
              >
                Porciones de pulpo
              </button>
              {selectedItems.size > 0 && (
                <button
                  onClick={handleReviewOrder}
                  disabled={isLoading}
                  className="text-xs bg-coral-50 text-coral-700 px-3 py-1.5 rounded-full hover:bg-coral-100 transition-colors font-medium"
                >
                  Revisar mi pedido
                </button>
              )}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-ocean-600 text-white rounded-br-md'
                    : 'bg-ocean-50 text-ocean-900 rounded-bl-md'
                }`}
              >
                {msg.text}
              </div>
            </div>
            {/* Product action buttons for José's recommendations */}
            {msg.role === 'jose' && msg.matchedProducts && msg.matchedProducts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2 ml-1">
                {msg.matchedProducts.map(product => {
                  const isInCart = selectedItems.has(product.id);
                  return (
                    <button
                      key={product.id}
                      onClick={() => { if (!isInCart) onAddItem(product); }}
                      disabled={isInCart}
                      className={`text-xs px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 ${
                        isInCart
                          ? 'bg-green-100 text-green-700 cursor-default'
                          : 'bg-coral-50 text-coral-700 hover:bg-coral-100'
                      }`}
                    >
                      {isInCart ? (
                        <>
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          {product.nombre}
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                          </svg>
                          Agregar {product.nombre}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-ocean-50 text-ocean-600 px-3 py-2 rounded-2xl rounded-bl-md text-sm animate-pulse">
              Jose esta pensando...
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-ocean-100 p-3">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pregunta sobre mariscos..."
            disabled={isLoading}
            className="flex-1 px-3 py-2 text-sm border border-ocean-200 rounded-xl
              focus:outline-none focus:ring-2 focus:ring-coral-400 focus:border-transparent
              disabled:bg-ocean-50 disabled:cursor-not-allowed
              placeholder:text-ocean-400"
          />
          <button
            onClick={() => handleSubmit()}
            disabled={!input.trim() || input.trim().length < 3 || isLoading}
            className="px-4 py-2 bg-coral-500 hover:bg-coral-600 disabled:bg-ocean-200
              disabled:cursor-not-allowed text-white font-medium text-sm rounded-xl
              transition-colors flex-shrink-0"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
