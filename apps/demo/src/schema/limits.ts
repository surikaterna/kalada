export const DEMO_LIMITS = Object.freeze({
  schemaText: 64 * 1024,
  expressionText: 64 * 1024,
  dataText: 256 * 1024,
  transferText: 1024 * 1024,
  jsonDepth: 32,
  schemaNodes: 512,
  schemaEdges: 2048,
  branches: 8,
  collectionEntries: 128,
  dataNodes: 4096,
  stringValue: 4096,
  validationWork: 1_000_000,
  expressionDocuments: 16,
});

export type JsonLimitKind = "schema" | "data" | "transfer";

export class BoundedJsonError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "BoundedJsonError";
    this.code = code;
  }
}

export function parseBoundedJson(text: string, kind: JsonLimitKind): unknown {
  const limit = textLimit(kind);
  if (text.length > limit) throw new BoundedJsonError("JSON_TEXT_LIMIT");
  scanJsonDepth(text);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BoundedJsonError("JSON_SYNTAX");
  }
  inspectJson(value, kind);
  return value;
}

export function inspectJson(value: unknown, kind: JsonLimitKind): JsonMeasurement {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  let depth = 0;
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    nodes += 1;
    depth = Math.max(depth, entry.depth);
    checkJsonEntry(entry.value, entry.depth, nodes, kind);
    if (entry.value && typeof entry.value === "object") {
      pushChildren(stack, entry.value, entry.depth + 1);
    }
  }
  return Object.freeze({ nodes, depth });
}

export interface JsonMeasurement {
  readonly nodes: number;
  readonly depth: number;
}

function textLimit(kind: JsonLimitKind): number {
  if (kind === "schema") return DEMO_LIMITS.schemaText;
  if (kind === "data") return DEMO_LIMITS.dataText;
  return DEMO_LIMITS.transferText;
}

function scanJsonDepth(text: string): void {
  let depth = 0;
  let string = false;
  let escaped = false;
  for (const character of text) {
    if (string) {
      const state = stringState(character, escaped);
      string = state.string;
      escaped = state.escaped;
      continue;
    }
    if (character === '"') {
      string = true;
      continue;
    }
    depth = nextDepth(character, depth);
    if (depth > DEMO_LIMITS.jsonDepth || depth < 0) throw new BoundedJsonError("JSON_DEPTH_LIMIT");
  }
}

function stringState(character: string, escaped: boolean) {
  if (escaped) return { string: true, escaped: false };
  if (character === "\\") return { string: true, escaped: true };
  return { string: character !== '"', escaped: false };
}

function nextDepth(character: string, depth: number): number {
  if (character === "{" || character === "[") return depth + 1;
  if (character === "}" || character === "]") return depth - 1;
  return depth;
}

function checkJsonEntry(value: unknown, depth: number, nodes: number, kind: JsonLimitKind): void {
  if (depth > DEMO_LIMITS.jsonDepth) throw new BoundedJsonError("JSON_DEPTH_LIMIT");
  if (nodes > DEMO_LIMITS.dataNodes) throw new BoundedJsonError("JSON_NODE_LIMIT");
  if (typeof value === "string" && value.length > DEMO_LIMITS.stringValue) {
    throw new BoundedJsonError("JSON_STRING_LIMIT");
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new BoundedJsonError("JSON_NONFINITE_NUMBER");
  }
  if (kind === "schema" && Array.isArray(value) && value.length > DEMO_LIMITS.collectionEntries) {
    throw new BoundedJsonError("JSON_COLLECTION_LIMIT");
  }
}

function pushChildren(
  stack: Array<{ value: unknown; depth: number }>,
  value: object,
  depth: number,
): void {
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  if (entries.length > DEMO_LIMITS.collectionEntries) {
    throw new BoundedJsonError("JSON_COLLECTION_LIMIT");
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (dangerousKey(entry[0])) throw new BoundedJsonError("JSON_RESERVED_KEY");
    stack.push({ value: entry[1], depth });
  }
}

function dangerousKey(key: string): boolean {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}
