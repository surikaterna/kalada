import { Validator } from "@cfworker/json-schema";
import type { StandardSchemaV1 } from "@scheman/core";
import { type AdmittedSchema, estimateValidationWork } from "./admission.js";

export interface DataValidation {
  readonly valid: boolean;
  readonly code:
    | "DATA_VALID"
    | "DATA_INVALID"
    | "DATA_WORKLOAD_UNSUPPORTED"
    | "DATA_VALIDATOR_FAILURE";
  readonly issues: readonly Readonly<{ instancePointer: string; schemaPointer: string }>[];
}

export interface WholeDataValidator {
  readonly standard: StandardSchemaV1<unknown, unknown>;
  readonly validate: (value: unknown) => DataValidation;
}

export function createWholeDataValidator(admitted: AdmittedSchema): WholeDataValidator {
  const validator = new Validator(admitted.schema, "2020-12", true);
  const validate = (value: unknown): DataValidation => {
    const workload = estimateValidationWork(admitted, value);
    if (!workload.supported) return result(false, "DATA_WORKLOAD_UNSUPPORTED", []);
    try {
      const outcome = validator.validate(value);
      if (outcome.valid) return result(true, "DATA_VALID", []);
      const issues = outcome.errors.slice(0, 32).map((error) =>
        Object.freeze({
          instancePointer: safePointer(error.instanceLocation),
          schemaPointer: safePointer(error.keywordLocation),
        }),
      );
      return result(false, "DATA_INVALID", issues);
    } catch {
      return result(false, "DATA_VALIDATOR_FAILURE", []);
    }
  };
  const standard: StandardSchemaV1<unknown, unknown> = {
    "~standard": {
      version: 1,
      vendor: "kalada-demo-cfworker",
      validate: (value) =>
        validate(value).valid
          ? { value }
          : { issues: [{ message: "Data failed schema validation" }] },
    },
  };
  return Object.freeze({ standard, validate });
}

function result(
  valid: boolean,
  code: DataValidation["code"],
  issues: DataValidation["issues"],
): DataValidation {
  return Object.freeze({ valid, code, issues: Object.freeze([...issues]) });
}

function safePointer(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) return "";
  if (!(value.startsWith("/") || value.startsWith("#/"))) return "";
  for (const character of value) if (character.charCodeAt(0) < 32) return "";
  return value;
}
