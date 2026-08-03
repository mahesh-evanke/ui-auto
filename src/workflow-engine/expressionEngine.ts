/**
 * Expression engine: evaluates the small expression language used inside
 * mappings/transforms - string concatenation, math, comparisons, boolean
 * logic, a handful of built-in functions, and {{path}} / ${value} template
 * interpolation. Deliberately NOT a general-purpose scripting language (no
 * loops, no assignment, no user-defined functions) - keeps it safe to run
 * against untrusted workflow definitions and easy to reason about.
 *
 * Grammar (highest to lowest precedence):
 *   primary    := NUMBER | STRING | TRUE | FALSE | NULL | IDENT | IDENT '(' args ')' | '(' expr ')'
 *   unary      := ('!' | '-') unary | primary
 *   multiplicative := unary (('*' | '/') unary)*
 *   additive   := multiplicative (('+' | '-') multiplicative)*
 *   comparison := additive (('==' | '!=' | '<' | '<=' | '>' | '>=') additive)*
 *   logical    := comparison (('&&' | '||') comparison)*
 *   expr       := logical
 */
import type { JsonValue } from './types';
import { getByPath } from './pathResolver';

export class ExpressionError extends Error {
  constructor(message: string, public readonly expression: string) {
    super(`Expression error in "${expression}": ${message}`);
    this.name = 'ExpressionError';
  }
}

/** Resolves a dotted identifier (e.g. "step1.response.user.id") to a value, or throws if unresolvable. */
export type IdentifierResolver = (identifier: string) => JsonValue | undefined;

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' }
  | { kind: 'eof' };

const OPERATORS = ['==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '<', '>', '!'];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ kind: 'lparen' });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ kind: 'rparen' });
      i++;
      continue;
    }
    if (c === ',') {
      tokens.push({ kind: 'comma' });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let str = '';
      while (j < src.length && src[j] !== quote) {
        str += src[j] === '\\' && src[j + 1] === quote ? (j++, quote) : src[j];
        j++;
      }
      tokens.push({ kind: 'str', value: str });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ kind: 'num', value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.$[\]]/.test(src[j])) j++;
      tokens.push({ kind: 'ident', value: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPERATORS.includes(two)) {
      tokens.push({ kind: 'op', value: two });
      i += 2;
      continue;
    }
    if (OPERATORS.includes(c)) {
      tokens.push({ kind: 'op', value: c });
      i++;
      continue;
    }
    throw new ExpressionError(`Unexpected character "${c}" at position ${i}`, src);
  }
  tokens.push({ kind: 'eof' });
  return tokens;
}

const BUILTINS: Record<string, (...args: JsonValue[]) => JsonValue> = {
  today: () => new Date().toISOString().slice(0, 10),
  now: () => new Date().toISOString(),
  concat: (...args) => args.map((a) => (a === null || a === undefined ? '' : String(a))).join(''),
  upper: (s: JsonValue) => String(s).toUpperCase(),
  lower: (s: JsonValue) => String(s).toLowerCase(),
  toNumber: (s: JsonValue) => Number(s),
  toString: (s: JsonValue) => String(s),
  if: (cond: JsonValue, a: JsonValue, b: JsonValue) => (cond ? a : b),
};

class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private resolve: IdentifierResolver, private src: string) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private next(): Token {
    return this.tokens[this.pos++];
  }
  private error(msg: string): never {
    throw new ExpressionError(msg, this.src);
  }

  parseExpression(): JsonValue {
    const value = this.logical();
    if (this.peek().kind !== 'eof') this.error(`Unexpected trailing token near position ${this.pos}`);
    return value;
  }

  private logical(): JsonValue {
    let left = this.comparison();
    while (this.peek().kind === 'op' && (this.peek() as any).value === '&&') {
      this.next();
      const right = this.comparison();
      left = Boolean(left) && Boolean(right);
    }
    while (this.peek().kind === 'op' && (this.peek() as any).value === '||') {
      this.next();
      const right = this.comparison();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  private comparison(): JsonValue {
    let left = this.additive();
    const cmpOps = ['==', '!=', '<', '<=', '>', '>='];
    while (this.peek().kind === 'op' && cmpOps.includes((this.peek() as any).value)) {
      const op = (this.next() as any).value;
      const right = this.additive();
      switch (op) {
        case '==':
          left = left === right;
          break;
        case '!=':
          left = left !== right;
          break;
        case '<':
          left = (left as any) < (right as any);
          break;
        case '<=':
          left = (left as any) <= (right as any);
          break;
        case '>':
          left = (left as any) > (right as any);
          break;
        case '>=':
          left = (left as any) >= (right as any);
          break;
      }
    }
    return left;
  }

  private additive(): JsonValue {
    let left = this.multiplicative();
    while (this.peek().kind === 'op' && ['+', '-'].includes((this.peek() as any).value)) {
      const op = (this.next() as any).value;
      const right = this.multiplicative();
      if (op === '+') {
        left = typeof left === 'string' || typeof right === 'string' ? `${left ?? ''}${right ?? ''}` : (left as number) + (right as number);
      } else {
        left = (left as number) - (right as number);
      }
    }
    return left;
  }

  private multiplicative(): JsonValue {
    let left = this.unary();
    while (this.peek().kind === 'op' && ['*', '/'].includes((this.peek() as any).value)) {
      const op = (this.next() as any).value;
      const right = this.unary();
      left = op === '*' ? (left as number) * (right as number) : (left as number) / (right as number);
    }
    return left;
  }

  private unary(): JsonValue {
    if (this.peek().kind === 'op' && ((this.peek() as any).value === '!' || (this.peek() as any).value === '-')) {
      const op = (this.next() as any).value;
      const value = this.unary();
      return op === '!' ? !value : -(value as number);
    }
    return this.primary();
  }

  private primary(): JsonValue {
    const tok = this.next();
    if (tok.kind === 'num') return tok.value;
    if (tok.kind === 'str') return tok.value;
    if (tok.kind === 'lparen') {
      const value = this.logical();
      if (this.peek().kind !== 'rparen') this.error('Expected closing ")"');
      this.next();
      return value;
    }
    if (tok.kind === 'ident') {
      if (tok.value === 'true') return true;
      if (tok.value === 'false') return false;
      if (tok.value === 'null') return null;

      if (this.peek().kind === 'lparen') {
        this.next();
        const args: JsonValue[] = [];
        if (this.peek().kind !== 'rparen') {
          args.push(this.logical());
          while (this.peek().kind === 'comma') {
            this.next();
            args.push(this.logical());
          }
        }
        if (this.peek().kind !== 'rparen') this.error('Expected closing ")" after function args');
        this.next();
        const fn = BUILTINS[tok.value];
        if (!fn) this.error(`Unknown function "${tok.value}"`);
        return fn(...args);
      }

      const resolved = this.resolve(tok.value);
      if (resolved === undefined) this.error(`Unresolved reference "${tok.value}"`);
      return resolved;
    }
    this.error('Unexpected token');
  }
}

/** Evaluates a full expression string (no {{ }} wrapper) against a resolver, e.g. "price * quantity" or 'if(status=="ACTIVE","a","b")'. */
export function evaluateExpression(expression: string, resolve: IdentifierResolver): JsonValue {
  const tokens = tokenize(expression);
  return new Parser(tokens, resolve, expression).parseExpression();
}

/**
 * Resolves a template string containing zero or more {{expression}} tokens,
 * e.g. "{{step1.response.firstName}} {{step1.response.lastName}}" or
 * "Bearer {{step1.response.accessToken}}". A template that is EXACTLY one
 * {{...}} token (nothing else around it) returns the raw resolved value
 * (preserving its type - number/boolean/object) instead of stringifying it;
 * anything with surrounding text is string-interpolated.
 */
export function resolveTemplate(template: string, resolve: IdentifierResolver): JsonValue {
  const tokenRe = /\{\{\s*([^}]+?)\s*\}\}/g;
  const matches = [...template.matchAll(tokenRe)];
  if (matches.length === 1 && matches[0][0] === template.trim()) {
    return evaluateExpression(matches[0][1], resolve);
  }
  return template.replace(tokenRe, (_full, expr) => {
    const value = evaluateExpression(expr, resolve);
    return value === null || value === undefined ? '' : String(value);
  });
}

/**
 * Resolves the `${value}` shorthand used by simple transforms, e.g.
 * mapping.transform = "Bearer ${value}" where `value` is the single already-
 * resolved source value (no path lookup needed for it).
 */
export function applyValueTemplate(template: string, value: JsonValue | undefined): string {
  return template.replace(/\$\{\s*value\s*\}/g, value === null || value === undefined ? '' : String(value));
}
