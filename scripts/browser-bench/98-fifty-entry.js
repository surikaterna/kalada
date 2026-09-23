import { normalizeManualEnvironment } from "../../../98-a-readonly/packages/host/dist/index.js";
import { createLanguageService } from "../../../98-a-readonly/packages/language-service/dist/index.js";

function environment() {
  return normalizeManualEnvironment({
    mode: "sync",
    bindings: [
      {
        id: "count-id",
        name: "count",
        path: ["count"],
        semanticType: { kind: "primitive-type", name: "number" },
      },
    ],
  });
}

const samples = (values) => ({
  samples: values,
  median: [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)],
});

function measure(service, uris, enabled) {
  const durations = { highlight: [], diagnostics: [], analyze: [] };
  const outputs = [];
  for (const uri of uris) {
    const result = {};
    for (const kind of Object.keys(durations)) {
      const start = performance.now();
      const value = service[kind](uri);
      if (enabled) durations[kind].push(performance.now() - start);
      result[kind] =
        kind === "highlight"
          ? { kind: value.kind, spans: value.spans?.map(({ kind, from, to }) => [kind, from, to]) }
          : { kind: value.kind, codes: value.diagnostics?.map(({ code }) => code) };
    }
    outputs.push(result);
  }
  return {
    durations: Object.fromEntries(Object.entries(durations).map(([k, v]) => [k, samples(v)])),
    outputs,
  };
}

export function runFifty(tokenHeavy = false, enabled = true) {
  const service = createLanguageService({ generation: 1, description: environment() });
  const uris = Array.from({ length: 50 }, (_, i) => `memory:///synthetic/expr-${i}.kalada`);
  const source = (i) => (tokenHeavy ? `count${" + 1".repeat(40)} + ${i}` : `count + ${i}`);
  const start = performance.now();
  uris.forEach((uri, i) => {
    service.openDocument({ uri, text: source(i), version: 1 });
  });
  const openMs = performance.now() - start;
  const cold = measure(service, uris, enabled);
  const document = service.getDocument(uris[0]);
  const editStart = performance.now();
  service.updateDocument({
    uri: uris[0],
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
  const editMs = performance.now() - editStart;
  const edited = measure(service, [uris[0]], enabled);
  const dataStart = performance.now();
  const data = measure(service, uris, enabled);
  const dataMs = performance.now() - dataStart;
  const schemaStart = performance.now();
  service.updateEnvironment({ generation: 2, description: environment() });
  const schema = measure(service, uris, enabled);
  const schemaMs = performance.now() - schemaStart;
  return {
    tokenHeavy,
    openMs,
    editMs,
    dataMs,
    schemaMs,
    cold,
    edited,
    data,
    schema,
    docs: service.getWorkspaceSnapshot().documents.length,
    note: "data phase repeats public LS analysis without changing data: LS has no data-update API",
  };
}
