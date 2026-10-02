import { history, historyKeymap } from "@codemirror/commands";
import { Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, type Tooltip, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type {
  EditorHover,
  EditorIdentity,
  EditorSession,
  EditorSessionOptions,
  EditorSnapshot,
} from "./editor-contracts.js";
import { EditorTooling } from "./editor-tooling.js";
import { detectLineSeparator, textForEditor, textFromEditor } from "./line-separator.js";

/** Internal bridge hooks are deliberately not part of the neutral public entry point. */
export interface EditorBridge {
  changed?: (snapshot: EditorSnapshot, previous: EditorSnapshot, transaction?: Transaction) => void;
  renderHover?: (hover: EditorHover, from: number, to: number) => Tooltip;
  isCurrent?: (identity: EditorIdentity) => boolean;
  filterCompletions?: boolean;
}

export function createEditorSession(options: EditorSessionOptions): EditorSession {
  return new NeutralEditorSession(options);
}

export class NeutralEditorSession implements EditorSession {
  readonly extension;
  private snapshot: EditorSnapshot;
  private attached: EditorView | null = null;
  private disposed = false;
  private readonly separator = new Compartment();
  private readonly tooling: EditorTooling;
  private readonly options: EditorSessionOptions;
  private readonly bridge: EditorBridge;

  constructor(options: EditorSessionOptions, bridge: EditorBridge = {}) {
    this.options = options;
    this.bridge = bridge;
    const document = options.document;
    if (
      typeof document.text !== "string" ||
      typeof document.uri !== "string" ||
      document.uri.length === 0 ||
      !Number.isSafeInteger(document.version) ||
      document.version < 0
    )
      throw new TypeError("Invalid editor document");
    this.snapshot = Object.freeze({ ...document, environmentGeneration: 0 });
    this.tooling = new EditorTooling(
      {
        snapshot: () => this.snapshot,
        view: () => (this.disposed ? null : this.attached),
        renderHover: bridge.renderHover,
        isCurrent: bridge.isCurrent,
        filterCompletions: bridge.filterCompletions,
      },
      options.provider,
    );
    this.extension = this.createExtension();
  }

  getSnapshot(): EditorSnapshot {
    return this.snapshot;
  }

  refreshEnvironment(): void {
    this.assertOpen();
    if (this.snapshot.environmentGeneration >= Number.MAX_SAFE_INTEGER)
      throw new RangeError("Editor environment generation exhausted");
    this.snapshot = Object.freeze({
      ...this.snapshot,
      environmentGeneration: this.snapshot.environmentGeneration + 1,
    });
    if (!this.attached) {
      this.tooling.invalidate();
      return;
    }
    this.tooling.clear(this.attached, true);
    this.tooling.schedule(this.attached);
  }

  replaceDocument(text: string): void {
    this.assertOpen();
    if (typeof text !== "string") throw new TypeError("Replacement text must be a string");
    const view = this.attached;
    if (!view) {
      this.changed(text);
      return;
    }
    const separator = detectLineSeparator(text);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: textForEditor(text) },
      selection: EditorSelection.cursor(0),
      annotations: Transaction.addToHistory.of(true),
      effects:
        separator === view.state.lineBreak
          ? undefined
          : this.separator.reconfigure(EditorState.lineSeparator.of(separator)),
    });
  }

  format(): boolean | Promise<boolean> {
    this.assertOpen();
    return this.tooling.format();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tooling.invalidate(this.attached);
    if (this.attached) this.tooling.clear(this.attached, true);
    this.attached = null;
  }

  private createExtension() {
    const session = this;
    return [
      ViewPlugin.define((view) => {
        this.attach(view);
        return {
          update: (update: ViewUpdate) => this.update(update),
          destroy: () => this.detach(view),
        };
      }),
      this.separator.of({
        // Resolve when CodeMirror builds a state, including reuse of a cached extension.
        get extension() {
          return EditorState.lineSeparator.of(detectLineSeparator(session.snapshot.text));
        },
      }),
      history(),
      this.tooling.extension(),
      keymap.of(historyKeymap),
      EditorView.contentAttributes.of({ "aria-label": this.options.ariaLabel ?? "Source editor" }),
      this.options.extensions ?? [],
    ];
  }

  private attach(view: EditorView): void {
    this.assertOpen();
    if (this.attached && this.attached !== view)
      throw new Error("Editor session already has a view");
    if (textFromEditor(view.state.doc, view.state.lineBreak) !== this.snapshot.text)
      throw new Error("CodeMirror document does not match the opened document");
    this.attached = view;
    this.tooling.schedule(view);
  }

  private detach(view: EditorView): void {
    if (this.attached !== view) return;
    this.attached = null;
    this.tooling.invalidate(view);
  }

  private update(update: ViewUpdate): void {
    if (this.disposed || !update.docChanged) return;
    for (const transaction of update.transactions) {
      if (!transaction.docChanged) continue;
      if (
        textFromEditor(transaction.startState.doc, transaction.startState.lineBreak) !==
        this.snapshot.text
      )
        throw new Error("CodeMirror and editor snapshots diverged");
      this.changed(textFromEditor(transaction.newDoc, transaction.state.lineBreak), transaction);
    }
    this.tooling.schedule(update.view);
  }

  private changed(text: string, transaction?: Transaction): void {
    if (this.snapshot.version >= Number.MAX_SAFE_INTEGER)
      throw new RangeError("Editor document revision exhausted");
    this.tooling.invalidate();
    const previous = this.snapshot;
    const snapshot = Object.freeze({ ...previous, version: previous.version + 1, text });
    this.bridge.changed?.(snapshot, previous, transaction);
    this.snapshot = snapshot;
    try {
      this.options.onDocumentChange?.(snapshot);
    } catch {}
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error("Editor session is disposed");
  }
}
