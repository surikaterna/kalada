import { KaladaV1, type KaladaV1Program } from "@kalada/core";
import { compileProjectionV1, type ProjectionProgram, ProjectionV1 } from "@kalada/projection";
import { type KaladaParseResult, parseKaladaV1Expression } from "@kalada/syntax";

const core: KaladaV1Program = KaladaV1.program(KaladaV1.literal(true));
const parsed: KaladaParseResult = parseKaladaV1Expression("true");
const projection: ProjectionProgram = ProjectionV1.program(ProjectionV1.value(core));
void [parsed, compileProjectionV1(projection)];
