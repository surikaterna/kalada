import { canonicalJsonIdentity, type JsonValue } from "./json.js";
import type { KaladaV1Expression, MatchArm } from "./types.js";

export function collectKaladaV1Dependencies<R extends JsonValue>(
  expression: KaladaV1Expression<R>,
): readonly R[] {
  const output: R[] = [];
  const identities = new Set<string>();
  visit(expression, new Set(), output, identities);
  return Object.freeze(output);
}

function visit<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  scope: ReadonlySet<string>,
  output: R[],
  identities: Set<string>,
): void {
  if (node.kind === "ref") {
    addReference(node.ref, scope, output, identities);
    return;
  }
  if (
    node.kind === "literal" ||
    node.kind === "instant" ||
    node.kind === "duration" ||
    node.kind === "current-instant" ||
    node.kind === "core-function" ||
    (node.kind === "option" && node.variant === "none")
  )
    return;
  if (node.kind === "binding") {
    visitBinding(node, scope, output, identities);
    return;
  }
  if (visitAddedNode(node, scope, output, identities)) return;
  if (visitFunctionNode(node, scope, output, identities)) return;

  if (node.kind === "match") {
    visitMatch(node.value, node.arms, scope, output, identities);
    return;
  }
  if (
    node.kind === "temporal-arithmetic" ||
    node.kind === "temporal-comparison" ||
    node.kind === "equality" ||
    node.kind === "ordered-comparison"
  ) {
    visit(node.left, scope, output, identities);
    visit(node.right, scope, output, identities);
    return;
  }
  if (node.kind === "option" || node.kind === "result") {
    visit(node.value, scope, output, identities);
  }
}

function visitAddedNode<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  scope: ReadonlySet<string>,
  output: R[],
  identities: Set<string>,
): boolean {
  if (node.kind === "field-access" || node.kind === "optional-field-access") {
    visit(node.target, scope, output, identities);
    return true;
  }
  if (node.kind === "membership") {
    visit(node.needle, scope, output, identities);
    visit(node.array, scope, output, identities);
    return true;
  }
  return false;
}

function visitFunctionNode<R extends JsonValue>(
  node: KaladaV1Expression<R>,
  scope: ReadonlySet<string>,
  output: R[],
  identities: Set<string>,
): boolean {
  if (node.kind === "function") {
    visit(
      node.body,
      extendedMany(
        scope,
        node.parameters.map((parameter) => parameter.name),
      ),
      output,
      identities,
    );
    return true;
  }
  if (node.kind === "function-group") {
    const groupScope = extendedMany(
      scope,
      node.functions.map((member) => member.name),
    );
    for (const member of node.functions) {
      visit(
        member.body,
        extendedMany(
          groupScope,
          member.parameters.map((parameter) => parameter.name),
        ),
        output,
        identities,
      );
    }
    visit(node.body, groupScope, output, identities);
    return true;
  }
  if (node.kind === "call") {
    visit(node.callee, scope, output, identities);
    for (const argument of node.arguments) visit(argument, scope, output, identities);
    return true;
  }
  return false;
}

function visitBinding<R extends JsonValue>(
  node: Extract<KaladaV1Expression<R>, { kind: "binding" }>,
  scope: ReadonlySet<string>,
  output: R[],
  identities: Set<string>,
): void {
  visit(node.value, scope, output, identities);
  visit(node.body, extended(scope, node.name), output, identities);
}

function visitMatch<R extends JsonValue>(
  value: KaladaV1Expression<R>,
  arms: readonly MatchArm<R>[],
  scope: ReadonlySet<string>,
  output: R[],
  identities: Set<string>,
): void {
  visit(value, scope, output, identities);
  for (const arm of arms) {
    visit(arm.body, arm.binding ? extended(scope, arm.binding) : scope, output, identities);
  }
}

function addReference<R extends JsonValue>(
  reference: R,
  scope: ReadonlySet<string>,
  output: R[],
  identities: Set<string>,
): void {
  if (typeof reference === "string" && scope.has(reference)) return;
  const identity = canonicalJsonIdentity(reference);
  if (identities.has(identity)) return;
  identities.add(identity);
  output.push(reference);
}

function extended(scope: ReadonlySet<string>, name: string): ReadonlySet<string> {
  const output = new Set(scope);
  output.add(name);
  return output;
}

function extendedMany(scope: ReadonlySet<string>, names: readonly string[]): ReadonlySet<string> {
  const output = new Set(scope);
  for (const name of names) output.add(name);
  return output;
}
