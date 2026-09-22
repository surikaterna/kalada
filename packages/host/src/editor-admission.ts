export type EditorGraphEdgeCategory = "root" | "definition" | "child" | "resolution";

export interface EditorGraphAdmissionRequest {
  readonly maxEdges: number;
  readonly definitions: number;
  readonly children: number;
  readonly resolutions: number;
  readonly roots: number;
  readonly evidenceReserve?: number;
}

export interface EditorGraphAdmission {
  readonly model: Readonly<{
    readonly B: number;
    readonly D: number;
    readonly C: number;
    readonly V: number;
    readonly R: number;
    readonly Q: number;
  }>;
  readonly requestedChildren: number;
  readonly backboneAdmitted: boolean;
  readonly truncated: boolean;
  readonly total: number;
  readonly remaining: number;
}

export interface EditorGraphEdgeUsage {
  readonly budget: number;
  readonly root: number;
  readonly definition: number;
  readonly child: number;
  readonly resolution: number;
  readonly total: number;
  readonly remaining: number;
}

export interface EditorGraphEdgeMeter {
  readonly claim: (category: EditorGraphEdgeCategory) => boolean;
  readonly snapshot: () => EditorGraphEdgeUsage;
}

export function calculateEditorGraphAdmission(
  request: EditorGraphAdmissionRequest,
): EditorGraphAdmission {
  const B = boundedCount(request.maxEdges);
  const D = boundedCount(request.definitions);
  const requestedChildren = boundedCount(request.children);
  const V = boundedCount(request.resolutions);
  const R = boundedCount(request.roots);
  const Q = boundedCount(request.evidenceReserve ?? 0);
  const fixed = D + V + R + Q;
  const backboneAdmitted = fixed <= B;
  const C = backboneAdmitted ? Math.min(requestedChildren, B - fixed) : 0;
  const total = backboneAdmitted ? fixed + C : 0;
  return Object.freeze({
    model: Object.freeze({ B, D, C, V, R, Q }),
    requestedChildren,
    backboneAdmitted,
    truncated: !backboneAdmitted || C < requestedChildren,
    total,
    remaining: B - total,
  });
}

export function createEditorGraphEdgeMeter(maxEdges: number): EditorGraphEdgeMeter {
  const budget = boundedCount(maxEdges);
  const counts: Record<EditorGraphEdgeCategory, number> = {
    root: 0,
    definition: 0,
    child: 0,
    resolution: 0,
  };
  return Object.freeze({
    claim(category: EditorGraphEdgeCategory) {
      if (sumCounts(counts) >= budget) return false;
      counts[category] += 1;
      return true;
    },
    snapshot() {
      const total = sumCounts(counts);
      return Object.freeze({ budget, ...counts, total, remaining: budget - total });
    },
  });
}

function boundedCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function sumCounts(counts: Readonly<Record<EditorGraphEdgeCategory, number>>): number {
  return counts.root + counts.definition + counts.child + counts.resolution;
}
