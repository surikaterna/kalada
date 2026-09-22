import {
  autocompletion,
  type CompletionResult as CodeMirrorCompletionResult,
  type Completion,
  type CompletionContext,
  closeCompletion,
  completionKeymap,
} from "@codemirror/autocomplete";
import { history, historyKeymap } from "@codemirror/commands";
import { setDiagnostics } from "@codemirror/lint";
import {
  EditorSelection,
  type Transaction as EditorTransaction,
  Transaction,
} from "@codemirror/state";
import {
  hoverTooltip as codeMirrorHover,
  EditorView,
  keymap,
  type Tooltip,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type {
  CompletionItem,
  DocumentSnapshot,
  LanguageService,
  SnapshotIdentity,
} from "@kalada/language-service";
import type { KaladaEditorSession, KaladaEditorSessionOptions } from "./contracts.js";
import {
  animationWindow,
  positionAt,
  translateDiagnostic,
  translatedTooltip,
  wholeReplacement,
} from "./session-helpers.js";
import { keyboardTooltipField, setKeyboardTooltip } from "./tooltip-state.js";
import { changesToEdits, rangeToOffsets } from "./translation.js";

export function createKaladaEditorSession(
  options: KaladaEditorSessionOptions,
): KaladaEditorSession {
  return new EditorSession(options);
}

class EditorSession implements KaladaEditorSession {
  readonly extension;
  private readonly service: LanguageService;
  private readonly uri: string;
  private readonly onDocumentChange?: (snapshot: DocumentSnapshot) => void;
  private view: EditorView | null = null;
  private expectedText: string;
  private revision: number;
  private disposed = false;
  private viewEpoch = 0;
  private completionEpoch = 0;
  private hoverEpoch = 0;
  private diagnosticsEpoch = 0;
  private diagnosticsFrame: number | null = null;

  constructor(options: KaladaEditorSessionOptions) {
    this.service = options.service;
    this.uri = options.document.uri;
    this.onDocumentChange = options.onDocumentChange;
    const opened = this.service.openDocument(options.document);
    this.expectedText = opened.text;
    this.revision = opened.version;
    this.extension = this.createExtension();
  }

  refreshEnvironment(): void {
    this.assertOpen();
    this.invalidateRequests();
    const view = this.view;
    if (!view) return;
    closeCompletion(view);
    view.dispatch({ effects: setKeyboardTooltip.of(null) });
    this.scheduleDiagnostics(view);
  }

  replaceDocument(text: string): void {
    this.assertOpen();
    if (typeof text !== "string") throw new TypeError("Replacement text must be a string");
    const view = this.view;
    if (view) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: EditorSelection.cursor(0),
        annotations: Transaction.addToHistory.of(true),
      });
      return;
    }
    const current = this.requireDocument();
    const snapshot = this.service.updateDocument({
      uri: this.uri,
      version: this.nextRevision(),
      edits: [wholeReplacement(current, text)],
    });
    this.expectedText = snapshot.text;
    this.invalidateRequests();
    this.notify(snapshot);
  }

  format(): boolean {
    this.assertOpen();
    const view = this.view;
    if (!view) return false;
    const epoch = this.completionEpoch;
    const result = this.service.format(this.uri, {
      cancellation: this.cancellation("completion", epoch),
    });
    if (
      result.kind !== "format" ||
      !result.edit ||
      !this.publishable(result, view, epoch, "completion")
    ) {
      return false;
    }
    const range = rangeToOffsets(view.state.doc, result.edit.range);
    if (!range) return false;
    view.dispatch({
      changes: { ...range, insert: result.edit.text },
      annotations: Transaction.addToHistory.of(true),
    });
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidateRequests();
    this.cancelDiagnosticsFrame();
    this.view = null;
    this.service.closeDocument(this.uri);
  }

  private createExtension() {
    const session = this;
    const lifecycle = ViewPlugin.define((view) => {
      session.attach(view);
      return {
        update(update: ViewUpdate): void {
          session.updateView(update);
        },
        destroy(): void {
          session.detach(view);
        },
      };
    });
    return [
      lifecycle,
      history(),
      autocompletion({ override: [(context) => this.complete(context)] }),
      codeMirrorHover((view, position) => this.pointerHover(view, position)),
      keyboardTooltipField,
      keymap.of([
        ...completionKeymap,
        ...historyKeymap,
        { key: "Mod-Shift-h", run: (view) => this.keyboardHover(view) },
        { key: "Escape", run: (view) => this.clearInteractions(view) },
      ]),
      EditorView.contentAttributes.of({ "aria-label": "Kalada expression editor" }),
    ];
  }

  private attach(view: EditorView): void {
    this.assertOpen();
    if (this.view && this.view !== view)
      throw new Error("Kalada editor session already has a view");
    if (view.state.doc.toString() !== this.expectedText) {
      throw new Error("CodeMirror document does not match the opened Kalada document");
    }
    this.view = view;
    this.viewEpoch += 1;
    this.scheduleDiagnostics(view);
  }

  private detach(view: EditorView): void {
    if (this.view !== view) return;
    this.cancelDiagnosticsFrame();
    this.invalidateRequests();
    this.view = null;
    this.viewEpoch += 1;
  }

  private updateView(update: ViewUpdate): void {
    if (!update.docChanged) return;
    this.invalidateRequests();
    for (const transaction of update.transactions) {
      if (transaction.docChanged) this.applyTransaction(transaction);
    }
    this.expectedText = update.state.doc.toString();
    this.scheduleDiagnostics(update.view);
  }

  private applyTransaction(transaction: EditorTransaction): void {
    const current = this.requireDocument();
    if (current.text !== transaction.startState.doc.toString()) {
      throw new Error("CodeMirror and language-service snapshots diverged");
    }
    const edits = changesToEdits(
      transaction.startState.doc,
      transaction.newDoc,
      transaction.changes,
      current,
    );
    const snapshot = this.service.updateDocument({
      uri: this.uri,
      version: this.nextRevision(),
      edits,
    });
    if (snapshot.text !== transaction.newDoc.toString()) {
      throw new Error("CodeMirror transaction translation changed document text");
    }
    this.expectedText = snapshot.text;
    this.notify(snapshot);
  }

  private complete(context: CompletionContext): CodeMirrorCompletionResult | null {
    const view = this.view;
    if (!view || view.state !== context.state || this.disposed) return null;
    const epoch = ++this.completionEpoch;
    const result = this.service.completion(this.uri, positionAt(context.state.doc, context.pos), {
      cancellation: this.cancellation("completion", epoch),
    });
    if (result.kind !== "completion" || !this.publishable(result, view, epoch, "completion")) {
      return null;
    }
    const translated = result.items.map((item) =>
      this.translateCompletion(item, result, view, epoch),
    );
    const available = translated.filter((entry) => entry !== null);
    const first = available[0];
    return first
      ? { from: first.from, to: first.to, options: available.map(({ option }) => option) }
      : null;
  }

  private translateCompletion(
    item: CompletionItem,
    identity: SnapshotIdentity,
    view: EditorView,
    epoch: number,
  ): Readonly<{ from: number; to: number; option: Completion }> | null {
    const range = rangeToOffsets(view.state.doc, item.edit.range);
    if (!range) return null;
    const option: Completion = {
      label: item.label,
      type: item.kind === "binding" ? "variable" : item.kind,
      detail: `${item.support}, ${item.presence}`,
      boost: item.support === "common" ? 10 : 0,
      apply: (target) => this.applyCompletion(target, item, identity, epoch),
    };
    return { ...range, option };
  }

  private applyCompletion(
    view: EditorView,
    item: CompletionItem,
    identity: SnapshotIdentity,
    epoch: number,
  ): void {
    if (!this.publishable(identity, view, epoch, "completion")) return;
    const range = rangeToOffsets(view.state.doc, item.edit.range);
    if (!range) return;
    view.dispatch({ changes: { ...range, insert: item.edit.text } });
  }

  private pointerHover(view: EditorView, offset: number): Tooltip | null {
    return this.requestHover(view, offset);
  }

  private keyboardHover(view: EditorView): boolean {
    const tooltip = this.requestHover(view, view.state.selection.main.head);
    if (!tooltip) return false;
    view.dispatch({ effects: setKeyboardTooltip.of(tooltip) });
    return true;
  }

  private requestHover(view: EditorView, offset: number): Tooltip | null {
    const epoch = ++this.hoverEpoch;
    const result = this.service.hover(this.uri, positionAt(view.state.doc, offset), {
      cancellation: this.cancellation("hover", epoch),
    });
    if (
      result.kind !== "hover" ||
      !result.hover ||
      !this.publishable(result, view, epoch, "hover")
    ) {
      return null;
    }
    return translatedTooltip(result, view);
  }

  private clearInteractions(view: EditorView): boolean {
    closeCompletion(view);
    view.dispatch({ effects: setKeyboardTooltip.of(null) });
    view.focus();
    return true;
  }

  private scheduleDiagnostics(view: EditorView): void {
    this.cancelDiagnosticsFrame();
    const epoch = ++this.diagnosticsEpoch;
    const viewEpoch = this.viewEpoch;
    this.diagnosticsFrame = animationWindow(view).requestAnimationFrame(() => {
      this.diagnosticsFrame = null;
      const result = this.service.diagnostics(this.uri, {
        cancellation: this.cancellation("diagnostics", epoch),
      });
      if (result.kind !== "diagnostics" || !this.publishable(result, view, epoch, "diagnostics"))
        return;
      if (this.viewEpoch !== viewEpoch) return;
      view.dispatch(
        setDiagnostics(
          view.state,
          result.diagnostics.map((entry) => translateDiagnostic(entry, view)),
        ),
      );
    });
  }

  private cancelDiagnosticsFrame(): void {
    if (this.diagnosticsFrame === null || !this.view) return;
    animationWindow(this.view).cancelAnimationFrame(this.diagnosticsFrame);
    this.diagnosticsFrame = null;
  }

  private cancellation(kind: RequestKind, epoch: number) {
    return {
      isCancellationRequested: () => this.disposed || this.epoch(kind) !== epoch,
    };
  }

  private publishable(
    identity: SnapshotIdentity,
    view: EditorView,
    epoch: number,
    kind: RequestKind,
  ): boolean {
    return (
      !this.disposed &&
      this.view === view &&
      this.epoch(kind) === epoch &&
      "status" in identity &&
      identity.status === "current" &&
      this.service.isCurrent(identity)
    );
  }

  private epoch(kind: RequestKind): number {
    if (kind === "completion") return this.completionEpoch;
    if (kind === "hover") return this.hoverEpoch;
    return this.diagnosticsEpoch;
  }

  private invalidateRequests(): void {
    this.completionEpoch += 1;
    this.hoverEpoch += 1;
    this.diagnosticsEpoch += 1;
  }

  private nextRevision(): number {
    if (this.revision >= Number.MAX_SAFE_INTEGER)
      throw new RangeError("Kalada document revision exhausted");
    this.revision += 1;
    return this.revision;
  }

  private requireDocument(): DocumentSnapshot {
    const document = this.service.getDocument(this.uri);
    if (!document) throw new Error("Kalada editor document is not open");
    return document;
  }

  private notify(snapshot: DocumentSnapshot): void {
    try {
      this.onDocumentChange?.(snapshot);
    } catch {}
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error("Kalada editor session is disposed");
  }
}

type RequestKind = "completion" | "hover" | "diagnostics";
