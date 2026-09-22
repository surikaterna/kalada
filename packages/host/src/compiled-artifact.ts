import type { CompiledKaladaV1Program } from "@kalada/core";
import type { CompiledExpression, ParsedExpression } from "./execution-contracts.js";

interface CompiledArtifactInput {
  readonly source: CompiledExpression["source"];
  readonly parsed: ParsedExpression;
  readonly program: CompiledExpression["program"];
  readonly sourceMap: CompiledExpression["sourceMap"];
  readonly resultType: CompiledExpression["resultType"];
  readonly compileProjectionFingerprint: string;
  readonly compileFingerprint: string;
}

const constructionToken = Object.freeze({});

class AuthenticCompiledExpression implements CompiledExpression {
  readonly format = "kalada-host-compiled-expression-v1" as const;
  readonly source: CompiledExpression["source"];
  readonly parsed: ParsedExpression;
  readonly program: CompiledExpression["program"];
  readonly sourceMap: CompiledExpression["sourceMap"];
  readonly coreCompilation: CompiledKaladaV1Program<string>;
  readonly dependencies: readonly string[];
  readonly resultType: CompiledExpression["resultType"];
  readonly compileProjectionFingerprint: string;
  readonly compileFingerprint: string;
  readonly #integrity: Readonly<Record<string, unknown>>;

  constructor(token: object, input: CompiledArtifactInput, core: CompiledKaladaV1Program<string>) {
    if (token !== constructionToken) throw new TypeError("Invalid compiled artifact construction.");
    this.source = input.source;
    this.parsed = input.parsed;
    this.program = input.program;
    this.sourceMap = input.sourceMap;
    this.coreCompilation = immutableCoreCompilation(core);
    this.dependencies = this.coreCompilation.dependencies;
    this.resultType = input.resultType;
    this.compileProjectionFingerprint = input.compileProjectionFingerprint;
    this.compileFingerprint = input.compileFingerprint;
    this.#integrity = integrityRecord(this);
    Object.freeze(this);
  }

  static authentic(input: unknown): input is AuthenticCompiledExpression {
    if (typeof input !== "object" || input === null || !(#integrity in input)) return false;
    return integrityMatches(input, input.#integrity);
  }
}

Object.freeze(AuthenticCompiledExpression.authentic);
Object.freeze(AuthenticCompiledExpression.prototype);
Object.freeze(AuthenticCompiledExpression);

export function createCompiledArtifact(
  input: CompiledArtifactInput,
  core: CompiledKaladaV1Program<string>,
): CompiledExpression {
  return new AuthenticCompiledExpression(constructionToken, input, core);
}

export function isAuthenticCompiledExpression(input: unknown): input is CompiledExpression {
  return AuthenticCompiledExpression.authentic(input);
}

function immutableCoreCompilation(
  core: CompiledKaladaV1Program<string>,
): CompiledKaladaV1Program<string> {
  const evaluate: CompiledKaladaV1Program<string>["evaluate"] = Object.freeze((resolve, inputs) =>
    core.evaluate(resolve, inputs),
  );
  const evaluateWithClock: CompiledKaladaV1Program<string>["evaluateWithClock"] = Object.freeze(
    (resolve, clock) => core.evaluateWithClock(resolve, clock),
  );
  return Object.freeze({
    program: core.program,
    dependencies: core.dependencies,
    functions: core.functions,
    evaluate,
    evaluateWithClock,
  });
}

function integrityRecord(input: CompiledExpression): Readonly<Record<string, unknown>> {
  return Object.freeze({
    source: input.source,
    parsed: input.parsed,
    program: input.program,
    sourceMap: input.sourceMap,
    coreCompilation: input.coreCompilation,
    dependencies: input.dependencies,
    resultType: input.resultType,
    compileProjectionFingerprint: input.compileProjectionFingerprint,
    compileFingerprint: input.compileFingerprint,
  });
}

function integrityMatches(
  input: AuthenticCompiledExpression,
  expected: Readonly<Record<string, unknown>>,
): boolean {
  if (!Object.isFrozen(input) || input.format !== "kalada-host-compiled-expression-v1")
    return false;
  return Object.entries(expected).every(
    ([key, value]) => input[key as keyof CompiledExpression] === value,
  );
}
