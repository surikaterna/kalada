async (page) => {
  const bundle = __BUNDLE__;
  const capture = __CAPTURE__;
  const blocked = [];
  await page.route("**/*", (route) => {
    if (!route.request().url().startsWith("http://127.0.0.1:4179/")) {
      blocked.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.route("**/kalada/98-fifty-harness.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; connect-src 'self'\">",
    }),
  );
  await page.route("**/kalada/98-fifty-normal.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: bundle }),
  );
  await page.goto("http://127.0.0.1:4179/kalada/98-fifty-harness.html");
  const rows = await page.evaluate(capture);
  return { rows, blocked, browserVersion: page.context().browser()?.version() };
};
