import type {
  KaladaBinaryOperator,
  KaladaCstNode,
  KaladaErrorCstNode,
  KaladaToken,
} from "./cst-types.js";
import { DiagnosticSink } from "./diagnostics.js";
import { freezeRange } from "./freeze.js";
import { ParserBudget, ParserLimit } from "./parser-budget.js";
import { maxParsedDepth, type Parsed, RELATIONAL_OPERATORS } from "./parser-types.js";
import type { KaladaSyntaxDiagnostic, KaladaSyntaxLimits } from "./public-types.js";

export class Parser {
  private index = 0;
  readonly sink: DiagnosticSink;
  private readonly tokens: readonly KaladaToken[];
  private readonly budget: ParserBudget;
  constructor(
    tokens: readonly KaladaToken[],
    limits: KaladaSyntaxLimits,
    diagnostics: readonly KaladaSyntaxDiagnostic[],
  ) {
    this.tokens = tokens;
    this.sink = new DiagnosticSink(limits, diagnostics);
    this.budget = new ParserBudget(limits, this.sink, tokens[tokens.length - 1]?.range.end ?? 0);
  }
  parse(): KaladaCstNode {
    try {
      const expression = this.parseConditional().node;
      while (!this.at("eof")) {
        const current = this.current();
        this.budget.recover(current.range);
        const alreadyDiagnosed = current.kind === "unsupported" || current.kind === "invalid";
        if (current.kind === "left-parenthesis")
          this.sink.add("parse", "KALADA_SYNTAX_UNSUPPORTED_FORM", current.range);
        if (current.kind !== "left-parenthesis" && !alreadyDiagnosed) {
          this.sink.add("parse", "KALADA_SYNTAX_UNEXPECTED_TOKEN", current.range);
        }
        this.consume();
      }
      return expression;
    } catch (error) {
      if (error instanceof ParserLimit) {
        this.index = this.tokens.length - 1;
        return error.node;
      }
      throw error;
    }
  }

  private parseConditional(): Parsed {
    const condition = this.parseCoalesce();
    if (!this.at("question")) return condition;
    const branches = this.parseConditionalBranches(condition.depth);
    const node = this.create({
      kind: "conditional",
      condition: condition.node,
      questionToken: branches.questionToken,
      // biome-ignore lint/suspicious/noThenProperty: The CST field mirrors ternary syntax.
      then: branches.then.node,
      colonToken: branches.colonToken,
      else: branches.otherwise.node,
      range: freezeRange(condition.node.range.start, branches.otherwise.node.range.end),
    });
    return this.parsed(
      node,
      false,
      false,
      maxParsedDepth(condition, branches.then, branches.otherwise) + 1,
    );
  }

  private parseConditionalBranches(conditionDepth: number): {
    readonly questionToken: number;
    readonly then: Parsed;
    readonly colonToken: number | null;
    readonly otherwise: Parsed;
  } {
    return this.budget.withConditional(conditionDepth, this.current().range.start, () => {
      const questionToken = this.consume();
      const then = this.budget.withinWrapper(this.current().range.start, () =>
        this.parseConditional(),
      );
      let colonToken: number | null = null;
      if (this.at("colon")) colonToken = this.consume();
      else this.sink.add("parse", "KALADA_SYNTAX_EXPECTED_COLON", this.current().range);
      const otherwise = this.budget.withinWrapper(this.current().range.start, () =>
        this.parseConditional(),
      );
      return { questionToken, then, colonToken, otherwise };
    });
  }

  private parseCoalesce(): Parsed {
    let left = this.parseLogicalOr();
    while (this.operator("??")) {
      const operatorToken = this.consume();
      const right = this.parseLogicalOr();
      if (left.logical || right.logical) {
        this.sink.add(
          "parse",
          "KALADA_SYNTAX_COALESCE_LOGICAL_MIX",
          this.token(operatorToken).range,
        );
      }
      left = this.binary(left, right, "??", operatorToken, true, left.logical || right.logical);
    }
    return left;
  }

  private parseLogicalOr(): Parsed {
    return this.parseBinaryTier(() => this.parseLogicalXor(), new Set(["||"]), true);
  }

  private parseLogicalXor(): Parsed {
    return this.parseBinaryTier(() => this.parseLogicalAnd(), new Set(["xor"]), false);
  }

  private parseLogicalAnd(): Parsed {
    return this.parseBinaryTier(() => this.parseEquality(), new Set(["&&"]), true);
  }

  private parseEquality(): Parsed {
    return this.parseBinaryTier(() => this.parseRelational(), new Set(["==", "!="]), false);
  }

  private parseRelational(): Parsed {
    let left = this.parseAdditive();
    let seen = false;
    while (this.currentOperator(RELATIONAL_OPERATORS)) {
      const operatorToken = this.consume();
      if (seen) {
        this.sink.add("parse", "KALADA_SYNTAX_RELATIONAL_CHAIN", this.token(operatorToken).range);
      }
      seen = true;
      const operator = this.token(operatorToken).text as KaladaBinaryOperator;
      left = this.binary(
        left,
        this.parseAdditive(),
        operator,
        operatorToken,
        left.coalesce,
        left.logical,
      );
    }
    return left;
  }

  private parseAdditive(): Parsed {
    return this.parseBinaryTier(() => this.parseMultiplicative(), new Set(["+", "-"]), false);
  }

  private parseMultiplicative(): Parsed {
    return this.parseBinaryTier(() => this.parseUnary(), new Set(["*", "/", "%"]), false);
  }

  private parseBinaryTier(
    next: () => Parsed,
    operators: ReadonlySet<string>,
    logical: boolean,
  ): Parsed {
    let left = next();
    while (this.currentOperator(operators)) {
      const operatorToken = this.consume();
      const operator = this.token(operatorToken).text as KaladaBinaryOperator;
      const right = next();
      if (logical && (left.coalesce || right.coalesce)) {
        this.sink.add(
          "parse",
          "KALADA_SYNTAX_COALESCE_LOGICAL_MIX",
          this.token(operatorToken).range,
        );
      }
      left = this.binary(
        left,
        right,
        operator,
        operatorToken,
        left.coalesce || right.coalesce,
        logical || left.logical || right.logical,
      );
    }
    return left;
  }

  private parseUnary(): Parsed {
    const token = this.current();
    if (token.kind !== "operator" || !["!", "+", "-"].includes(token.text))
      return this.parsePostfix();
    const operatorToken = this.consume();
    const operand = this.budget.withWrapper(this.current().range.start, () => this.parseUnary());
    const node = this.create({
      kind: "unary",
      operator: token.text as "!" | "+" | "-",
      operatorToken,
      operand: operand.node,
      range: freezeRange(token.range.start, operand.node.range.end),
    });
    return this.parsed(node, operand.coalesce, operand.logical, operand.depth + 1);
  }

  private parsePostfix(): Parsed {
    let target = this.parsePrimary();
    while (this.at("dot") || this.at("optional-dot")) {
      const operatorToken = this.consume();
      const operator = this.token(operatorToken);
      const fieldToken = this.fieldToken();
      const field = fieldToken === null ? null : this.token(fieldToken).text;
      const end = fieldToken === null ? operator.range.end : this.token(fieldToken).range.end;
      const node = this.create({
        kind: "field-access",
        target: target.node,
        optional: operator.kind === "optional-dot",
        operatorToken,
        fieldToken,
        field,
        range: freezeRange(target.node.range.start, end),
      });
      target = this.parsed(node, target.coalesce, target.logical, target.depth + 1);
    }
    return target;
  }

  private parsePrimary(): Parsed {
    const current = this.current();
    if (current.kind === "identifier") return this.reference();
    if (["number", "string", "true", "false", "null"].includes(current.kind)) return this.literal();
    if (current.kind === "left-parenthesis") return this.group();
    if (current.kind === "invalid" || current.kind === "unsupported") {
      return this.parsed(this.error(this.recoverAdvance()), false, false, 1);
    }
    this.sink.add("parse", "KALADA_SYNTAX_EXPECTED_EXPRESSION", current.range);
    const synchronizer =
      current.kind === "eof" ||
      current.kind === "right-parenthesis" ||
      current.kind === "colon" ||
      this.isBinary(current);
    const token = synchronizer ? null : this.recoverAdvance();
    return this.parsed(this.error(token), false, false, 1);
  }

  private group(): Parsed {
    const openToken = this.consume();
    const expression = this.budget.withWrapper(this.current().range.start, () =>
      this.parseConditional(),
    );
    let closeToken: number | null = null;
    if (this.at("right-parenthesis")) closeToken = this.consume();
    else this.sink.add("parse", "KALADA_SYNTAX_EXPECTED_RIGHT_PARENTHESIS", this.current().range);
    const end = closeToken === null ? expression.node.range.end : this.token(closeToken).range.end;
    const node = this.create({
      kind: "group",
      openToken,
      expression: expression.node,
      closeToken,
      range: freezeRange(this.token(openToken).range.start, end),
    });
    return this.parsed(node, false, false, expression.depth + 1);
  }

  private reference(): Parsed {
    const index = this.consume();
    const found = this.token(index);
    const node = this.create({
      kind: "reference",
      token: index,
      name: found.text,
      range: found.range,
    });
    return this.parsed(node, false, false, 1);
  }

  private literal(): Parsed {
    const index = this.consume();
    const found = this.token(index);
    const value =
      found.kind === "number"
        ? Number(found.text)
        : found.kind === "string"
          ? JSON.parse(found.text)
          : found.kind === "true"
            ? true
            : found.kind === "false"
              ? false
              : null;
    const literalKind: "number" | "string" | "boolean" | "null" =
      found.kind === "true" || found.kind === "false"
        ? "boolean"
        : (found.kind as "number" | "string" | "null");
    const node = this.create({
      kind: "literal",
      literalKind,
      token: index,
      value,
      range: found.range,
    });
    return this.parsed(node, false, false, 1);
  }

  private fieldToken(): number | null {
    const current = this.current();
    if (["identifier", "true", "false", "null", "in", "xor"].includes(current.kind))
      return this.consume();
    this.sink.add("parse", "KALADA_SYNTAX_EXPECTED_FIELD", current.range);
    return null;
  }

  private binary(
    left: Parsed,
    right: Parsed,
    operator: KaladaBinaryOperator,
    operatorToken: number,
    coalesce: boolean,
    logical: boolean,
  ): Parsed {
    const node = this.create({
      kind: "binary",
      operator,
      operatorToken,
      left: left.node,
      right: right.node,
      range: freezeRange(left.node.range.start, right.node.range.end),
    });
    return this.parsed(
      node,
      coalesce || operator === "??",
      logical,
      Math.max(left.depth, right.depth) + 1,
    );
  }

  private parsed(node: KaladaCstNode, coalesce: boolean, logical: boolean, depth: number): Parsed {
    this.budget.finishDepth(depth, node.range.start);
    return { node, coalesce, logical, depth };
  }

  private create<T extends KaladaCstNode>(node: T): T {
    return this.budget.create(node);
  }

  private error(index: number | null): KaladaErrorCstNode {
    const range = index === null ? this.current().range : this.token(index).range;
    return this.create({ kind: "error", token: index, range });
  }

  private recoverAdvance(): number | null {
    if (this.at("eof")) return null;
    this.budget.recover(this.current().range);
    const found = this.consume();
    return found;
  }

  private currentOperator(operators: ReadonlySet<string>): boolean {
    const current = this.current();
    return (
      (current.kind === "operator" || current.kind === "in" || current.kind === "xor") &&
      operators.has(current.text)
    );
  }

  private operator(value: string): boolean {
    return this.current().kind === "operator" && this.current().text === value;
  }

  private isBinary(value: KaladaToken): boolean {
    return (
      value.kind === "in" ||
      value.kind === "xor" ||
      (value.kind === "operator" && !["!"].includes(value.text))
    );
  }

  private at(kind: KaladaToken["kind"]): boolean {
    return this.current().kind === kind;
  }
  private current(): KaladaToken {
    this.skipTrivia();
    const found = this.token(this.index);
    if (found.kind === "invalid" && this.sink.hasLexicalLimitAt(found.range.start))
      this.budget.exhaust(found.range.start);
    return found;
  }
  private token(index: number): KaladaToken {
    const found = this.tokens[index] ?? this.tokens[this.tokens.length - 1];
    if (found === undefined) throw new Error("Parser token invariant failed.");
    return found;
  }

  private consume(): number {
    this.skipTrivia();
    const found = this.index;
    if (this.tokens[found]?.kind !== "eof") this.index += 1;
    return found;
  }

  private skipTrivia(): void {
    while (this.tokens[this.index]?.kind === "whitespace") this.index += 1;
  }
}
