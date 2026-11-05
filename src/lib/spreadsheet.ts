export type SpreadsheetCells = Record<string, string>;

export type CellResult = {
  raw: string;
  value: number | null;
  display: string;
  error: string | null;
  isFormula: boolean;
};

export function columnLabel(index: number): string {
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

export function parseRef(ref: string): { row: number; col: number } | null {
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(ref.toUpperCase());
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(match[2]) - 1, col: col - 1 };
}

type Token =
  | { type: "num"; value: number }
  | { type: "word"; value: string }
  | { type: "op"; value: string }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "comma" }
  | { type: "colon" }
  | { type: "eof" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t") { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j += 1;
      tokens.push({ type: "num", value: Number(input.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9]/.test(input[j])) j += 1;
      tokens.push({ type: "word", value: input.slice(i, j).toUpperCase() });
      i = j;
      continue;
    }
    if ("+-*/".includes(ch)) { tokens.push({ type: "op", value: ch }); i += 1; continue; }
    if (ch === "(") { tokens.push({ type: "lparen" }); i += 1; continue; }
    if (ch === ")") { tokens.push({ type: "rparen" }); i += 1; continue; }
    if (ch === ",") { tokens.push({ type: "comma" }); i += 1; continue; }
    if (ch === ":") { tokens.push({ type: "colon" }); i += 1; continue; }
    if (ch === "^") { tokens.push({ type: "op", value: "^" }); i += 1; continue; }
    throw new Error(`Unexpected character "${ch}"`);
  }
  tokens.push({ type: "eof" });
  return tokens;
}

type Node =
  | { t: "num"; v: number }
  | { t: "ref"; ref: string }
  | { t: "range"; a: string; b: string }
  | { t: "fn"; name: string; args: Node[] }
  | { t: "bin"; op: string; l: Node; r: Node }
  | { t: "neg"; x: Node };

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.pos]; }
  private next(): Token { return this.tokens[this.pos++]; }

  parse(): Node {
    const node = this.expression();
    if (this.peek().type !== "eof") throw new Error("Unexpected trailing input");
    return node;
  }

  private expression(): Node {
    let node = this.term();
    while (this.peek().type === "op" && "+-".includes((this.peek() as { value: string }).value)) {
      const op = (this.next() as { value: string }).value;
      node = { t: "bin", op, l: node, r: this.term() };
    }
    return node;
  }

  private term(): Node {
    let node = this.factor();
    while (this.peek().type === "op" && "*/^".includes((this.peek() as { value: string }).value)) {
      const op = (this.next() as { value: string }).value;
      node = { t: "bin", op, l: node, r: this.factor() };
    }
    return node;
  }

  private factor(): Node {
    const tok = this.peek();
    if (tok.type === "op" && (tok.value === "-" || tok.value === "+")) {
      this.next();
      const inner = this.factor();
      return tok.value === "-" ? { t: "neg", x: inner } : inner;
    }
    return this.primary();
  }

  private primary(): Node {
    const tok = this.next();
    if (tok.type === "num") return { t: "num", v: tok.value };
    if (tok.type === "lparen") {
      const inner = this.expression();
      if (this.next().type !== "rparen") throw new Error("Missing )");
      return inner;
    }
    if (tok.type === "word") {
      const isRef = /^[A-Z]+[1-9]\d*$/.test(tok.value);
      if (isRef) {
        if (this.peek().type === "colon") {
          this.next();
          const end = this.next();
          if (end.type !== "word") throw new Error("Bad range");
          return { t: "range", a: tok.value, b: end.value };
        }
        return { t: "ref", ref: tok.value };
      }
      if (this.peek().type === "lparen") {
        this.next();
        const args: Node[] = [];
        if (this.peek().type !== "rparen") {
          args.push(this.expression());
          while (this.peek().type === "comma") {
            this.next();
            args.push(this.expression());
          }
        }
        if (this.next().type !== "rparen") throw new Error("Missing ) for function");
        return { t: "fn", name: tok.value, args };
      }
      throw new Error(`Unknown name "${tok.value}"`);
    }
    throw new Error("Unexpected token");
  }
}

function rangeRefs(a: string, b: string): string[] {
  const start = parseRef(a);
  const end = parseRef(b);
  if (!start || !end) throw new Error("Bad range");
  const refs: string[] = [];
  for (let r = Math.min(start.row, end.row); r <= Math.max(start.row, end.row); r += 1) {
    for (let c = Math.min(start.col, end.col); c <= Math.max(start.col, end.col); c += 1) {
      refs.push(`${columnLabel(c)}${r + 1}`);
    }
  }
  return refs;
}

const FUNCTIONS: Record<string, (values: number[]) => number> = {
  SUM: (v) => v.reduce((a, b) => a + b, 0),
  AVERAGE: (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0),
  AVG: (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0),
  MIN: (v) => (v.length ? Math.min(...v) : 0),
  MAX: (v) => (v.length ? Math.max(...v) : 0),
  COUNT: (v) => v.length,
};

function evalNode(
  node: Node,
  resolve: (ref: string) => number,
  collect: (ref: string) => number | null,
): number {
  switch (node.t) {
    case "num":
      return node.v;
    case "neg":
      return -evalNode(node.x, resolve, collect);
    case "ref":
      return resolve(node.ref);
    case "range":
      throw new Error("Range only valid inside a function");
    case "bin": {
      const l = evalNode(node.l, resolve, collect);
      const r = evalNode(node.r, resolve, collect);
      switch (node.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": return r === 0 ? Number.NaN : l / r;
        case "^": return l ** r;
        default: throw new Error("Bad operator");
      }
    }
    case "fn": {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new Error(`Unknown function ${node.name}`);
      const values: number[] = [];
      for (const arg of node.args) {
        if (arg.t === "range") {
          for (const ref of rangeRefs(arg.a, arg.b)) {
            const v = collect(ref);
            if (v !== null && !Number.isNaN(v)) values.push(v);
          }
        } else {
          const v = evalNode(arg, resolve, collect);
          if (!Number.isNaN(v)) values.push(v);
        }
      }
      return fn(values);
    }
  }
}

function resolveNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

export function calculateSheet(cells: SpreadsheetCells): Record<string, CellResult> {
  const results: Record<string, CellResult> = {};
  const cache = new Map<string, number>();

  const resolveCell = (ref: string, stack: Set<string>): number => {
    const key = ref.toUpperCase();
    if (cache.has(key)) return cache.get(key) as number;
    if (stack.has(key)) throw new Error("#CYCLE");
    const raw = cells[key];
    if (raw === undefined || raw.trim() === "") return 0;
    if (raw.trim().startsWith("=")) {
      stack.add(key);
      try {
        const ast = new Parser(tokenize(raw.slice(1))).parse();
        const value = evalNode(
          ast,
          (r) => resolveCell(r, stack),
          (r) => {
            try { return resolveCell(r, stack); } catch { return null; }
          },
        );
        stack.delete(key);
        cache.set(key, value);
        return value;
      } catch (error) {
        stack.delete(key);
        if (error instanceof Error && error.message === "#CYCLE") throw error;
        throw new Error("#ERROR");
      }
    }
    const n = resolveNumber(raw);
    if (n === null) return 0;
    cache.set(key, n);
    return n;
  };

  for (const [ref, raw] of Object.entries(cells)) {
    const isFormula = raw.trim().startsWith("=");
    try {
      if (isFormula) {
        const value = resolveCell(ref, new Set());
        results[ref] = {
          raw,
          value,
          display: Number.isFinite(value) ? String(Number(value.toFixed(6))) : "#ERROR",
          error: Number.isFinite(value) ? null : "#ERROR",
          isFormula,
        };
      } else {
        const value = resolveNumber(raw);
        results[ref] = { raw, value, display: raw, error: null, isFormula };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "#ERROR";
      results[ref] = { raw, value: null, display: message, error: message, isFormula };
    }
  }
  return results;
}

export function createSheet(rows = 20, cols = 8): { rows: number; cols: number; cells: SpreadsheetCells } {
  return { rows, cols, cells: {} };
}

export function toCsv(rows: number, cols: number, cells: SpreadsheetCells, results: Record<string, CellResult>): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    const cellsRow: string[] = [];
    for (let c = 0; c < cols; c += 1) {
      const id = `${columnLabel(c)}${r + 1}`;
      const result = results[id];
      const raw = cells[id] ?? "";
      const value = result && result.isFormula ? result.display : raw;
      cellsRow.push(/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    }
    lines.push(cellsRow.join(","));
  }
  return lines.join("\n");
}

export function parseCsv(text: string): SpreadsheetCells {
  const cells: SpreadsheetCells = {};
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else { field += ch; }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);
  rows.forEach((values, r) => {
    values.forEach((value, c) => {
      if (value !== "") cells[`${columnLabel(c)}${r + 1}`] = value;
    });
  });
  return cells;
}
