import { KaladaFailure } from "./diagnostics.js";
import type { JsonValue } from "./json.js";
import type { ResolvedKaladaV1Limits } from "./limits.js";
import { checkKaladaV1Types } from "./static-types.js";
import type { KaladaV1Expression, KaladaV1FunctionCapture } from "./types.js";

type Path = readonly (string | number)[];
type Names = ReadonlySet<string>;

interface AnalysisState {
  readonly limits: ResolvedKaladaV1Limits;
  readonly functions: KaladaV1FunctionCapture[];
}

export function analyzeKaladaV1Functions<R extends JsonValue>(
  expression: KaladaV1Expression<R>,
  limits: ResolvedKaladaV1Limits,
): readonly KaladaV1FunctionCapture[] {
  const state: AnalysisState = { limits, functions: [] };
  scan(expression, ["expression"], new Set(), state);
  checkKaladaV1Types(expression);
  return Object.freeze(state.functions);
}

function scan<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  path: Path,
  scope: Names,
  state: AnalysisState,
): void {
  if (node.kind === "function") {
    const parameters = node.parameters.map((item) => item.name);
    record(path, null, collectCaptures(node.body, scope, new Set(parameters)), state);
    scan(node.body, [...path, "body"], extendedMany(scope, parameters), state);
    return;
  }
  if (node.kind === "function-group") {
    scanGroup(node, path, scope, state);
    return;
  }
  scanChildren(node, path, scope, state);
}

function scanGroup<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "function-group" }>,
  path: Path,
  scope: Names,
  state: AnalysisState,
): void {
  const names = node.functions.map((item) => item.name);
  const groupScope = extendedMany(scope, names);
  node.functions.forEach((fn, index) => {
    const memberPath = [...path, "functions", index];
    const parameters = fn.parameters.map((item) => item.name);
    const locals = new Set([...names, ...parameters]);
    record(memberPath, fn.name, collectCaptures(fn.body, scope, locals), state);
    scan(fn.body, [...memberPath, "body"], extendedMany(groupScope, parameters), state);
  });
  scan(node.body, [...path, "body"], groupScope, state);
}

function scanChildren<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  path: Path,
  scope: Names,
  state: AnalysisState,
): void {
  if (isLeaf(node)) return;
  if (node.kind === "binding") {
    scan(node.value, [...path, "value"], scope, state);
    scan(node.body, [...path, "body"], extended(scope, node.name), state);
    return;
  }
  if (node.kind === "call") {
    scan(node.callee, [...path, "callee"], scope, state);
    node.arguments.forEach((item, index) => {
      scan(item, [...path, "arguments", index], scope, state);
    });
    return;
  }
  const single = singleChild(node);
  if (single) {
    scan(single[0], [...path, single[1]], scope, state);
    return;
  }
  if (node.kind === "membership") {
    scan(node.needle, [...path, "needle"], scope, state);
    scan(node.array, [...path, "array"], scope, state);
    return;
  }
  if (node.kind === "match") {
    scanMatch(node, path, scope, state);
    return;
  }
  if (isBinary(node)) {
    scan(node.left, [...path, "left"], scope, state);
    scan(node.right, [...path, "right"], scope, state);
    return;
  }
  if (node.kind === "option" && node.variant === "some")
    scan(node.value, [...path, "value"], scope, state);
  if (node.kind === "result") scan(node.value, [...path, "value"], scope, state);
}

function scanMatch<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "match" }>,
  path: Path,
  scope: Names,
  state: AnalysisState,
): void {
  scan(node.value, [...path, "value"], scope, state);
  node.arms.forEach((arm, index) => {
    const armScope = arm.binding ? extended(scope, arm.binding) : scope;
    scan(arm.body, [...path, "arms", index, "body"], armScope, state);
  });
}

function collectCaptures<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  outer: Names,
  locals: Names,
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  visitReferences(node, new Set(locals), (name) => {
    if (outer.has(name) && !seen.has(name)) {
      seen.add(name);
      found.push(name);
    }
  });
  return found;
}

function visitReferences<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  locals: Set<string>,
  add: (name: string) => void,
): void {
  if (node.kind === "ref") {
    if (typeof node.ref === "string" && !locals.has(node.ref)) add(node.ref);
    return;
  }
  if (isLeaf(node)) return;
  if (node.kind === "binding") {
    visitReferences(node.value, locals, add);
    visitReferences(node.body, added(locals, node.name), add);
    return;
  }
  if (node.kind === "function") {
    visitReferences(
      node.body,
      addedMany(
        locals,
        node.parameters.map((item) => item.name),
      ),
      add,
    );
    return;
  }
  if (node.kind === "function-group") {
    visitGroupReferences(node, locals, add);
    return;
  }
  visitReferenceChildren(node, locals, add);
}

function visitReferenceChildren<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  locals: Set<string>,
  add: (name: string) => void,
): void {
  if (node.kind === "call") {
    visitReferences(node.callee, locals, add);
    for (const item of node.arguments) visitReferences(item, locals, add);
    return;
  }
  const single = singleChild(node);
  if (single) {
    visitReferences(single[0], locals, add);
    return;
  }
  if (node.kind === "membership") {
    visitReferences(node.needle, locals, add);
    visitReferences(node.array, locals, add);
    return;
  }
  if (node.kind === "match") {
    visitReferences(node.value, locals, add);
    for (const arm of node.arms)
      visitReferences(arm.body, arm.binding ? added(locals, arm.binding) : locals, add);
    return;
  }
  if (isBinary(node)) {
    visitReferences(node.left, locals, add);
    visitReferences(node.right, locals, add);
    return;
  }
  if (node.kind === "option" && node.variant === "some") visitReferences(node.value, locals, add);
  if (node.kind === "result") visitReferences(node.value, locals, add);
}

function isBinary<R extends JsonValue>(
  node: KaladaV1Expression<R>,
): node is Extract<
  KaladaV1Expression<R>,
  {
    kind:
      | "temporal-arithmetic"
      | "temporal-comparison"
      | "equality"
      | "ordered-comparison"
      | "numeric-binary"
      | "boolean-logical"
      | "boolean-xor";
  }
> {
  return (
    node.kind === "temporal-arithmetic" ||
    node.kind === "temporal-comparison" ||
    node.kind === "equality" ||
    node.kind === "ordered-comparison" ||
    node.kind === "numeric-binary" ||
    node.kind === "boolean-logical" ||
    node.kind === "boolean-xor"
  );
}

function isUnary<R extends JsonValue>(
  node: KaladaV1Expression<R>,
): node is Extract<KaladaV1Expression<R>, { kind: "numeric-unary" | "boolean-not" }> {
  return node.kind === "numeric-unary" || node.kind === "boolean-not";
}

function singleChild<R extends JsonValue>(
  node: KaladaV1Expression<R>,
): readonly [KaladaV1Expression<R>, "target" | "operand"] | null {
  if (isFieldAccess(node)) return [node.target, "target"];
  if (isUnary(node)) return [node.operand, "operand"];
  return null;
}

function isFieldAccess<R extends JsonValue>(
  node: KaladaV1Expression<R>,
): node is Extract<KaladaV1Expression<R>, { kind: "field-access" | "optional-field-access" }> {
  return node.kind === "field-access" || node.kind === "optional-field-access";
}

function visitGroupReferences<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "function-group" }>,
  locals: Set<string>,
  add: (name: string) => void,
): void {
  const group = addedMany(
    locals,
    node.functions.map((item) => item.name),
  );
  for (const fn of node.functions)
    visitReferences(
      fn.body,
      addedMany(
        group,
        fn.parameters.map((item) => item.name),
      ),
      add,
    );
  visitReferences(node.body, group, add);
}

function isLeaf<R extends JsonValue>(node: KaladaV1Expression<R>): boolean {
  return (
    node.kind === "literal" ||
    node.kind === "ref" ||
    node.kind === "instant" ||
    node.kind === "duration" ||
    node.kind === "current-instant" ||
    node.kind === "core-function" ||
    (node.kind === "option" && node.variant === "none")
  );
}

function record(path: Path, name: string | null, captures: string[], state: AnalysisState): void {
  if (captures.length > state.limits.maxCapturesPerClosure)
    throw new KaladaFailure("KALADA_CAPTURE_LIMIT", path);
  state.functions.push(
    Object.freeze({
      path: Object.freeze([...path]),
      name,
      captures: Object.freeze(captures),
    }),
  );
}

function extended(scope: Names, name: string): Names {
  return extendedMany(scope, [name]);
}

function extendedMany(scope: Names, names: readonly string[]): Names {
  const output = new Set(scope);
  for (const name of names) output.add(name);
  return output;
}

function added(scope: Set<string>, name: string): Set<string> {
  return addedMany(scope, [name]);
}

function addedMany(scope: Set<string>, names: readonly string[]): Set<string> {
  return new Set([...scope, ...names]);
}
