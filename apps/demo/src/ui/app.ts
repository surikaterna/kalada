import { defaultKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { createKaladaEditorSession, type KaladaEditorSession } from "@kalada/codemirror";
import {
  compiledSnapshot,
  cstSnapshot,
  diagnosticsSnapshot,
  environmentSnapshot,
  linkSnapshot,
} from "../inspectors/artifacts.js";
import { valueJson } from "../inspectors/values.js";
import { DemoRuntime, type RuntimeSnapshot, uriForName } from "../live/runtime.js";
import { ImportCoordinator } from "../workspace/imports.js";
import { WorkspaceModel } from "../workspace/model.js";
import { clearWorkspace, restoreWorkspace, saveWorkspace } from "../workspace/persistence.js";
import { exportWorkspace, importWorkspace } from "../workspace/transfer.js";

export function createDemoApp(mount: HTMLElement): () => void {
  const app = new DemoApp(mount);
  app.start();
  return () => app.dispose();
}

class DemoApp {
  private readonly mount: HTMLElement;
  private model = new WorkspaceModel();
  private runtime!: DemoRuntime;
  private view: EditorView | null = null;
  private readonly states = new Map<string, EditorState>();
  private readonly sessions = new Map<string, KaladaEditorSession>();
  private latest?: RuntimeSnapshot;
  private reveal = false;
  private persistence = false;
  private readonly imports = new ImportCoordinator<ReturnType<typeof importWorkspace>>();
  private editor!: HTMLElement;
  private tabs!: HTMLElement;
  private status!: HTMLElement;
  private panels!: HTMLElement;

  constructor(mount: HTMLElement) {
    this.mount = mount;
  }
  start(): void {
    this.buildShell();
    this.initializeRuntime();
    this.open(this.model.snapshot().activeName);
  }

  private buildShell(): void {
    this.mount.replaceChildren();
    const shell = element("div", "shell");
    const toolbar = element("div", "toolbar");
    const heading = element("h1");
    heading.textContent = "Kalada schema workspace";
    toolbar.append(heading);
    toolbar.append(
      button("Format", () => this.format()),
      button("Generate data", () => this.generate()),
      button("Export", () => this.export()),
      this.importControl(),
      button("Reset", () => this.reset()),
      this.persistenceControl(),
      this.revealControl(),
    );
    this.status = element("div", "status");
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.tabs = element("div", "tabs");
    this.tabs.setAttribute("role", "tablist");
    const workspace = element("div", "workspace");
    this.editor = element("section", "editor");
    this.editor.setAttribute("aria-label", "Active document editor");
    this.panels = element("aside", "panels");
    this.panels.setAttribute("aria-label", "Workspace results and inspectors");
    workspace.append(this.editor, this.panels);
    shell.append(toolbar, this.status, this.tabs, workspace);
    this.mount.append(shell);
    this.renderTabs();
  }

  private initializeRuntime(): void {
    this.runtime = new DemoRuntime(
      this.model,
      (snapshot) => this.render(snapshot),
      () => {
        for (const session of this.sessions.values()) session.refreshEnvironment();
      },
    );
    for (const document of this.model.snapshot().documents) {
      const session = createKaladaEditorSession({
        service: this.runtime.service,
        document: {
          uri: uriForName(document.name),
          version: document.revision,
          text: document.text,
        },
        onDocumentChange: (snapshot) => {
          this.imports.invalidate();
          this.runtime.documentChanged(snapshot);
          this.persist();
        },
      });
      this.sessions.set(document.name, session);
      this.states.set(document.name, this.expressionState(document.name, session));
    }
    this.states.set("schema.json", this.jsonState("schema.json"));
    this.states.set("data.json", this.jsonState("data.json"));
    this.runtime.start();
  }

  private expressionState(name: string, session: KaladaEditorSession): EditorState {
    return EditorState.create({ doc: this.model.text(name), extensions: [session.extension] });
  }
  private jsonState(name: "schema.json" | "data.json"): EditorState {
    return EditorState.create({
      doc: this.model.text(name),
      extensions: [
        json(),
        keymap.of(defaultKeymap),
        EditorView.contentAttributes.of({ "aria-label": `${name} editor` }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          this.commitJsonDocument(name, update.state.doc.toString());
        }),
      ],
    });
  }

  private open(name: string, focusEditor = true): void {
    const state = this.states.get(name);
    if (!state) return;
    if (this.view) {
      this.states.set(this.model.snapshot().activeName, this.view.state);
      this.view.destroy();
    }
    this.model.select(name);
    this.view = new EditorView({ state, parent: this.editor });
    this.renderTabs();
    this.render(this.runtime.snapshot());
    if (focusEditor) this.view.focus();
  }

  private renderTabs(): void {
    const names = [
      "schema.json",
      "data.json",
      ...this.model.snapshot().documents.map((entry) => entry.name),
    ];
    this.tabs.replaceChildren(
      ...names.map((name) => {
        const control = button(name, () => this.open(name));
        control.setAttribute("role", "tab");
        control.setAttribute("aria-selected", String(name === this.model.snapshot().activeName));
        control.tabIndex = name === this.model.snapshot().activeName ? 0 : -1;
        control.addEventListener("keydown", (event) => this.tabKey(event, names, name));
        return control;
      }),
    );
  }

  private tabKey(event: KeyboardEvent, names: string[], name: string): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? names.length - 1
          : (names.indexOf(name) + offset + names.length) % names.length;
    const target = names[index];
    if (!target) return;
    this.open(target, false);
    this.tabs.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }

  private render(snapshot: RuntimeSnapshot): void {
    this.latest = snapshot;
    this.status.dataset.state = snapshot.state;
    this.status.textContent = `${snapshot.state}: ${snapshot.code}`;
    const active = this.model.snapshot().activeName;
    const file = snapshot.files.get(active);
    const output = panel(
      "Output / error",
      file?.output === undefined
        ? valueJson(diagnosticsSnapshot(file?.diagnostics ?? [{ code: snapshot.code }]))
        : valueJson(file.output),
      true,
    );
    const tooling = panel(
      "Tooling",
      valueJson({
        resultType: file?.resultType ?? "unavailable",
        dependencies: file?.dependencies ?? [],
        timing: file?.timing ?? {},
      }),
    );
    const diagnostics = panel(
      "Diagnostics",
      valueJson(diagnosticsSnapshot(file?.diagnostics ?? [])),
    );
    const artifacts = panel(
      "Advanced inspectors",
      valueJson({
        cst: active.endsWith(".kalada")
          ? cstSnapshot(this.model.text(active), this.reveal)
          : { unavailable: true },
        compiled: compiledSnapshot(file?.compiled, this.reveal),
        link: linkSnapshot(file?.prepared),
        schemaEnvironment: environmentSnapshot(snapshot.environment),
      }),
    );
    const grid = element("div", "panel-grid");
    grid.append(output, tooling, diagnostics, artifacts);
    this.panels.replaceChildren(grid);
  }

  private format(): void {
    const session = this.sessions.get(this.model.snapshot().activeName);
    if (!session?.format()) this.announce("Formatting is unavailable for this document");
  }
  private generate(): void {
    const seed = this.model.snapshot().seed;
    const result = this.runtime.generate(seed);
    if (!result.ok || !result.bytes) {
      this.announce(result.code);
      return;
    }
    if (
      !this.runtime.applyGenerated(result, seed, (bytes) =>
        this.replaceJsonDocument("data.json", bytes),
      )
    ) {
      this.announce("generation-stale");
      return;
    }
    this.announce("Generated data validated and applied");
  }
  private replaceJsonDocument(name: "schema.json" | "data.json", text: string): void {
    const state =
      this.model.snapshot().activeName === name && this.view
        ? this.view.state
        : this.states.get(name);
    if (!state) return;
    const transaction = state.update({ changes: { from: 0, to: state.doc.length, insert: text } });
    if (this.model.snapshot().activeName === name && this.view) this.view.dispatch(transaction);
    else {
      this.states.set(name, transaction.state);
      this.commitJsonDocument(name, text);
    }
  }
  private commitJsonDocument(name: "schema.json" | "data.json", text: string): void {
    this.imports.invalidate();
    this.model.update(name, text);
    if (name === "schema.json") this.runtime.schemaChanged();
    else this.runtime.dataChanged();
    this.persist();
  }

  private reset(): void {
    clearWorkspace(localStorage);
    this.persistence = false;
    this.restart(new WorkspaceModel());
    this.announce("Workspace reset");
  }
  private restart(model: WorkspaceModel): void {
    this.imports.invalidate();
    this.reveal = false;
    this.latest = undefined;
    this.panels?.replaceChildren();
    this.view?.destroy();
    for (const session of this.sessions.values()) session.dispose();
    this.runtime.dispose();
    this.states.clear();
    this.sessions.clear();
    this.model = model;
    this.buildShell();
    this.initializeRuntime();
    this.open(model.snapshot().activeName);
  }
  private persist(): void {
    if (this.persistence && !saveWorkspace(localStorage, this.model.snapshot()).ok)
      this.announce("Persistence unavailable; edits remain in memory");
  }
  private announce(message: string): void {
    this.status.textContent = message;
  }

  private importControl(): HTMLElement {
    const label = element("label");
    label.textContent = "Import ";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.className = "sr-only";
    const trigger = button("Choose file", () => input.click());
    input.addEventListener("change", () => void this.importFile(input));
    label.append(trigger, input);
    return label;
  }
  private async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file || file.size > 1024 * 1024) {
      this.announce("Import rejected: file limit");
      return;
    }
    try {
      const outcome = await this.imports.run(
        () => file.text(),
        importWorkspace,
        (workspace) => this.restart(new WorkspaceModel(workspace)),
      );
      if (outcome === "applied") this.announce("Workspace imported");
    } catch {
      this.announce("Import rejected: invalid workspace");
    }
  }
  private export(): void {
    const blob = new Blob([exportWorkspace(this.model.snapshot())], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "kalada-workspace.json";
    anchor.click();
    URL.revokeObjectURL(url);
    this.announce("Sensitive workspace export downloaded");
  }
  private persistenceControl(): HTMLElement {
    const label = element("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.persistence;
    input.addEventListener("change", () => {
      this.persistence = input.checked;
      if (this.persistence) {
        const restored = restoreWorkspace(localStorage);
        if (
          restored.ok &&
          restored.value &&
          confirm("Restore saved source/schema/data from this origin?")
        )
          this.restart(new WorkspaceModel(restored.value));
        else this.persist();
      } else clearWorkspace(localStorage);
    });
    label.append(input, document.createTextNode(" Persist sensitive workspace locally"));
    return label;
  }
  private revealControl(): HTMLElement {
    const label = element("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.addEventListener("change", () => {
      this.reveal = input.checked;
      if (this.latest) this.render(this.latest);
    });
    label.append(input, document.createTextNode(" Reveal source/literals in inspectors"));
    return label;
  }
  dispose(): void {
    this.imports.dispose();
    this.view?.destroy();
    for (const session of this.sessions.values()) session.dispose();
    this.runtime.dispose();
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  name: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const value = document.createElement(name);
  if (className) value.className = className;
  return value;
}
function button(text: string, action: () => void): HTMLButtonElement {
  const value = document.createElement("button");
  value.type = "button";
  value.textContent = text;
  value.addEventListener("click", action);
  return value;
}
function panel(title: string, text: string, sensitive = false): HTMLElement {
  const section = element("section", "panel");
  const heading = element("h2");
  heading.textContent = title;
  const pre = document.createElement("pre");
  pre.textContent = text;
  section.append(heading);
  if (sensitive) {
    const warning = element("p", "sensitive");
    warning.textContent = "Local data/result — may contain secrets";
    section.append(warning);
  }
  section.append(pre);
  return section;
}
