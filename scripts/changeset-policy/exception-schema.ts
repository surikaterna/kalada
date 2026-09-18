import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv } from "ajv/dist/ajv.js";
import type { ReleaseException } from "./types.js";

const ajv = new Ajv({ allErrors: true, strict: true });
const validators = new Map(
  [1, 2].map((version) => {
    const schemaPath = resolve(
      import.meta.dirname,
      `../../release-exceptions/schema.v${version}.json`,
    );
    return [
      version,
      ajv.compile<ReleaseException>(JSON.parse(readFileSync(schemaPath, "utf8"))),
    ] as const;
  }),
);

export function parseException(value: Buffer, path: string): ReleaseException {
  let record: unknown;
  try {
    record = JSON.parse(value.toString("utf8"));
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
  const version = isRecord(record) ? record.schemaVersion : undefined;
  const validate = validators.get(version as number);
  if (!validate?.(record)) {
    const details = validate
      ? ajv.errorsText(validate.errors, { separator: "; " })
      : "unsupported schemaVersion";
    throw new Error(`${path} does not match a supported exception schema: ${details}`);
  }
  return record as ReleaseException;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
