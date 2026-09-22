import type { Locator, Page } from "playwright";
import { DEMO_BASE } from "./config.js";

export async function gotoReady(page: Page, baseUrl: string): Promise<void> {
  const response = await page.goto(baseUrl, { waitUntil: "networkidle" });
  if (response?.status() !== 200) throw new Error("Canonical demo route did not return 200");
  if (new URL(page.url()).pathname !== DEMO_BASE) throw new Error("Demo left its canonical route");
  await waitStatus(page, "ready: WORKSPACE_READY");
}

export async function waitStatus(page: Page, expected: string): Promise<void> {
  await page.locator('[role="status"]').getByText(expected, { exact: true }).waitFor();
}

export async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole("tab", { name, exact: true }).click();
}

export function editor(page: Page): Locator {
  return page.locator(".cm-content");
}

export async function replaceEditor(page: Page, text: string): Promise<void> {
  await editor(page).focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(text);
}

export function panel(page: Page, name: string): Locator {
  return page.locator(".panel", { has: page.getByRole("heading", { name, exact: true }) });
}

export async function waitOutput(page: Page, expected: string): Promise<void> {
  await panel(page, "Output / error").locator("pre").getByText(expected, { exact: true }).waitFor();
}

export async function assertNoOutput(page: Page, unexpected: string): Promise<void> {
  const text = await panel(page, "Output / error").locator("pre").textContent();
  if (text?.includes(unexpected)) throw new Error(`Stale output remained visible: ${unexpected}`);
}

export async function completionLabels(page: Page): Promise<string[]> {
  await editor(page).focus();
  await page.keyboard.press("Control+Space");
  await page.locator(".cm-tooltip-autocomplete").waitFor();
  const labels = await page.locator(".cm-completionLabel").allTextContents();
  await page.keyboard.press("Escape");
  return labels;
}

export async function startMutationProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const observed: string[] = [];
    const roots = document.querySelectorAll(".panels, .status");
    const observer = new MutationObserver(() => {
      observed.push(
        Array.from(roots, (root) => root.textContent ?? "")
          .join("\n")
          .slice(0, 64_000),
      );
    });
    for (const root of roots)
      observer.observe(root, { childList: true, subtree: true, characterData: true });
    (
      window as unknown as {
        __demoMutationProbe: { observed: string[]; observer: MutationObserver };
      }
    ).__demoMutationProbe = { observed, observer };
  });
}

export async function assertMutationProbe(
  page: Page,
  forbidden: readonly string[],
  expected: string,
): Promise<void> {
  const observed = await page.evaluate(() => {
    const probe = (
      window as unknown as {
        __demoMutationProbe: { observed: string[]; observer: MutationObserver };
      }
    ).__demoMutationProbe;
    probe.observer.disconnect();
    return probe.observed;
  });
  if (observed.length === 0) throw new Error("Mutation probe did not observe a publication");
  if (forbidden.some((marker) => observed.some((entry) => entry.includes(marker)))) {
    throw new Error(`A stale marker was published: ${forbidden.join(", ")}`);
  }
  if (!observed.some((entry) => entry.includes(expected))) {
    throw new Error(`Current marker was not observed: ${expected}`);
  }
}

export async function expectInspectorKeys(page: Page): Promise<void> {
  const text = await panel(page, "Advanced inspectors").locator("pre").textContent();
  const keys = [
    "kalada-demo-cst-v1",
    "program",
    "sourceMap",
    "schemaEnvironment",
    "kalada-host-prepared-expression-v1",
    "linkPlan",
    "dependencies",
    "diagnostics",
    "graph",
  ];
  const missing = keys.filter((key) => !text?.includes(key));
  if (missing.length) throw new Error(`Inspector evidence missing: ${missing.join(", ")}`);
}
