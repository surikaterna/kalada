import type {
  ExperimentalKaladaV1GuestPrefixResult,
  KaladaParseResult,
  KaladaSemanticQueryResult,
  KaladaSourceMapEntry,
  KaladaSyntaxStaticType,
} from "@kalada/syntax";
import {
  experimentalParseKaladaV1GuestExpressionPrefix,
  lowerKaladaV1Expression,
  parseKaladaV1Expression,
  queryKaladaV1Semantics,
} from "@kalada/syntax";

const parsed: KaladaParseResult = parseKaladaV1Expression("item");
const guest: ExperimentalKaladaV1GuestPrefixResult = experimentalParseKaladaV1GuestExpressionPrefix(
  "{item}",
  1,
);
if (guest.ok && guest.parsed) {
  const range: number = guest.range.end;
  const stop: number = guest.stop;
  void [range, stop, lowerKaladaV1Expression(guest.parsed)];
}
const semantics: KaladaSemanticQueryResult = queryKaladaV1Semantics(parsed);
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
  void [resultType, semantics];
}
