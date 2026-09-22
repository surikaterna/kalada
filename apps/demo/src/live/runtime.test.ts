import { describe, expect, it } from "vitest";
import { WorkspaceModel } from "../workspace/model.js";
import { DemoRuntime, uriForName } from "./runtime.js";

describe("live workspace orchestration", () => {
  it("prepares and evaluates three independent documents", async () => {
    const model = new WorkspaceModel();
    const runtime = new DemoRuntime(
      model,
      () => undefined,
      () => undefined,
    );
    runtime.start();
    await ready(runtime);
    const snapshot = runtime.snapshot();
    expect(snapshot.state).toBe("ready");
    expect(snapshot.files.get("greeting.kalada")?.output).toBe("Ada");
    expect(snapshot.files.get("count.kalada")?.output).toBe(3);
    expect(snapshot.files.get("enabled.kalada")?.output).toBe("Ada");
    expect(snapshot.files.get("count.kalada")?.dependencies).toEqual(["demo:data"]);
    runtime.dispose();
  });

  it("reuses prepared plans for data-only changes and blocks invalid data", async () => {
    const model = new WorkspaceModel();
    const runtime = new DemoRuntime(
      model,
      () => undefined,
      () => undefined,
    );
    runtime.start();
    await ready(runtime);
    const prepared = runtime.snapshot().files.get("count.kalada")?.prepared;
    model.update(
      "data.json",
      JSON.stringify({ user: { name: "Grace" }, count: 5, enabled: false }),
    );
    runtime.dataChanged();
    await ready(runtime);
    expect(runtime.snapshot().files.get("count.kalada")?.prepared).toBe(prepared);
    expect(runtime.snapshot().files.get("count.kalada")?.output).toBe(6);
    model.update("data.json", "{}");
    runtime.dataChanged();
    await waitFor(() => runtime.snapshot().state === "invalid");
    expect(runtime.snapshot().state).toBe("invalid");
    expect(runtime.snapshot().files.get("count.kalada")?.output).toBeUndefined();
    runtime.dispose();
  });

  it("isolates source revisions and drops superseded schema work", async () => {
    const model = new WorkspaceModel();
    const runtime = new DemoRuntime(
      model,
      () => undefined,
      () => undefined,
    );
    const uri = uriForName("count.kalada");
    runtime.service.openDocument({ uri, version: 1, text: model.text("count.kalada") });
    runtime.start();
    model.update("schema.json", "false");
    runtime.schemaChanged();
    model.update("schema.json", model.snapshot().schemaText.replace("false", "true"));
    runtime.schemaChanged();
    await ready(runtime);
    const updated = runtime.service.updateDocument({
      uri,
      version: 2,
      edits: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: model.text("count.kalada").length },
          },
          text: "data.count + 2",
        },
      ],
    });
    runtime.documentChanged(updated);
    await waitFor(() => runtime.snapshot().files.get("count.kalada")?.output === 4);
    expect(runtime.snapshot().files.get("count.kalada")?.output).toBe(4);
    expect(runtime.snapshot().files.get("greeting.kalada")?.output).toBe("Ada");
    runtime.dispose();
  });
});

async function ready(runtime: DemoRuntime): Promise<void> {
  await waitFor(() => runtime.snapshot().state === "ready");
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("runtime did not settle");
}
