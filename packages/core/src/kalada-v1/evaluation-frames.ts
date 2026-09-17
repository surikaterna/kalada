import type { JsonValue } from "./json.js";
import type { RuntimeEnvironment, RuntimeValue, UserClosure } from "./runtime-values.js";
import type { KaladaCoreFunctionName, KaladaType, KaladaV1Expression, MatchArm } from "./types.js";

export type Path = readonly (string | number)[];
type Expression<R extends JsonValue> = KaladaV1Expression<R>;

export type EvaluationFrame<R extends JsonValue> =
  | {
      kind: "binding";
      phase: "value" | "body";
      path: Path;
      name: string;
      body: Expression<R>;
      outer: RuntimeEnvironment;
    }
  | {
      kind: "constructor";
      phase: "payload";
      path: Path;
      type: "Option" | "Result";
      variant: "some" | "ok" | "err";
    }
  | {
      kind: "match";
      phase: "scrutinee" | "arm";
      path: Path;
      type: "Option" | "Result";
      arms: readonly MatchArm<R>[];
      outer: RuntimeEnvironment;
      scrutinee: RuntimeValue | null;
      selected: number | null;
    }
  | {
      kind: "temporal-binary";
      phase: "left" | "right";
      path: Path;
      expressionKind: "temporal-arithmetic" | "temporal-comparison";
      operator: string;
      right: Expression<R>;
      left: RuntimeValue | null;
    }
  | {
      kind: "function-group-body";
      phase: "body";
      path: Path;
      body: Expression<R>;
      outer: RuntimeEnvironment;
      group: RuntimeEnvironment;
    }
  | { kind: "call-callee"; phase: "callee"; path: Path; arguments: readonly Expression<R>[] }
  | {
      kind: "call-arguments";
      phase: "argument";
      path: Path;
      callable: RuntimeValue;
      arguments: readonly Expression<R>[];
      values: RuntimeValue[];
      index: number;
    }
  | {
      kind: "user-return";
      phase: "body";
      path: Path;
      name: string | null;
      returns: KaladaType;
      caller: RuntimeEnvironment;
    }
  | {
      kind: "core-iteration";
      phase: "ready" | "callback";
      path: Path;
      operator: KaladaCoreFunctionName;
      callback: RuntimeValue;
      input: readonly JsonValue[];
      index: number;
      partial: JsonValue[] | boolean;
    };

export interface EvaluationTask<R extends JsonValue> {
  readonly node: Expression<R>;
  readonly path: Path;
  readonly environment: RuntimeEnvironment;
}

export function functionEnvironment<R extends JsonValue>(
  closure: UserClosure<R>,
  values: readonly RuntimeValue[],
): RuntimeEnvironment {
  const output = new Map(closure.captures);
  closure.recursive?.names.forEach((name, index) => {
    output.set(name, closure.recursive?.closures[index] as UserClosure<R>);
  });
  closure.parameters.forEach((parameter, index) => {
    output.set(parameter.name, values[index] as RuntimeValue);
  });
  return output;
}
