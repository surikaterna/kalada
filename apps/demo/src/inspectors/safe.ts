const LIMITS = Object.freeze({ depth: 32, nodes: 4096, text: 256 * 1024 });

export function safeValue(value: unknown): unknown {
  const seen = new Map<object, number>();
  let nodes = 0;
  const visit = (input: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > LIMITS.nodes || depth > LIMITS.depth) return Object.freeze({ type: "truncated" });
    const primitive = safePrimitive(input);
    if (primitive.matched) return primitive.value;
    if (typeof input !== "object") return Object.freeze({ type: "unsupported" });
    return safeObject(input as object, depth, seen, visit);
  };
  return visit(value, 0);
}

function safeObject(
  input: object,
  depth: number,
  seen: Map<object, number>,
  visit: (value: unknown, depth: number) => unknown,
): unknown {
  const known = seen.get(input);
  if (known !== undefined) return Object.freeze({ type: "reference", id: known });
  seen.set(input, seen.size + 1);
  if (Array.isArray(input))
    return Object.freeze(input.slice(0, 128).map((item) => visit(item, depth + 1)));
  if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
    return Object.freeze({ type: "unsupported" });
  const output: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(input).sort().slice(0, 128)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    output[key] =
      descriptor && "value" in descriptor
        ? visit(descriptor.value, depth + 1)
        : Object.freeze({ type: "accessor-redacted" });
  }
  return Object.freeze(output);
}

function safePrimitive(input: unknown): { matched: boolean; value?: unknown } {
  if (input === undefined) return { matched: true, value: Object.freeze({ type: "undefined" }) };
  if (typeof input === "bigint")
    return { matched: true, value: Object.freeze({ type: "bigint", decimal: String(input) }) };
  if (typeof input === "number" && !Number.isFinite(input))
    return { matched: true, value: Object.freeze({ type: "nonfinite" }) };
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "number" ||
    typeof input === "boolean"
  )
    return { matched: true, value: input };
  return { matched: false };
}

export function safeJson(value: unknown): string {
  const text = JSON.stringify(safeValue(value), null, 2);
  if (text.length <= LIMITS.text) return text;
  return `${text.slice(0, LIMITS.text - 32)}\n{"type":"text-truncated"}`;
}
