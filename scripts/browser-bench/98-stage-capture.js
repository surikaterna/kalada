async (text) => {
  const view = document.querySelector(".cm-content").cmTile.view;
  const snapshot = () => ({
    text: view.state.doc.toString(),
    output: document.querySelector(".panel pre")?.textContent,
    status: document.querySelector("[role=status]")?.textContent,
    spans: [...document.querySelectorAll(".cm-content [class*=kalada-hl-]")].map((e) => [
      e.className,
      e.textContent,
    ]),
    diagnostics: document.querySelectorAll(".panel pre")[2]?.textContent,
    inspector: document.querySelectorAll(".panel pre")[3]?.textContent,
  });
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  await new Promise((done) => setTimeout(done, 250));
  const before = snapshot();
  globalThis.__kalada98?.events.splice(0);
  await new Promise((done) => requestAnimationFrame(done));
  const start = performance.now();
  view.dispatch({ changes: { from: view.state.doc.length, insert: " " } });
  const dispatchMs = performance.now() - start;
  const rafMs = await new Promise((done) =>
    requestAnimationFrame(() => done(performance.now() - start)),
  );
  await new Promise((done) => setTimeout(done, 230));
  return {
    before,
    after: snapshot(),
    dispatchMs,
    rafMs,
    events: (globalThis.__kalada98?.events ?? []).map((event) => ({
      ...event,
      offsetMs: event.at - start,
    })),
  };
};
