import type { CompiledExpression, PreparedExpression } from "@kalada/host";
import { type KaladaCstNode, parseKaladaV1Expression } from "@kalada/syntax";
import type { DemoEnvironment } from "../schema/environment.js";
import { environmentSnapshotValue } from "./environment.js";
import { freeze, omitted, ownArray, ownData } from "./own.js";
import { programSnapshot, typeSnapshot } from "./program.js";
import { valueSnapshot } from "./values.js";

export function cstSnapshot(source: string, reveal = false): unknown {
  const parsed = parseKaladaV1Expression(source);
  return freeze({
    format: "kalada-demo-cst-v1",
    tokens: ownArray(ownData(parsed.document, "tokens")).map((token) => ({
      kind: ownData(token, "kind"),
      range: offsetRange(ownData(token, "range")),
      ...(reveal ? { text: ownData(token, "text") } : {}),
    })),
    expression: cstNode(ownData(parsed.document, "expression") as KaladaCstNode, reveal),
    diagnostics: diagnosticsSnapshot(parsed.diagnostics),
  });
}

export function compiledSnapshot(
  compiled: CompiledExpression | undefined,
  reveal = false,
): unknown {
  if (!compiled || ownData(compiled, "format") !== "kalada-host-compiled-expression-v1")
    return freeze({ unavailable: true });
  return freeze({
    format: "kalada-host-compiled-expression-v1",
    program: programSnapshot(ownData(compiled, "program") as CompiledExpression["program"], reveal),
    sourceMap: ownArray(ownData(compiled, "sourceMap")).map(sourceMapEntry),
    resultType: typeSnapshot(ownData(compiled, "resultType")),
    dependencies: ownArray(ownData(compiled, "dependencies")).filter(safeBindingId),
  });
}

export function linkSnapshot(prepared: PreparedExpression | undefined): unknown {
  if (!prepared || ownData(prepared, "format") !== "kalada-host-prepared-expression-v1")
    return freeze({ unavailable: true });
  return freeze({
    format: "kalada-host-prepared-expression-v1",
    linkPlan: ownArray(ownData(prepared, "linkPlan")).map((slot) => ({
      index: ownData(slot, "index"),
      bindingId: safeBindingId(ownData(slot, "bindingId"))
        ? ownData(slot, "bindingId")
        : "unknown-binding",
      name: ownData(slot, "name"),
      path: pathSnapshot(ownData(slot, "path")),
      semanticType: typeSnapshot(ownData(slot, "semanticType")),
      ...(ownData(slot, "validator") === undefined
        ? {}
        : { validator: capabilitySnapshot(ownData(slot, "validator")) }),
      ...(ownData(slot, "codec") === undefined
        ? {}
        : { codec: capabilitySnapshot(ownData(slot, "codec")) }),
    })),
  });
}

export function environmentSnapshot(environment: DemoEnvironment | undefined): unknown {
  return freeze(environment ? environmentSnapshotValue(environment) : { unavailable: true });
}

export function diagnosticsSnapshot(diagnostics: readonly unknown[]): unknown {
  return freeze(ownArray(diagnostics).map(diagnosticSnapshot));
}

function diagnosticSnapshot(value: unknown): unknown {
  return {
    code:
      typeof ownData(value, "code") === "string" ? ownData(value, "code") : "UNKNOWN_DIAGNOSTIC",
    phase: typeof ownData(value, "phase") === "string" ? ownData(value, "phase") : "unknown",
    message: "Diagnostic reported",
    ...(sourceSnapshot(ownData(value, "source")) ?? {}),
    ...(ownData(value, "bindingPath") === undefined
      ? {}
      : { bindingPath: pathSnapshot(ownData(value, "bindingPath")) }),
    ...(ownData(value, "cause") === undefined
      ? {}
      : { cause: causeSnapshot(ownData(value, "cause")) }),
  };
}

function sourceSnapshot(value: unknown): object | undefined {
  const uri = ownData(value, "uri");
  if (typeof uri !== "string" || !/^kalada-demo:\/\/workspace\/[A-Za-z0-9_.%-]+$/u.test(uri))
    return undefined;
  return { source: { uri, range: utf16Range(ownData(value, "range")) } };
}

function causeSnapshot(value: unknown): unknown {
  return {
    code: ownData(value, "code"),
    ...(ownData(value, "range") === undefined
      ? {}
      : { range: offsetRange(ownData(value, "range")) }),
    ...(ownData(value, "path") === undefined ? {} : { path: pathSnapshot(ownData(value, "path")) }),
  };
}

function cstNode(node: KaladaCstNode, reveal: boolean): unknown {
  const kind = ownData(node, "kind");
  const base = { kind, range: offsetRange(ownData(node, "range")) };
  if (kind === "literal")
    return {
      ...base,
      literalKind: ownData(node, "literalKind"),
      token: ownData(node, "token"),
      ...(reveal ? { value: valueSnapshot(ownData(node, "value")) } : {}),
    };
  if (kind === "reference")
    return {
      ...base,
      token: ownData(node, "token"),
      ...(reveal ? { name: ownData(node, "name") } : {}),
    };
  const unary = cstUnary(node, kind, base, reveal);
  if (unary) return unary;
  const branching = cstBranching(node, kind, base, reveal);
  return branching ?? omitted();
}

function cstUnary(
  node: unknown,
  kind: unknown,
  base: object,
  reveal: boolean,
): unknown | undefined {
  if (kind === "group")
    return {
      ...base,
      openToken: ownData(node, "openToken"),
      expression: cstNode(ownData(node, "expression") as KaladaCstNode, reveal),
      closeToken: ownData(node, "closeToken"),
    };
  if (kind === "field-access")
    return {
      ...base,
      target: cstNode(ownData(node, "target") as KaladaCstNode, reveal),
      optional: ownData(node, "optional"),
      operatorToken: ownData(node, "operatorToken"),
      fieldToken: ownData(node, "fieldToken"),
      ...(reveal ? { field: ownData(node, "field") } : {}),
    };
  if (kind === "unary")
    return {
      ...base,
      operator: ownData(node, "operator"),
      operatorToken: ownData(node, "operatorToken"),
      operand: cstNode(ownData(node, "operand") as KaladaCstNode, reveal),
    };
  if (kind === "error") return { ...base, token: ownData(node, "token") };
  return undefined;
}

function cstBranching(
  node: unknown,
  kind: unknown,
  base: object,
  reveal: boolean,
): unknown | undefined {
  if (kind === "binary")
    return {
      ...base,
      operator: ownData(node, "operator"),
      operatorToken: ownData(node, "operatorToken"),
      left: cstNode(ownData(node, "left") as KaladaCstNode, reveal),
      right: cstNode(ownData(node, "right") as KaladaCstNode, reveal),
    };
  if (kind === "conditional") {
    const output = {
      ...base,
      condition: cstNode(ownData(node, "condition") as KaladaCstNode, reveal),
      questionToken: ownData(node, "questionToken"),
      colonToken: ownData(node, "colonToken"),
      else: cstNode(ownData(node, "else") as KaladaCstNode, reveal),
    };
    // biome-ignore lint/suspicious/noThenProperty: Preserve the documented CST field in this inert DTO.
    Object.defineProperty(output, "then", {
      value: cstNode(ownData(node, "then") as KaladaCstNode, reveal),
      enumerable: true,
    });
    return output;
  }
  return undefined;
}

function sourceMapEntry(value: unknown): unknown {
  return {
    path: pathSnapshot(ownData(value, "path")),
    role: ownData(value, "role"),
    range: offsetRange(ownData(value, "range")),
  };
}

function capabilitySnapshot(value: unknown): unknown {
  return {
    kind: ownData(value, "kind"),
    mode: ownData(value, "mode"),
    id: ownData(value, "capabilityId"),
    version: ownData(value, "capabilityVersion"),
  };
}

function offsetRange(value: unknown): unknown {
  return { start: ownData(value, "start"), end: ownData(value, "end") };
}

function utf16Range(value: unknown): unknown {
  return {
    start: position(ownData(value, "start")),
    end: position(ownData(value, "end")),
  };
}

function position(value: unknown): unknown {
  return { line: ownData(value, "line"), character: ownData(value, "character") };
}

function pathSnapshot(value: unknown): unknown {
  return ownArray(value).filter((item) => typeof item === "string" || typeof item === "number");
}

function safeBindingId(value: unknown): value is string {
  return value === "demo:data";
}
