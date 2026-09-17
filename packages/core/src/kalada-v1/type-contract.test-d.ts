import type {
  DurationValue,
  EncodedKaladaValueV1,
  InstantValue,
  KaladaFunctionType,
  KaladaV1DiagnosticContextFrame,
  OptionValue,
  ResultValue,
} from "./index.js";

const functionType: KaladaFunctionType = {
  kind: "function-type",
  parameters: [{ kind: "primitive-type", name: "number" }],
  returns: { kind: "primitive-type", name: "boolean" },
};
const context: KaladaV1DiagnosticContextFrame = {
  kind: "function-call",
  name: null,
  path: ["expression"],
};
// @ts-expect-error Function types require an explicit return descriptor.
const missingReturn: KaladaFunctionType = { kind: "function-type", parameters: [] };

// @ts-expect-error Runtime ADTs cannot be constructed structurally.
const spoofedOption: OptionValue = { type: "Option", variant: "none" };
// @ts-expect-error Runtime ADTs cannot be constructed structurally.
const spoofedResult: ResultValue = { type: "Result", variant: "ok", value: 1 };
// @ts-expect-error Runtime temporal values cannot be constructed structurally.
const spoofedInstant: InstantValue = { type: "Instant", milliseconds: 1 };
// @ts-expect-error Runtime temporal values cannot be constructed structurally.
const spoofedDuration: DurationValue = { type: "Duration", milliseconds: 1 };
const impossibleNone: EncodedKaladaValueV1 = {
  format: "kalada-value",
  version: 1,
  type: "Option",
  variant: "none",
  // @ts-expect-error Option.none has no encoded payload.
  value: 1,
};
// @ts-expect-error Json envelopes require a JSON payload.
const impossibleJson: EncodedKaladaValueV1 = {
  format: "kalada-value",
  version: 1,
  type: "Json",
  variant: "value",
};
// @ts-expect-error Option cannot use a Result variant.
const impossibleVariant: EncodedKaladaValueV1 = {
  format: "kalada-value",
  version: 1,
  type: "Option",
  variant: "ok",
  value: { format: "kalada-value", version: 1, type: "Json", variant: "value", value: 1 },
};

void spoofedOption;
void spoofedResult;
void spoofedInstant;
void spoofedDuration;
void impossibleNone;
void impossibleJson;
void impossibleVariant;
void functionType;
void context;
void missingReturn;
