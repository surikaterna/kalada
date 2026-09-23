import { inject as injectA } from "./98-injections.mjs";

const shared = new Set([
  "packages/syntax/src/parse.ts",
  "packages/language-service/src/documents.ts",
  "packages/codemirror/src/highlight-extension.ts",
  "apps/demo/src/inspectors/artifacts.ts",
  "apps/demo/src/ui/app.ts",
  "apps/demo/src/live/runtime.ts",
]);

function replaceOnce(code, before, after, relative) {
  if (code.split(before).length !== 2) throw Error(`B injection mismatch ${relative}: ${before}`);
  return code.replace(before, after);
}

export function injectB(code, relative, tracer) {
  if (shared.has(relative)) return injectA(code, relative, tracer);
  let changes;
  if (relative === "packages/language-service/src/service.ts") {
    changes = [
      [
        "const parsed = this.parseDocument(captured.document);",
        'const parsed = trace.scope("highlight", uri, captured.document.version, () => this.parseDocument(captured.document));',
      ],
      [
        "const spans = classifyHighlight(parsed);",
        'const spans = trace.scope("highlight", uri, captured.document.version, () => trace.span("classify", null, () => classifyHighlight(parsed)));',
      ],
      [
        "const run = runAnalysisPhases(captured.document, captured.environment, options?.cancellation);",
        "const run = trace.scope(operation, uri, captured.document.version, () => trace.span(operation, null, () => runAnalysisPhases(captured.document, captured.environment, options?.cancellation)));",
      ],
      [
        "const run = runCompletion(\n      captured.document,\n      captured.environment,\n      position,\n      options?.cancellation,\n      (document) => this.parseDocument(document),\n    );",
        'const run = trace.scope("completion", uri, captured.document.version, () => runCompletion(\n      captured.document,\n      captured.environment,\n      position,\n      options?.cancellation,\n      (document) => this.parseDocument(document),\n    ));',
      ],
      [
        "const run = runHover(\n      captured.document,\n      captured.environment,\n      position,\n      options?.cancellation,\n      (document) => this.parseDocument(document),\n    );",
        'const run = trace.scope("hover", uri, captured.document.version, () => runHover(\n      captured.document,\n      captured.environment,\n      position,\n      options?.cancellation,\n      (document) => this.parseDocument(document),\n    ));',
      ],
    ];
  }
  if (relative === "packages/language-service/src/syntax-cache.ts") {
    changes = [
      ["this.hits += 1;", 'this.hits += 1;\n      trace.span("cache.hit", null, () => null);'],
      ["this.misses += 1;", 'this.misses += 1;\n    trace.span("cache.miss", null, () => null);'],
    ];
  }
  if (!changes) return null;
  const result = changes.reduce(
    (current, [before, after]) => replaceOnce(current, before, after, relative),
    code,
  );
  return `import { trace } from ${JSON.stringify(tracer)};\n${result}`;
}
