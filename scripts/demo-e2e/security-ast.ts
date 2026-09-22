import ts from "typescript";
import { RuntimeAnalyzer } from "./security-analysis.js";
import { StaticSinkPolicy } from "./security-sinks.js";

// Invariant: emitted code cannot retain unprovable global-host flow into capability lookup or invocation.
export function assertJavaScriptSecurity(path: string, source: string): void {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error(`JavaScript security parse failed: ${path}`);
  const sinks = new StaticSinkPolicy(file);
  sinks.scan();
  const analyzer = new RuntimeAnalyzer(file);
  analyzer.scan();
  const failures = new Set([...sinks.failures, ...analyzer.failures]);
  if (failures.size) {
    throw new Error(`Forbidden runtime primitive in ${path}: ${[...failures].sort().join("; ")}`);
  }
}
