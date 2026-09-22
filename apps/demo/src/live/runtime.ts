import {
  type CompiledExpression,
  compileExpression,
  linkExpression,
  type PreparedExpression,
  parseExpression,
} from "@kalada/host";
import {
  createLanguageService,
  type DocumentSnapshot,
  type LanguageService,
} from "@kalada/language-service";
import { type GenerationResult, generateCandidate } from "../generation/candidate.js";
import type { DemoEnvironment } from "../schema/environment.js";
import { parseBoundedJson } from "../schema/limits.js";
import type { DataValidation } from "../schema/validator.js";
import type { WorkspaceModel } from "../workspace/model.js";
import { nameFromUri, uriForName } from "../workspace/uris.js";
import {
  emptyFile,
  failedEnvironment,
  failureFile,
  freezeSnapshot,
  resultFile,
  waitingFile,
} from "./snapshots.js";

export { uriForName } from "../workspace/uris.js";

const DEBOUNCE_MS = 150;
export type RuntimeState = "loading" | "invalid" | "ready";
export interface FileResult {
  readonly name: string;
  readonly state: RuntimeState;
  readonly output?: unknown;
  readonly diagnostics: readonly unknown[];
  readonly resultType?: unknown;
  readonly dependencies: readonly string[];
  readonly timing: Readonly<{ prepare: number; evaluate: number }>;
  readonly compiled?: CompiledExpression;
  readonly prepared?: PreparedExpression;
}
export interface RuntimeSnapshot {
  readonly state: RuntimeState;
  readonly code: string;
  readonly environment?: DemoEnvironment;
  readonly data?: unknown;
  readonly dataValidation?: DataValidation;
  readonly files: ReadonlyMap<string, FileResult>;
}
interface Cache {
  version: number;
  projection: string;
  environmentGeneration: number;
  compiled?: CompiledExpression;
  prepared?: PreparedExpression;
}

export class DemoRuntime {
  readonly service: LanguageService;
  private readonly model: WorkspaceModel;
  private readonly publish: (snapshot: RuntimeSnapshot) => void;
  private readonly refreshEditors: () => void;
  private workspaceEpoch = 1;
  private environmentGeneration = 0;
  private validationGeneration = 0;
  private settingsVersion = 1;
  private sequence = 0;
  private state: RuntimeState = "loading";
  private code = "SCHEMA_LOADING";
  private environment?: DemoEnvironment;
  private data?: unknown;
  private hasData = false;
  private dataValidation?: DataValidation;
  private readonly files = new Map<string, FileResult>();
  private readonly caches = new Map<string, Cache>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly generationKeys = new WeakMap<object, string>();
  private disposed = false;

  constructor(
    model: WorkspaceModel,
    publish: (snapshot: RuntimeSnapshot) => void,
    refreshEditors: () => void,
  ) {
    this.model = model;
    this.publish = publish;
    this.refreshEditors = refreshEditors;
    this.service = createLanguageService({ generation: 0, description: failedEnvironment() });
    for (const document of model.snapshot().documents)
      this.files.set(document.name, emptyFile(document.name));
  }

  start(): void {
    this.schemaChanged();
  }
  schemaChanged(): void {
    this.invalidateEnvironment("SCHEMA_LOADING");
    this.schedule("schema", () => void this.installSchema(), DEBOUNCE_MS);
  }
  dataChanged(): void {
    this.validationGeneration += 1;
    this.data = undefined;
    this.hasData = false;
    this.dataValidation = undefined;
    this.state = "loading";
    this.code = "DATA_LOADING";
    this.clearOutputs("DATA_LOADING");
    const key = this.dataKey();
    this.schedule("data", () => this.validateData(key), DEBOUNCE_MS);
  }
  documentChanged(snapshot: DocumentSnapshot): void {
    this.model.update(nameFromUri(snapshot.uri), snapshot.text, snapshot.version);
    this.caches.delete(nameFromUri(snapshot.uri));
    this.files.set(
      nameFromUri(snapshot.uri),
      emptyFile(nameFromUri(snapshot.uri), "SOURCE_LOADING"),
    );
    const key = this.fileKey(nameFromUri(snapshot.uri));
    this.schedule(
      `file:${snapshot.uri}`,
      () => this.prepareAndEvaluate(nameFromUri(snapshot.uri), key),
      DEBOUNCE_MS,
    );
    this.emit();
  }
  evaluateAll(): void {
    for (const document of this.model.snapshot().documents) {
      this.prepareAndEvaluate(document.name, this.fileKey(document.name));
    }
  }
  generate(seed: number): GenerationResult {
    const key = this.generationKey(seed);
    if (!this.environment) return Object.freeze({ ok: false, code: "generation-unsupported" });
    const result = generateCandidate(
      this.environment.adapted.environment.editorGraph,
      seed,
      this.environment.validator.validate,
    );
    if (this.disposed || key !== this.generationKey(seed)) {
      return Object.freeze({ ok: false, code: "generation-stale" });
    }
    if (result.ok) this.generationKeys.set(result, key);
    return result;
  }
  applyGenerated(result: GenerationResult, seed: number, apply: (bytes: string) => void): boolean {
    if (
      !result.ok ||
      !result.bytes ||
      this.disposed ||
      this.generationKeys.get(result) !== this.generationKey(seed)
    ) {
      return false;
    }
    this.generationKeys.delete(result);
    apply(result.bytes);
    return true;
  }
  snapshot(): RuntimeSnapshot {
    return freezeSnapshot(
      this.state,
      this.code,
      this.environment,
      this.data,
      this.dataValidation,
      this.files,
    );
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.workspaceEpoch += 1;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private async installSchema(): Promise<void> {
    const key = this.schemaKey();
    try {
      const { createDemoEnvironment } = await import("../schema/environment.js");
      const environment = await createDemoEnvironment(this.model.snapshot().schemaText);
      if (!this.currentSchema(key)) return;
      this.environment = environment;
      this.state = "loading";
      this.code = "DATA_LOADING";
      this.environmentGeneration += 1;
      this.service.updateEnvironment({
        generation: this.environmentGeneration,
        description: environment.adapted,
      });
      this.refreshEditors();
      this.validationGeneration += 1;
      this.validateData(this.dataKey());
    } catch {
      if (!this.currentSchema(key)) return;
      this.state = "invalid";
      this.code = "SCHEMA_INVALID_OR_UNSUPPORTED";
      this.emit();
    }
  }

  private validateData(key: string): void {
    if (key !== this.dataKey() || !this.environment) return;
    try {
      const data = parseBoundedJson(this.model.snapshot().dataText, "data");
      const validation = this.environment.validator.validate(data);
      if (key !== this.dataKey()) return;
      this.dataValidation = validation;
      if (!validation.valid) {
        this.state = "invalid";
        this.code = validation.code;
        this.emit();
        return;
      }
      this.data = data;
      this.hasData = true;
      this.state = "ready";
      this.code = "WORKSPACE_READY";
      this.evaluateAll();
    } catch {
      this.state = "invalid";
      this.code = "DATA_JSON_INVALID";
      this.emit();
    }
  }

  private prepareAndEvaluate(name: string, key: string): void {
    if (key !== this.fileKey(name)) return;
    const started = performance.now();
    const prepared = this.prepare(name);
    const prepareTime = performance.now() - started;
    if (key !== this.fileKey(name)) return;
    if (!prepared.ok) {
      this.files.set(name, failureFile(name, prepared.diagnostics, prepareTime));
      this.emit();
      return;
    }
    if (!this.hasData || !this.dataValidation?.valid) {
      this.files.set(name, waitingFile(name, prepared.value, prepareTime));
      this.emit();
      return;
    }
    const evaluatedAt = performance.now();
    const outcome = prepared.value.evaluate({ data: this.data });
    const evaluateTime = performance.now() - evaluatedAt;
    if (key !== this.fileKey(name)) return;
    this.files.set(name, resultFile(name, prepared.value, outcome, prepareTime, evaluateTime));
    this.emit();
  }

  private prepare(name: string) {
    if (!this.environment)
      return { ok: false as const, diagnostics: [{ code: "SCHEMA_NOT_READY" }] };
    const version = this.model.revision(name);
    const projection = JSON.stringify(this.environment.adapted.environment.compileProjection);
    const cached = this.caches.get(name);
    let compiled =
      cached?.version === version && cached.projection === projection ? cached.compiled : undefined;
    if (!compiled) {
      const parsed = parseExpression(this.model.text(name), { sourceUri: uriForName(name) });
      if (!parsed.ok) return parsed;
      const result = compileExpression(
        parsed.value,
        this.environment.adapted.environment.compileProjection,
      );
      if (!result.ok) return result;
      compiled = result.value;
    }
    if (
      cached?.prepared &&
      cached.version === version &&
      cached.environmentGeneration === this.environmentGeneration
    )
      return { ok: true as const, value: cached.prepared };
    const linked = linkExpression(
      compiled,
      this.environment.adapted.environment,
      this.environment.adapted.capabilitySnapshot,
    );
    if (!linked.ok) return linked;
    this.caches.set(name, {
      version,
      projection,
      environmentGeneration: this.environmentGeneration,
      compiled,
      prepared: linked.value,
    });
    return linked;
  }

  private invalidateEnvironment(code: string): void {
    this.environment = undefined;
    this.data = undefined;
    this.hasData = false;
    this.dataValidation = undefined;
    this.state = "loading";
    this.code = code;
    this.environmentGeneration += 1;
    this.service.updateEnvironment({
      generation: this.environmentGeneration,
      description: failedEnvironment(),
    });
    this.refreshEditors();
    for (const cache of this.caches.values()) cache.prepared = undefined;
    this.clearOutputs(code);
  }
  private clearOutputs(code: string): void {
    for (const name of this.files.keys()) this.files.set(name, emptyFile(name, code));
    this.emit();
  }
  private schedule(name: string, task: () => void, delay: number): void {
    const old = this.timers.get(name);
    if (old) clearTimeout(old);
    this.timers.set(
      name,
      setTimeout(() => {
        this.timers.delete(name);
        if (!this.disposed) task();
      }, delay),
    );
  }
  private schemaKey(): string {
    return `${this.workspaceEpoch}:${this.model.snapshot().schemaRevision}:${this.environmentGeneration}:${this.settingsVersion}:${++this.sequence}`;
  }
  private currentSchema(key: string): boolean {
    const parts = key.split(":");
    return (
      !this.disposed &&
      Number(parts[0]) === this.workspaceEpoch &&
      Number(parts[1]) === this.model.snapshot().schemaRevision &&
      Number(parts[2]) === this.environmentGeneration &&
      Number(parts[3]) === this.settingsVersion
    );
  }
  private dataKey(): string {
    return `${this.workspaceEpoch}:${this.model.snapshot().schemaRevision}:${this.model.snapshot().dataRevision}:${this.environmentGeneration}:${this.validationGeneration}:${this.settingsVersion}`;
  }
  private fileKey(name: string): string {
    return `${this.dataKey()}:${name}:${this.model.revision(name)}`;
  }
  private generationKey(seed: number): string {
    const snapshot = this.model.snapshot();
    return `${this.workspaceEpoch}:${snapshot.schemaRevision}:${snapshot.dataRevision}:${this.environmentGeneration}:${this.settingsVersion}:${seed}:demo-input-candidate-v1`;
  }
  private emit(): void {
    this.publish(this.snapshot());
  }
}
