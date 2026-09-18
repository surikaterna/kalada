import type {
  KaladaV1Diagnostic,
  KaladaV1FunctionLimits,
  KaladaV1Limits,
  KaladaV1Program,
} from "@kalada/core/kalada-v1";

export type ProjectionPath = readonly (string | number)[];

export interface ProjectionValueNode {
  readonly kind: "value";
  readonly expression: KaladaV1Program<string>;
}

export interface ProjectionObjectEntry {
  readonly key: string;
  readonly value: ProjectionNode;
}

export interface ProjectionObjectNode {
  readonly kind: "object";
  readonly entries: readonly ProjectionObjectEntry[];
}

export interface ProjectionArrayNode {
  readonly kind: "array";
  readonly items: readonly ProjectionNode[];
}

export interface ProjectionIfNode {
  readonly kind: "if";
  readonly condition: KaladaV1Program<string>;
  readonly then: ProjectionNode;
  readonly else?: ProjectionNode;
}

export interface ProjectionMapNode {
  readonly kind: "map";
  readonly collection: KaladaV1Program<string>;
  readonly item: string;
  readonly index: string;
  readonly body: ProjectionNode;
}

export type ProjectionNode =
  | ProjectionValueNode
  | ProjectionObjectNode
  | ProjectionArrayNode
  | ProjectionIfNode
  | ProjectionMapNode;

export interface ProjectionProgram {
  readonly format: "kalada-projection";
  readonly version: 1;
  readonly profile: "projection-v1";
  readonly root: ProjectionNode;
}

export interface ProjectionV1Limits {
  readonly maxProjectionDepth: number;
  readonly maxProjectionNodes: number;
  readonly maxObjectEntries: number;
  readonly maxArrayItems: number;
  readonly maxNameLength: number;
  readonly maxKeyLength: number;
  readonly maxExpressionInvocations: number;
  readonly maxCollectionLength: number;
  readonly maxCollectionIterations: number;
  readonly maxOutputDepth: number;
  readonly maxOutputNodes: number;
  readonly maxOutputBytes: number;
}

export interface ProjectionV1Options {
  readonly limits?: Partial<ProjectionV1Limits>;
  readonly coreLimits?: Partial<KaladaV1Limits & KaladaV1FunctionLimits>;
}

export type ProjectionDiagnosticCode =
  | "PROJECTION_INVALID_INPUT"
  | "PROJECTION_LIMIT_EXCEEDED"
  | "PROJECTION_DUPLICATE_KEY"
  | "PROJECTION_UNSAFE_KEY"
  | "PROJECTION_CONDITION_TYPE"
  | "PROJECTION_COLLECTION_TYPE"
  | "PROJECTION_VALUE_TYPE"
  | "PROJECTION_OUTPUT_LIMIT"
  | "PROJECTION_CORE_ERROR"
  | "PROJECTION_CLOCK_ERROR";

export interface ProjectionDiagnostic {
  readonly code: ProjectionDiagnosticCode;
  readonly path: ProjectionPath;
  readonly message: string;
  readonly cause?: KaladaV1Diagnostic;
}

export type ProjectionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: ProjectionDiagnostic };

export interface CompiledProjection {
  readonly projection: ProjectionProgram;
  readonly dependencies: readonly string[];
}
