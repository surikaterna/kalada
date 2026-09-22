import { StateEffect, StateField } from "@codemirror/state";
import { showTooltip, type Tooltip } from "@codemirror/view";

export const setKeyboardTooltip = StateEffect.define<Tooltip | null>();

export const keyboardTooltipField = StateField.define<readonly Tooltip[]>({
  create: () => [],
  update(value, transaction) {
    let next = value;
    for (const effect of transaction.effects) {
      if (effect.is(setKeyboardTooltip)) next = effect.value ? [effect.value] : [];
    }
    return next;
  },
  provide: (field) => showTooltip.computeN([field], (state) => state.field(field)),
});
