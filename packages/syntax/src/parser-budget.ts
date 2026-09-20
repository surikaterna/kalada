import type { KaladaCstNode, KaladaErrorCstNode, KaladaSourceRange } from "./cst-types.js";
import type { DiagnosticSink } from "./diagnostics.js";
import { freezeRange } from "./freeze.js";
import type { KaladaSyntaxLimits } from "./public-types.js";

export class ParserLimit extends Error {
  readonly node: KaladaErrorCstNode;

  constructor(node: KaladaErrorCstNode) {
    super("KALADA_SYNTAX_LIMIT_EXCEEDED");
    this.node = node;
  }
}

export class ParserBudget {
  private nodes = 0;
  private recovered = 0;
  private pendingDepth = 0;
  private stopped = false;
  private readonly limits: KaladaSyntaxLimits;
  private readonly sink: DiagnosticSink;
  private readonly sourceEnd: number;

  constructor(limits: KaladaSyntaxLimits, sink: DiagnosticSink, sourceEnd: number) {
    this.limits = limits;
    this.sink = sink;
    this.sourceEnd = sourceEnd;
  }

  create<T extends KaladaCstNode>(node: T): T {
    if (this.nodes >= this.limits.maxCstNodes) this.stop(node.range.start);
    this.nodes += 1;
    return Object.freeze(node);
  }

  finishDepth(depth: number, start: number): void {
    if (this.pendingDepth + depth > this.limits.maxCstDepth) this.stop(start);
  }

  recover(range: KaladaSourceRange): void {
    if (this.recovered >= this.limits.maxRecoveryTokens) this.stop(range.start);
    this.recovered += 1;
  }

  exhaust(start: number): never {
    return this.stop(start);
  }

  withWrapper<T>(start: number, parse: () => T): T {
    if (this.pendingDepth + 1 >= this.limits.maxCstDepth) this.stop(start);
    this.pendingDepth += 1;
    try {
      return parse();
    } finally {
      this.pendingDepth -= 1;
    }
  }

  withConditional<T>(conditionDepth: number, start: number, parse: () => T): T {
    if (this.pendingDepth + conditionDepth + 1 > this.limits.maxCstDepth) this.stop(start);
    return this.withWrapper(start, parse);
  }

  withinWrapper<T>(start: number, parse: () => T): T {
    if (this.pendingDepth >= this.limits.maxCstDepth) this.stop(start);
    return parse();
  }

  private stop(start: number): never {
    const range = freezeRange(start, this.sourceEnd);
    if (!this.stopped) {
      this.stopped = true;
      this.sink.limit("parse", range);
    }
    throw new ParserLimit(Object.freeze({ kind: "error", token: null, range }));
  }
}
