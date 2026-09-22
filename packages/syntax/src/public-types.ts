import type {
  JsonValue,
  KaladaType,
  KaladaV1DiagnosticCode,
  KaladaV1Options,
  KaladaV1Program,
} from "@kalada/core";
import type { KaladaBinaryOperator, KaladaCstDocument, KaladaSourceRange } from "./cst-types.js";

export interface KaladaSyntaxLimits {
  readonly maxSourceLength: number;
  readonly maxTokens: number;
  readonly maxCstDepth: number;
  readonly maxCstNodes: number;
  readonly maxDiagnostics: number;
  readonly maxRecoveryTokens: number;
  readonly maxIdentifierLength: number;
  readonly maxDecodedStringLength: number;
  readonly maxStaticTypeDepth: number;
}

export interface KaladaParseOptions {
  readonly limits?: Partial<KaladaSyntaxLimits>;
}

export type KaladaSyntaxDiagnosticCode =
  | "KALADA_SYNTAX_INVALID_INPUT"
  | "KALADA_SYNTAX_LIMIT_EXCEEDED"
  | "KALADA_SYNTAX_UNEXPECTED_TOKEN"
  | "KALADA_SYNTAX_EXPECTED_EXPRESSION"
  | "KALADA_SYNTAX_EXPECTED_FIELD"
  | "KALADA_SYNTAX_EXPECTED_RIGHT_PARENTHESIS"
  | "KALADA_SYNTAX_EXPECTED_COLON"
  | "KALADA_SYNTAX_INVALID_NUMBER"
  | "KALADA_SYNTAX_INVALID_STRING"
  | "KALADA_SYNTAX_UNSUPPORTED_FORM"
  | "KALADA_SYNTAX_UNSUPPORTED_OPERATOR"
  | "KALADA_SYNTAX_RELATIONAL_CHAIN"
  | "KALADA_SYNTAX_COALESCE_LOGICAL_MIX"
  | "KALADA_SYNTAX_UNKNOWN_REFERENCE";

export interface KaladaSyntaxDiagnostic {
  readonly phase: "lex" | "parse" | "lower";
  readonly code: KaladaSyntaxDiagnosticCode | KaladaV1DiagnosticCode;
  readonly message: string;
  readonly range: KaladaSourceRange;
  readonly path: readonly (string | number)[];
}

export interface KaladaParseResult {
  readonly document: KaladaCstDocument;
  readonly diagnostics: readonly KaladaSyntaxDiagnostic[];
}

export type KaladaSyntaxStaticType = "dynamic" | KaladaType;

export type KaladaSemanticSupport = "supported" | "conditional" | "unsupported";

export interface KaladaSemanticOperatorInfo {
  readonly operator: KaladaBinaryOperator;
  readonly support: KaladaSemanticSupport;
}

export interface KaladaSemanticNodeInfo {
  readonly range: KaladaSourceRange;
  readonly type: KaladaSyntaxStaticType;
  readonly known: boolean;
  readonly fieldAccess: Readonly<{
    plain: KaladaSemanticSupport;
    optional: KaladaSemanticSupport;
  }>;
  readonly operators: readonly KaladaSemanticOperatorInfo[];
}

export interface KaladaSemanticQueryResult {
  readonly nodes: readonly KaladaSemanticNodeInfo[];
  readonly diagnostics: readonly KaladaSyntaxDiagnostic[];
  readonly incomplete: boolean;
}

export interface KaladaReferenceBinding<R extends JsonValue> {
  readonly reference: R;
  readonly type: KaladaSyntaxStaticType;
}

export interface KaladaLowerOptions<R extends JsonValue> {
  readonly references?: Readonly<Record<string, KaladaReferenceBinding<R>>>;
  readonly coreOptions?: KaladaV1Options<R>;
}

export type KaladaSourceMapRole = "node" | "operator" | "literal" | "reference" | "field" | "group";

export interface KaladaSourceMapEntry {
  readonly path: readonly (string | number)[];
  readonly role: KaladaSourceMapRole;
  readonly range: KaladaSourceRange;
}

export type KaladaLowerOutcome<R extends JsonValue = string> =
  | {
      readonly ok: true;
      readonly program: KaladaV1Program<R>;
      readonly sourceMap: readonly KaladaSourceMapEntry[];
      readonly resultType: KaladaSyntaxStaticType;
    }
  | { readonly ok: false; readonly diagnostics: readonly KaladaSyntaxDiagnostic[] };

export type KaladaFormatOutcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly diagnostics: readonly KaladaSyntaxDiagnostic[] };
