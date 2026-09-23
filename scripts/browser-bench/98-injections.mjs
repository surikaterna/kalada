const changes = {
  "packages/syntax/src/parse.ts": [
    ["export function parseKaladaV1Expression(", "function originalParseKaladaV1Expression("],
    [
      "const scanned = lex(source, limits);",
      'const scanned = trace.span("lex", source, () => lex(source, limits));',
    ],
    [
      "const parseLimits =",
      `export function parseKaladaV1Expression(source: string, options?: KaladaParseOptions): KaladaParseResult {
  return trace.span("parse", source, () => originalParseKaladaV1Expression(source, options));
}
const parseLimits =`,
    ],
  ],
  "packages/language-service/src/service.ts": [
    [
      "return this.store.update(input);",
      'return trace.span("document.update", null, () => this.store.update(input));',
    ],
    [
      "const parsed = parseKaladaV1Expression(captured.document.text);",
      'const parsed = trace.scope("highlight", uri, captured.document.version, () => parseKaladaV1Expression(captured.document.text));',
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
      "const run = runCompletion(",
      'const run = trace.scope("completion", uri, captured.document.version, () => runCompletion(',
    ],
    ["      options?.cancellation,\n    );", "      options?.cancellation,\n    ));"],
    [
      "const run = runHover(captured.document, captured.environment, position, options?.cancellation);",
      'const run = trace.scope("hover", uri, captured.document.version, () => runHover(captured.document, captured.environment, position, options?.cancellation));',
    ],
  ],
  "packages/language-service/src/documents.ts": [
    [
      "lineIndex: createUtf16LineIndex(text)",
      'lineIndex: trace.scope("line-index", uri, version, () => trace.span("line-index", null, () => createUtf16LineIndex(text)))',
    ],
  ],
  "packages/codemirror/src/highlight-extension.ts": [
    [
      "refresh(view: EditorView): void {",
      'refresh(view: EditorView): void {\n        trace.span("decoration", null, () => this.refreshMeasured(view));\n      }\n      refreshMeasured(view: EditorView): void {',
    ],
  ],
  "apps/demo/src/inspectors/artifacts.ts": [
    [
      "return inspectSafely(() => cstSnapshotUnsafe(source, reveal), omitted);",
      'return trace.span("inspector.serialize", null, () => inspectSafely(() => cstSnapshotUnsafe(source, reveal), omitted));',
    ],
  ],
  "apps/demo/src/ui/app.ts": [
    [
      "private render(snapshot: RuntimeSnapshot): void {",
      'private render(snapshot: RuntimeSnapshot): void {\n    trace.span("render", null, () => this.renderMeasured(snapshot));\n  }\n  private renderMeasured(snapshot: RuntimeSnapshot): void {',
    ],
    [
      "? cstSnapshot(this.model.text(active), this.reveal)",
      '? trace.scope("inspector", uriForName(active), this.runtime.service.getDocument(uriForName(active))?.version ?? null, () => cstSnapshot(this.model.text(active), this.reveal))',
    ],
  ],
  "apps/demo/src/live/runtime.ts": [
    [
      "const prepared = this.prepare(name);",
      'const prepared = trace.scope("prepared", uriForName(name), this.model.revision(name), () => trace.span("prepare", null, () => this.prepare(name)));',
    ],
    [
      "const parsed = parseExpression(this.model.text(name), { sourceUri: uriForName(name) });",
      'const parsed = trace.scope("prepared", uriForName(name), version, () => parseExpression(this.model.text(name), { sourceUri: uriForName(name) }));',
    ],
    [
      "const outcome = prepared.value.evaluate({ data: this.data });",
      'const outcome = trace.span("evaluate", null, () => prepared.value.evaluate({ data: this.data }));',
    ],
  ],
};

export function inject(code, relative, tracer) {
  const replacements = changes[relative];
  if (!replacements) return null;
  let result = code;
  for (const [before, after] of replacements) {
    if (result.split(before).length !== 2) throw Error(`injection mismatch ${relative}: ${before}`);
    result = result.replace(before, after);
  }
  return `import { trace } from ${JSON.stringify(tracer)};\n${result}`;
}
