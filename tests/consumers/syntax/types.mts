import type {
  ExperimentalKaladaV1GuestPrefixResult,
  KaladaDirectLocationOutcome,
  KaladaParseResult,
  KaladaSemanticQueryResult,
  KaladaSourceMapEntry,
  KaladaSyntaxStaticType,
} from "@kalada/syntax";
import {
  checkKaladaV1DirectLocation,
  experimentalParseKaladaV1GuestExpressionPrefix,
  lowerKaladaV1Expression,
  parseKaladaV1Expression,
  queryKaladaV1Semantics,
} from "@kalada/syntax";

const parsed: KaladaParseResult = parseKaladaV1Expression("item");
const direct: KaladaDirectLocationOutcome = checkKaladaV1DirectLocation("line.quantity", {
  bindings: {
    line: {
      target: { namespace: "data", scope: "line", segments: [] },
      type: { kind: "primitive-type", name: "json" },
      writable: true,
      properties: {
        quantity: { type: { kind: "primitive-type", name: "number" }, writable: true },
      },
    },
  },
});
if (direct.ok) {
  const scope: string | undefined = direct.location.target.scope;
  void scope;
}
const rejected: KaladaDirectLocationOutcome = checkKaladaV1DirectLocation("line?.quantity", {
  bindings: {},
});
if (!rejected.ok) {
  const code: string | undefined = rejected.diagnostics[0]?.code;
  void code;
}
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
