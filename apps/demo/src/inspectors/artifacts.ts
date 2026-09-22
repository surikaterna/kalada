import type { CompiledExpression, HostDiagnostic, PreparedExpression } from "@kalada/host";
import { parseKaladaV1Expression } from "@kalada/syntax";
import type { DemoEnvironment } from "../schema/environment.js";
import { safeValue } from "./safe.js";

export function cstSnapshot(source: string, reveal = false): unknown {
  const parsed = parseKaladaV1Expression(source);
  return freeze({
    format: "kalada-demo-cst-v1",
    tokens: parsed.document.tokens.map((token) => ({
      kind: token.kind,
      range: token.range,
      ...(reveal ? { text: token.text } : {}),
    })),
    expression: cstNode(parsed.document.expression, reveal),
    diagnostics: diagnosticsSnapshot(parsed.diagnostics),
  });
}

export function compiledSnapshot(
  compiled: CompiledExpression | undefined,
  reveal = false,
): unknown {
  if (!compiled) return freeze({ unavailable: true });
  return freeze({
    format: compiled.format,
    program: redactLiterals(safeValue(compiled.program), reveal),
    sourceMap: compiled.sourceMap.map((entry) => ({
      path: entry.path,
      role: entry.role,
      range: entry.range,
    })),
    resultType: compiled.resultType,
    dependencies: [...compiled.dependencies],
  });
}

export function linkSnapshot(prepared: PreparedExpression | undefined): unknown {
  if (!prepared) return freeze({ unavailable: true });
  return freeze({
    format: prepared.format,
    linkPlan: prepared.linkPlan.map((slot) => ({
      index: slot.index,
      bindingId: slot.bindingId,
      name: slot.name,
      path: slot.path,
      semanticType: slot.semanticType,
      ...(slot.validator ? { validator: capability(slot.validator) } : {}),
      ...(slot.codec ? { codec: capability(slot.codec) } : {}),
    })),
  });
}

export function environmentSnapshot(environment: DemoEnvironment | undefined): unknown {
  if (!environment) return freeze({ unavailable: true });
  const normalized = environment.adapted.environment;
  return freeze({
    schema: {
      formatVersion: environment.document.formatVersion,
      root: environment.document.root,
      capabilities: environment.document.capabilities,
      definitions: environment.document.definitions.map((entry) => ({
        side: entry.side,
        sourcePointer: entry.sourcePointer,
        name: entry.name,
        nodeId: entry.node.nodeId,
      })),
      nodes: Object.entries(environment.document.nodes).map(([id, node]) => ({
        id,
        kind: node.kind,
      })),
    },
    environment: {
      format: normalized.format,
      provider: {
        mode: normalized.provider.mode,
        providerId: normalized.provider.providerId,
        providerVersion: normalized.provider.providerVersion,
      },
      cacheability: normalized.cacheability.cacheable,
      compileProjection: normalized.compileProjection,
      bindings: normalized.bindings.map((binding) => ({
        id: binding.id,
        name: binding.name,
        path: binding.path,
        semanticType: binding.semanticType,
        editorShapeRoot: binding.editorShapeRoot,
      })),
      graph: {
        format: normalized.editorGraph.format,
        roots: normalized.editorGraph.roots,
        nodes: normalized.editorGraph.nodes.map(graphNode),
        definitions: normalized.editorGraph.definitions,
        evidence: normalized.editorGraph.evidence,
        limits: normalized.editorGraph.limits,
      },
    },
  });
}

export function diagnosticsSnapshot(diagnostics: readonly unknown[]): unknown {
  return freeze(diagnostics.map(diagnosticSnapshot));
}

function diagnosticSnapshot(value: unknown): unknown {
  const item = value as Partial<HostDiagnostic>;
  const message =
    typeof item.message === "string" && item.message.length <= 256
      ? item.message
      : "Diagnostic unavailable";
  return {
    code: typeof item.code === "string" ? item.code : "UNKNOWN_DIAGNOSTIC",
    phase: typeof item.phase === "string" ? item.phase : "unknown",
    message,
    ...(item.source ? { source: item.source } : {}),
    ...(item.bindingPath ? { bindingPath: item.bindingPath } : {}),
    ...(item.cause
      ? {
          cause: {
            code: item.cause.code,
            range: "range" in item.cause ? item.cause.range : undefined,
          },
        }
      : {}),
  };
}

function cstNode(
  node: ReturnType<typeof parseKaladaV1Expression>["document"]["expression"],
  reveal: boolean,
): unknown {
  const output: Record<string, unknown> = { kind: node.kind, range: node.range };
  for (const key of [
    "token",
    "openToken",
    "closeToken",
    "operatorToken",
    "fieldToken",
    "optional",
    "operator",
    "literalKind",
  ]) {
    if (key in node) output[key] = (node as unknown as Record<string, unknown>)[key];
  }
  for (const key of ["name", "field", "value"])
    if (reveal && key in node)
      output[key] = safeValue((node as unknown as Record<string, unknown>)[key]);
  for (const key of [
    "expression",
    "target",
    "operand",
    "left",
    "right",
    "condition",
    "then",
    "else",
  ]) {
    const child = (node as unknown as Record<string, unknown>)[key];
    if (child && typeof child === "object") output[key] = cstNode(child as typeof node, reveal);
  }
  return output;
}

function redactLiterals(value: unknown, reveal: boolean): unknown {
  if (reveal || !value || typeof value !== "object") return value;
  if (Array.isArray(value))
    return Object.freeze(value.map((entry) => redactLiterals(entry, false)));
  const output: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(value))
    output[key] = key === "value" ? "[literal redacted]" : redactLiterals(item, false);
  return Object.freeze(output);
}

function capability(value: {
  kind: string;
  mode: string;
  capabilityId?: string;
  capabilityVersion?: string;
}) {
  return {
    kind: value.kind,
    mode: value.mode,
    id: value.capabilityId,
    version: value.capabilityVersion,
  };
}
function graphNode(
  node: DemoEnvironment["adapted"]["environment"]["editorGraph"]["nodes"][number],
) {
  return {
    id: node.id,
    kind: node.kind,
    availability: node.availability,
    evidence: node.evidence,
    constraints: node.constraints,
  };
}
function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return Object.freeze(value);
}
