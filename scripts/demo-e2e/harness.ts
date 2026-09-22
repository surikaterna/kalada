import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Browser, type BrowserContext, chromium, type Request } from "playwright";
import { DEMO_BASE, RESULTS, ROOT } from "./config.js";
import type { ArtifactSummary, RequestRecord, Scenario } from "./types.js";

export interface HarnessSummary {
  readonly browserVersion: string;
  readonly scenarios: readonly string[];
  readonly requests: readonly RequestRecord[];
}

export async function runHarness(
  baseUrl: string,
  scenarios: readonly Scenario[],
  artifact?: ArtifactSummary,
): Promise<HarnessSummary> {
  const browser = await launchBrowser();
  const allRequests: RequestRecord[] = [];
  const failures: Error[] = [];
  try {
    for (const scenario of scenarios) {
      const requests = await runScenario(browser, baseUrl, scenario, artifact).catch((error) => {
        failures.push(error instanceof Error ? error : new Error(String(error)));
        return [];
      });
      allRequests.push(...requests);
    }
    if (failures.length)
      throw new AggregateError(failures, `${failures.length} E2E scenario(s) failed`);
    return {
      browserVersion: browser.version(),
      scenarios: scenarios.map(({ name }) => name),
      requests: allRequests,
    };
  } finally {
    await browser.close();
  }
}

async function runScenario(
  browser: Browser,
  baseUrl: string,
  scenario: Scenario,
  artifact?: ArtifactSummary,
): Promise<RequestRecord[]> {
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block" });
  const requests: RequestRecord[] = [];
  const requestMap = new Map<Request, RequestRecord>();
  const forbidden: string[] = [];
  const browserErrors: string[] = [];
  installNetworkPolicy(context, baseUrl, requests, requestMap, forbidden);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  try {
    await scenario.run({ page, baseUrl, requests });
    await page.waitForLoadState("networkidle");
    assertBrowserOutcome(requests, forbidden, browserErrors, baseUrl, artifact);
    await context.tracing.stop();
    return requests;
  } catch (error) {
    await writeFailureEvidence(
      context,
      page,
      scenario.name,
      requests,
      browserErrors,
      error,
      browser.version(),
    );
    throw new Error(`${scenario.name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.close();
  }
}

function installNetworkPolicy(
  context: BrowserContext,
  baseUrl: string,
  records: RequestRecord[],
  requestMap: Map<Request, RequestRecord>,
  forbidden: string[],
): void {
  const origin = new URL(baseUrl).origin;
  context.on("request", (request) => {
    const record = requestRecord(request);
    records.push(record);
    requestMap.set(request, record);
  });
  context.on("response", (response) => {
    const record = requestMap.get(response.request());
    if (record) record.status = response.status();
  });
  context.on("requestfailed", (request) => {
    const record = requestMap.get(request);
    if (record) record.status = "failed";
  });
  void context.route("**/*", async (route) => {
    const request = route.request();
    if (allowedRequest(request, origin)) await route.continue();
    else {
      forbidden.push(`${request.method()} ${request.url()} (${request.resourceType()})`);
      await route.abort("blockedbyclient");
    }
  });
}

function allowedRequest(request: Request, origin: string): boolean {
  if (request.method() !== "GET") return false;
  const url = new URL(request.url());
  return (
    url.origin === origin &&
    (url.pathname === DEMO_BASE || /^\/kalada\/assets\/[A-Za-z0-9_.-]+$/u.test(url.pathname)) &&
    !url.search &&
    !url.hash
  );
}

function assertBrowserOutcome(
  requests: readonly RequestRecord[],
  forbidden: readonly string[],
  errors: readonly string[],
  baseUrl: string,
  artifact?: ArtifactSummary,
): void {
  if (forbidden.length) throw new Error(`Blocked request(s): ${forbidden.join(" | ")}`);
  if (errors.length) throw new Error(`Browser error(s): ${errors.join(" | ")}`);
  const incomplete = requests.filter(
    (request) => request.status === null || request.status === "failed",
  );
  if (incomplete.length) throw new Error(`Incomplete request(s): ${JSON.stringify(incomplete)}`);
  if (artifact) assertArtifactRequests(requests, baseUrl, artifact);
}

function assertArtifactRequests(
  requests: readonly RequestRecord[],
  baseUrl: string,
  artifact: ArtifactSummary,
): void {
  const origin = new URL(baseUrl).origin;
  const expected = new Set(
    [...artifact.runtimeFiles].map((file) =>
      file === "index.html" ? DEMO_BASE : `${DEMO_BASE}${file}`,
    ),
  );
  const requested = new Set(requests.map(({ url }) => new URL(url).pathname));
  const outside = [...requested].filter((path) => !expected.has(path));
  const missing = [...expected].filter((path) => !requested.has(path));
  if (outside.length || missing.length) {
    throw new Error(
      `Runtime requests differ from artifact closure: outside=${outside} missing=${missing}`,
    );
  }
  for (const file of artifact.lazyEnvironmentFiles) {
    if (!requests.some(({ url }) => url === `${origin}${DEMO_BASE}${file}`)) {
      throw new Error(`Lazy environment chunk was not requested under ${DEMO_BASE}: ${file}`);
    }
  }
}

async function writeFailureEvidence(
  context: BrowserContext,
  page: import("playwright").Page,
  name: string,
  requests: readonly RequestRecord[],
  browserErrors: readonly string[],
  error: unknown,
  browserVersion: string,
): Promise<void> {
  const directory = resolve(RESULTS, safeName(name));
  mkdirSync(directory, { recursive: true });
  await page
    .screenshot({ path: resolve(directory, "screenshot.png"), fullPage: true })
    .catch(() => undefined);
  await context.tracing.stop({ path: resolve(directory, "trace.zip") }).catch(() => undefined);
  writeJson(resolve(directory, "requests.json"), requests);
  writeJson(resolve(directory, "versions.json"), versions(browserVersion));
  writeJson(resolve(directory, "report.json"), {
    scenario: name,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : String(error),
    browserErrors,
  });
}

function versions(browserVersion: string): object {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  return {
    bun: Bun.version,
    playwright: manifest.devDependencies.playwright,
    chromium: browserVersion,
  };
}

function requestRecord(request: Request): RequestRecord {
  return {
    method: request.method(),
    url: request.url(),
    resourceType: request.resourceType(),
    status: null,
  };
}

async function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.DEMO_E2E_CHROMIUM_EXECUTABLE_PATH;
  return await chromium.launch(
    executablePath ? { headless: true, executablePath } : { headless: true },
  );
}

function safeName(name: string): string {
  return name.replaceAll(/[^a-z0-9-]/giu, "-");
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
