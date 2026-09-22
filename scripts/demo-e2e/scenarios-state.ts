import type { Page } from "playwright";
import {
  assertMutationProbe,
  assertNoOutput,
  completionLabels,
  editor,
  gotoReady,
  openTab,
  panel,
  replaceEditor,
  startMutationProbe,
  waitOutput,
  waitStatus,
} from "./helpers.js";
import type { Scenario } from "./types.js";

const GENERATED = '{"count":5,"enabled":true,"user":{"name":"a"}}';

export const seededGenerationAndPrivacy: Scenario = {
  name: "seed-1-generation-propagation-and-privacy",
  async run({ page, baseUrl }) {
    await gotoReady(page, baseUrl);
    await page.getByRole("button", { name: "Reset" }).click();
    await page.getByText("Workspace reset", { exact: true }).waitFor();
    await waitStatus(page, "ready: WORKSPACE_READY");
    await openTab(page, "count.kalada");
    await page.getByRole("button", { name: "Generate data" }).click();
    await page.getByText("Generated data validated and applied", { exact: true }).waitFor();
    await waitStatus(page, "ready: WORKSPACE_READY");
    await assertGeneratedPropagation(page);
    await verifyInspectorPrivacy(page);
  },
};

async function assertGeneratedPropagation(page: Page): Promise<void> {
  await openTab(page, "data.json");
  if ((await editor(page).textContent()) !== GENERATED) {
    throw new Error(`Seed 1 bytes drifted: ${await editor(page).textContent()}`);
  }
  await openTab(page, "count.kalada");
  await waitOutput(page, "6");
  const diagnostics = await panel(page, "Diagnostics").locator("pre").textContent();
  if (diagnostics !== "[]") throw new Error(`Generated data did not validate: ${diagnostics}`);
}

async function verifyInspectorPrivacy(page: Page): Promise<void> {
  await replaceEditor(page, '"e2e-private-marker"');
  await waitOutput(page, '"e2e-private-marker"');
  const inspector = panel(page, "Advanced inspectors").locator("pre");
  if ((await inspector.textContent())?.includes("e2e-private-marker")) {
    throw new Error("Inspector revealed source/literals by default");
  }
  await page.getByLabel("Reveal source/literals in inspectors").check();
  await inspector.getByText(/e2e-private-marker/u).waitFor();
}

export const staleSupersession: Scenario = {
  name: "version-data-environment-stale-supersession",
  async run({ page, baseUrl }) {
    await gotoReady(page, baseUrl);
    await verifyVersionSupersession(page);
    await resetWorkspace(page);
    await verifyDataSupersession(page);
    await resetWorkspace(page);
    await verifyEnvironmentSupersession(page);
  },
};

async function resetWorkspace(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByText("Workspace reset", { exact: true }).waitFor();
  await waitStatus(page, "ready: WORKSPACE_READY");
}

async function verifyVersionSupersession(page: Page): Promise<void> {
  await openTab(page, "count.kalada");
  await startMutationProbe(page);
  await replaceEditor(page, '"version-stale-marker"');
  await replaceEditor(page, '"version-current-marker"');
  await waitOutput(page, '"version-current-marker"');
  await assertMutationProbe(page, ["version-stale-marker"], "version-current-marker");
}

async function verifyDataSupersession(page: Page): Promise<void> {
  await openTab(page, "count.kalada");
  await replaceEditor(page, "data.user.name");
  await waitOutput(page, '"Ada"');
  await openTab(page, "data.json");
  await startMutationProbe(page);
  await replaceEditor(page, dataFixture("data-stale-marker"));
  await replaceEditor(page, dataFixture("data-current-marker"));
  await openTab(page, "count.kalada");
  await waitOutput(page, '"data-current-marker"');
  await assertMutationProbe(page, ["data-stale-marker"], "data-current-marker");
}

async function verifyEnvironmentSupersession(page: Page): Promise<void> {
  await openTab(page, "count.kalada");
  await replaceEditor(page, "data");
  await openTab(page, "data.json");
  await replaceEditor(page, '"environment-current-marker"');
  await openTab(page, "schema.json");
  await startMutationProbe(page);
  await replaceEditor(page, '{"const":"environment-stale-marker"}');
  await replaceEditor(page, '{"const":"environment-current-marker"}');
  await openTab(page, "count.kalada");
  await waitOutput(page, '"environment-current-marker"');
  await assertMutationProbe(page, ["environment-stale-marker"], "environment-current-marker");
}

function dataFixture(name: string): string {
  return JSON.stringify({ count: 2, enabled: true, user: { name } });
}

export const recursiveReferences: Scenario = {
  name: "same-document-recursion-completion-evaluation-inspection-generation",
  async run({ page, baseUrl }) {
    await gotoReady(page, baseUrl);
    await installRecursiveFixture(page);
    await openTab(page, "count.kalada");
    await replaceEditor(page, "data.");
    const labels = await completionLabels(page);
    if (!labels.includes("next") || !labels.includes("value")) {
      throw new Error(`Recursive completion missing: ${labels.join(",")}`);
    }
    await replaceEditor(page, "data.next.value");
    await waitOutput(page, "3");
    const inspector = await panel(page, "Advanced inspectors").locator("pre").textContent();
    if (!inspector?.includes('"cycle": true') || !inspector.includes('"kind": "reference"')) {
      throw new Error("Recursive inspector evidence missing");
    }
    await page.getByRole("button", { name: "Generate data" }).click();
    await page.getByText("Generated data validated and applied", { exact: true }).waitFor();
    await openTab(page, "data.json");
    if ((await editor(page).textContent()) !== '{"value":5}')
      throw new Error("Recursive generation drifted");
  },
};

async function installRecursiveFixture(page: Page): Promise<void> {
  const schema = {
    type: "object",
    properties: { value: { type: "integer" }, next: { $ref: "#" } },
    required: ["value"],
    additionalProperties: false,
  };
  await openTab(page, "data.json");
  await replaceEditor(page, '{"value":2,"next":{"value":3}}');
  await openTab(page, "schema.json");
  await replaceEditor(page, JSON.stringify(schema));
  await waitStatus(page, "ready: WORKSPACE_READY");
}

export const unsupportedReferences: Scenario = {
  name: "unsupported-reference-policy-with-zero-resolver-requests",
  async run({ page, baseUrl, requests }) {
    await gotoReady(page, baseUrl);
    await openTab(page, "greeting.kalada");
    await waitOutput(page, '"Ada"');
    await openTab(page, "schema.json");
    const fixtures = [
      '{"$ref":"https://example.invalid/schema"}',
      '{"$ref":"other.json#/value"}',
      '{"type":"object","properties":{"value":{"$id":"urn:nested","type":"string"}}}',
      '{"$dynamicRef":"#node"}',
      '{"$ref":"#"}',
    ];
    const initialRequests = requests.length;
    for (const fixture of fixtures) await assertUnsupportedFixture(page, fixture);
    if (requests.length !== initialRequests)
      throw new Error("Unsupported refs attempted resolver requests");
  },
};

async function assertUnsupportedFixture(page: Page, fixture: string): Promise<void> {
  await replaceEditor(page, fixture);
  await waitStatus(page, "invalid: SCHEMA_INVALID_OR_UNSUPPORTED");
  await assertNoOutput(page, "Ada");
  const output = await panel(page, "Output / error").textContent();
  if (!output?.includes("SCHEMA_INVALID_OR_UNSUPPORTED")) {
    throw new Error(`Unsupported schema state was not exact for ${fixture}`);
  }
}
