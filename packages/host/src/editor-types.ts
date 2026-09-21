export type HostPath = readonly (string | number)[];

export type EditorData =
  | null
  | boolean
  | number
  | string
  | readonly EditorData[]
  | { readonly [key: string]: EditorData };

export interface EditorRelationShape {
  readonly name: string;
  readonly key?: string;
  readonly shape: EditorShape;
}

export interface EditorShapeEvidence {
  readonly sourceId?: string;
  readonly annotations?: EditorData;
  readonly constraints?: EditorData;
  readonly relations?: readonly EditorRelationShape[];
}

export type EditorUnknownCode =
  | "invalid-shape"
  | "unsupported-shape"
  | "depth-limit"
  | "node-limit"
  | "edge-limit"
  | "unresolved-reference";

export interface EditorUnknownEvidence {
  readonly code: EditorUnknownCode;
  readonly path: HostPath;
}

export type EditorScalarName =
  | "null"
  | "boolean"
  | "number"
  | "integer"
  | "string"
  | "undefined"
  | "void"
  | "bigint"
  | "symbol"
  | "date"
  | "NaN"
  | "json"
  | "instant"
  | "duration";

export interface EditorScalarShape extends EditorShapeEvidence {
  readonly kind: "scalar";
  readonly name: EditorScalarName;
}

export interface EditorUnknownShape extends EditorShapeEvidence {
  readonly kind: "unknown";
  readonly reason?: string;
}

export interface EditorObjectPropertyShape {
  readonly name: string;
  readonly required: boolean;
  readonly presence?: "required" | "optional" | "unknown";
  readonly shape: EditorShape;
}

export interface EditorObjectShape extends EditorShapeEvidence {
  readonly kind: "object";
  readonly properties: readonly EditorObjectPropertyShape[];
  readonly requiredNames?: readonly string[];
  readonly additionalProperties?: EditorShape;
  readonly unknownKeys?: "strip" | "reject" | "passthrough" | "schema" | "unknown";
}

export interface EditorArrayShape extends EditorShapeEvidence {
  readonly kind: "array";
  readonly element: EditorShape;
}

export interface EditorTupleShape extends EditorShapeEvidence {
  readonly kind: "tuple";
  readonly items: readonly EditorShape[];
  readonly rest?: EditorShape;
}

export interface EditorUnionShape extends EditorShapeEvidence {
  readonly kind: "union";
  readonly variants: readonly EditorShape[];
  readonly semantics?: string;
  readonly discriminator?: EditorData;
}

export interface EditorReferenceShape extends EditorShapeEvidence {
  readonly kind: "reference";
  readonly definition: string;
  readonly reference?: string;
  readonly unresolved?: string;
}

export interface EditorLiteralShape extends EditorShapeEvidence {
  readonly kind: "literal";
  readonly value: EditorData;
}

export interface EditorEnumShape extends EditorShapeEvidence {
  readonly kind: "enum";
  readonly values: readonly EditorData[];
}

export interface EditorNeverShape extends EditorShapeEvidence {
  readonly kind: "never";
}

export interface EditorUnconstrainedShape extends EditorShapeEvidence {
  readonly kind: "unconstrained";
  readonly domain: "json" | "js";
}

export interface EditorOpaqueShape extends EditorShapeEvidence {
  readonly kind: "opaque";
  readonly reason: string;
}

export interface EditorRecordShape extends EditorShapeEvidence {
  readonly kind: "record";
  readonly key: EditorShape;
  readonly value: EditorShape;
  readonly exhaustive: boolean | "unknown";
}

export interface EditorIntersectionShape extends EditorShapeEvidence {
  readonly kind: "intersection";
  readonly operands: readonly EditorShape[];
}

export interface EditorWrapperShape extends EditorShapeEvidence {
  readonly kind: "wrapper";
  readonly wrapper: string;
  readonly inner: EditorShape;
  readonly value?: EditorData;
}

export type EditorShape =
  | EditorScalarShape
  | EditorUnknownShape
  | EditorObjectShape
  | EditorArrayShape
  | EditorTupleShape
  | EditorUnionShape
  | EditorReferenceShape
  | EditorLiteralShape
  | EditorEnumShape
  | EditorNeverShape
  | EditorUnconstrainedShape
  | EditorOpaqueShape
  | EditorRecordShape
  | EditorIntersectionShape
  | EditorWrapperShape;

export interface ManualEditorDefinition {
  readonly name: string;
  readonly shape: EditorShape;
}

export interface ManualEditorShapeDocument {
  readonly root: EditorShape;
  readonly definitions?: readonly ManualEditorDefinition[];
}

export interface EditorGraphLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxEdges: number;
}

export interface EditorGraphInput {
  readonly bindingId: string;
  readonly path: HostPath;
  readonly document: ManualEditorShapeDocument;
}

export interface EditorEdge {
  readonly nodeId: string;
  readonly path: HostPath;
  readonly cycle: boolean;
}

export interface EditorPropertyEdge extends EditorEdge {
  readonly name: string;
  readonly required: boolean;
  readonly presence: "required" | "optional" | "unknown";
}

export interface EditorRelationEdge extends EditorEdge {
  readonly name: string;
  readonly key?: string;
}

export interface EditorNodeBase {
  readonly id: string;
  readonly path: HostPath;
  readonly availability: "available" | "unknown";
  readonly evidence: readonly EditorUnknownEvidence[];
  readonly sourceId?: string;
  readonly annotations?: EditorData;
  readonly constraints?: EditorData;
  readonly relations: readonly EditorRelationEdge[];
}

export interface EditorScalarNode extends EditorNodeBase {
  readonly kind: "scalar";
  readonly name: EditorScalarName;
}

export interface EditorUnknownNode extends EditorNodeBase {
  readonly kind: "unknown";
  readonly reason?: string;
}

export interface EditorObjectNode extends EditorNodeBase {
  readonly kind: "object";
  readonly properties: readonly EditorPropertyEdge[];
  readonly requiredNames: readonly string[];
  readonly unknownKeys?: "strip" | "reject" | "passthrough" | "schema" | "unknown";
  readonly additionalProperties?: EditorEdge;
}

export interface EditorArrayNode extends EditorNodeBase {
  readonly kind: "array";
  readonly element: EditorEdge;
}

export interface EditorTupleNode extends EditorNodeBase {
  readonly kind: "tuple";
  readonly items: readonly EditorEdge[];
  readonly rest?: EditorEdge;
}

export interface EditorUnionNode extends EditorNodeBase {
  readonly kind: "union";
  readonly variants: readonly EditorEdge[];
  readonly semantics?: string;
  readonly discriminator?: EditorData;
}

export interface EditorReferenceNode extends EditorNodeBase {
  readonly kind: "reference";
  readonly definition: string;
  readonly status: "resolved" | "unresolved";
  readonly target?: EditorEdge;
  readonly reference?: string;
  readonly unresolved?: string;
}

export interface EditorLiteralNode extends EditorNodeBase {
  readonly kind: "literal";
  readonly value: EditorData;
}

export interface EditorEnumNode extends EditorNodeBase {
  readonly kind: "enum";
  readonly values: readonly EditorData[];
}

export interface EditorNeverNode extends EditorNodeBase {
  readonly kind: "never";
}

export interface EditorUnconstrainedNode extends EditorNodeBase {
  readonly kind: "unconstrained";
  readonly domain: "json" | "js";
}

export interface EditorOpaqueNode extends EditorNodeBase {
  readonly kind: "opaque";
  readonly reason: string;
}

export interface EditorRecordNode extends EditorNodeBase {
  readonly kind: "record";
  readonly key: EditorEdge;
  readonly value: EditorEdge;
  readonly exhaustive: boolean | "unknown";
}

export interface EditorIntersectionNode extends EditorNodeBase {
  readonly kind: "intersection";
  readonly operands: readonly EditorEdge[];
}

export interface EditorWrapperNode extends EditorNodeBase {
  readonly kind: "wrapper";
  readonly wrapper: string;
  readonly inner: EditorEdge;
  readonly value?: EditorData;
}

export type EditorNode =
  | EditorScalarNode
  | EditorUnknownNode
  | EditorObjectNode
  | EditorArrayNode
  | EditorTupleNode
  | EditorUnionNode
  | EditorReferenceNode
  | EditorLiteralNode
  | EditorEnumNode
  | EditorNeverNode
  | EditorUnconstrainedNode
  | EditorOpaqueNode
  | EditorRecordNode
  | EditorIntersectionNode
  | EditorWrapperNode;

export interface EditorGraphRoot extends EditorEdge {
  readonly bindingId: string;
}

export interface EditorGraphDefinition {
  readonly bindingId: string;
  readonly name: string;
  readonly nodeId: string;
  readonly path: HostPath;
}

export interface EditorGraph {
  readonly format: "kalada-editor-graph-v1";
  readonly nodeIdScope: "document-local";
  readonly limits: EditorGraphLimits;
  readonly roots: readonly EditorGraphRoot[];
  readonly nodes: readonly EditorNode[];
  readonly definitions: readonly EditorGraphDefinition[];
  readonly evidence: readonly EditorUnknownEvidence[];
}

export interface EditorTraversalOptions {
  readonly maxDepth?: number;
  readonly maxVisits?: number;
}

export interface EditorTraversalStep {
  readonly nodeId: string;
  readonly path: HostPath;
  readonly depth: number;
  readonly via:
    | "root"
    | "property"
    | "additional-property"
    | "element"
    | "item"
    | "rest"
    | "variant"
    | "operand"
    | "record-key"
    | "record-value"
    | "wrapper"
    | "relation"
    | "reference";
  readonly cycle: boolean;
  readonly availability: "available" | "unknown";
}
