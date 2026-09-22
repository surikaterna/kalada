import type { KaladaType, KaladaV1Expression, KaladaV1Program } from "@kalada/core";
import { freeze, inspectSafely, omitted, ownArray, ownData } from "./own.js";
import { valueSnapshot } from "./values.js";

export function programSnapshot(program: KaladaV1Program<string>, reveal: boolean): unknown {
  return inspectSafely(() => freeze(programSnapshotUnsafe(program, reveal)), omitted);
}

function programSnapshotUnsafe(program: KaladaV1Program<string>, reveal: boolean): unknown {
  if (ownData(program, "format") !== "kalada-program") return omitted();
  return {
    format: "kalada-program",
    version: ownData(program, "version"),
    profile: ownData(program, "profile"),
    expression: expressionSnapshot(ownData(program, "expression"), reveal),
  };
}

export function typeSnapshot(value: unknown): unknown {
  return inspectSafely(() => freeze(typeSnapshotUnsafe(value)), omitted);
}

function typeSnapshotUnsafe(value: unknown): unknown {
  const kind = ownData(value, "kind");
  if (kind === "primitive-type") return { kind, name: ownData(value, "name") };
  if (kind === "option-type") return { kind, value: typeSnapshotUnsafe(ownData(value, "value")) };
  if (kind === "result-type")
    return {
      kind,
      ok: typeSnapshotUnsafe(ownData(value, "ok")),
      error: typeSnapshotUnsafe(ownData(value, "error")),
    };
  if (kind === "array-type")
    return { kind, element: typeSnapshotUnsafe(ownData(value, "element")) };
  if (kind === "function-type")
    return {
      kind,
      parameters: ownArray(ownData(value, "parameters")).map(typeSnapshotUnsafe),
      returns: typeSnapshotUnsafe(ownData(value, "returns")),
    };
  return value === "dynamic" ? "dynamic" : omitted();
}

function expressionSnapshot(value: unknown, reveal: boolean): unknown {
  const kind = ownData(value, "kind");
  if (kind === "literal")
    return { kind, value: reveal ? valueSnapshot(ownData(value, "value")) : "[literal redacted]" };
  if (kind === "ref") return { kind, ref: ownData(value, "ref") };
  const simple = simpleExpression(value, kind, reveal);
  if (simple) return simple;
  const control = controlExpression(value, kind, reveal);
  if (control) return control;
  const callable = callableExpression(value, kind, reveal);
  return callable ?? omitted();
}

function simpleExpression(value: unknown, kind: unknown, reveal: boolean): unknown | undefined {
  if (["instant", "duration"].includes(kind as string))
    return { kind, milliseconds: ownData(value, "milliseconds") };
  if (kind === "current-instant") return { kind };
  if (kind === "core-function") return { kind, name: ownData(value, "name") };
  if (["field-access", "optional-field-access"].includes(kind as string))
    return { kind, target: child(value, "target", reveal), field: ownData(value, "field") };
  if (kind === "numeric-unary")
    return { kind, operator: ownData(value, "operator"), operand: child(value, "operand", reveal) };
  if (kind === "boolean-not") return { kind, operand: child(value, "operand", reveal) };
  if (kind === "membership")
    return { kind, needle: child(value, "needle", reveal), array: child(value, "array", reveal) };
  if (BINARY_KINDS.has(kind as string))
    return {
      kind,
      ...(kind === "ordered-comparison" ? { domain: ownData(value, "domain") } : {}),
      operator: ownData(value, "operator"),
      left: child(value, "left", reveal),
      right: child(value, "right", reveal),
    };
  if (kind === "boolean-xor")
    return { kind, left: child(value, "left", reveal), right: child(value, "right", reveal) };
  return undefined;
}

const BINARY_KINDS = new Set([
  "temporal-arithmetic",
  "temporal-comparison",
  "equality",
  "ordered-comparison",
  "numeric-binary",
  "boolean-logical",
]);

function controlExpression(value: unknown, kind: unknown, reveal: boolean): unknown | undefined {
  if (kind === "conditional") {
    const output = {
      kind,
      condition: child(value, "condition", reveal),
      else: child(value, "else", reveal),
    };
    // biome-ignore lint/suspicious/noThenProperty: Preserve the canonical program field in this inert DTO.
    Object.defineProperty(output, "then", {
      value: child(value, "then", reveal),
      enumerable: true,
    });
    return output;
  }
  if (kind === "option-coalesce")
    return {
      kind,
      option: child(value, "option", reveal),
      fallback: child(value, "fallback", reveal),
    };
  if (kind === "binding")
    return {
      kind,
      name: ownData(value, "name"),
      value: child(value, "value", reveal),
      body: child(value, "body", reveal),
    };
  if (kind === "option")
    return {
      kind,
      variant: ownData(value, "variant"),
      ...(ownData(value, "variant") === "some" ? { value: child(value, "value", reveal) } : {}),
    };
  if (kind === "result")
    return { kind, variant: ownData(value, "variant"), value: child(value, "value", reveal) };
  if (kind === "match") return matchSnapshot(value, reveal);
  return undefined;
}

function matchSnapshot(value: unknown, reveal: boolean): unknown {
  return {
    kind: "match",
    type: ownData(value, "type"),
    value: child(value, "value", reveal),
    arms: ownArray(ownData(value, "arms")).map((arm) => ({
      variant: ownData(arm, "variant"),
      ...(ownData(arm, "binding") === undefined ? {} : { binding: ownData(arm, "binding") }),
      body: child(arm, "body", reveal),
    })),
  };
}

function callableExpression(value: unknown, kind: unknown, reveal: boolean): unknown | undefined {
  if (kind === "function")
    return {
      kind,
      parameters: parameters(value),
      returns: typeSnapshotUnsafe(ownData(value, "returns")),
      body: child(value, "body", reveal),
    };
  if (kind === "call")
    return {
      kind,
      callee: child(value, "callee", reveal),
      arguments: ownArray(ownData(value, "arguments")).map((item) =>
        expressionSnapshot(item, reveal),
      ),
    };
  if (kind === "function-group")
    return {
      kind,
      functions: ownArray(ownData(value, "functions")).map((item) => ({
        name: ownData(item, "name"),
        parameters: parameters(item),
        returns: typeSnapshotUnsafe(ownData(item, "returns")),
        body: child(item, "body", reveal),
      })),
      body: child(value, "body", reveal),
    };
  return undefined;
}

function parameters(value: unknown): unknown {
  return ownArray(ownData(value, "parameters")).map((item) => ({
    name: ownData(item, "name"),
    type: typeSnapshotUnsafe(ownData(item, "type") as KaladaType),
  }));
}

function child(value: unknown, key: string, reveal: boolean): unknown {
  return expressionSnapshot(ownData(value, key) as KaladaV1Expression<string>, reveal);
}
