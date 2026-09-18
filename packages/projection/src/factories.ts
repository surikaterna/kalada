import type { KaladaV1Program } from "@kalada/core/kalada-v1";
import type { ProjectionNode, ProjectionObjectEntry, ProjectionProgram } from "./types.js";

const program = (root: ProjectionNode): ProjectionProgram => ({
  format: "kalada-projection",
  version: 1,
  profile: "projection-v1",
  root,
});
const value = (expression: KaladaV1Program<string>): ProjectionNode => ({
  kind: "value",
  expression,
});
const entry = (key: string, node: ProjectionNode): ProjectionObjectEntry => ({ key, value: node });
const object = (entries: readonly ProjectionObjectEntry[]): ProjectionNode => ({
  kind: "object",
  entries,
});
const array = (items: readonly ProjectionNode[]): ProjectionNode => ({ kind: "array", items });
const conditional = (
  condition: KaladaV1Program<string>,
  then: ProjectionNode,
  otherwise?: ProjectionNode,
): ProjectionNode => ({
  kind: "if",
  condition,
  then,
  ...(otherwise === undefined ? {} : { else: otherwise }),
});
const map = (
  collection: KaladaV1Program<string>,
  item: string,
  index: string,
  body: ProjectionNode,
): ProjectionNode => ({ kind: "map", collection, item, index, body });

export const ProjectionV1 = Object.freeze({
  program,
  value,
  entry,
  object,
  array,
  if: conditional,
  map,
});
