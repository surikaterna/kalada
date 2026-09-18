import {
  type CompiledKaladaV1Program,
  compileKaladaV1Program,
  type KaladaV1FunctionLimits,
  type KaladaV1Limits,
  type KaladaV1Program,
} from "@kalada/core/kalada-v1";
import { ProjectionFailure } from "./diagnostics.js";
import { invalid } from "./inspect.js";
import type { ProjectionPath } from "./types.js";

interface ExpressionState {
  readonly coreLimits: Partial<KaladaV1Limits & KaladaV1FunctionLimits> | undefined;
  readonly dependencies: string[];
  readonly seenDependencies: Set<string>;
  readonly programs: WeakMap<KaladaV1Program<string>, CompiledKaladaV1Program<string>>;
}

type CompileOutcome = ReturnType<typeof compileKaladaV1Program<string>>;

export function compileProjectionExpression(
  input: unknown,
  path: ProjectionPath,
  scope: ReadonlySet<string>,
  state: ExpressionState,
): KaladaV1Program<string> {
  let outcome: CompileOutcome;
  try {
    outcome = compileKaladaV1Program<string>(input, { limits: state.coreLimits });
  } catch {
    invalid(path);
  }
  if (!outcome.ok) throw new ProjectionFailure("PROJECTION_CORE_ERROR", path, outcome.diagnostic);
  collectDependencies(outcome.value.dependencies, scope, state);
  state.programs.set(outcome.value.program, outcome.value);
  return outcome.value.program;
}

function collectDependencies(
  dependencies: readonly string[],
  scope: ReadonlySet<string>,
  state: Pick<ExpressionState, "dependencies" | "seenDependencies">,
): void {
  for (const dependency of dependencies) {
    if (scope.has(dependency) || state.seenDependencies.has(dependency)) continue;
    state.seenDependencies.add(dependency);
    state.dependencies.push(dependency);
  }
}
