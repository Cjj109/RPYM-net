import { useState, useRef, useEffect } from 'react';

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

    // Clean expired entries
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

    // Clean expired and add new
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

// --- Types ---
interface Message {
  role: 'user' | 'jose';
  text: string;
}

// --- Component ---
export default function ChefJose() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  const handleSubmit = async () => {
    const question = input.trim();
    if (!question || question.length < 3 || isLoading) return;

    // Add user message
    setMessages(prev => [...prev, { role: 'user', text: question }]);
    setInput('');

    // Check cache
    const cached = getCachedAnswer(question);
    if (cached) {
      setMessages(prev => [...prev, { role: 'jose', text: cached }]);
      return;
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
        setMessages(prev => [...prev, { role: 'jose', text: data.answer }]);
        setCachedAnswer(question, data.answer);
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
        <div>
          <h3 className="text-white font-semibold text-sm leading-tight">Consulta a Jose</h3>
          <p className="text-ocean-300 text-xs">Chef de mariscos — preguntale sobre recetas y preparaciones</p>
        </div>
      </div>

      {/* Messages area */}
      <div className="overflow-y-auto p-4 space-y-3 min-h-[200px] max-h-[350px]">
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
              Preguntame sobre cocina y mariscos
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                onClick={() => { setInput('Como preparo camarones al ajillo?'); }}
                className="text-xs bg-ocean-50 text-ocean-700 px-3 py-1.5 rounded-full hover:bg-ocean-100 transition-colors"
              >
                Camarones al ajillo
              </button>
              <button
                onClick={() => { setInput('Como hago un ceviche de pescado?'); }}
                className="text-xs bg-ocean-50 text-ocean-700 px-3 py-1.5 rounded-full hover:bg-ocean-100 transition-colors"
              >
                Ceviche de pescado
              </button>
              <button
                onClick={() => { setInput('Cuanto pulpo necesito para 6 personas?'); }}
                className="text-xs bg-ocean-50 text-ocean-700 px-3 py-1.5 rounded-full hover:bg-ocean-100 transition-colors"
              >
                Porciones de pulpo
              </button>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
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
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-ocean-50 text-ocean-600 px-3 py-2 rounded-2xl rounded-bl-md text-sm animate-pulse">
              Jose esta pensando...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
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
            onClick={handleSubmit}
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
