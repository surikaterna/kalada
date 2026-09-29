export function assertApprovedGraph(
  coreVersion: unknown,
  projectionVersion: unknown,
  projectionRange: unknown,
  approved: Map<string, string>,
): void {
  const expectedCore = approved.get("@kalada/core");
  const expectedProjection = approved.get("@kalada/projection");
  if (!expectedCore || !expectedProjection)
    throw new Error("Approved graph lacks core or projection");
  if (coreVersion !== expectedCore || projectionVersion !== expectedProjection) {
    throw new Error(
      `Packed versions differ from approved graph: ${expectedCore}, ${expectedProjection}`,
    );
  }
  if (projectionRange !== `^${expectedCore}`) {
    throw new Error(`Packed projection must depend on approved core ^${expectedCore}`);
  }
}
