import { readFileSync } from "node:fs";
import type { Page } from "playwright";
import { editor, gotoReady, openTab, replaceEditor, waitOutput, waitStatus } from "./helpers.js";
import type { Scenario } from "./types.js";

export const transferAndPersistence: Scenario = {
  name: "export-import-persistence-corruption-and-quota",
  async run({ page, baseUrl }) {
    await gotoReady(page, baseUrl);
    await openTab(page, "count.kalada");
    await replaceEditor(page, '"storage-private-marker"');
    await waitOutput(page, '"storage-private-marker"');
    const baseline = await persistenceBaseline(page);
    await verifyExport(page);
    await verifyRejectedImports(page);
    const imported = distinctWorkspace(baseline, 99, 10);
    await verifyImportedConvergence(page, imported);
    await verifyQuotaFailure(page, distinctWorkspace(imported, 77, 10));
  },
};

async function persistenceBaseline(page: Page): Promise<Record<string, unknown>> {
  const persistence = page.getByLabel("Persist sensitive workspace locally");
  await persistence.check();
  const saved = await storedWorkspace(page);
  if (!saved) throw new Error("Persistence opt-in did not save the workspace");
  await persistence.uncheck();
  await page.evaluate(() => localStorage.setItem("kalada-demo-workspace-v1", "{corrupt"));
  await persistence.check();
  if (!(await editor(page).textContent())?.includes("storage-private-marker")) {
    throw new Error("Corrupt restore replaced the live workspace");
  }
  const valid = await storedWorkspace(page);
  if (!valid) throw new Error("Workspace was not re-saved after corrupt restore rejection");
  return JSON.parse(valid) as Record<string, unknown>;
}

async function verifyExport(page: Page): Promise<void> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Workspace export did not produce a download");
  const exported = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const expected = [
    "activeName",
    "dataRevision",
    "dataText",
    "documents",
    "format",
    "generatorVersion",
    "schemaRevision",
    "schemaText",
    "seed",
    "version",
  ];
  if (JSON.stringify(Object.keys(exported).sort()) !== JSON.stringify(expected)) {
    throw new Error("Workspace export contained undeclared fields");
  }
  await page.getByText("Sensitive workspace export downloaded", { exact: true }).waitFor();
}

async function verifyRejectedImports(page: Page): Promise<void> {
  const input = page.locator('input[type="file"]');
  const before = await editor(page).textContent();
  await input.setInputFiles({
    name: "corrupt.json",
    mimeType: "application/json",
    buffer: Buffer.from("{not-json"),
  });
  await page.getByText("Import rejected: invalid workspace", { exact: true }).waitFor();
  await assertEditorUnchanged(page, before);
  await input.setInputFiles({
    name: "oversized.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(1024 * 1024 + 1, 32),
  });
  await page.getByText("Import rejected: file limit", { exact: true }).waitFor();
  await assertEditorUnchanged(page, before);
}

async function verifyImportedConvergence(
  page: Page,
  imported: Record<string, unknown>,
): Promise<void> {
  await importWorkspace(page, "workspace.json", imported);
  await page.getByText("Workspace imported", { exact: true }).waitFor();
  await waitStatus(page, "ready: WORKSPACE_READY");
  if ((await editor(page).textContent()) !== "data.count")
    throw new Error("Imported source missing");
  await waitOutput(page, "99");
  const persisted = await storedWorkspace(page);
  if (!persisted || JSON.stringify(JSON.parse(persisted)) !== JSON.stringify(imported)) {
    throw new Error("Imported live and persisted workspaces diverged");
  }
  if (await page.getByLabel("Reveal source/literals in inspectors").isChecked()) {
    throw new Error("Import retained inspector reveal state");
  }
}

async function verifyQuotaFailure(page: Page, imported: Record<string, unknown>): Promise<void> {
  const before = await storedWorkspace(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await importWorkspace(page, "memory-only.json", imported);
  await page
    .getByText("Persistence unavailable; imported workspace remains in memory", { exact: true })
    .waitFor();
  await waitStatus(page, "ready: WORKSPACE_READY");
  await waitOutput(page, "77");
  if ((await storedWorkspace(page)) !== before) throw new Error("Quota failure changed storage");
  if (!(await page.getByLabel("Persist sensitive workspace locally").isChecked())) {
    throw new Error("Quota failure disabled persistence opt-in");
  }
  await replaceEditor(page, '"quota-memory-marker"');
  await page
    .getByText("Persistence unavailable; edits remain in memory", { exact: true })
    .waitFor();
  if (!(await editor(page).textContent())?.includes("quota-memory-marker")) {
    throw new Error("Quota failure rolled back the in-memory edit");
  }
}

async function importWorkspace(page: Page, name: string, workspace: Record<string, unknown>) {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(workspace)),
  });
}

function distinctWorkspace(
  source: Record<string, unknown>,
  count: number,
  revisionDelta: number,
): Record<string, unknown> {
  const documents = (source.documents as Record<string, unknown>[]).map((document) =>
    document.name === "count.kalada"
      ? { ...document, text: "data.count", revision: (document.revision as number) + revisionDelta }
      : document,
  );
  return {
    ...source,
    activeName: "count.kalada",
    dataText: JSON.stringify({ count, enabled: true, user: { name: "Imported" } }),
    dataRevision: (source.dataRevision as number) + revisionDelta,
    documents,
  };
}

async function assertEditorUnchanged(page: Page, expected: string | null): Promise<void> {
  if ((await editor(page).textContent()) !== expected)
    throw new Error("Rejected import mutated workspace");
}

async function storedWorkspace(page: Page): Promise<string | null> {
  return await page.evaluate(() => localStorage.getItem("kalada-demo-workspace-v1"));
}
