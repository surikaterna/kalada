import type { JsonValue } from "@kalada/core";
import type { KaladaBinaryOperator, KaladaCstNode, KaladaSourceRange } from "./cst-types.js";
import { diagnostic } from "./diagnostics.js";
import { dispatchBinary, dispatchField } from "./dispatch.js";
import { deepFreeze } from "./freeze.js";
import { BINARY_OPERATORS } from "./operators.js";
import { syntaxLimitsFor } from "./parse.js";
import type {
  KaladaLowerOptions,
  KaladaParseResult,
  KaladaSemanticNodeInfo,
  KaladaSemanticQueryResult,
  KaladaSemanticSupport,
} from "./public-types.js";
import { type LowerConfiguration, readLowerConfiguration } from "./reference-environment.js";
import { analyzeSemantics, type SemanticInference } from "./semantic-inference.js";
import { projectStaticType, type StaticType } from "./static-types.js";

export function queryKaladaV1Semantics<R extends JsonValue = string>(
  parsed: KaladaParseResult,
  options?: KaladaLowerOptions<R>,
): KaladaSemanticQueryResult {
  const limits = syntaxLimitsFor(parsed);
  if (limits === null) return invalidQuery();
  const configuration = safeConfiguration(options, limits);
  if (configuration === null) return invalidQuery(parsed.document.expression.range);
  const analysis = analyzeSemantics(parsed, configuration);
  const nodes = analysis.ordered.map((node) =>
    describeNode(node, analysis.inferred.get(node) ?? unknownInference()),
  );
  return deepFreeze({
    nodes,
    diagnostics: analysis.diagnostics,
    incomplete: analysis.incomplete,
  });
}

function safeConfiguration<R extends JsonValue>(
  options: KaladaLowerOptions<R> | undefined,
  limits: NonNullable<ReturnType<typeof syntaxLimitsFor>>,
): LowerConfiguration<R> | null {
  try {
    return readLowerConfiguration(options, limits);
  } catch {
    return null;
  }
}

function describeNode(node: KaladaCstNode, inference: SemanticInference): KaladaSemanticNodeInfo {
  const type = projectStaticType(inference.type);
  return {
    range: node.range,
    type,
    known: inference.complete && type !== "dynamic",
    fieldAccess: {
      plain: fieldSupport(inference, false),
      optional: fieldSupport(inference, true),
    },
    operators: BINARY_OPERATORS.map((operator) => ({
      operator,
      support: operatorSupport(operator, inference),
    })),
  };
}

function fieldSupport(inference: SemanticInference, optional: boolean): KaladaSemanticSupport {
  if (!inference.complete || inference.type === "dynamic") return "conditional";
  try {
    dispatchField(inference.type, optional);
    return "supported";
  } catch {
    return "unsupported";
  }
}

function operatorSupport(
  operator: KaladaBinaryOperator,
  left: SemanticInference,
): KaladaSemanticSupport {
  if (!left.complete) return "conditional";
  return dispatchSupport(operator, left.type, "dynamic", false);
}

function dispatchSupport(
  operator: KaladaBinaryOperator,
  left: StaticType,
  right: StaticType,
  completeOperands: boolean,
): KaladaSemanticSupport {
  try {
    dispatchBinary(operator, left, right);
    if (!completeOperands || containsDynamic(left) || containsDynamic(right)) return "conditional";
    return "supported";
  } catch {
    return left === "dynamic" ? "conditional" : "unsupported";
  }
}

function containsDynamic(type: StaticType): boolean {
  return type === "dynamic" || ("shape" in type && containsDynamic(type.value));
}

function unknownInference(): SemanticInference {
  return { type: "dynamic", complete: false };
}

function invalidQuery(range: KaladaSourceRange = Object.freeze({ start: 0, end: 0 })) {
  return deepFreeze({
    nodes: [],
    diagnostics: [
      diagnostic(
        "lower",
        "KALADA_SYNTAX_INVALID_INPUT",
        "Kalada syntax input is invalid.",
        range,
        [],
      ),
    ],
    incomplete: true,
  });
}
