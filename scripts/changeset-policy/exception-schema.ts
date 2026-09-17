import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv } from "ajv/dist/ajv.js";
import type { ReleaseException } from "./types.js";

const schemaPath = resolve(import.meta.dirname, "../../release-exceptions/schema.v1.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv({ allErrors: true, strict: true, formats: { "date-time": true } });
const validate = ajv.compile<ReleaseException>(schema);

export function parseException(value: Buffer, path: string): ReleaseException {
  let record: unknown;
  try {
    record = JSON.parse(value.toString("utf8"));
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
  if (!validate(record)) {
    const details = ajv.errorsText(validate.errors, { separator: "; " });
    throw new Error(`${path} does not match schema.v1.json: ${details}`);
  }
  return record as ReleaseException;
}
