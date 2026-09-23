async (page) => {
  const bundle = __BUNDLE__;
  await page.route("**/kalada/98-fifty.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle,
    }),
  );
  await page.goto("http://127.0.0.1:4179/kalada/");
  const result = await page.evaluate(async () => {
    const { runFifty } = await import("/kalada/98-fifty.js");
    return [false, true].flatMap((heavy) =>
      Array.from({ length: 5 }, () => {
        const run = runFifty(heavy, true);
        const codes = (phase) => phase.outputs.map((entry) => entry.diagnostics.codes);
        return {
          tokenHeavy: heavy,
          docs: run.docs,
          openMs: run.openMs,
          editMs: run.editMs,
          dataMs: run.dataMs,
          schemaMs: run.schemaMs,
          cold: run.cold.durations,
          edited: run.edited.durations,
          data: run.data.durations,
          schema: run.schema.durations,
          parity:
            JSON.stringify(codes(run.cold)) === JSON.stringify(codes(run.data)) &&
            JSON.stringify(codes(run.cold)) === JSON.stringify(codes(run.schema)),
          diagnosticCode: run.cold.outputs[0].diagnostics.codes,
        };
      }),
    );
  });
  return { result, browserVersion: page.context().browser()?.version() };
};
