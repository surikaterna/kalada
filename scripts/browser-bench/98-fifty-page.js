async (page) => {
  const bundle = __BUNDLE__;
  const instrumented = __INSTRUMENTED__;
  const sample = __SAMPLE__;
  await page.route("**/kalada/98-fifty.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: bundle }),
  );
  await page.route("**/kalada/98-fifty-instrumented.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: instrumented }),
  );
  await page.goto("http://127.0.0.1:4179/kalada/");
  await page.evaluate(async () => {
    await import("/kalada/98-fifty.js");
    await import("/kalada/98-fifty-instrumented.js");
  });
  const result = [];
  for (const heavy of [false, true]) {
    for (let iteration = 0; iteration < 20; iteration += 1) {
      result.push(await page.evaluate(sample, heavy));
    }
  }
  return { result, browserVersion: page.context().browser()?.version() };
};
