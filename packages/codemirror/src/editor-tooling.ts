import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
  closeCompletion,
  completionKeymap,
} from "@codemirror/autocomplete";
import { setDiagnostics } from "@codemirror/lint";
import { Transaction } from "@codemirror/state";
import {
  closeHoverTooltips,
  type EditorView,
  hoverTooltip,
  keymap,
  type Tooltip,
} from "@codemirror/view";
import type {
  EditorCompletion,
  EditorEdit,
  EditorHover,
  EditorIdentity,
  EditorProvider,
  EditorResponse,
  EditorResult,
  EditorSnapshot,
} from "./editor-contracts.js";
import { editorTooltip } from "./editor-presentation.js";
import { EditorRequests, type RequestTicket, resolveResponse } from "./editor-requests.js";
import { editorOffset, sourceOffset, validEdit, validRange } from "./editor-validation.js";
import { textForEditor } from "./line-separator.js";
import { keyboardTooltipField, setKeyboardTooltip } from "./tooltip-state.js";

export interface ToolingHost {
  snapshot(): EditorSnapshot;
  view(): EditorView | null;
  renderHover?: (hover: EditorHover, from: number, to: number) => Tooltip;
  isCurrent?: (identity: EditorIdentity) => boolean;
  filterCompletions?: boolean;
}

export class EditorTooling {
  private readonly requests = new EditorRequests();
  private frame: number | null = null;
  private readonly host: ToolingHost;
  private readonly provider: EditorProvider;
  constructor(host: ToolingHost, provider: EditorProvider = {}) {
    this.host = host;
    this.provider = provider;
  }

  extension() {
    return [
      autocompletion({ override: [(context) => this.complete(context)] }),
      hoverTooltip((view, offset) => this.hover(view, offset)),
      keyboardTooltipField,
      keymap.of([
        ...completionKeymap,
        { key: "Mod-Shift-h", run: (view) => this.keyboardHover(view) },
        {
          key: "Escape",
          run: (view) => {
            this.clear(view);
            view.focus();
            return true;
          },
        },
      ]),
    ];
  }

  invalidate(view = this.host.view()): void {
    if (this.frame !== null && view)
      view.dom.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.requests.invalidate();
  }

  clear(view: EditorView, diagnostics = false): void {
    this.invalidate();
    closeCompletion(view);
    const interactions = { effects: [setKeyboardTooltip.of(null), closeHoverTooltips] };
    if (diagnostics) view.dispatch(interactions, setDiagnostics(view.state, []));
    else view.dispatch(interactions);
  }

  schedule(view: EditorView): void {
    const diagnosticsProvider = this.provider.diagnostics?.bind(this.provider);
    const window = view.dom.ownerDocument.defaultView;
    if (!diagnosticsProvider || !window) return;
    const ticket = this.ticket("diagnostics", view);
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      if (!ticket.current()) return;
      const response = diagnosticsProvider(ticket);
      void this.resolve(
        response,
        ticket,
        (result) => {
          const diagnostics = result.value.filter((entry) =>
            validRange(entry, ticket.snapshot.text),
          );
          view.dispatch(
            setDiagnostics(
              view.state,
              diagnostics.map((entry) => ({
                ...this.range(view, entry),
                message: entry.message,
                severity: entry.severity,
              })),
            ),
          );
          return true;
        },
        false,
      );
    });
  }

  format(): boolean | Promise<boolean> {
    const view = this.host.view();
    if (!view || !this.provider.format) return false;
    const ticket = this.ticket("format", view);
    return this.resolve(
      this.provider.format(ticket),
      ticket,
      (result, guarded) => this.apply(view, result.value, guarded),
      false,
    );
  }

  private complete(
    context: CompletionContext,
  ): CompletionResult | null | Promise<CompletionResult | null> {
    const view = this.host.view();
    if (!view || view.state !== context.state || !this.provider.completion) return null;
    const ticket = this.ticket("completion", view);
    const offset = sourceOffset(view.state.doc, view.state.lineBreak, context.pos);
    return this.resolve(
      this.provider.completion(ticket, offset),
      ticket,
      (result, guarded) => {
        const entries = result.value.filter((item) => validEdit(item.edit, ticket.snapshot.text));
        const first = entries[0];
        if (!first) return null;
        return {
          ...this.range(view, first.edit),
          filter: this.host.filterCompletions ?? false,
          options: entries.map((item) => this.option(view, item, guarded)),
        };
      },
      null as CompletionResult | null,
    );
  }

  private option(view: EditorView, item: EditorCompletion, ticket: RequestTicket) {
    return {
      label: item.label,
      type: item.type,
      detail: item.detail,
      boost: item.boost,
      apply: (target: EditorView) => {
        if (target === view) this.apply(target, item.edit, ticket);
      },
    };
  }

  private apply(view: EditorView, edit: EditorEdit, ticket: RequestTicket): boolean {
    if (!ticket.current() || !validEdit(edit, ticket.snapshot.text)) return false;
    view.dispatch({
      changes: { ...this.range(view, edit), insert: textForEditor(edit.text) },
      annotations: Transaction.addToHistory.of(true),
    });
    return true;
  }

  private hover(
    view: EditorView,
    offset: number,
    publish?: (tooltip: Tooltip) => void,
  ): Tooltip | null | Promise<Tooltip | null> {
    if (this.host.view() !== view || !this.provider.hover) return null;
    const ticket = this.ticket("hover", view);
    const source = sourceOffset(view.state.doc, view.state.lineBreak, offset);
    return this.resolve(
      this.provider.hover(ticket, source),
      ticket,
      (result) => {
        if (!validRange(result.value, ticket.snapshot.text)) return null;
        const range = this.range(view, result.value);
        const tooltip = (this.host.renderHover ?? editorTooltip)(
          result.value,
          range.from,
          range.to,
        );
        publish?.(tooltip);
        return tooltip;
      },
      null as Tooltip | null,
    );
  }

  private keyboardHover(view: EditorView): boolean {
    const tooltip = this.hover(view, view.state.selection.main.head, (value) =>
      view.dispatch({ effects: setKeyboardTooltip.of(value) }),
    );
    return tooltip instanceof Promise || tooltip !== null;
  }

  private ticket(kind: "diagnostics" | "completion" | "hover" | "format", view: EditorView) {
    return this.requests.start(
      kind,
      this.host.snapshot(),
      () => this.host.snapshot(),
      () => this.host.view() === view,
    );
  }

  private resolve<T, R>(
    response: EditorResponse<T>,
    ticket: RequestTicket,
    publish: (result: EditorResult<T>, guarded: RequestTicket) => R,
    fallback: R,
  ): R | Promise<R> {
    return resolveResponse(
      response,
      ticket,
      (result) => {
        const guarded = {
          ...ticket,
          current: () => ticket.current() && (this.host.isCurrent?.(result) ?? true),
        };
        return guarded.current() ? publish(result, guarded) : fallback;
      },
      fallback,
    );
  }

  private range(view: EditorView, range: { readonly from: number; readonly to: number }) {
    return {
      from: editorOffset(view.state.doc, view.state.lineBreak, range.from),
      to: editorOffset(view.state.doc, view.state.lineBreak, range.to),
    };
  }
}
