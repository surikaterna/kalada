import { KaladaV1, Option } from "@kalada/core";
import { compileProjectionV1, ProjectionV1 } from "@kalada/projection";
import { formatKaladaV1Expression } from "@kalada/syntax";

const formatted = formatKaladaV1Expression("1+2");
const compiled = compileProjectionV1(
  ProjectionV1.program(ProjectionV1.value(KaladaV1.program(KaladaV1.literal("browser")))),
);
const outcome = compiled.ok ? compiled.value.evaluate(() => ({ found: false })) : compiled;
if (!formatted.ok || !Option.none || JSON.stringify(outcome) !== '{"ok":true,"value":"browser"}') {
  throw new Error("Bundled package execution failed");
}
globalThis.packagePolicyBrowserOutcome = { formatted: formatted.text, outcome };
