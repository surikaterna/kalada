import ts from "typescript";

const TRACKED_GLOBALS = new Set([
  "Blob",
  "FileReader",
  "Function",
  "URL",
  "Worker",
  "SharedWorker",
  "caches",
  "document",
  "eval",
  "fetch",
  "globalThis",
  "indexedDB",
  "localStorage",
  "location",
  "navigator",
  "self",
  "sessionStorage",
  "setInterval",
  "setTimeout",
  "window",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
]);
const NODE_GLOBALS = new Set([
  "Buffer",
  "Bun",
  "Deno",
  "__dirname",
  "__filename",
  "exports",
  "global",
  "module",
  "process",
]);
const NETWORK_GLOBALS = new Set([
  "EventSource",
  "SharedWorker",
  "WebSocket",
  "Worker",
  "XMLHttpRequest",
  "fetch",
]);
const NETWORK_MEMBERS = new Set(["sendBeacon", "serviceWorker"]);
const NODE_BUILTINS = new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dgram",
  "dns",
  "fs",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "stream",
  "tls",
  "url",
  "util",
  "worker_threads",
  "zlib",
]);

export interface InventoryCount {
  readonly name: string;
  readonly count: number;
}

export interface JavaScriptInventory {
  readonly imports: readonly InventoryCount[];
  readonly capabilities: readonly InventoryCount[];
  readonly urlLiterals: readonly InventoryCount[];
}

interface ScanState {
  readonly file: ts.SourceFile;
  readonly imports: Map<string, number>;
  readonly capabilities: Map<string, number>;
  readonly urls: Map<string, number>;
  readonly failures: Set<string>;
}

// This inventories bounded syntax in one emitted asset; it is not an alias-flow proof for arbitrary JS.
export function inventoryJavaScript(path: string, source: string): JavaScriptInventory {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error(`Artifact JavaScript parse failed: ${path}`);
  const state: ScanState = {
    file,
    imports: new Map(),
    capabilities: new Map(),
    urls: new Map(),
    failures: new Set(),
  };
  visit(file, state);
  if (state.failures.size) {
    throw new Error(
      `Forbidden observed syntax in ${path}: ${[...state.failures].sort().join("; ")}`,
    );
  }
  return {
    imports: normalizedCounts(state.imports),
    capabilities: normalizedCounts(state.capabilities),
    urlLiterals: normalizedCounts(state.urls),
  };
}

function visit(node: ts.Node, state: ScanState): void {
  if (ts.isStringLiteralLike(node)) inspectUrlLiteral(node.text, state);
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) inspectModuleNode(node, state);
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) inspectInvocation(node, state);
  if (ts.isIdentifier(node)) inspectIdentifier(node, state);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    inspectMember(node, state);
  }
  if (ts.isBinaryExpression(node)) inspectAssignment(node, state);
  ts.forEachChild(node, (child) => visit(child, state));
}

function inspectModuleNode(
  node: ts.ImportDeclaration | ts.ExportDeclaration,
  state: ScanState,
): void {
  const specifier = node.moduleSpecifier;
  if (!specifier) return;
  if (!ts.isStringLiteralLike(specifier)) {
    fail(state, "non-literal static import", node);
    return;
  }
  recordImport("static", specifier.text, node, state);
}

function inspectInvocation(node: ts.CallExpression | ts.NewExpression, state: ScanState): void {
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    inspectDynamicImport(node, state);
    return;
  }
  const path = expressionPath(node.expression);
  const finalName = path?.split(".").at(-1);
  if (path === "eval" || path?.endsWith(".eval")) fail(state, "direct eval", node);
  if (path === "Function" || path?.endsWith(".Function")) fail(state, "direct Function", node);
  if (path === "require") fail(state, "CommonJS require", node);
  if (finalName && NETWORK_GLOBALS.has(finalName)) fail(state, `network API ${finalName}`, node);
  if (finalName && NETWORK_MEMBERS.has(finalName)) fail(state, `network API ${finalName}`, node);
  if (isObviousConstructorChain(node.expression))
    fail(state, "constructor dynamic-code chain", node);
  inspectActiveUrl(node, path, state);
}

function inspectDynamicImport(node: ts.CallExpression, state: ScanState): void {
  const argument = node.arguments[0];
  if (!argument || !ts.isStringLiteralLike(argument)) {
    fail(state, "non-literal dynamic import", node);
    return;
  }
  recordImport("dynamic", argument.text, node, state);
}

function inspectIdentifier(node: ts.Identifier, state: ScanState): void {
  if (!isReferenceIdentifier(node)) return;
  if (TRACKED_GLOBALS.has(node.text)) increment(state.capabilities, `identifier:${node.text}`);
  if (NETWORK_GLOBALS.has(node.text)) fail(state, `network capability ${node.text}`, node);
  if (node.text === "require") fail(state, "CommonJS require reference", node);
  if (!NODE_GLOBALS.has(node.text)) return;
  if (node.text === "process" && ts.isTypeOfExpression(node.parent)) {
    increment(state.capabilities, "node-probe:typeof process");
    return;
  }
  fail(state, `Node/server global ${node.text}`, node);
}

function inspectMember(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  state: ScanState,
): void {
  const name = memberName(node);
  if (!name) return;
  if (NETWORK_MEMBERS.has(name)) fail(state, `network capability ${name}`, node);
  const owner = expressionPath(node.expression);
  if (
    owner &&
    ["global", "globalThis", "self", "window"].includes(owner) &&
    (NODE_GLOBALS.has(name) || ["eval", "Function", "require"].includes(name))
  ) {
    fail(state, `direct host capability ${owner}.${name}`, node);
  }
  if (["createObjectURL", "revokeObjectURL"].includes(name)) {
    increment(state.capabilities, `member:${name}`);
  }
}

function inspectAssignment(node: ts.BinaryExpression, state: ScanState): void {
  if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
  if (!ts.isPropertyAccessExpression(node.left) && !ts.isElementAccessExpression(node.left)) return;
  const name = memberName(node.left) ?? "";
  if (
    NETWORK_GLOBALS.has(name) ||
    NETWORK_MEMBERS.has(name) ||
    ["eval", "Function"].includes(name)
  ) {
    fail(state, `direct capability mutation ${name}`, node);
  }
  if (!["action", "href", "src"].includes(name)) return;
  const literal = literalText(node.right);
  if (literal && isActiveExternalUrl(literal)) fail(state, `active URL ${literal}`, node);
}

function inspectActiveUrl(
  node: ts.CallExpression | ts.NewExpression,
  path: string | undefined,
  state: ScanState,
): void {
  const finalName = path?.split(".").at(-1);
  if (!finalName || !["open", "assign", "replace", "setAttribute"].includes(finalName)) return;
  const index = finalName === "setAttribute" ? 1 : 0;
  const literal = literalText(node.arguments?.[index]);
  if (literal && isActiveExternalUrl(literal) && literal !== "/kalada/") {
    fail(state, `active URL ${literal}`, node);
  }
}

function recordImport(
  kind: "dynamic" | "static",
  specifier: string,
  node: ts.Node,
  state: ScanState,
) {
  increment(state.imports, `${kind}:${specifier}`);
  if (!/^\.\/[A-Za-z0-9_.-]+\.js$/u.test(specifier)) {
    const reason = isNodeBuiltin(specifier) ? "Node builtin import" : "non-bundled import";
    fail(state, `${reason} ${specifier}`, node);
  }
}

function inspectUrlLiteral(value: string, state: ScanState): void {
  if (value === "/kalada/") increment(state.urls, `base:${value}`);
  else if (/^(?:https?|wss?):\/\//u.test(value)) increment(state.urls, `foreign:${value}`);
  else if (value.startsWith("/")) increment(state.urls, `root:${value}`);
}

function isObviousConstructorChain(expression: ts.Expression): boolean {
  const value = unwrap(expression);
  if (!ts.isPropertyAccessExpression(value) && !ts.isElementAccessExpression(value)) return false;
  if (memberName(value) !== "constructor") return false;
  const owner = unwrap(value.expression);
  if (memberName(owner) === "constructor") return true;
  if (ts.isIdentifier(owner)) return owner.text === "Function" || owner.text === "Object";
  return (
    ts.isArrowFunction(owner) ||
    ts.isFunctionExpression(owner) ||
    ts.isObjectLiteralExpression(owner) ||
    ts.isClassExpression(owner)
  );
}

function expressionPath(expression: ts.Expression): string | undefined {
  const value = unwrap(expression);
  if (ts.isIdentifier(value)) return value.text;
  if (!ts.isPropertyAccessExpression(value) && !ts.isElementAccessExpression(value))
    return undefined;
  const owner = expressionPath(value.expression);
  const name = memberName(value);
  return owner && name ? `${owner}.${name}` : undefined;
}

function memberName(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression | ts.Expression,
): string | undefined {
  const value = unwrap(node);
  if (ts.isPropertyAccessExpression(value)) return value.name.text;
  if (ts.isElementAccessExpression(value) && ts.isStringLiteralLike(value.argumentExpression)) {
    return value.argumentExpression.text;
  }
  return undefined;
}

function isReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  return !(
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node)
  );
}

function literalText(node: ts.Expression | undefined): string | undefined {
  const value = node && unwrap(node);
  return value && ts.isStringLiteralLike(value) ? value.text : undefined;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let value = expression;
  while (ts.isParenthesizedExpression(value) || ts.isNonNullExpression(value))
    value = value.expression;
  return value;
}

function isNodeBuiltin(specifier: string): boolean {
  const name = specifier.replace(/^node:/u, "").split("/")[0] ?? "";
  return specifier.startsWith("node:") || NODE_BUILTINS.has(name);
}

function isActiveExternalUrl(value: string): boolean {
  return value.startsWith("/") || /^(?:https?|wss?):\/\//u.test(value);
}

function fail(state: ScanState, reason: string, node: ts.Node): void {
  const position = state.file.getLineAndCharacterOfPosition(node.getStart(state.file));
  state.failures.add(`${reason} at ${position.line + 1}:${position.character + 1}`);
}

function increment(values: Map<string, number>, name: string): void {
  values.set(name, (values.get(name) ?? 0) + 1);
}

function normalizedCounts(values: ReadonlyMap<string, number>): InventoryCount[] {
  return [...values]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => ({ name, count }));
}
