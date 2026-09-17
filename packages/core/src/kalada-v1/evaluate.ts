import { failure, KaladaFailure, success } from "./diagnostics.js";
import { runEvaluation } from "./evaluation-machine.js";
import type { JsonValue } from "./json.js";
import { dataValue } from "./json.js";
import type { ResolvedKaladaV1Limits } from "./limits.js";
import { type InstantValue, isInstant } from "./temporal.js";
import type {
  KaladaV1EvaluationInputs,
  KaladaV1Expression,
  KaladaV1FunctionCapture,
  KaladaV1Outcome,
  KaladaV1Resolver,
} from "./types.js";
import type { KaladaValue } from "./values.js";

export function evaluateKaladaV1<R extends JsonValue>(
  expression: KaladaV1Expression<R>,
  resolve: KaladaV1Resolver<R>,
  limits: ResolvedKaladaV1Limits,
  functions: readonly KaladaV1FunctionCapture[],
  inputs: KaladaV1EvaluationInputs = {},
): KaladaV1Outcome<KaladaValue> {
  try {
    const instant = evaluationInstant(inputs);
    return success(runEvaluation(expression, resolve, limits, functions, instant));
  } catch (error) {
    const problem =
      error instanceof KaladaFailure ? error : new KaladaFailure("KALADA_REFERENCE_ERROR", []);
    return failure(problem.code, problem.path, problem.context);
  }
}

function evaluationInstant(inputs: KaladaV1EvaluationInputs): InstantValue | undefined {
  let keys: readonly PropertyKey[];
  try {
    if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs))
      throw new TypeError();
    keys = Reflect.ownKeys(inputs);
  } catch {
    throw new KaladaFailure("KALADA_INVALID_INPUT", ["inputs", "instant"]);
  }
  const unexpected = keys.find((key) => key !== "instant");
  if (unexpected !== undefined) {
    throw new KaladaFailure("KALADA_INVALID_INPUT", ["inputs", String(unexpected)]);
  }
  if (!keys.includes("instant")) return undefined;
  const instant = readInstant(inputs);
  if (instant !== undefined && !isInstant(instant)) {
    throw new KaladaFailure("KALADA_INVALID_INPUT", ["inputs", "instant"]);
  }
  return instant;
}

function readInstant(inputs: KaladaV1EvaluationInputs): unknown {
  try {
    return dataValue(inputs, "instant");
  } catch {
    throw new KaladaFailure("KALADA_INVALID_INPUT", ["inputs", "instant"]);
  }
}
