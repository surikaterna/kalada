import { KaladaV1, type KaladaV1Resolution } from "@kalada/core";
import {
  compileProjectionV1,
  type ProjectionEvaluationOutcome,
  type ProjectionProgram,
  ProjectionV1,
  type ProjectionV1Limits,
} from "@kalada/projection";
import schema from "@kalada/projection/projection-v1.schema.json" with { type: "json" };

const program: ProjectionProgram = ProjectionV1.program(
  ProjectionV1.value(KaladaV1.program(KaladaV1.literal(schema.$id))),
);
const limits: Partial<ProjectionV1Limits> = { maxOutputNodes: 2 };
const compiled = compileProjectionV1(program, { limits });
const missing = (): KaladaV1Resolution => ({ found: false });
const outcome: ProjectionEvaluationOutcome = compiled.ok
  ? compiled.value.evaluate(missing)
  : compiled;
void outcome;
