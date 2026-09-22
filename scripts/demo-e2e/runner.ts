import { rmSync } from "node:fs";
import { buildAndVerifyArtifact } from "./artifact.js";
import { DEMO_BASE, deployedUrl, LOCAL_ORIGIN, RESULTS } from "./config.js";
import { runHarness } from "./harness.js";
import { startPreview, stopPreview, waitForPreview } from "./process.js";
import {
  deployedWorkspaceSmoke,
  directLoadReload,
  editingAndTooling,
  keyboardAndSafeDom,
} from "./scenarios-core.js";
import {
  recursiveReferences,
  seededGenerationAndPrivacy,
  staleSupersession,
  unsupportedReferences,
} from "./scenarios-state.js";
import { transferAndPersistence } from "./scenarios-storage.js";
import type { ArtifactSummary, Scenario } from "./types.js";

const localScenarios: readonly Scenario[] = [
  directLoadReload,
  editingAndTooling,
  seededGenerationAndPrivacy,
  staleSupersession,
  recursiveReferences,
  unsupportedReferences,
  transferAndPersistence,
  keyboardAndSafeDom,
];

export async function runDemoE2E(deployed: boolean): Promise<void> {
  rmSync(RESULTS, { force: true, recursive: true });
  if (deployed) {
    const target = deployedUrl();
    const summary = await runHarness(target.href, [directLoadReload, deployedWorkspaceSmoke]);
    report(summary, target.href);
    rmSync(RESULTS, { force: true, recursive: true });
    return;
  }
  const artifact = buildAndVerifyArtifact();
  const preview = startPreview();
  try {
    await waitForPreview(preview);
    const baseUrl = `${LOCAL_ORIGIN}${DEMO_BASE}`;
    const summary = await runHarness(baseUrl, localScenarios, artifact);
    report(summary, baseUrl, artifact);
    rmSync(RESULTS, { force: true, recursive: true });
  } finally {
    await stopPreview(preview);
  }
}

function report(
  summary: Awaited<ReturnType<typeof runHarness>>,
  baseUrl: string,
  artifact?: ArtifactSummary,
): void {
  const requests = [...new Map(summary.requests.map((request) => [request.url, request])).values()];
  console.log(
    JSON.stringify(
      {
        result: "passed",
        baseUrl,
        browser: summary.browserVersion,
        scenarios: summary.scenarios,
        artifact:
          artifact === undefined
            ? undefined
            : {
                files: artifact.files,
                entryStaticClosure: [...artifact.entryStaticFiles].sort(),
                lazyEnvironmentClosure: [...artifact.lazyEnvironmentFiles].sort(),
                checks: [
                  "all imports resolved",
                  "exact dependency pins",
                  "vendor isolation",
                  "AST runtime primitive scan",
                  "base-correct emitted URLs",
                  "runtime-only regular files",
                ],
              },
        requestAllowlist: [
          `${new URL(baseUrl).origin}${DEMO_BASE}`,
          `${new URL(baseUrl).origin}${DEMO_BASE}assets/*`,
        ],
        requests,
        failureEvidence: "apps/demo/test-results/demo-e2e (failure only; deleted on success)",
      },
      null,
      2,
    ),
  );
}
