import { BUILTIN_WORKSPACE } from "../examples/builtin.js";
import { type DemoWorkspaceEnvelopeV1, validateEnvelope } from "./transfer.js";

export type WorkspaceFileName = "schema.json" | "data.json" | string;

export class WorkspaceModel {
  private envelope: DemoWorkspaceEnvelopeV1;
  constructor(initial: DemoWorkspaceEnvelopeV1 = BUILTIN_WORKSPACE) {
    this.envelope = validateEnvelope(initial);
  }
  snapshot(): DemoWorkspaceEnvelopeV1 {
    return this.envelope;
  }
  replace(next: DemoWorkspaceEnvelopeV1): void {
    this.envelope = validateEnvelope(next);
  }
  reset(): void {
    this.envelope = validateEnvelope(BUILTIN_WORKSPACE);
  }
  text(name: WorkspaceFileName): string {
    if (name === "schema.json") return this.envelope.schemaText;
    if (name === "data.json") return this.envelope.dataText;
    const document = this.envelope.documents.find((entry) => entry.name === name);
    if (!document) throw new Error("WORKSPACE_DOCUMENT_MISSING");
    return document.text;
  }
  revision(name: WorkspaceFileName): number {
    if (name === "schema.json") return this.envelope.schemaRevision;
    if (name === "data.json") return this.envelope.dataRevision;
    const document = this.envelope.documents.find((entry) => entry.name === name);
    if (!document) throw new Error("WORKSPACE_DOCUMENT_MISSING");
    return document.revision;
  }
  update(name: WorkspaceFileName, text: string, revision?: number): number {
    const nextRevision = revision ?? this.nextRevision(name);
    if (name === "schema.json")
      this.envelope = { ...this.envelope, schemaText: text, schemaRevision: nextRevision };
    else if (name === "data.json")
      this.envelope = { ...this.envelope, dataText: text, dataRevision: nextRevision };
    else this.updateExpression(name, text, nextRevision);
    return nextRevision;
  }
  select(name: WorkspaceFileName): void {
    this.envelope = { ...this.envelope, activeName: name };
  }
  seed(seed: number): void {
    this.envelope = { ...this.envelope, seed: seed >>> 0 };
  }
  private nextRevision(name: WorkspaceFileName): number {
    const current = this.revision(name);
    if (current >= Number.MAX_SAFE_INTEGER) throw new RangeError("WORKSPACE_REVISION_EXHAUSTED");
    return current + 1;
  }
  private updateExpression(name: string, text: string, revision: number): void {
    let found = false;
    const documents = this.envelope.documents.map((entry) => {
      if (entry.name !== name) return entry;
      found = true;
      return { ...entry, text, revision };
    });
    if (!found) throw new Error("WORKSPACE_DOCUMENT_MISSING");
    this.envelope = { ...this.envelope, documents };
  }
}
