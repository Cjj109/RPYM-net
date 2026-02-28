/**
 * Evaluador seguro de expresiones matemáticas.
 * Usa el algoritmo Shunting Yard (Dijkstra) para convertir
 * notación infija a RPN y luego evaluar.
 * Soporta +, -, *, /, paréntesis, comas como decimal.
 * Nunca lanza excepciones — retorna 0 para inputs inválidos.
 */

type Token =
  | { type: 'number'; value: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/' }
  | { type: 'lparen' }
  | { type: 'rparen' };

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

function tokenize(expr: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (ch === ' ') { i++; continue; }

    // Número (incluyendo decimales)
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        num += expr[i];
        i++;
      }
      const val = parseFloat(num);
      if (isNaN(val)) return null;
      tokens.push({ type: 'number', value: val });
      continue;
    }

    // Operadores
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      // Detectar menos unario: al inicio, después de '(' o después de operador
      if (ch === '-') {
        const prev = tokens[tokens.length - 1];
        const isUnary = !prev || prev.type === 'lparen' || prev.type === 'op';
        if (isUnary) {
          // Consumir el número siguiente y negarlo
          i++;
          // Saltar espacios
          while (i < expr.length && expr[i] === ' ') i++;

          if (i < expr.length && expr[i] === '(') {
            // -(expr): insertar -1 * (expr)
            tokens.push({ type: 'number', value: -1 });
            tokens.push({ type: 'op', value: '*' });
            continue;
          }

          let num = '';
          while (i < expr.length && /[0-9.]/.test(expr[i])) {
            num += expr[i];
            i++;
          }
          if (!num) return null;
          const val = parseFloat(num);
          if (isNaN(val)) return null;
          tokens.push({ type: 'number', value: -val });
          continue;
        }
      }

      // Plus unario: ignorar
      if (ch === '+') {
        const prev = tokens[tokens.length - 1];
        const isUnary = !prev || prev.type === 'lparen' || prev.type === 'op';
        if (isUnary) { i++; continue; }
      }

      tokens.push({ type: 'op', value: ch as '+' | '-' | '*' | '/' });
      i++;
      continue;
    }

    if (ch === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen' }); i++; continue; }

    // Carácter desconocido
    return null;
  }

  return tokens.length > 0 ? tokens : null;
}

function shuntingYard(tokens: Token[]): Token[] | null {
  const output: Token[] = [];
  const ops: Token[] = [];

  for (const token of tokens) {
    if (token.type === 'number') {
      output.push(token);
    } else if (token.type === 'op') {
      while (ops.length > 0) {
        const top = ops[ops.length - 1];
        if (
          top.type === 'op' &&
          PRECEDENCE[top.value] >= PRECEDENCE[token.value]
        ) {
          output.push(ops.pop()!);
        } else {
          break;
        }
      }
      ops.push(token);
    } else if (token.type === 'lparen') {
      ops.push(token);
    } else if (token.type === 'rparen') {
      while (ops.length > 0 && ops[ops.length - 1].type !== 'lparen') {
        output.push(ops.pop()!);
      }
      if (ops.length === 0) return null; // Paréntesis sin cerrar
      ops.pop(); // Quitar '('
    }
  }

  while (ops.length > 0) {
    const top = ops.pop()!;
    if (top.type === 'lparen') return null; // Paréntesis sin cerrar
    output.push(top);
  }

  return output;
}

function evaluateRPN(tokens: Token[]): number | null {
  const stack: number[] = [];

  for (const token of tokens) {
    if (token.type === 'number') {
      stack.push(token.value);
    } else if (token.type === 'op') {
      if (stack.length < 2) return null;
      const b = stack.pop()!;
      const a = stack.pop()!;
      switch (token.value) {
        case '+': stack.push(a + b); break;
        case '-': stack.push(a - b); break;
        case '*': stack.push(a * b); break;
        case '/':
          if (b === 0) return 0;
          stack.push(a / b);
          break;
      }
    }
  }

  return stack.length === 1 ? stack[0] : null;
}

export function evalMathExpr(expr: string): number {
  // Normalizar: comas → puntos, eliminar caracteres no válidos
  const sanitized = expr.replace(/,/g, '.').replace(/[^0-9+\-*/.() ]/g, '').trim();
  if (!sanitized) return 0;

  const tokens = tokenize(sanitized);
  if (!tokens) return 0;

  const rpn = shuntingYard(tokens);
  if (!rpn) return 0;

  const result = evaluateRPN(rpn);
  return typeof result === 'number' && isFinite(result) ? result : 0;
}
