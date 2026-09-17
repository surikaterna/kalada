import { canonicalizeKaladaV1Program } from "./canonicalize.js";
import { collectKaladaV1Dependencies } from "./dependencies.js";
import { failure, success } from "./diagnostics.js";
import { evaluateKaladaV1 } from "./evaluate.js";
import type { JsonValue } from "./json.js";
import { resolveLimits } from "./limits.js";
import type {
  CompiledKaladaV1Program,
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
      evaluate: (resolve: KaladaV1Resolver<R>) =>
        evaluateKaladaV1(program.expression, resolve, limits),
    }),
  );
}
