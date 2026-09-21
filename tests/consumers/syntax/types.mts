import type {
  KaladaParseResult,
  KaladaSourceMapEntry,
  KaladaSyntaxStaticType,
} from "@kalada/syntax";
import { lowerKaladaV1Expression, parseKaladaV1Expression } from "@kalada/syntax";

const parsed: KaladaParseResult = parseKaladaV1Expression("item");
const lowered = lowerKaladaV1Expression<{ id: string }>(parsed, {
  references: { item: { reference: { id: "item" }, type: "dynamic" } },
  coreOptions: {
    reference: {
      validate: (value): value is { id: string } =>
        typeof value === "object" && value !== null && "id" in value,
    },
  },
});
if (lowered.ok) {
  const entries: readonly KaladaSourceMapEntry[] = lowered.sourceMap;
  const resultType: KaladaSyntaxStaticType = lowered.resultType;
  void entries;
  void resultType;
}
