export function calibrationBatches(value = "21", smoke = false) {
  const batches = Number(value);
  if (smoke && batches === 1) return 1;
  if (!Number.isInteger(batches) || batches < 21 || batches > 100)
    throw Error("batches must be 21..100 (1 warmup + at least 20 valid)");
  return batches;
}
