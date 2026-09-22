import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
  await page.getByRole("button", { name: "Generate data" }).click();
  await page.getByText("Generated data validated and applied").waitFor();
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
  if (await page.locator("script:not([src]), img, iframe").count())
    throw new Error("Unsafe DOM rendered");
  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByText("Workspace reset").waitFor();
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
