import type { JsonValue } from "@kalada/core/kalada-v1";
import { ProjectionFailure } from "./diagnostics.js";
import type { ProjectionPath, ProjectionV1Limits } from "./types.js";

export interface OutputTree {
  readonly value: JsonValue;
  readonly path: ProjectionPath;
  readonly entries?: readonly OutputEntry[];
  readonly items?: readonly OutputTree[];
}

export interface OutputEntry {
  readonly key: string;
  readonly keyPath: ProjectionPath;
  readonly output: OutputTree;
}

interface Checkpoint {
  readonly nodes: number;
  readonly bytes: number;
  readonly pending?: ProjectionFailure;
}

export class OutputAccounting {
  private readonly limits: Readonly<ProjectionV1Limits>;
  private nodes = 0;
  private bytes = 0;
  private pending?: ProjectionFailure;

  constructor(limits: Readonly<ProjectionV1Limits>) {
    this.limits = limits;
  }

  checkpoint(): Checkpoint {
    return { nodes: this.nodes, bytes: this.bytes, pending: this.pending };
  }

  rollback(checkpoint: Checkpoint): void {
    this.nodes = checkpoint.nodes;
    this.bytes = checkpoint.bytes;
    this.pending = checkpoint.pending;
  }

  failIfPending(): void {
    if (this.pending) throw this.pending;
  }

  failIfChanged(checkpoint: Checkpoint): void {
    if (this.pending && this.pending !== checkpoint.pending) throw this.pending;
  }

  chargeTree(tree: OutputTree, depth: number): void {
    this.occurrence(depth, tree.path, openingToken(tree.value));
    if (tree.items) this.chargeItems(tree.items, depth);
    if (tree.entries) this.chargeEntries(tree.entries, depth);
    if (tree.items || tree.entries) this.token(Array.isArray(tree.value) ? "]" : "}", tree.path);
  }

  startContainer(depth: number, path: ProjectionPath, token: "[" | "{"): void {
    this.occurrence(depth, path, token);
  }

  token(token: string, path: ProjectionPath): void {
    if (this.pending) return;
    const bytes = Buffer.byteLength(token);
    if (this.bytes + bytes > this.limits.maxOutputBytes) {
      this.pending = new ProjectionFailure("PROJECTION_OUTPUT_LIMIT", path);
      return;
    }
    this.bytes += bytes;
  }

  private occurrence(depth: number, path: ProjectionPath, token: string): void {
    if (this.pending) return;
    if (depth > this.limits.maxOutputDepth || this.nodes + 1 > this.limits.maxOutputNodes) {
      this.pending = new ProjectionFailure("PROJECTION_OUTPUT_LIMIT", path);
      return;
    }
    this.nodes += 1;
    this.token(token, path);
  }

  private chargeItems(items: readonly OutputTree[], depth: number): void {
    for (const [index, item] of items.entries()) {
      if (index > 0) this.token(",", item.path);
      this.chargeTree(item, depth + 1);
    }
  }

  private chargeEntries(entries: readonly OutputEntry[], depth: number): void {
    for (const [index, entry] of entries.entries()) {
      if (index > 0) this.token(",", entry.keyPath);
      this.token(JSON.stringify(entry.key), entry.keyPath);
      this.token(":", entry.keyPath);
      this.chargeTree(entry.output, depth + 1);
    }
  }
}

function openingToken(value: JsonValue): string {
  if (Array.isArray(value)) return "[";
  if (value !== null && typeof value === "object") return "{";
  return JSON.stringify(value);
}
