import type {
  CompiledKaladaV1Program,
  KaladaV1FunctionLimits,
  KaladaV1Limits,
  KaladaV1Program,
  KaladaValue,
} from "@kalada/core";
import type {
  KaladaParseOptions,
  KaladaParseResult,
  KaladaSourceMapEntry,
  KaladaSyntaxStaticType,
} from "@kalada/syntax";
import type { CapabilityDeclaration, HostDiagnostic, NormalizedEnvironment } from "./contracts.js";
import type { HostPath } from "./editor-types.js";

export type HostExecutionDiagnosticCode =
  | "HOST_PARSE_INVALID_SOURCE"
  | "HOST_COMPILE_INVALID_OPTIONS"
  | "HOST_COMPILE_INVALID_PROJECTION"
  | "HOST_LINK_INCOMPATIBLE_ENVIRONMENT"
  | "HOST_LINK_MISSING_BINDING"
  | "HOST_LINK_INVALID_CAPABILITY"
  | "HOST_LINK_ASYNC_UNSUPPORTED"
  | "HOST_BINDING_MISSING"
  | "HOST_BINDING_DECODE"
  | "HOST_BINDING_CONVERSION"
  | "HOST_BINDING_SEMANTIC";

export type HostResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; diagnostics: readonly HostDiagnostic[] }>;

export interface HostExpressionSource {
  readonly uri: string;
  readonly text: string;
}

export interface HostParseOptions {
  readonly sourceUri?: string;
  readonly syntax?: KaladaParseOptions;
}

export interface HostCompileOptions {
  readonly profile?: string;
  readonly limits?: Partial<KaladaV1Limits & KaladaV1FunctionLimits>;
}

export interface HostPrepareOptions {
  readonly parse?: HostParseOptions;
  readonly compile?: HostCompileOptions;
}

export interface ParsedExpression {
  readonly format: "kalada-host-parsed-expression-v1";
  readonly source: HostExpressionSource;
  readonly syntax: KaladaParseResult;
  readonly parseFingerprintInput: Readonly<Record<string, unknown>>;
}

export interface CompiledExpression {
  readonly format: "kalada-host-compiled-expression-v1";
  readonly source: HostExpressionSource;
  readonly parsed: ParsedExpression;
  readonly program: KaladaV1Program<string>;
  readonly sourceMap: readonly KaladaSourceMapEntry[];
  readonly coreCompilation: CompiledKaladaV1Program<string>;
  readonly dependencies: readonly string[];
  readonly resultType: KaladaSyntaxStaticType;
  readonly compileProjectionFingerprint: string;
  readonly compileFingerprint: string;
}

export interface HostLinkPlanSlot {
  readonly index: number;
  readonly bindingId: string;
  readonly name: string;
  readonly path: HostPath;
  readonly semanticType: KaladaSyntaxStaticType;
  readonly validator?: CapabilityDeclaration;
  readonly codec?: CapabilityDeclaration;
}

export interface PreparedExpression {
  readonly format: "kalada-host-prepared-expression-v1";
  readonly compiled: CompiledExpression;
  readonly environment: NormalizedEnvironment;
  readonly linkPlan: readonly HostLinkPlanSlot[];
  readonly linkFingerprint?: string;
  evaluate(values: unknown): HostResult<KaladaValue>;
}

export type LinkExpressionResult = HostResult<PreparedExpression>;
export type CompileExpressionResult = HostResult<CompiledExpression>;
export type ParseExpressionResult = HostResult<ParsedExpression>;
export type PrepareExpressionResult = HostResult<PreparedExpression>;
export type EvaluateExpressionResult = HostResult<KaladaValue>;
