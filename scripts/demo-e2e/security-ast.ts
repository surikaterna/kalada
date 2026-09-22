import ts from "typescript";
import { RuntimeAnalyzer } from "./security-analysis.js";

// Invariant: emitted code cannot retain unprovable global-host flow into capability lookup or invocation.
export function assertJavaScriptSecurity(path: string, source: string): void {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error(`JavaScript security parse failed: ${path}`);
  const analyzer = new RuntimeAnalyzer(file);
  analyzer.scan();
  if (analyzer.failures.size) {
    throw new Error(
      `Forbidden runtime primitive in ${path}: ${[...analyzer.failures].sort().join("; ")}`,
    );
  }
}
