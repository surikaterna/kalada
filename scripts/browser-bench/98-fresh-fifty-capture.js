async () => {
  await import("/kalada/98-fifty-normal.js");
  const rows = [];
  for (const heavy of [false, true]) {
    const run = globalThis.__kalada98NormalFifty(heavy, true);
    const signatures = ["cold", "edited", "repeat", "envOnly"].map((phase) =>
      JSON.stringify(run[phase].outputs),
    );
    const hash = async (input) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      );
    };
    rows.push({
      heavy,
      docs: run.docs,
      openMs: run.openMs,
      editMs: run.editMs,
      repeatMs: run.repeatMs,
      envOnlyMs: run.envOnlyMs,
      cold: run.cold.durations,
      edited: run.edited.durations,
      repeat: run.repeat.durations,
      envOnly: run.envOnly.durations,
      outputsSha256: await Promise.all(signatures.map(hash)),
      toolingSha256: await hash(JSON.stringify(run.tooling)),
      currentness: run.currentness,
      diagnosticCode: run.cold.outputs[0].diagnostics.codes,
      unsupported: run.unsupported,
    });
  }
  return rows;
};
