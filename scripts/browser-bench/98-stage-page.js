async (page) => {
  const config = __CONFIG__;
  const capture = __CAPTURE__;
  const rows = [];
  const blocked = [];
  await page.route("**/*", (route) => {
    if (!route.request().url().startsWith("http://127.0.0.1:")) {
      blocked.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  for (const fixture of config.fixtures) {
    for (let iteration = 0; iteration < config.repetitions; iteration += 1) {
      for (const cohort of ["A", "instrumented"]) {
        await page.goto(config.urls[cohort]);
        await page.waitForSelector(".cm-content");
        await page.waitForFunction(() =>
          document.querySelector("[role=status]")?.textContent?.includes("WORKSPACE_READY"),
        );
        const data = await page.evaluate(capture, fixture.text);
        rows.push({ fixture: fixture.name, iteration, cohort, ...data });
      }
    }
  }
  return { rows, blocked, browser: page.context().browser()?.version() };
};
