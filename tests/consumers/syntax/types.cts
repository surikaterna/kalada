import syntax = require("@kalada/syntax");
const direct: syntax.KaladaDirectLocationOutcome = syntax.checkKaladaV1DirectLocation(
  "line.quantity",
  {
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
  },
);
if (direct.ok) {
  const segments: readonly string[] = direct.location.target.segments;
  void segments;
}
const rejected: syntax.KaladaDirectLocationOutcome = syntax.checkKaladaV1DirectLocation(
  "line?.quantity",
  { bindings: {} },
);
if (!rejected.ok) {
  const code: string | undefined = rejected.diagnostics[0]?.code;
  void code;
}

const parsed: syntax.KaladaParseResult = syntax.parseKaladaV1Expression("true");
const guest: syntax.ExperimentalKaladaV1GuestPrefixResult =
  syntax.experimentalParseKaladaV1GuestExpressionPrefix("{true}", 1);
void guest.stop;
const formatted: syntax.KaladaFormatOutcome = syntax.formatKaladaV1Expression(
  parsed.document.source,
);
const lowered: syntax.KaladaLowerOutcome = syntax.lowerKaladaV1Expression(parsed);
const resultType: syntax.KaladaSyntaxStaticType | undefined = lowered.ok
  ? lowered.resultType
  : undefined;
void formatted;
void resultType;
