import type { JsonValue } from "@kalada/core";

export interface KaladaSourceRange {
  readonly start: number;
  readonly end: number;
}

export type KaladaTokenKind =
  | "whitespace"
  | "identifier"
  | "number"
  | "string"
  | "true"
  | "false"
  | "null"
  | "in"
  | "xor"
  | "left-parenthesis"
  | "right-parenthesis"
  | "dot"
  | "optional-dot"
  | "question"
  | "colon"
  | "operator"
  | "unsupported"
  | "invalid"
  | "eof";

export interface KaladaToken {
  readonly kind: KaladaTokenKind;
  readonly text: string;
  readonly range: KaladaSourceRange;
}

interface CstBase {
  readonly range: KaladaSourceRange;
}

export interface KaladaLiteralCstNode extends CstBase {
  readonly kind: "literal";
  readonly literalKind: "number" | "string" | "boolean" | "null";
  readonly token: number;
  readonly value: JsonValue;
}

export interface KaladaReferenceCstNode extends CstBase {
  readonly kind: "reference";
  readonly token: number;
  readonly name: string;
}

export interface KaladaGroupCstNode extends CstBase {
  readonly kind: "group";
  readonly openToken: number;
  readonly expression: KaladaCstNode;
  readonly closeToken: number | null;
}

export interface KaladaFieldAccessCstNode extends CstBase {
  readonly kind: "field-access";
  readonly target: KaladaCstNode;
  readonly optional: boolean;
  readonly operatorToken: number;
  readonly fieldToken: number | null;
  readonly field: string | null;
}

export interface KaladaUnaryCstNode extends CstBase {
  readonly kind: "unary";
  readonly operator: "!" | "+" | "-";
  readonly operatorToken: number;
  readonly operand: KaladaCstNode;
}

export type KaladaBinaryOperator =
  | "*"
  | "/"
  | "%"
  | "+"
  | "-"
  | "<"
  | "<="
  | ">"
  | ">="
  | "in"
  | "=="
  | "!="
  | "&&"
  | "xor"
  | "||"
  | "??";

export interface KaladaBinaryCstNode extends CstBase {
  readonly kind: "binary";
  readonly operator: KaladaBinaryOperator;
  readonly operatorToken: number;
  readonly left: KaladaCstNode;
  readonly right: KaladaCstNode;
}

export interface KaladaConditionalCstNode extends CstBase {
  readonly kind: "conditional";
  readonly condition: KaladaCstNode;
  readonly questionToken: number;
  readonly then: KaladaCstNode;
  readonly colonToken: number | null;
  readonly else: KaladaCstNode;
}

export interface KaladaErrorCstNode extends CstBase {
  readonly kind: "error";
  readonly token: number | null;
}

export type KaladaCstNode =
  | KaladaLiteralCstNode
  | KaladaReferenceCstNode
  | KaladaGroupCstNode
  | KaladaFieldAccessCstNode
  | KaladaUnaryCstNode
  | KaladaBinaryCstNode
  | KaladaConditionalCstNode
  | KaladaErrorCstNode;

export interface KaladaCstDocument {
  readonly source: string;
  readonly tokens: readonly KaladaToken[];
  readonly expression: KaladaCstNode;
}
