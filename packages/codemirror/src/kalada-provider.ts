import type { HoverInfo, LanguageService, SnapshotIdentity } from "@kalada/language-service";
import type {
  EditorHover,
  EditorIdentity,
  EditorProvider,
  EditorRequest,
  EditorResult,
} from "./editor-contracts.js";

export class KaladaProvider implements EditorProvider {
  readonly service: LanguageService;
  readonly uri: string;
  readonly hovers = new WeakMap<EditorHover, HoverInfo>();
  private readonly identities = new WeakMap<EditorIdentity, SnapshotIdentity>();

  constructor(service: LanguageService, uri: string) {
    this.service = service;
    this.uri = uri;
  }

  isCurrent(identity: EditorIdentity): boolean {
    const original = this.identities.get(identity);
    return !!original && this.service.isCurrent(original);
  }

  diagnostics(request: EditorRequest) {
    const result = this.service.diagnostics(this.uri, cancellation(request));
    if (result.kind !== "diagnostics" || !this.service.isCurrent(result)) return null;
    return this.tagged(
      request,
      result,
      result.diagnostics.map((item) => ({
        ...(item.source ? this.range(item.source.range) : { from: 0, to: 0 }),
        message: item.message,
        severity: "error" as const,
      })),
    );
  }

  completion(request: EditorRequest, offset: number) {
    const result = this.service.completion(
      this.uri,
      this.document().lineIndex.positionAt(offset),
      cancellation(request),
    );
    if (result.kind !== "completion" || !this.service.isCurrent(result)) return null;
    return this.tagged(
      request,
      result,
      result.items.map((item) => ({
        label: item.label,
        edit: { ...this.range(item.edit.range), text: item.edit.text },
        type: item.kind === "binding" ? "variable" : item.kind,
        detail: `${item.support}, ${item.presence}`,
        boost: item.support === "common" ? 10 : 0,
      })),
    );
  }

  hover(request: EditorRequest, offset: number) {
    const result = this.service.hover(
      this.uri,
      this.document().lineIndex.positionAt(offset),
      cancellation(request),
    );
    if (result.kind !== "hover" || !result.hover || !this.service.isCurrent(result)) return null;
    const hover = { ...this.range(result.hover.range), content: "" };
    this.hovers.set(hover, result.hover);
    return this.tagged(request, result, hover);
  }

  format(request: EditorRequest) {
    const result = this.service.format(this.uri, cancellation(request));
    if (result.kind !== "format" || !result.edit || !this.service.isCurrent(result)) return null;
    return this.tagged(request, result, {
      ...this.range(result.edit.range),
      text: result.edit.text,
    });
  }

  private tagged<T>(request: EditorRequest, original: SnapshotIdentity, value: T): EditorResult<T> {
    const result = {
      uri: this.uri,
      version: request.snapshot.version,
      environmentGeneration: request.snapshot.environmentGeneration,
      value,
    };
    this.identities.set(result, original);
    return result;
  }

  private range(source: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  }) {
    const document = this.document();
    return {
      from: document.lineIndex.offsetAt(source.start),
      to: document.lineIndex.offsetAt(source.end),
    };
  }

  private document() {
    const document = this.service.getDocument(this.uri);
    if (!document) throw new Error("Kalada editor document is not open");
    return document;
  }
}

function cancellation(request: EditorRequest) {
  return { cancellation: { isCancellationRequested: () => request.signal.aborted } };
}
