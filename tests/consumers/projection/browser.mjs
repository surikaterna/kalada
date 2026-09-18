import { KaladaV1 as K } from "@kalada/core/kalada-v1";
import { compileProjectionV1, ProjectionV1 as P } from "@kalada/projection";

const compiled = compileProjectionV1(P.program(P.value(K.program(K.literal("browser")))));
if (!compiled.ok) throw new Error(compiled.diagnostic.code);
const outcome = compiled.value.evaluate(() => ({ found: false }));
if (JSON.stringify(outcome) !== '{"ok":true,"value":"browser"}') {
  throw new Error(`Browser projection mismatch: ${JSON.stringify(outcome)}`);
}
globalThis.projectionBrowserOutcome = outcome;
