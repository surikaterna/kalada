const instantBrands = new WeakSet<object>();
const durationBrands = new WeakSet<object>();

declare const instantBrand: unique symbol;
declare const durationBrand: unique symbol;

export interface InstantValue {
  readonly [instantBrand]: true;
  readonly type: "Instant";
  readonly milliseconds: number;
}

export interface DurationValue {
  readonly [durationBrand]: true;
  readonly type: "Duration";
  readonly milliseconds: number;
}

function milliseconds(input: number): number {
  if (!Number.isSafeInteger(input)) throw new RangeError("Milliseconds must be a safe integer.");
  return Object.is(input, -0) ? 0 : input;
}

function branded<T extends object>(brands: WeakSet<object>, value: T): T {
  Object.freeze(value);
  brands.add(value);
  return value;
}

export const Instant = Object.freeze({
  fromMilliseconds(value: number): InstantValue {
    return branded(instantBrands, {
      type: "Instant",
      milliseconds: milliseconds(value),
    } as InstantValue);
  },
});

export const Duration = Object.freeze({
  fromMilliseconds(value: number): DurationValue {
    return branded(durationBrands, {
      type: "Duration",
      milliseconds: milliseconds(value),
    } as DurationValue);
  },
});

export function isInstant(value: unknown): value is InstantValue {
  return typeof value === "object" && value !== null && instantBrands.has(value);
}

export function isDuration(value: unknown): value is DurationValue {
  return typeof value === "object" && value !== null && durationBrands.has(value);
}
