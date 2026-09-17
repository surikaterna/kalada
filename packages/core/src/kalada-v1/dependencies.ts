import type { JsonValue } from "./json.js";
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
  if (node.kind === "literal" || (node.kind === "option" && node.variant === "none")) return;
  if (node.kind === "binding") {
    visitBinding(node, scope, output, identities);
    return;
  }
  if (node.kind === "match") {
    visitMatch(node.value, node.arms, scope, output, identities);
    return;
  }
  visit(node.value, scope, output, identities);
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
  const identity = JSON.stringify(reference);
  if (identities.has(identity)) return;
  identities.add(identity);
  output.push(reference);
}

function extended(scope: ReadonlySet<string>, name: string): ReadonlySet<string> {
  const output = new Set(scope);
  output.add(name);
  return output;
}
