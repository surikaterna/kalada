import type { EncodedKaladaValueV1, OptionValue, ResultValue } from "./index.js";

// @ts-expect-error Runtime ADTs cannot be constructed structurally.
const spoofedOption: OptionValue = { type: "Option", variant: "none" };
// @ts-expect-error Runtime ADTs cannot be constructed structurally.
const spoofedResult: ResultValue = { type: "Result", variant: "ok", value: 1 };
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
void impossibleNone;
void impossibleJson;
void impossibleVariant;
