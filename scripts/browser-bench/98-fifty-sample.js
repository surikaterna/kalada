(heavy) => {
  const run = globalThis.__kalada98NormalFifty(heavy, true);
  globalThis.__kalada98.events.splice(0);
  const observed = globalThis.__kalada98RunFifty(heavy, true);
  const grouped = {};
  for (const event of globalThis.__kalada98.events) {
    const key = `${event.stage}/${event.caller ?? "none"}/${event.version ?? "none"}`;
    if (!grouped[key]) grouped[key] = { count: 0, ms: 0 };
    grouped[key].count += 1;
    grouped[key].ms += event.ms;
  }
  const parityPhases = Object.fromEntries(
    ["cold", "edited", "repeat", "envOnly"].map((phase) => [
      phase,
      JSON.stringify(run[phase].outputs) === JSON.stringify(observed[phase].outputs),
    ]),
  );
  const toolingParity = JSON.stringify(run.tooling) === JSON.stringify(observed.tooling);
  const currentnessParity =
    JSON.stringify(run.currentness) === JSON.stringify(observed.currentness) &&
    run.currentness.coldCurrent &&
    !run.currentness.oldVersionCurrent &&
    !run.currentness.oldEnvironmentCurrent;
  return {
    tokenHeavy: heavy,
    docs: run.docs,
    openMs: run.openMs,
    editMs: run.editMs,
    repeatMs: run.repeatMs,
    envOnlyMs: run.envOnlyMs,
    cold: run.cold.durations,
    edited: run.edited.durations,
    repeat: run.repeat.durations,
    envOnly: run.envOnly.durations,
    parity: Object.values(parityPhases).every(Boolean) && toolingParity && currentnessParity,
    parityPhases,
    toolingParity,
    currentnessParity,
    grouped,
    overhead: {
      openMs: observed.openMs,
      editMs: observed.editMs,
      repeatMs: observed.repeatMs,
      envOnlyMs: observed.envOnlyMs,
      cold: observed.cold.durations,
      edited: observed.edited.durations,
    },
    diagnosticCode: run.cold.outputs[0].diagnostics.codes,
  };
};
