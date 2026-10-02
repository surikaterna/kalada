import type { KaladaEditorSession, KaladaEditorSessionOptions } from "./contracts.js";
import { type EditorBridge, NeutralEditorSession } from "./editor-session.js";
import { KaladaProvider } from "./kalada-provider.js";
import { hoverTooltip } from "./render.js";
import { wholeReplacement } from "./session-helpers.js";
import { changesToEdits } from "./translation.js";

export function createKaladaEditorSession(
  options: KaladaEditorSessionOptions,
): KaladaEditorSession {
  const { service } = options;
  const opened = service.openDocument(options.document);
  let disposed = false;
  const provider = new KaladaProvider(service, opened.uri);
  const core = new NeutralEditorSession(
    {
      document: opened,
      ariaLabel: "Kalada expression editor",
      provider,
      onDocumentChange: () => {
        const snapshot = service.getDocument(opened.uri);
        if (snapshot) options.onDocumentChange?.(snapshot);
      },
    },
    kaladaBridge(provider),
  );
  return {
    extension: core.extension,
    refreshEnvironment: () => core.refreshEnvironment(),
    replaceDocument: (text) => core.replaceDocument(text),
    format() {
      const formatted = core.format();
      if (typeof formatted !== "boolean") throw new Error("Kalada formatting must be synchronous");
      return formatted;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      core.dispose();
      service.closeDocument(opened.uri);
    },
  };
}

function kaladaBridge(provider: KaladaProvider): EditorBridge {
  return {
    filterCompletions: true,
    isCurrent: (identity) => provider.isCurrent(identity),
    changed(snapshot, previous, transaction) {
      const current = provider.service.getDocument(provider.uri);
      if (!current || current.text !== previous.text || current.version !== previous.version)
        throw new Error("CodeMirror and language-service snapshots diverged");
      const updated = provider.service.updateDocument({
        uri: provider.uri,
        version: snapshot.version,
        edits: transaction
          ? changesToEdits(
              transaction.startState.doc,
              transaction.newDoc,
              transaction.changes,
              current,
              transaction.state.lineBreak,
            )
          : [wholeReplacement(current, snapshot.text)],
      });
      if (updated.text !== snapshot.text)
        throw new Error("CodeMirror transaction translation changed document text");
    },
    renderHover(hover, from, to) {
      const info = provider.hovers.get(hover);
      if (!info) throw new Error("Missing Kalada hover presentation");
      return { ...hoverTooltip(info, from), end: to };
    },
  };
}
