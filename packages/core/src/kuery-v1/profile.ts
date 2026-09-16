import type { JsonValue } from "./types.js";

export type ExpressionValueType =
  | "any"
  | "null"
  | "boolean"
  | "number"
  | "string"
  | "array"
  | "object";
export const MAX_EXPRESSION_OPERATOR_ARGS = 32;
export type ExpressionOperatorFn = (args: readonly JsonValue[]) => JsonValue;
type ExpressionEvaluationStrategy = "and" | "or" | "coalesce" | "exists" | "if";

export interface ExpressionOperatorDefinition {
  readonly name: string;
  readonly arity?: number;
  readonly minArgs?: number;
  readonly maxArgs?: number;
  readonly inputTypes?: readonly ExpressionValueType[];
  readonly resultType?: ExpressionValueType;
  readonly execute: ExpressionOperatorFn;
}

export interface ExpressionOperator extends ExpressionOperatorDefinition {}

const OPERATOR_NAME = /^[a-z][a-z0-9-]*(?:[.:/][a-z][a-z0-9-]*)*$/;
const NAMESPACED_OPERATOR_NAME = /^[a-z][a-z0-9-]*[.:/][a-z][a-z0-9-]*(?:[.:/][a-z][a-z0-9-]*)*$/;
const PROFILE_NAME = /^[A-Za-z][A-Za-z0-9._:/@-]{0,127}$/;
const EXPRESSION_VALUE_TYPES = new Set<ExpressionValueType>([
  "any",
  "null",
  "boolean",
  "number",
  "string",
  "array",
  "object",
]);
const PROFILE_STATE = new WeakMap<ExpressionProfile, ReadonlyMap<string, ExpressionOperator>>();
const OPERATOR_STRATEGIES = new WeakMap<ExpressionOperator, ExpressionEvaluationStrategy>();
const INVALID_INPUT_TYPES = Symbol("invalid input types");

interface DefinitionSnapshot {
  readonly name: unknown;
  readonly arity: unknown;
  readonly minArgs: unknown;
  readonly maxArgs: unknown;
  readonly inputTypes: unknown;
  readonly resultType: unknown;
  readonly execute: unknown;
  readonly strategy: unknown;
}

type ValidDefinitionSnapshot = DefinitionSnapshot & {
  readonly name: string;
  readonly arity: number | undefined;
  readonly minArgs: number | undefined;
  readonly maxArgs: number | undefined;
  readonly inputTypes: readonly ExpressionValueType[] | undefined;
  readonly resultType: ExpressionValueType | undefined;
  readonly execute: ExpressionOperatorFn;
  readonly strategy: ExpressionEvaluationStrategy | undefined;
};
/**
 * Structurally immutable snapshot of operator metadata and callback identities.
 * Callbacks are trusted host code; their closed-over or function-object state remains producer-owned.
 */
export class ExpressionProfile {
  readonly name: string;

  constructor(name: string, operators: Iterable<ExpressionOperatorDefinition>) {
    validateProfileName(name);
    const snapshot = new Map<string, ExpressionOperator>();
    addDefinitions(operators, snapshot);
    this.name = name;
    PROFILE_STATE.set(this, snapshot);
    Object.freeze(this);
  }

  /** Derive a new immutable profile while preserving this profile's evaluation semantics. */
  extend(name: string, operators: Iterable<ExpressionOperatorDefinition>): ExpressionProfile {
    validateProfileName(name);
    const snapshot = new Map(profileOperators(this));
    for (const definition of operators) {
      const captured = captureDefinition(definition);
      validateCustomDefinition(captured);
      if (snapshot.has(captured.name))
        throw new TypeError(`Duplicate expression operator: ${captured.name}`);
      snapshot.set(captured.name, freezeDefinition(captured));
    }
    return createProfileSnapshot(name, snapshot);
  }

  get(name: string): ExpressionOperator | undefined {
    validateLookupName(name);
    return profileOperators(this).get(name);
  }

  has(name: string): boolean {
    validateLookupName(name);
    return profileOperators(this).has(name);
  }

  get definitions(): readonly ExpressionOperator[] {
    return Object.freeze([...profileOperators(this).values()]);
  }
}

function profileOperators(profile: ExpressionProfile): ReadonlyMap<string, ExpressionOperator> {
  const operators = PROFILE_STATE.get(profile);
  if (!operators) throw new TypeError("Invalid expression profile receiver.");
  return operators;
}

function addDefinitions(
  operators: Iterable<ExpressionOperatorDefinition>,
  snapshot: Map<string, ExpressionOperator>,
): void {
  for (const definition of operators) {
    const captured = captureDefinition(definition);
    validateDefinition(captured);
    if (snapshot.has(captured.name))
      throw new TypeError(`Duplicate expression operator: ${captured.name}`);
    snapshot.set(captured.name, freezeDefinition(captured));
  }
}

function createProfileSnapshot(
  name: string,
  operators: ReadonlyMap<string, ExpressionOperator>,
): ExpressionProfile {
  validateProfileName(name);
  const profile = Object.create(ExpressionProfile.prototype) as ExpressionProfile;
  const snapshot = new Map(operators);
  Object.defineProperty(profile, "name", { value: name, enumerable: true });
  PROFILE_STATE.set(profile, snapshot);
  Object.freeze(profile);
  return profile;
}

/** Mutable construction helper whose build result is an independent structural snapshot. */
export class ExpressionProfileBuilder {
  private readonly definitions = new Map<string, ValidDefinitionSnapshot>();
  private readonly name: string;

  constructor(name: string) {
    validateProfileName(name);
    this.name = name;
  }

  add(definition: ExpressionOperatorDefinition): this {
    const captured = captureDefinition(definition);
    validateCustomDefinition(captured);
    if (this.definitions.has(captured.name))
      throw new TypeError(`Duplicate expression operator: ${captured.name}`);
    this.definitions.set(captured.name, captured);
    return this;
  }

  build(): ExpressionProfile {
    const operators = new Map<string, ExpressionOperator>();
    for (const [name, definition] of this.definitions)
      operators.set(name, freezeDefinition(definition));
    return createProfileSnapshot(this.name, operators);
  }
}

function validateDefinition(
  definition: DefinitionSnapshot,
): asserts definition is ValidDefinitionSnapshot {
  if (
    typeof definition.name !== "string" ||
    !OPERATOR_NAME.test(definition.name) ||
    typeof definition.execute !== "function"
  ) {
    throw new TypeError("Expression operator name or implementation is invalid.");
  }
  const inputTypes = validatedInputTypes(definition.inputTypes);
  validateResultType(definition.resultType);
  const arity = definition.arity;
  const minArgs = definition.minArgs;
  const maxArgs = definition.maxArgs;
  const hasExact = arity !== undefined;
  if (hasExact === (minArgs !== undefined || maxArgs !== undefined)) {
    throw new TypeError("Expression operators require exact arity or min/max arity.");
  }
  if (hasExact) validateCount(arity);
  if (minArgs !== undefined) validateCount(minArgs);
  if (maxArgs !== undefined) validateCount(maxArgs);
  if ((minArgs ?? 0) > (maxArgs ?? Number.MAX_SAFE_INTEGER)) {
    throw new TypeError("Expression operator minimum arity exceeds maximum arity.");
  }
  if (inputTypes && hasExact && inputTypes.length !== arity) {
    throw new TypeError("Expression operator input metadata must match exact arity.");
  }
  if (inputTypes && !hasExact && inputTypes.length !== 1) {
    throw new TypeError("Variadic expression operators accept one repeated input type.");
  }
}

function validateCustomDefinition(
  definition: DefinitionSnapshot,
): asserts definition is ValidDefinitionSnapshot {
  validateDefinition(definition);
  if (typeof definition.name !== "string" || !NAMESPACED_OPERATOR_NAME.test(definition.name)) {
    throw new TypeError("Custom expression operators require a namespaced name.");
  }
}

function validateProfileName(name: string): void {
  if (typeof name !== "string" || !PROFILE_NAME.test(name))
    throw new TypeError("Expression profile name is invalid.");
}

function validateLookupName(name: string): void {
  if (typeof name !== "string")
    throw new TypeError("Expression operator name must be a primitive string.");
}

function validatedInputTypes(input: unknown): readonly ExpressionValueType[] | undefined {
  if (input !== undefined && !validInputTypes(input)) {
    throw new TypeError("Expression operator input metadata is invalid.");
  }
  return input;
}

function validateResultType(input: unknown): asserts input is ExpressionValueType | undefined {
  if (input !== undefined && !isExpressionValueType(input)) {
    throw new TypeError("Expression operator result metadata is invalid.");
  }
}

function validInputTypes(input: unknown): input is readonly ExpressionValueType[] {
  if (!Array.isArray(input)) return false;
  for (let index = 0; index < input.length; index += 1) {
    if (!Object.hasOwn(input, index) || !isExpressionValueType(input[index])) return false;
  }
  return true;
}

function isExpressionValueType(value: unknown): value is ExpressionValueType {
  return typeof value === "string" && EXPRESSION_VALUE_TYPES.has(value as ExpressionValueType);
}

function validateCount(value: unknown): asserts value is number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > MAX_EXPRESSION_OPERATOR_ARGS
  ) {
    throw new TypeError("Expression operator arity is invalid.");
  }
}

function freezeDefinition(definition: ValidDefinitionSnapshot): ExpressionOperator {
  const operator = Object.freeze({
    name: definition.name,
    arity: definition.arity,
    minArgs: definition.minArgs,
    maxArgs: definition.maxArgs,
    inputTypes: definition.inputTypes,
    resultType: definition.resultType,
    execute: definition.execute,
  });
  if (definition.strategy) OPERATOR_STRATEGIES.set(operator, definition.strategy);
  return operator;
}

function createStandardProfile(
  name: string,
  operators: Iterable<
    ExpressionOperatorDefinition & { readonly strategy?: ExpressionEvaluationStrategy }
  >,
): ExpressionProfile {
  const snapshot = new Map<string, ExpressionOperator>();
  for (const definition of operators) {
    const captured = captureDefinition(definition, true);
    validateDefinition(captured);
    if (snapshot.has(captured.name))
      throw new TypeError(`Duplicate expression operator: ${captured.name}`);
    snapshot.set(captured.name, freezeDefinition(captured));
  }
  return createProfileSnapshot(name, snapshot);
}

function getEvaluationStrategy(
  operator: ExpressionOperator,
): ExpressionEvaluationStrategy | undefined {
  return OPERATOR_STRATEGIES.get(operator);
}

export const internalProfile = Object.freeze({ createStandardProfile, getEvaluationStrategy });

function captureDefinition(
  definition: ExpressionOperatorDefinition,
  includeStrategy = false,
): DefinitionSnapshot {
  const inputTypes = definition.inputTypes;
  return Object.freeze({
    name: definition.name,
    arity: definition.arity,
    minArgs: definition.minArgs,
    maxArgs: definition.maxArgs,
    inputTypes: captureInputTypes(inputTypes),
    resultType: definition.resultType,
    execute: definition.execute,
    strategy: includeStrategy
      ? (
          definition as ExpressionOperatorDefinition & {
            readonly strategy?: ExpressionEvaluationStrategy;
          }
        ).strategy
      : undefined,
  });
}

function captureInputTypes(input: unknown): unknown {
  if (input === undefined || !Array.isArray(input)) return input;
  try {
    const length = input.length;
    if (length > MAX_EXPRESSION_OPERATOR_ARGS) return INVALID_INPUT_TYPES;
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) output.push(input[index]);
    return Object.freeze(output);
  } catch {
    return INVALID_INPUT_TYPES;
  }
}
