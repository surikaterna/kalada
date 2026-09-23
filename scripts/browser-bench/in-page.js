async (page) => {
  const config = __CONFIG__;
  const blocked = [];
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (!url.startsWith(`${config.origin}/`)) {
      blocked.push(url);
      return route.abort();
    }
    return route.continue();
  });
  const results = [];
  for (const fixture of config.fixtures) {
    await page.goto(config.url);
    await page.waitForSelector(".cm-content");
    await page.waitForFunction(() =>
      document.querySelector("[role=status]")?.textContent?.includes("WORKSPACE_READY"),
    );
    results.push(
      await page.evaluate(
        async ({ fixture }) => {
          const view = document.querySelector(".cm-content").cmTile.view;
          const status = () => document.querySelector("[role=status]")?.textContent;
          const output = () => document.querySelector(".panel pre")?.textContent;
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: fixture.text } });
          await new Promise((resolve) => setTimeout(resolve, 230));
          const before = { status: status(), output: output(), text: view.state.doc.toString() };
          const longTasks = [];
          let observer;
          if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
            observer = new PerformanceObserver((list) =>
              longTasks.push(...list.getEntries().map((e) => e.duration)),
            );
            observer.observe({ type: "longtask" });
          }
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
          const from = view.state.doc.length;
          const start = performance.now();
          view.dispatch({ changes: { from, insert: " " }, selection: { anchor: from + 1 } });
          const dispatchMs = performance.now() - start;
          const afterDispatch = view.state.doc.toString();
          const rafMs = await new Promise((resolve) =>
            requestAnimationFrame(() => resolve(performance.now() - start)),
          );
          await new Promise((resolve) => setTimeout(resolve, 230));
          observer?.disconnect();
          return {
            before,
            after: {
              status: status(),
              output: output(),
              text: view.state.doc.toString(),
              markedText: document.querySelector(".cm-content")?.textContent,
            },
            afterDispatch,
            dispatchMs,
            rafMs,
            longTasks,
            longTaskSupported: !!observer,
          };
        },
        { fixture },
      ),
    );
  }
  await page.goto(config.url);
  await page.waitForSelector(".cm-content");
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Space");
  const keyboard = await page.evaluate(() => ({
    text: document.querySelector(".cm-content").cmTile.view.state.doc.toString(),
    status: document.querySelector("[role=status]")?.textContent,
  }));
  await page.waitForTimeout(230);
  keyboard.output = await page.locator(".panel pre").first().textContent();
  const supersession = await page.evaluate(async () => {
    const view = document.querySelector(".cm-content").cmTile.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "data.count + 2" } });
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "data.count + 1" } });
    await new Promise((resolve) => setTimeout(resolve, 230));
    return {
      text: view.state.doc.toString(),
      output: document.querySelector(".panel pre")?.textContent,
    };
  });
  return {
    results,
    blocked,
    requests,
    browser: await page.evaluate(() => navigator.userAgent),
    viewport: page.viewportSize(),
    keyboard,
    supersession,
  };
};
