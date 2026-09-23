import { normalizeManualEnvironment } from "../../../98-a-readonly/packages/host/dist/index.js";
import { createLanguageService } from "../../../98-a-readonly/packages/language-service/dist/index.js";

function environment() {
  return normalizeManualEnvironment({
    mode: "sync",
    bindings: [],
  });
}

const samples = (values) => ({
  samples: values,
  median: [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)],
});

function measure(service, uris, enabled) {
  const durations = { highlight: [], diagnostics: [], analyze: [] };
  const outputs = [];
  let firstIdentity;
  for (const uri of uris) {
    const result = {};
    for (const kind of Object.keys(durations)) {
      const start = performance.now();
      const value = service[kind](uri);
      if (kind === "highlight" && !firstIdentity) firstIdentity = value;
      if (enabled) durations[kind].push(performance.now() - start);
      result[kind] =
        kind === "highlight"
          ? { kind: value.kind, spans: value.spans?.map(({ kind, from, to }) => [kind, from, to]) }
          : { kind: value.kind, codes: value.diagnostics?.map(({ code }) => code) };
      result[kind].status = value.status;
      result[kind].version = value.version;
      result[kind].environmentGeneration = value.environmentGeneration;
    }
    outputs.push(result);
  }
  return {
    durations: Object.fromEntries(Object.entries(durations).map(([k, v]) => [k, samples(v)])),
    outputs,
    firstIdentity,
  };
}

function editFirst(service, uri) {
  const document = service.getDocument(uri);
  const editStart = performance.now();
  service.updateDocument({
    uri,
    version: 2,
    edits: [
      {
        range: {
          start: document.lineIndex.positionAt(document.text.length),
          end: document.lineIndex.positionAt(document.text.length),
        },
        text: " ",
      },
    ],
  });
  return performance.now() - editStart;
}

export function runFifty(tokenHeavy = false, enabled = true) {
  const service = createLanguageService({ generation: 1, description: environment() });
  const uris = Array.from({ length: 50 }, (_, i) => `memory:///synthetic/expr-${i}.kalada`);
  const source = (i) => (tokenHeavy ? `1${" + 1".repeat(40)} + ${i}` : `1 + ${i}`);
  const start = performance.now();
  uris.forEach((uri, i) => {
    service.openDocument({ uri, text: source(i), version: 1 });
  });
  const openMs = performance.now() - start;
  const cold = measure(service, uris, enabled);
  const coldCurrent = service.isCurrent(cold.firstIdentity);
  const editMs = editFirst(service, uris[0]);
  const oldVersionCurrent = service.isCurrent(cold.firstIdentity);
  const edited = measure(service, [uris[0]], enabled);
  const tooling = {
    completion: service.completion(uris[0], service.getDocument(uris[0]).lineIndex.positionAt(1)),
    hover: service.hover(uris[0], { line: 0, character: 0 }),
  };
  const repeatStart = performance.now();
  const repeat = measure(service, uris, enabled);
  const repeatMs = performance.now() - repeatStart;
  const envOnlyStart = performance.now();
  service.updateEnvironment({ generation: 2, description: environment() });
  const oldEnvironmentCurrent = service.isCurrent(edited.firstIdentity);
  const envOnly = measure(service, uris, enabled);
  const envOnlyMs = performance.now() - envOnlyStart;
  return {
    tokenHeavy,
    openMs,
    editMs,
    repeatMs,
    envOnlyMs,
    cold,
    edited,
    tooling,
    repeat,
    envOnly,
    currentness: { coldCurrent, oldVersionCurrent, oldEnvironmentCurrent },
    docs: service.getWorkspaceSnapshot().documents.length,
    unsupported: ["data update", "schema update"],
  };
}
