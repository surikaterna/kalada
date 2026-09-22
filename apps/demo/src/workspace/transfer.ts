import { DEMO_LIMITS, parseBoundedJson } from "../schema/limits.js";

export interface DemoDocumentRecord {
  readonly name: string;
  readonly text: string;
  readonly revision: number;
}

export interface DemoWorkspaceEnvelopeV1 {
  readonly format: "kalada-demo-workspace";
  readonly version: 1;
  readonly schemaText: string;
  readonly schemaRevision: number;
  readonly dataText: string;
  readonly dataRevision: number;
  readonly documents: readonly DemoDocumentRecord[];
  readonly activeName: string;
  readonly seed: number;
  readonly generatorVersion: "demo-input-candidate-v1";
}

const ROOT_KEYS = [
  "activeName",
  "dataRevision",
  "dataText",
  "documents",
  "format",
  "generatorVersion",
  "schemaRevision",
  "schemaText",
  "seed",
  "version",
].sort();
const DOCUMENT_KEYS = ["name", "revision", "text"];

export class WorkspaceTransferError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "WorkspaceTransferError";
  }
}

export function importWorkspace(text: string): DemoWorkspaceEnvelopeV1 {
  const value = parseBoundedJson(text, "transfer");
  return validateEnvelope(value);
}

export function exportWorkspace(value: DemoWorkspaceEnvelopeV1): string {
  const checked = validateEnvelope(value);
  const text = JSON.stringify(checked, null, 2);
  if (text.length > DEMO_LIMITS.transferText)
    throw new WorkspaceTransferError("TRANSFER_TEXT_LIMIT");
  return text;
}

export function validateEnvelope(value: unknown): DemoWorkspaceEnvelopeV1 {
  const input = passiveRecord(value, ROOT_KEYS, "TRANSFER_SHAPE");
  if (input.format !== "kalada-demo-workspace" || input.version !== 1) invalid("TRANSFER_VERSION");
  if (input.generatorVersion !== "demo-input-candidate-v1") invalid("TRANSFER_GENERATOR");
  const schemaText = boundedText(input.schemaText, DEMO_LIMITS.schemaText);
  const dataText = boundedText(input.dataText, DEMO_LIMITS.dataText);
  const documents = validateDocuments(input.documents);
  const activeName = boundedText(input.activeName, 64);
  if (
    !(
      activeName === "schema.json" ||
      activeName === "data.json" ||
      documents.some((doc) => doc.name === activeName)
    )
  ) {
    invalid("TRANSFER_ACTIVE_DOCUMENT");
  }
  return Object.freeze({
    format: "kalada-demo-workspace",
    version: 1,
    schemaText,
    schemaRevision: revision(input.schemaRevision),
    dataText,
    dataRevision: revision(input.dataRevision),
    documents,
    activeName,
    seed: uint32(input.seed),
    generatorVersion: "demo-input-candidate-v1",
  });
}

function validateDocuments(value: unknown): readonly DemoDocumentRecord[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > DEMO_LIMITS.expressionDocuments) {
    invalid("TRANSFER_DOCUMENT_COUNT");
  }
  const names = new Set<string>();
  const documents = value.map((item) => {
    const record = passiveRecord(item, DOCUMENT_KEYS, "TRANSFER_DOCUMENT");
    const name = boundedText(record.name, 64);
    if (!/^[A-Za-z0-9_-]+\.kalada$/u.test(name) || names.has(name))
      invalid("TRANSFER_DOCUMENT_NAME");
    names.add(name);
    return Object.freeze({
      name,
      text: boundedText(record.text, DEMO_LIMITS.expressionText),
      revision: revision(record.revision),
    });
  });
  return Object.freeze(documents);
}

function passiveRecord(value: unknown, keys: string[], code: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    invalid(code);
  const own = Object.keys(value).sort();
  if (own.length !== keys.length || own.some((key, index) => key !== [...keys].sort()[index]))
    invalid(code);
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) invalid(code);
  }
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) invalid("TRANSFER_TEXT");
  return value;
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid("TRANSFER_REVISION");
  return value as number;
}

function uint32(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffff_ffff)
    invalid("TRANSFER_SEED");
  return value as number;
}

function invalid(code: string): never {
  throw new WorkspaceTransferError(code);
}
