import { rejectCallbackPromise } from "./callback-promise.js";
import { canonicalizeKaladaV1Program } from "./canonicalize.js";
import { collectKaladaV1Dependencies } from "./dependencies.js";
import { failure, KaladaFailure, success } from "./diagnostics.js";
import { evaluateKaladaV1 } from "./evaluate.js";
import type { JsonValue } from "./json.js";
import { type ResolvedKaladaV1Limits, resolveLimits } from "./limits.js";
import { analyzeKaladaV1Functions } from "./static-analysis.js";
import { isInstant } from "./temporal.js";
import type {
  CompiledKaladaV1Program,
  KaladaV1Clock,
  KaladaV1EvaluationInputs,
  KaladaV1FunctionCapture,
  KaladaV1Options,
  KaladaV1Outcome,
  KaladaV1Resolver,
} from "./types.js";

export function compileKaladaV1Program<R extends JsonValue = string>(
  input: unknown,
  options: KaladaV1Options<R> = {},
): KaladaV1Outcome<CompiledKaladaV1Program<R>> {
  const canonical = canonicalizeKaladaV1Program<R>(input, options);
  if (!canonical.ok) return canonical;
  let limits: ResolvedKaladaV1Limits;
  try {
    limits = resolveLimits(options.limits);
  } catch {
    return failure("KALADA_LIMIT_EXCEEDED", []);
  }
  const program = canonical.value;
  let functions: readonly KaladaV1FunctionCapture[];
  try {
    functions = analyzeKaladaV1Functions(program.expression, limits);
  } catch (error) {
    const problem =
      error instanceof KaladaFailure ? error : new KaladaFailure("KALADA_INVALID_INPUT", []);
    return failure(problem.code, problem.path);
  }
  const dependencies = collectKaladaV1Dependencies(program.expression);
  return success(
    Object.freeze({
      program,
      dependencies,
      functions,
      evaluate: (resolve: KaladaV1Resolver<R>, inputs?: KaladaV1EvaluationInputs) =>
        evaluateKaladaV1(program.expression, resolve, limits, functions, inputs),
      evaluateWithClock: (resolve: KaladaV1Resolver<R>, clock: KaladaV1Clock) =>
        evaluateWithClock(program.expression, resolve, limits, functions, clock),
    }),
  );
}

function evaluateWithClock<R extends JsonValue>(
  expression: Parameters<typeof evaluateKaladaV1<R>>[0],
  resolve: KaladaV1Resolver<R>,
  limits: ResolvedKaladaV1Limits,
  functions: readonly KaladaV1FunctionCapture[],
  clock: KaladaV1Clock,
): ReturnType<typeof evaluateKaladaV1<R>> {
  let sample: unknown;
  try {
    sample = clock();
  } catch {
    return failure("KALADA_CLOCK_ERROR", ["clock"]);
  }
  if (rejectCallbackPromise(sample)) return failure("KALADA_ASYNC_UNSUPPORTED", ["clock"]);
  if (!isInstant(sample)) return failure("KALADA_INVALID_CLOCK", ["clock"]);
  return evaluateKaladaV1(expression, resolve, limits, functions, { instant: sample });
}
