import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import type { CompletionOutcome } from "@kalada/language-service";
import { chromium } from "playwright";
import { copyChangesetReleaseWorkspace } from "./smoke-release-workspace.js";

declare global {
  interface Window {
    __kaladaReady?: boolean;
    __kalada: {
      readonly view: { readonly state: { readonly doc: { toString(): string } } };
      readonly versions: readonly number[];
      directCompletion(): CompletionOutcome;
      acceptCompletion(): boolean;
      completionStatus(): string | null;
      completionIndex(): number | null;
      selectCompletion(): boolean;
      replace(text: string): void;
      moveToEnd(): void;
      format(): boolean;
      undo(): boolean;
      redo(): boolean;
      refresh(): void;
      batch(): void;
      dispose(): void;
      disposeThenEdit(): {
        readonly text: string;
        readonly open: boolean;
        readonly tooltips: number;
        readonly diagnostics: number;
      };
      crlfLifecycle(): Record<string, { readonly editor: string; readonly service?: string }>;
      highlightLifecycle(): Record<string, unknown>;
    };
  }
}

interface PackResult {
  readonly filename: string;
  readonly files: readonly { readonly path: string }[];
}

const root = resolve(import.meta.dirname, "..");
const fixtures = resolve(root, "tests/consumers/codemirror");
const browserOnly = process.argv.includes("--browser-only");

function run(command: string[], cwd: string): string {
  const [executable, ...args] = command;
  if (!executable) throw new Error("A command is required");
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

async function createRelease(directory: string): Promise<void> {
  await copyChangesetReleaseWorkspace(root, directory);
  run([resolve(root, "node_modules/.bin/changeset"), "version"], directory);
  const manifest = JSON.parse(
    await readFile(join(directory, "packages/codemirror/package.json"), "utf8"),
  );
  if (
    manifest.version !== "0.1.0" ||
    manifest.dependencies["@kalada/language-service"] !== "^0.1.0"
  ) {
    throw new Error("Unexpected CodeMirror release plan");
  }
}

function pack(directory: string, packageDirectory: string): PackResult {
  const output = run(
    ["npm", "pack", "--json", packageDirectory, "--pack-destination", directory],
    root,
  );
  const [result] = JSON.parse(output) as PackResult[];
  if (!result) throw new Error(`npm pack returned no artifact for ${packageDirectory}`);
  return result;
}

function assertPackage(result: PackResult, archive: string): void {
  const paths = result.files.map(({ path }) => path);
  for (const required of [
    "README.md",
    "dist/index.js",
    "dist/index.cjs",
    "dist/index.d.ts",
    "dist/index.d.cts",
    "package.json",
  ]) {
    if (!paths.includes(required))
      throw new Error(`Packed CodeMirror adapter is missing ${required}`);
  }
  const runtime = ["dist/index.js", "dist/index.cjs"].map((file) =>
    run(["tar", "-xOf", archive, `package/${file}`], root),
  );
  if (runtime.some((text) => /parseKalada|editorGraph|\.evaluate\s*\(/u.test(text))) {
    throw new Error("CodeMirror adapter contains language or evaluation logic");
  }
}

function runTypes(directory: string): void {
  for (const file of ["types.mts", "types.cts"]) {
    run(
      [
        resolve(root, "node_modules/.bin/tsc"),
        "--strict",
        "--noEmit",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        file,
      ],
      directory,
    );
  }
}

async function runBrowser(directory: string): Promise<void> {
  run(["bun", "build", "browser.mjs", "--target=browser", "--outfile=browser.js"], directory);
  const bundle = await readFile(join(directory, "browser.js"), "utf8");
  if (/["']node:|["']@scheman\//u.test(bundle)) throw new Error("Browser boundary drifted");
  const server = createServer(async (request, response) => {
    const name = request.url === "/browser.js" ? "browser.js" : "index.html";
    response.setHeader("content-type", extname(name) === ".js" ? "text/javascript" : "text/html");
    response.end(await readFile(join(directory, name)));
  });
  await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", () => resolveReady()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Static server did not bind");
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch(
    executablePath ? { headless: true, executablePath } : { headless: true },
  );
  try {
    const page = await browser.newPage();
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.waitForFunction(() => window.__kaladaReady === true);
    await verifyBrowser(page);
    if (browserErrors.length > 0) {
      throw new Error(`CodeMirror browser errors: ${browserErrors.join(" | ")}`);
    }
  } finally {
    await browser.close();
    await new Promise((resolveClosed) => server.close(resolveClosed));
  }
}

async function verifyBrowser(page: import("playwright").Page): Promise<void> {
  const direct = await page.evaluate(() => window.__kalada.directCompletion());
  await page.locator(".cm-content").focus();
  await page.locator(".kalada-hl-reference").waitFor();
  await page.keyboard.press("Control+Space");
  await page.locator(".cm-tooltip-autocomplete").waitFor();
  const labels = await page.locator(".cm-completionLabel").allTextContents();
  if (
    direct.kind !== "completion" ||
    labels.join() !== direct.items.map(({ label }) => label).join()
  ) {
    throw new Error(
      `Direct and CodeMirror completion diverged: ${labels.join()} / ${
        direct.kind === "completion" ? direct.items.map(({ label }) => label).join() : direct.kind
      }`,
    );
  }
  await page.waitForTimeout(100);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__kalada.view.state.doc.toString() === "user.name");
  await page.keyboard.press("Control+Shift+H");
  await page.locator('[role="tooltip"]').waitFor();
  if (await page.locator("img").count()) throw new Error("Tooltip rendered injected HTML");
  if (
    (await page.locator(".cm-content").getAttribute("aria-label")) !== "Kalada expression editor"
  ) {
    throw new Error("Editor accessibility label missing");
  }
  await page.evaluate(() => {
    window.__kalada.replace('user.name=="x"');
    window.__kalada.format();
  });
  await page.waitForFunction(
    () => window.__kalada.view.state.doc.toString() === 'user.name == "x"',
  );
  await page.evaluate(() => window.__kalada.undo());
  await page.evaluate(() => window.__kalada.redo());
  await page.evaluate(() => {
    window.__kalada.refresh();
    window.__kalada.replace("user.");
    window.__kalada.moveToEnd();
  });
  await page.keyboard.press("Control+Space");
  await page.locator(".cm-tooltip-autocomplete").waitFor();
  if (!(await page.locator(".cm-completionLabel").allTextContents()).includes("age")) {
    throw new Error("Environment refresh did not invalidate completion");
  }
  await page.waitForTimeout(350);
  await page.keyboard.press("Tab");
  await page.waitForFunction(() => window.__kalada.view.state.doc.toString() === "user.age");
  await page.keyboard.press("Tab");
  if (await page.locator(".cm-content").evaluate((node) => node === document.activeElement)) {
    throw new Error("Inactive Tab trapped focus");
  }
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+Space");
  await page.locator(".cm-tooltip-autocomplete").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".cm-tooltip-autocomplete").waitFor({ state: "hidden" });
  await page.evaluate(() => window.__kalada.batch());
  const versions = await page.evaluate(() => window.__kalada.versions);
  if (
    !versions.every((value, index) => {
      const previous = versions[index - 1];
      return index === 0 || (previous !== undefined && value > previous);
    })
  ) {
    throw new Error("Document revisions are not monotonic");
  }
  await verifyLifecycle(page);
}

async function verifyLifecycle(page: import("playwright").Page): Promise<void> {
  const highlight = await page.evaluate(() => window.__kalada.highlightLifecycle());
  const expectedHighlight = {
    initial: { punctuation: ["."], field: ["count"] },
    replaced: { operator: ["+"], keyword: ["true"] },
    astral: ["true"],
    multiple: { operator: ["+"], keyword: ["true"] },
    edited: ["true", "false"],
    lf: { operator: ["+"], keyword: ["true"] },
    cr: { operator: ["+"], keyword: ["true"] },
    formatted: { operator: ["+"], keyword: ["true"] },
    reattached: ["true"],
    closed: true,
  };
  if (JSON.stringify(highlight) !== JSON.stringify(expectedHighlight)) {
    throw new Error(`Rendered highlight offsets diverged: ${JSON.stringify(highlight)}`);
  }
  const crlf = await page.evaluate(() => window.__kalada.crlfLifecycle());
  for (const [step, pair] of Object.entries(crlf)) {
    if (pair.editor !== pair.service) {
      throw new Error(`CRLF parity failed at ${step}: ${JSON.stringify(pair)}`);
    }
  }
  if (crlf.opened.editor !== "user.\r\n" || crlf.changed.editor !== "user.name\r\n") {
    throw new Error(`CRLF text was normalized: ${JSON.stringify(crlf)}`);
  }
  if (crlf.replaced.editor !== 'user.name\r\n== "x"') {
    throw new Error(`CRLF replacement was normalized: ${JSON.stringify(crlf.replaced)}`);
  }
  const disposed = await page.evaluate(() => window.__kalada.disposeThenEdit());
  if (disposed.open || disposed.text !== "xuser." || disposed.tooltips || disposed.diagnostics) {
    throw new Error(`Mounted disposal was not inert: ${JSON.stringify(disposed)}`);
  }
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "kalada-codemirror-smoke-"));
  try {
    const release = join(directory, "release");
    await createRelease(release);
    const names = ["core", "syntax", "host", "language-service", "codemirror"];
    const packages = names.map((name) => pack(directory, join(release, "packages", name)));
    const archive = join(directory, packages[4]?.filename ?? "");
    if (!packages[4]) throw new Error("CodeMirror package was not packed");
    assertPackage(packages[4], archive);
    const consumer = join(directory, "consumer");
    await cp(fixtures, consumer, { recursive: true });
    run(
      [
        "npm",
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        ...packages.map(({ filename }) => join(directory, filename)),
      ],
      consumer,
    );
    if (browserOnly) await runBrowser(consumer);
    else {
      run(["node", "esm.mjs"], consumer);
      run(["node", "cjs.cjs"], consumer);
      runTypes(consumer);
    }
    console.log(`Packed CodeMirror smoke passed: ${basename(archive)}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();
