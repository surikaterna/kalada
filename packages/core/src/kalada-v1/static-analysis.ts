import { KaladaFailure } from "./diagnostics.js";
import type { JsonValue } from "./json.js";
import type { ResolvedKaladaV1Limits } from "./limits.js";
import type {
  FunctionExpression,
  KaladaFunctionType,
  KaladaType,
  KaladaV1Expression,
  KaladaV1FunctionCapture,
  MatchArm,
  NamedFunction,
} from "./types.js";

type Path = readonly (string | number)[];
const UNKNOWN = Symbol("unknown");
type StaticType = KaladaType | typeof UNKNOWN;
type Scope = ReadonlyMap<string, StaticType>;
interface AnalysisState {
  readonly limits: ResolvedKaladaV1Limits;
  readonly functions: KaladaV1FunctionCapture[];
  captures: number;
  closures: number;
}
export function analyzeKaladaV1Functions<R extends JsonValue>(
  expression: KaladaV1Expression<R>,
  limits: ResolvedKaladaV1Limits,
): readonly KaladaV1FunctionCapture[] {
  const state: AnalysisState = { limits, functions: [], captures: 0, closures: 0 };
  infer(expression, ["expression"], new Map(), state);
  return Object.freeze(state.functions);
}
function infer<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  path: Path,
  scope: Scope,
  state: AnalysisState,
): StaticType {
  if (node.kind === "literal") return literalType(node.value);
  if (node.kind === "ref")
    return typeof node.ref === "string" ? (scope.get(node.ref) ?? UNKNOWN) : UNKNOWN;
  const added = inferFunctionNode(node, path, scope, state);
  if (added !== undefined) return added;
  const structured = inferStructuredNode(node, path, scope, state);
  if (structured !== undefined) return structured;
  if (node.kind === "instant") return primitive("Instant");
  if (node.kind === "duration") return primitive("Duration");
  if (node.kind === "current-instant") return primitive("Instant");
  if (node.kind === "temporal-arithmetic" || node.kind === "temporal-comparison") {
    infer(node.left, [...path, "left"], scope, state);
    infer(node.right, [...path, "right"], scope, state);
    return node.kind === "temporal-comparison" ? primitive("boolean") : UNKNOWN;
  }
  return UNKNOWN;
}
function inferStructuredNode<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  path: Path,
  scope: Scope,
  state: AnalysisState,
): StaticType | undefined {
  if (node.kind === "binding") return analyzeBinding(node, path, scope, state);
  if (node.kind === "option") return optionType(node, path, scope, state);
  if (node.kind === "result") return resultType(node, path, scope, state);
  if (node.kind === "match") return analyzeMatch(node.value, node.arms, path, scope, state);
  return undefined;
}

function inferFunctionNode<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  path: Path,
  scope: Scope,
  state: AnalysisState,
): StaticType | undefined {
  if (node.kind === "function") return analyzeFunction(node, path, scope, null, state);
  if (node.kind === "function-group") return analyzeGroup(node, path, scope, state);
  if (node.kind === "call") return analyzeCall(node, path, scope, state);
  if (node.kind === "core-function") return coreType(node.name);
  return undefined;
}

function analyzeFunction<R extends JsonValue>(
  node: FunctionExpression<R>,
  path: Path,
  outer: Scope,
  name: string | null,
  state: AnalysisState,
): KaladaFunctionType {
  chargeClosure(path, state);
  const local = new Map<string, StaticType>();
  for (const parameter of node.parameters) local.set(parameter.name, parameter.type);
  const captures = collectCaptures(node.body, outer, new Set(local.keys()));
  recordCaptures(path, name, captures, state);
  const bodyType = infer(node.body, [...path, "body"], merged(outer, local), state);
  requireType(bodyType, node.returns, [...path, "body"]);
  return freezeFunctionType(
    node.parameters.map((item) => item.type),
    node.returns,
  );
}

function analyzeGroup<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "function-group" }>,
  path: Path,
  outer: Scope,
  state: AnalysisState,
): StaticType {
  const signatures = new Map<string, StaticType>();
  for (const fn of node.functions) signatures.set(fn.name, signature(fn));
  const groupScope = merged(outer, signatures);
  node.functions.forEach((fn, index) => {
    analyzeMember(fn, [...path, "functions", index], outer, groupScope, signatures, state);
  });
  return infer(node.body, [...path, "body"], groupScope, state);
}

function analyzeMember<R extends JsonValue>(
  fn: NamedFunction<R>,
  path: Path,
  outer: Scope,
  groupScope: Scope,
  signatures: Scope,
  state: AnalysisState,
): void {
  chargeClosure(path, state);
  const parameterScope = new Map<string, StaticType>();
  for (const parameter of fn.parameters) parameterScope.set(parameter.name, parameter.type);
  const locals = new Set([...parameterScope.keys(), ...signatures.keys()]);
  const captures = collectCaptures(fn.body, outer, locals);
  recordCaptures(path, fn.name, captures, state);
  const bodyType = infer(fn.body, [...path, "body"], merged(groupScope, parameterScope), state);
  requireType(bodyType, fn.returns, [...path, "body"]);
}

function analyzeCall<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "call" }>,
  path: Path,
  scope: Scope,
  state: AnalysisState,
): StaticType {
  const callee = infer(node.callee, [...path, "callee"], scope, state);
  const args = node.arguments.map((item, index) =>
    infer(item, [...path, "arguments", index], scope, state),
  );
  if (callee === UNKNOWN) return UNKNOWN;
  if (callee.kind !== "function-type") fail("KALADA_NOT_CALLABLE", [...path, "callee"]);
  if (args.length !== callee.parameters.length)
    fail("KALADA_FUNCTION_ARITY", [...path, "arguments"]);
  args.forEach((actual, index) => {
    requireType(actual, callee.parameters[index] as KaladaType, [...path, "arguments", index]);
  });
  return callee.returns;
}

function analyzeBinding<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "binding" }>,
  path: Path,
  scope: Scope,
  state: AnalysisState,
): StaticType {
  const value = infer(node.value, [...path, "value"], scope, state);
  return infer(node.body, [...path, "body"], merged(scope, new Map([[node.name, value]])), state);
}

function analyzeMatch<R extends JsonValue>(
  value: KaladaV1Expression<R>,
  arms: readonly MatchArm<R>[],
  path: Path,
  scope: Scope,
  state: AnalysisState,
): StaticType {
  infer(value, [...path, "value"], scope, state);
  let output: StaticType = UNKNOWN;
  arms.forEach((arm, index) => {
    const nested = arm.binding ? merged(scope, new Map([[arm.binding, UNKNOWN]])) : scope;
    const current = infer(arm.body, [...path, "arms", index, "body"], nested, state);
    output =
      output === UNKNOWN || current === UNKNOWN || equalType(output, current) ? current : UNKNOWN;
  });
  return output;
}

function collectCaptures<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  outer: Scope,
  locals: ReadonlySet<string>,
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
        node.parameters.map((p) => p.name),
      ),
      add,
    );
    return;
  }
  if (node.kind === "function-group") {
    visitGroupReferences(node, locals, add);
    return;
  }
  if (visitBranchReferences(node, locals, add)) return;
  if (node.kind === "temporal-arithmetic" || node.kind === "temporal-comparison") {
    visitReferences(node.left, locals, add);
    visitReferences(node.right, locals, add);
    return;
  }
  if (node.kind === "option" && node.variant === "some") visitReferences(node.value, locals, add);
  if (node.kind === "result") visitReferences(node.value, locals, add);
}

function visitBranchReferences<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  locals: Set<string>,
  add: (name: string) => void,
): boolean {
  if (node.kind === "call") {
    visitReferences(node.callee, locals, add);
    node.arguments.forEach((arg) => {
      visitReferences(arg, locals, add);
    });
    return true;
  }
  if (node.kind === "match") {
    visitReferences(node.value, locals, add);
    node.arms.forEach((arm) => {
      visitReferences(arm.body, arm.binding ? added(locals, arm.binding) : locals, add);
    });
    return true;
  }
  return false;
}

function visitGroupReferences<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "function-group" }>,
  locals: Set<string>,
  add: (name: string) => void,
): void {
  const group = addedMany(
    locals,
    node.functions.map((fn) => fn.name),
  );
  for (const fn of node.functions)
    visitReferences(
      fn.body,
      addedMany(
        group,
        fn.parameters.map((p) => p.name),
      ),
      add,
    );
  visitReferences(node.body, group, add);
}

function isLeaf<R extends JsonValue>(node: KaladaV1Expression<R>): boolean {
  return (
    node.kind === "literal" ||
    node.kind === "instant" ||
    node.kind === "duration" ||
    node.kind === "current-instant" ||
    node.kind === "core-function" ||
    (node.kind === "option" && node.variant === "none")
  );
}

function recordCaptures(
  path: Path,
  name: string | null,
  captures: string[],
  state: AnalysisState,
): void {
  if (captures.length > state.limits.maxCapturesPerClosure) fail("KALADA_CAPTURE_LIMIT", path);
  state.captures += captures.length;
  if (state.captures > state.limits.maxCapturedBindings) fail("KALADA_CAPTURE_LIMIT", path);
  state.functions.push(
    Object.freeze({ path: Object.freeze([...path]), name, captures: Object.freeze(captures) }),
  );
}

function chargeClosure(path: Path, state: AnalysisState): void {
  state.closures += 1;
  if (state.closures > state.limits.maxClosures) fail("KALADA_CLOSURE_LIMIT", path);
}

function optionType<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "option" }>,
  path: Path,
  scope: Scope,
  state: AnalysisState,
): StaticType {
  if (node.variant === "none") return UNKNOWN;
  const value = infer(node.value, [...path, "value"], scope, state);
  return value === UNKNOWN ? UNKNOWN : Object.freeze({ kind: "option-type", value });
}

function resultType<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "result" }>,
  path: Path,
  scope: Scope,
  state: AnalysisState,
): StaticType {
  const value = infer(node.value, [...path, "value"], scope, state);
  if (value === UNKNOWN) return UNKNOWN;
  return node.variant === "ok"
    ? Object.freeze({ kind: "result-type", ok: value, error: primitive("json") })
    : Object.freeze({ kind: "result-type", ok: primitive("json"), error: value });
}
function coreType(name: "map" | "filter" | "some" | "every"): KaladaFunctionType {
  const callbackReturn = primitive(name === "map" ? "json" : "boolean");
  const callback = freezeFunctionType([primitive("json"), primitive("number")], callbackReturn);
  return freezeFunctionType(
    [Object.freeze({ kind: "array-type", element: primitive("json") }), callback],
    name === "map" || name === "filter"
      ? Object.freeze({ kind: "array-type", element: primitive("json") })
      : primitive("boolean"),
  );
}

function signature<R extends JsonValue>(fn: NamedFunction<R>): KaladaFunctionType {
  return freezeFunctionType(
    fn.parameters.map((p) => p.type),
    fn.returns,
  );
}
function freezeFunctionType(
  parameters: readonly KaladaType[],
  returns: KaladaType,
): KaladaFunctionType {
  return Object.freeze({
    kind: "function-type",
    parameters: Object.freeze([...parameters]),
    returns,
  });
}
function primitive(
  name: "null" | "boolean" | "number" | "string" | "json" | "Instant" | "Duration",
): KaladaType {
  return Object.freeze({ kind: "primitive-type", name });
}
function literalType(value: JsonValue): KaladaType {
  if (Array.isArray(value))
    return Object.freeze({ kind: "array-type", element: primitive("json") });
  return primitive(
    value === null
      ? "null"
      : typeof value === "object"
        ? "json"
        : (typeof value as "boolean" | "number" | "string"),
  );
}
function requireType(actual: StaticType, expected: KaladaType, path: Path): void {
  if (actual !== UNKNOWN && !equalType(actual, expected))
    fail("KALADA_FUNCTION_TYPE_MISMATCH", path);
}
function equalType(left: KaladaType, right: KaladaType): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function merged(base: Scope, extra: Scope): Scope {
  return new Map([...base, ...extra]);
}
function added(scope: Set<string>, name: string): Set<string> {
  return addedMany(scope, [name]);
}
function addedMany(scope: Set<string>, names: readonly string[]): Set<string> {
  const output = new Set(scope);
  names.forEach((name) => {
    output.add(name);
  });
  return output;
}
function fail(code: ConstructorParameters<typeof KaladaFailure>[0], path: Path): never {
  throw new KaladaFailure(code, path);
}
