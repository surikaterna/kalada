import { describe, expect, it, vi } from "vitest";
import { ImportCoordinator } from "./imports.js";

describe("import operation lifecycle", () => {
  it.each(["edit", "reset", "dispose"])("drops an import superseded by %s", async (event) => {
    const coordinator = new ImportCoordinator<string>();
    let resolve!: (text: string) => void;
    const read = new Promise<string>((done) => {
      resolve = done;
    });
    const apply = vi.fn();
    const pending = coordinator.run(
      () => read,
      (text) => text,
      apply,
    );
    if (event === "dispose") coordinator.dispose();
    else coordinator.invalidate();
    resolve("late");
    await expect(pending).resolves.toBe("stale");
    expect(apply).not.toHaveBeenCalled();
  });

  it("allows only the newest overlapping import to commit", async () => {
    const coordinator = new ImportCoordinator<string>();
    let firstResolve!: (text: string) => void;
    const firstRead = new Promise<string>((done) => {
      firstResolve = done;
    });
    const applied: string[] = [];
    const first = coordinator.run(
      () => firstRead,
      (text) => text,
      (text) => applied.push(text),
    );
    const second = coordinator.run(
      () => Promise.resolve("new"),
      (text) => text,
      (text) => applied.push(text),
    );
    await expect(second).resolves.toBe("applied");
    firstResolve("old");
    await expect(first).resolves.toBe("stale");
    expect(applied).toEqual(["new"]);
  });
});
