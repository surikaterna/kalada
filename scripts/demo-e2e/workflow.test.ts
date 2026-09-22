import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./config.js";

const workflow = readFileSync(resolve(ROOT, ".github/workflows/pages.yml"), "utf8");

describe("Pages workflow policy", () => {
  it("uses immutable reviewed action pins", () => {
    const pins = [
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
      "actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9",
      "actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d",
      "actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346",
    ];
    for (const pin of pins) expect(workflow).toContain(pin);
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@v\d/u);
  });

  it("keeps verification read-only and deployment canonical", () => {
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).toContain("pages: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("github.repository == 'surikaterna/kalada'");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("enablement: false");
    expect(workflow).not.toMatch(/npm|changeset|pull_request_target|secrets\./u);
  });

  it("separates cancellable PRs from queued production", () => {
    expect(workflow).toContain("pages-pr-{0}");
    expect(workflow).toContain("'pages-production'");
    expect(workflow).toContain(
      "cancel-in-progress: $" + "{{ github.event_name == 'pull_request' }}",
    );
    expect(workflow).toContain("timeout-minutes: 30");
    expect(workflow).toContain("retention-days: 7");
    expect(workflow).toContain("retention-days: 1");
  });
});
