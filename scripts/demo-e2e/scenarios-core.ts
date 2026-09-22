import {
  completionLabels,
  editor,
  expectInspectorKeys,
  gotoReady,
  openTab,
  panel,
  replaceEditor,
  waitOutput,
  waitStatus,
} from "./helpers.js";
import type { Scenario } from "./types.js";

export const directLoadReload: Scenario = {
  name: "direct-load-and-reload",
  async run({ page, baseUrl }) {
    await gotoReady(page, baseUrl);
    const response = await page.reload({ waitUntil: "networkidle" });
    if (response?.status() !== 200) throw new Error("Canonical reload failed");
    await waitStatus(page, "ready: WORKSPACE_READY");
  },
};

export const editingAndTooling: Scenario = {
  name: "schema-data-independent-files-and-tooling",
  async run({ page, baseUrl }) {
    await gotoReady(page, baseUrl);
    await verifyFormattingCompletionHover(page);
    await verifyDiagnosticsRecovery(page);
    await verifyDataAndIndependentFiles(page);
    await verifyToolingAndInspectors(page);
  },
};

async function verifyFormattingCompletionHover(page: import("playwright").Page): Promise<void> {
  await openTab(page, "count.kalada");
  await waitOutput(page, "3");
  await replaceEditor(page, "data.count+1");
  await page.getByRole("button", { name: "Format" }).click();
  await page.waitForFunction(
    () => document.querySelector(".cm-content")?.textContent === "data.count + 1",
  );
  await replaceEditor(page, "data.");
  const labels = await completionLabels(page);
  if (!labels.includes("count")) throw new Error(`Schema completion missing: ${labels.join(",")}`);
  await replaceEditor(page, "data.count + 1");
  await editor(page).press("Home");
  for (let index = 0; index < 7; index += 1) await editor(page).press("ArrowRight");
  await editor(page).press("Control+Shift+h");
  await page.locator(".cm-kalada-hover").waitFor();
  await page.keyboard.press("Escape");
}

async function verifyDiagnosticsRecovery(page: import("playwright").Page): Promise<void> {
  await replaceEditor(page, "data.count +");
  await page.waitForFunction(() => {
    const pane = [...document.querySelectorAll(".panel")].find((item) =>
      item.querySelector("h2")?.textContent?.includes("Diagnostics"),
    );
    return (pane?.textContent ?? "").includes('"code"');
  });
  const failed = await panel(page, "Output / error").textContent();
  if (failed?.includes("\n3\n")) throw new Error("Failed source retained its prior output");
  await replaceEditor(page, "data.count + 2");
  await waitOutput(page, "4");
}

async function verifyDataAndIndependentFiles(page: import("playwright").Page): Promise<void> {
  await openTab(page, "data.json");
  await replaceEditor(page, '{"count":8,"enabled":true,"user":{"name":"Grace"}}');
  await waitStatus(page, "ready: WORKSPACE_READY");
  await openTab(page, "count.kalada");
  await waitOutput(page, "10");
  await openTab(page, "greeting.kalada");
  await waitOutput(page, '"Grace"');
  await replaceEditor(page, '"greeting-edited"');
  await waitOutput(page, '"greeting-edited"');
  await openTab(page, "enabled.kalada");
  await replaceEditor(page, 'data.enabled ? "enabled" : "disabled"');
  await waitOutput(page, '"enabled"');
}

async function verifyToolingAndInspectors(page: import("playwright").Page): Promise<void> {
  const tooling = await panel(page, "Tooling").locator("pre").textContent();
  for (const key of ["resultType", "dependencies", "demo:data", "prepare", "evaluate"]) {
    if (!tooling?.includes(key)) throw new Error(`Tooling evidence missing ${key}`);
  }
  await expectInspectorKeys(page);
  const tabs = page.getByRole("tab");
  if ((await tabs.count()) < 5) throw new Error("Virtual workspace tabs missing");
}

export const keyboardAndSafeDom: Scenario = {
  name: "keyboard-safe-dom-and-reset",
  async run({ page, baseUrl }) {
    await gotoReady(page, baseUrl);
    await openTab(page, "data.json");
    if ((await editor(page).getAttribute("aria-label")) !== "data.json editor") {
      throw new Error("JSON editor accessibility label missing");
    }
    await page.getByRole("tab", { name: "data.json" }).press("ArrowRight");
    await assertTabFocus(page, "greeting.kalada");
    await page.getByRole("tab", { name: "greeting.kalada" }).press("End");
    await assertTabFocus(page, "enabled.kalada");
    await page.getByRole("tab", { name: "enabled.kalada" }).press("Home");
    await assertTabFocus(page, "schema.json");
    if (await page.locator("script:not([src]), img, iframe").count())
      throw new Error("Unsafe DOM rendered");
    await page.getByLabel("Persist sensitive workspace locally").check();
    await page.getByLabel("Reveal source/literals in inspectors").check();
    await page.getByRole("button", { name: "Reset" }).click();
    await page.getByText("Workspace reset", { exact: true }).waitFor();
    await verifyReset(page);
  },
};

async function assertTabFocus(page: import("playwright").Page, name: string): Promise<void> {
  const selected = page.getByRole("tab", { name, exact: true });
  if ((await selected.getAttribute("aria-selected")) !== "true")
    throw new Error("Tab was not selected");
  if ((await page.evaluate(() => document.activeElement?.textContent)) !== name) {
    throw new Error("Keyboard tab navigation lost focus");
  }
}

async function verifyReset(page: import("playwright").Page): Promise<void> {
  const persisted = await page.evaluate(() => localStorage.getItem("kalada-demo-workspace-v1"));
  if (persisted !== null) throw new Error("Reset retained persisted workspace data");
  if (await page.getByLabel("Persist sensitive workspace locally").isChecked()) {
    throw new Error("Reset retained persistence opt-in");
  }
  if (await page.getByLabel("Reveal source/literals in inspectors").isChecked()) {
    throw new Error("Reset retained inspector reveal state");
  }
}

export const deployedWorkspaceSmoke: Scenario = {
  name: "deployed-focused-workspace-smoke",
  async run({ page, baseUrl }) {
    await gotoReady(page, baseUrl);
    await openTab(page, "count.kalada");
    await waitOutput(page, "3");
    await replaceEditor(page, "data.");
    const labels = await completionLabels(page);
    if (!labels.includes("count")) throw new Error("Deployed completion failed");
    await replaceEditor(page, "data.count + 1");
    await page.getByRole("button", { name: "Generate data" }).click();
    await page.getByText("Generated data validated and applied", { exact: true }).waitFor();
    await waitOutput(page, "6");
  },
};
