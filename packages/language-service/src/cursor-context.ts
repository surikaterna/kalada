import type {
  KaladaCstNode,
  KaladaFieldAccessCstNode,
  KaladaParseResult,
  KaladaSourceRange,
  KaladaToken,
} from "@kalada/syntax";

export interface ShapePath {
  readonly bindingName: string;
  readonly segments: readonly string[];
}

export type CompletionContext =
  | Readonly<{ kind: "binding"; range: KaladaSourceRange }>
  | Readonly<{
      kind: "property";
      range: KaladaSourceRange;
      paths: readonly ShapePath[];
      optional: boolean;
      target: KaladaCstNode;
    }>
  | Readonly<{ kind: "operator"; range: KaladaSourceRange; node: KaladaCstNode }>
  | Readonly<{ kind: "none" }>;

export interface HoverContext {
  readonly token: KaladaToken;
  readonly node: KaladaCstNode;
  readonly paths: readonly ShapePath[];
  readonly access: "plain" | "optional" | "none";
}

export function completionContext(parsed: KaladaParseResult, offset: number): CompletionContext {
  if (splitSurrogate(parsed.document.source, offset) || suppressedToken(parsed, offset)) {
    return { kind: "none" };
  }
  const field = completionField(parsed, offset);
  if (field) {
    const paths = shapePaths(field.target);
    if (paths.length === 0) return { kind: "none" };
    return {
      kind: "property",
      range: fieldRange(parsed, field, offset),
      paths,
      optional: field.optional,
      target: field.target,
    };
  }
  const reference = narrowestNode(parsed.document.expression, offset, "reference");
  if (reference?.kind === "reference") return { kind: "binding", range: reference.range };
  if (bindingPosition(parsed, offset))
    return { kind: "binding", range: { start: offset, end: offset } };
  const node =
    narrowestNode(parsed.document.expression, offset) ??
    (parsed.document.expression.range.end <= offset ? parsed.document.expression : null);
  if (
    parsed.diagnostics.length === 0 &&
    node &&
    operatorPosition(parsed.document.source, node, offset)
  ) {
    return { kind: "operator", range: { start: offset, end: offset }, node };
  }
  return { kind: "none" };
}

export function hoverContext(parsed: KaladaParseResult, offset: number): HoverContext | null {
  const token = tokenAt(parsed, offset);
  if (!token || !hoverableToken(token)) {
    return null;
  }
  const node = narrowestNode(parsed.document.expression, token.range.start);
  if (!node) return null;
  const tokenIndex = parsed.document.tokens.indexOf(token);
  const field = fieldForToken(parsed.document.expression, tokenIndex);
  if (field) {
    return {
      token,
      node: field,
      paths: shapePaths(field),
      access: field.optional ? "optional" : "plain",
    };
  }
  return { token, node, paths: shapePaths(node), access: "none" };
}

export function shapePaths(node: KaladaCstNode): readonly ShapePath[] {
  if (node.kind === "reference") return [{ bindingName: node.name, segments: [] }];
  if (node.kind === "group") return shapePaths(node.expression);
  if (node.kind === "field-access" && node.field !== null) {
    return shapePaths(node.target).map((path) => ({
      bindingName: path.bindingName,
      segments: [...path.segments, node.field as string],
    }));
  }
  if (node.kind === "conditional") return [...shapePaths(node.then), ...shapePaths(node.else)];
  return [];
}

export function narrowestNode(
  root: KaladaCstNode,
  offset: number,
  kind?: KaladaCstNode["kind"],
): KaladaCstNode | null {
  let found: KaladaCstNode | null = null;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || !contains(node.range, offset)) continue;
    if ((!kind || node.kind === kind) && narrower(node, found)) found = node;
    stack.push(...children(node));
  }
  return found;
}

function completionField(
  parsed: KaladaParseResult,
  offset: number,
): KaladaFieldAccessCstNode | null {
  const fields = allNodes(parsed.document.expression).filter(
    (node): node is KaladaFieldAccessCstNode => node.kind === "field-access",
  );
  const matches = fields.filter((field) => fieldMatches(parsed, field, offset));
  return matches.sort((left, right) => rangeWidth(left.range) - rangeWidth(right.range))[0] ?? null;
}

function fieldMatches(
  parsed: KaladaParseResult,
  field: KaladaFieldAccessCstNode,
  offset: number,
): boolean {
  if (field.fieldToken !== null) {
    const token = parsed.document.tokens[field.fieldToken];
    return token ? contains(token.range, offset) : false;
  }
  const operator = parsed.document.tokens[field.operatorToken];
  if (!operator || offset < operator.range.end) return false;
  return /^[^\S\r\n]*$/u.test(parsed.document.source.slice(operator.range.end, offset));
}

function fieldRange(
  parsed: KaladaParseResult,
  field: KaladaFieldAccessCstNode,
  offset: number,
): KaladaSourceRange {
  if (field.fieldToken === null) return { start: offset, end: offset };
  return parsed.document.tokens[field.fieldToken]?.range ?? { start: offset, end: offset };
}

function bindingPosition(parsed: KaladaParseResult, offset: number): boolean {
  const source = parsed.document.source;
  if (source.length === 0) return offset === 0;
  const before = source.slice(0, offset);
  const after = source.slice(offset);
  return before.trim().length === 0 && after.trim().length === 0;
}

function operatorPosition(source: string, node: KaladaCstNode, offset: number): boolean {
  if (node.kind === "error" || offset < node.range.end) return false;
  return (
    source.slice(node.range.end, offset).trim().length === 0 &&
    source.slice(offset).trim().length === 0
  );
}

function suppressedToken(parsed: KaladaParseResult, offset: number): boolean {
  const token = tokenAt(parsed, offset);
  return token ? ["string", "unsupported", "invalid"].includes(token.kind) : false;
}

function tokenAt(parsed: KaladaParseResult, offset: number): KaladaToken | null {
  const tokens = parsed.document.tokens.filter(
    ({ kind }) => kind !== "whitespace" && kind !== "eof",
  );
  const starting = tokens.find(({ range }) => range.start === offset && range.end > offset);
  if (starting) return starting;
  const containing = tokens.find(({ range }) => range.start < offset && offset < range.end);
  if (containing) return containing;
  return tokens.findLast(({ range }) => range.end === offset && range.start < range.end) ?? null;
}

function fieldForToken(root: KaladaCstNode, tokenIndex: number): KaladaFieldAccessCstNode | null {
  const fields = allNodes(root).filter(
    (node): node is KaladaFieldAccessCstNode => node.kind === "field-access",
  );
  return (
    fields
      .filter(({ fieldToken }) => fieldToken === tokenIndex)
      .sort((left, right) => rangeWidth(left.range) - rangeWidth(right.range))[0] ?? null
  );
}

function hoverableToken(token: KaladaToken): boolean {
  return ["identifier", "number", "true", "false", "null", "in", "xor"].includes(token.kind);
}

function allNodes(root: KaladaCstNode): KaladaCstNode[] {
  const output: KaladaCstNode[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    output.push(node);
    stack.push(...children(node));
  }
  return output;
}

function children(node: KaladaCstNode): KaladaCstNode[] {
  if (node.kind === "group") return [node.expression];
  if (node.kind === "field-access") return [node.target];
  if (node.kind === "unary") return [node.operand];
  if (node.kind === "binary") return [node.left, node.right];
  if (node.kind === "conditional") return [node.condition, node.then, node.else];
  return [];
}

function splitSurrogate(source: string, offset: number): boolean {
  const previous = source.charCodeAt(offset - 1);
  const next = source.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

function contains(range: KaladaSourceRange, offset: number): boolean {
  return range.start <= offset && offset <= range.end;
}

function narrower(node: KaladaCstNode, current: KaladaCstNode | null): boolean {
  return !current || rangeWidth(node.range) < rangeWidth(current.range);
}

function rangeWidth(range: KaladaSourceRange): number {
  return range.end - range.start;
}
