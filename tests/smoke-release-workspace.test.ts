import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertChangesetPackagesPresent,
  copyChangesetReleaseWorkspace,
  discoverWorkspaceDirectories,
} from "../scripts/smoke-release-workspace.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("smoke release workspace", () => {
  it("copies every workspace named by Changesets, including newly added packages", async () => {
    const source = await fixture();
    await expect(
      assertChangesetPackagesPresent(source, ["packages/core", "packages/syntax"]),
    ).rejects.toThrow(
      "quiet-hosts-describe.md references @kalada/host, which is missing from the smoke workspace",
    );

    const discovered = await discoverWorkspaceDirectories(source);
    expect(discovered).toEqual(["packages/core", "packages/host", "packages/syntax"]);

    const destination = join(source, "release");
    await copyChangesetReleaseWorkspace(source, destination);
    await expect(assertChangesetPackagesPresent(destination, discovered)).resolves.toBeUndefined();
    const host = JSON.parse(
      await readFile(join(destination, "packages/host/package.json"), "utf8"),
    );
    expect(host.name).toBe("@kalada/host");
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kalada-smoke-workspace-"));
  directories.push(root);
  await mkdir(join(root, ".changeset"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, workspaces: ["packages/*"] }),
  );
  await writeFile(join(root, "bun.lock"), "");
  await writeFile(
    join(root, ".changeset/quiet-hosts-describe.md"),
    '---\n"@kalada/host": minor\n---\n\nAdd host.\n',
  );
  for (const name of ["core", "host", "syntax"]) {
    await mkdir(join(root, "packages", name), { recursive: true });
    await writeFile(
      join(root, "packages", name, "package.json"),
      JSON.stringify({ name: `@kalada/${name}`, version: "0.0.0" }),
    );
  }
  return root;
}
