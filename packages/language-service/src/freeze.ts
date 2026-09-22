export function freezeData<T>(input: T): Readonly<T> {
  if (typeof input !== "object" || input === null || Object.isFrozen(input)) return input;
  for (const value of Object.values(input)) freezeData(value);
  return Object.freeze(input);
}
