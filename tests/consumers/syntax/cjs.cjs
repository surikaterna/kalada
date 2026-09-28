const syntax = require("@kalada/syntax");
const write = syntax.checkKaladaV1DirectLocation("line.quantity", {
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
if (
  !write.ok ||
  write.location.target.segments[0] !== "quantity" ||
  syntax.checkKaladaV1DirectLocation("line.quantity + 1", { bindings: {} }).ok
)
  throw new Error("CJS WRITE check failed");
const parsed = syntax.parseKaladaV1Expression("1+2*3");
const lowered = syntax.lowerKaladaV1Expression(parsed);
if (
  !lowered.ok ||
  lowered.program.expression.kind !== "numeric-binary" ||
  lowered.resultType.name !== "number"
) {
  throw new Error("CJS lowering failed");
}
const source = '{"}" + "x"}TAIL';
const guest = syntax.experimentalParseKaladaV1GuestExpressionPrefix(source, 1);
if (
  !guest.ok ||
  source[guest.stop] !== "}" ||
  source.slice(guest.stop + 1) !== "TAIL" ||
  guest.range.end !== guest.stop ||
  guest.parsed.document.source !== source
) {
  throw new Error("CJS guest boundary failed");
}
const invalid = syntax.experimentalParseKaladaV1GuestExpressionPrefix("{'bad}TAIL", 1);
if (invalid.ok || invalid.reason !== "unsupported-quote" || invalid.stop !== 1) {
  throw new Error("CJS unsupported guest accepted");
}
