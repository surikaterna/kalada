import { rejectCallbackPromise } from "../kuery-v1/callback-promise.js";
import { canonicalizeKaladaV1Program } from "./canonicalize.js";
import { collectKaladaV1Dependencies } from "./dependencies.js";
import { failure, success } from "./diagnostics.js";
import { evaluateKaladaV1 } from "./evaluate.js";
import type { JsonValue } from "./json.js";
import { resolveLimits } from "./limits.js";
import { isInstant } from "./temporal.js";
import type {
  CompiledKaladaV1Program,
  KaladaV1Clock,
  KaladaV1EvaluationInputs,
  KaladaV1Limits,
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
  let limits: KaladaV1Limits;
  try {
    limits = resolveLimits(options.limits);
  } catch {
    return failure("KALADA_LIMIT_EXCEEDED", []);
  }
  const program = canonical.value;
  const dependencies = collectKaladaV1Dependencies(program.expression);
  return success(
    Object.freeze({
      program,
      dependencies,
      evaluate: (resolve: KaladaV1Resolver<R>, inputs?: KaladaV1EvaluationInputs) =>
        evaluateKaladaV1(program.expression, resolve, limits, inputs),
      evaluateWithClock: (resolve: KaladaV1Resolver<R>, clock: KaladaV1Clock) =>
        evaluateWithClock(program.expression, resolve, limits, clock),
    }),
  );
}

function evaluateWithClock<R extends JsonValue>(
  expression: Parameters<typeof evaluateKaladaV1<R>>[0],
  resolve: KaladaV1Resolver<R>,
  limits: KaladaV1Limits,
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
  return evaluateKaladaV1(expression, resolve, limits, { instant: sample });
}
