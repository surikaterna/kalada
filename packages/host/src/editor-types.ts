export type HostPath = readonly (string | number)[];

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
  | "string"
  | "json"
  | "instant"
  | "duration";

export interface EditorScalarShape {
  readonly kind: "scalar";
  readonly name: EditorScalarName;
}

export interface EditorUnknownShape {
  readonly kind: "unknown";
  readonly reason?: string;
}

export interface EditorObjectPropertyShape {
  readonly name: string;
  readonly required: boolean;
  readonly shape: EditorShape;
}

export interface EditorObjectShape {
  readonly kind: "object";
  readonly properties: readonly EditorObjectPropertyShape[];
}

export interface EditorArrayShape {
  readonly kind: "array";
  readonly element: EditorShape;
}

export interface EditorTupleShape {
  readonly kind: "tuple";
  readonly items: readonly EditorShape[];
  readonly rest?: EditorShape;
}

export interface EditorUnionShape {
  readonly kind: "union";
  readonly variants: readonly EditorShape[];
}

export interface EditorReferenceShape {
  readonly kind: "reference";
  readonly definition: string;
}

export type EditorShape =
  | EditorScalarShape
  | EditorUnknownShape
  | EditorObjectShape
  | EditorArrayShape
  | EditorTupleShape
  | EditorUnionShape
  | EditorReferenceShape;

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
}

export interface EditorNodeBase {
  readonly id: string;
  readonly path: HostPath;
  readonly availability: "available" | "unknown";
  readonly evidence: readonly EditorUnknownEvidence[];
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
}

export interface EditorReferenceNode extends EditorNodeBase {
  readonly kind: "reference";
  readonly definition: string;
  readonly status: "resolved" | "unresolved";
  readonly target?: EditorEdge;
}

export type EditorNode =
  | EditorScalarNode
  | EditorUnknownNode
  | EditorObjectNode
  | EditorArrayNode
  | EditorTupleNode
  | EditorUnionNode
  | EditorReferenceNode;

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
  readonly via: "root" | "property" | "element" | "item" | "rest" | "variant" | "reference";
  readonly cycle: boolean;
  readonly availability: "available" | "unknown";
}
