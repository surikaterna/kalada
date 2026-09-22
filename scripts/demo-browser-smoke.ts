import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";

const root = resolve(import.meta.dirname, "..");
const app = resolve(root, "apps/demo");
const base = "/kalada-demo/";
const port = 4187;

function build(): void {
  const result = spawnSync("bun", ["run", "build"], {
    cwd: app,
    env: { ...process.env, DEMO_BASE: base },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Demo build failed");
  const metafile = readFileSync(resolve(app, "dist/demo-metafile.json"), "utf8");
  if (/node:|@scheman\/.*packages\/(?:host|language-service|core)/u.test(metafile)) {
    throw new Error("Demo bundle contains a forbidden package boundary");
  }
  const output = JSON.parse(metafile) as BundleEvidence;
  const main = output.entries.find((entry) => entry.type === "chunk" && entry.imports.length === 0);
  if (
    !main ||
    main.modules.some((name) => name.includes("@cfworker") || name.includes("@scheman/core"))
  ) {
    throw new Error("Optional schema vendors leaked into the initial chunk");
  }
  inspectJavaScript();
}

interface BundleEvidence {
  readonly entries: readonly {
    readonly file: string;
    readonly type: string;
    readonly imports: readonly string[];
    readonly modules: readonly string[];
  }[];
}

function inspectJavaScript(): void {
  const assets = resolve(app, "dist/assets");
  const forbidden =
    /\beval\s*\(|new\s+Function\s*\(|\bfetch\s*\(|\b(?:XMLHttpRequest|WebSocket)\b|["']node:/u;
  for (const name of readdirSync(assets)) {
    if (!name.endsWith(".js")) continue;
    if (forbidden.test(readFileSync(resolve(assets, name), "utf8"))) {
      throw new Error(`Forbidden dynamic-code/network/Node primitive in ${name}`);
    }
  }
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Demo preview did not become ready");
}

async function verify(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}${base}`);
  await page.getByText("ready: WORKSPACE_READY").waitFor();
  await verifyEditingAndTooling(page);
  await verifyTabNavigation(page);
  await verifyGeneratedPropagation(page);
  await verifyInspectorPrivacy(page);
  await verifyPersistenceAndImport(page);
  await verifyNegativeSchema(page);
  await verifySafeDomAndReset(page);
}

async function verifyEditingAndTooling(page: Page): Promise<void> {
  const tabs = page.getByRole("tab");
  if ((await tabs.count()) < 5) throw new Error("Virtual workspace tabs missing");
  await page.getByRole("tab", { name: "count.kalada" }).click();
  await page
    .locator(".panel", { hasText: "Output / error" })
    .locator("pre")
    .getByText("3", { exact: true })
    .waitFor();
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("data.count+1");
  await page.getByRole("button", { name: "Format" }).click();
  await page.waitForFunction(
    () => document.querySelector(".cm-content")?.textContent === "data.count + 1",
  );
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("data.");
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent === "data.");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Space");
  await page.locator(".cm-tooltip-autocomplete").waitFor();
  const completions = await page.locator(".cm-completionLabel").allTextContents();
  if (!completions.includes("count"))
    throw new Error(`Schema completion missing: ${completions.join(",")}`);
  await page.keyboard.press("Escape");
  await replaceEditor(page, "data.count + 1");
  await page.keyboard.press("Home");
  for (let index = 0; index < 7; index += 1) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Control+Shift+h");
  await page.locator(".cm-kalada-hover").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Generate data" }).click();
  await page.getByText("Generated data validated and applied").waitFor();
  await page.getByText("ready: WORKSPACE_READY").waitFor();
}

async function verifyTabNavigation(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "data.json" }).click();
  if ((await page.locator(".cm-content").getAttribute("aria-label")) !== "data.json editor") {
    throw new Error("JSON editor accessibility label missing");
  }
  await page.getByRole("tab", { name: "data.json" }).press("ArrowRight");
  if (
    (await page.getByRole("tab", { name: "greeting.kalada" }).getAttribute("aria-selected")) !==
    "true"
  ) {
    throw new Error("Keyboard tab navigation failed");
  }
  if ((await page.evaluate(() => document.activeElement?.getAttribute("role"))) !== "tab") {
    throw new Error("Arrow navigation moved focus out of the tablist");
  }
  await page.getByRole("tab", { name: "greeting.kalada" }).press("Home");
  if ((await page.getByRole("tab", { name: "schema.json" }).getAttribute("tabindex")) !== "0") {
    throw new Error("Roving tab Home behavior failed");
  }
}

async function verifySafeDomAndReset(page: Page): Promise<void> {
  if (await page.locator("script:not([src]), img, iframe").count())
    throw new Error("Unsafe DOM rendered");
  await page.getByLabel("Reveal source/literals in inspectors").check();
  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByText("Workspace reset").waitFor();
  const persisted = await page.evaluate(() => localStorage.getItem("kalada-demo-workspace-v1"));
  if (persisted !== null) throw new Error("Reset retained persisted workspace data");
  if (await page.getByLabel("Persist sensitive workspace locally").isChecked())
    throw new Error("Reset retained persistence opt-in");
  if (await page.getByLabel("Reveal source/literals in inspectors").isChecked())
    throw new Error("Reset retained inspector reveal state");
}

async function verifyGeneratedPropagation(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "data.json" }).click();
  const generatedText = (await page.locator(".cm-content").textContent()) ?? "";
  const generated = JSON.parse(generatedText) as { count: number };
  await page.getByRole("tab", { name: "count.kalada" }).click();
  await page
    .locator(".panel", { hasText: "Output / error" })
    .locator("pre")
    .getByText(String(generated.count + 1), { exact: true })
    .waitFor();
  const inspector = page.locator(".panel", { hasText: "Advanced inspectors" }).locator("pre");
  await inspector.getByText(/kalada-host-compiled-expression-v1/u).waitFor();
  await inspector.getByText(/kalada-host-prepared-expression-v1/u).waitFor();
}

async function verifyInspectorPrivacy(page: Page): Promise<void> {
  await replaceEditor(page, '"audit-secret"');
  await page.getByText("ready: WORKSPACE_READY").waitFor();
  const inspector = page.locator(".panel", { hasText: "Advanced inspectors" }).locator("pre");
  if ((await inspector.textContent())?.includes("audit-secret"))
    throw new Error("Inspector revealed source/literals by default");
  const reveal = page.getByLabel("Reveal source/literals in inspectors");
  await reveal.check();
  await inspector.getByText(/audit-secret/u).waitFor();
}

async function verifyPersistenceAndImport(page: Page): Promise<void> {
  const baseline = await persistedBaseline(page);
  await verifyExport(page);
  await verifyRejectedImports(page);
  const imported = distinctWorkspace(baseline, 99, 10);
  await verifyImportedConvergence(page, imported);
  await verifyImportPersistenceFailure(page, distinctWorkspace(imported, 77, 10));
}

async function persistedBaseline(page: Page): Promise<Record<string, unknown>> {
  const persistence = page.getByLabel("Persist sensitive workspace locally");
  await persistence.check();
  const saved = await page.evaluate(() => localStorage.getItem("kalada-demo-workspace-v1"));
  if (!saved) throw new Error("Persistence opt-in did not save the workspace");
  await persistence.uncheck();
  await page.evaluate(() => localStorage.setItem("kalada-demo-workspace-v1", "{corrupt"));
  await persistence.check();
  if (!(await page.locator(".cm-content").textContent())?.includes("audit-secret"))
    throw new Error("Corrupt restore replaced the live workspace");
  const validImport = await page.evaluate(() => localStorage.getItem("kalada-demo-workspace-v1"));
  if (!validImport) throw new Error("Workspace was not re-saved after corrupt restore rejection");
  return JSON.parse(validImport) as Record<string, unknown>;
}

async function verifyImportedConvergence(
  page: Page,
  imported: Record<string, unknown>,
): Promise<void> {
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: "workspace.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await page.getByText("Workspace imported").waitFor();
  await page.getByText("ready: WORKSPACE_READY").waitFor();
  if ((await page.locator(".cm-content").textContent()) !== "data.count")
    throw new Error("Imported source did not replace the active editor");
  await output(page, "77", false);
  await output(page, "99", true);
  const persisted = await page.evaluate(() => localStorage.getItem("kalada-demo-workspace-v1"));
  if (!persisted || JSON.stringify(JSON.parse(persisted)) !== JSON.stringify(imported))
    throw new Error("Imported live and persisted workspaces diverged");
  if (await page.getByLabel("Reveal source/literals in inspectors").isChecked())
    throw new Error("Import retained inspector reveal state");
}

async function verifyImportPersistenceFailure(
  page: Page,
  imported: Record<string, unknown>,
): Promise<void> {
  const before = await page.evaluate(() => localStorage.getItem("kalada-demo-workspace-v1"));
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "memory-only.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await page.getByText("Persistence unavailable; imported workspace remains in memory").waitFor();
  await page.getByText("ready: WORKSPACE_READY").waitFor();
  await output(page, "77", true);
  const after = await page.evaluate(() => localStorage.getItem("kalada-demo-workspace-v1"));
  if (after !== before) throw new Error("Failed imported persistence changed stored workspace");
  if (!(await page.getByLabel("Persist sensitive workspace locally").isChecked()))
    throw new Error("Import persistence failure silently disabled opt-in");
  await replaceEditor(page, '"quota-edit"');
  await page.getByText("Persistence unavailable; edits remain in memory").waitFor();
  if (!(await page.locator(".cm-content").textContent())?.includes("quota-edit"))
    throw new Error("Quota failure rolled back the in-memory edit");
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

async function output(page: Page, expected: string, shouldExist: boolean): Promise<void> {
  const result = page.locator(".panel", { hasText: "Output / error" }).locator("pre");
  if (shouldExist) await result.getByText(expected, { exact: true }).waitFor();
  else if (await result.getByText(expected, { exact: true }).count())
    throw new Error(`Unexpected stale output: ${expected}`);
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
  if (JSON.stringify(Object.keys(exported).sort()) !== JSON.stringify(expected))
    throw new Error("Workspace export contained undeclared fields");
  await page.getByText("Sensitive workspace export downloaded").waitFor();
}

async function verifyRejectedImports(page: Page): Promise<void> {
  const input = page.locator('input[type="file"]');
  const before = await page.locator(".cm-content").textContent();
  await input.setInputFiles({
    name: "corrupt.json",
    mimeType: "application/json",
    buffer: Buffer.from("{not-json"),
  });
  await page.getByText("Import rejected: invalid workspace").waitFor();
  if ((await page.locator(".cm-content").textContent()) !== before)
    throw new Error("Corrupt import mutated the workspace");
  await input.setInputFiles({
    name: "oversized.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(1024 * 1024 + 1, 32),
  });
  await page.getByText("Import rejected: file limit").waitFor();
  if ((await page.locator(".cm-content").textContent()) !== before)
    throw new Error("Oversized import mutated the workspace");
}

async function verifyNegativeSchema(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "schema.json" }).click();
  await replaceEditor(page, '{"type":"function"}');
  await page.getByText("invalid: SCHEMA_INVALID_OR_UNSUPPORTED").waitFor();
  const output = await page.locator(".panel", { hasText: "Output / error" }).textContent();
  if (!output?.includes("SCHEMA_INVALID_OR_UNSUPPORTED"))
    throw new Error("Negative schema path did not invalidate outputs");
}

async function replaceEditor(page: Page, text: string): Promise<void> {
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text);
}

async function main(): Promise<void> {
  build();
  const preview = spawn("bun", ["run", "preview", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: app,
    env: { ...process.env, DEMO_BASE: base },
    stdio: "pipe",
  });
  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(`${origin}${base}`);
    const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    const executablePath =
      configured ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
    const browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      const requests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("request", (request) => requests.push(request.url()));
      await verify(page, origin);
      if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
      if (requests.some((url) => !url.startsWith(origin)))
        throw new Error(`External request detected: ${requests.join(", ")}`);
      console.log(
        `Demo browser smoke passed (${await browser.version()}): ${requests.length} same-origin requests`,
      );
    } finally {
      await browser.close();
    }
  } finally {
    preview.kill("SIGTERM");
    await new Promise<void>((resolveExit) => {
      if (preview.exitCode !== null) resolveExit();
      else preview.once("exit", () => resolveExit());
    });
  }
}

await main();
