import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateReleaseIntegrity } from "../scripts/release-integrity.js";

const temporaryDirectories: string[] = [];
const changeset = `---
"@example/one": minor
---

Add the public one API.
`;

function git(repository: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function createRepository(): Promise<{ base: string; repository: string }> {
  const repository = await mkdtemp(join(tmpdir(), "kalada-release-integrity-"));
  temporaryDirectories.push(repository);
  await mkdir(join(repository, ".changeset"));
  await mkdir(join(repository, "packages/one/src"), { recursive: true });
  await writeFile(join(repository, ".changeset/one.md"), changeset);
  await writeJson(join(repository, "package.json"), { private: true, workspaces: ["packages/*"] });
  await writeJson(join(repository, "packages/one/package.json"), {
    name: "@example/one",
    version: "0.0.0",
    type: "module",
  });
  await writeFile(join(repository, "packages/one/src/index.ts"), "export const one = 1;\n");
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "Release Test");
  git(repository, "config", "user.email", "release-test@example.com");
  git(repository, "add", ".");
  git(repository, "commit", "-qm", "base");
  return { repository, base: git(repository, "rev-parse", "HEAD") };
}

async function createRelease(
  repository: string,
  version = "0.1.0",
  description = "Add the public one API.",
): Promise<void> {
  await unlink(join(repository, ".changeset/one.md"));
  await writeJson(join(repository, "packages/one/package.json"), {
    name: "@example/one",
    version,
    type: "module",
  });
  await writeFile(
    join(repository, "packages/one/CHANGELOG.md"),
    `# @example/one\n\n## ${version}\n\n### Minor Changes\n\n- abc1234: ${description}\n`,
  );
  git(repository, "add", "-A");
  git(repository, "commit", "-qm", "release");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("release integrity validation", () => {
  it("does not mistake an ordinary source state for a generated release", async () => {
    const { base, repository } = await createRepository();
    await writeFile(join(repository, "packages/one/src/index.ts"), "export const one = 2;\n");
    git(repository, "add", ".");
    git(repository, "commit", "-qm", "source change");

    expect(() => validateReleaseIntegrity(repository, base)).toThrow(
      "Generated release must consume at least one Changeset",
    );
  });

  it("accepts a generated release that consumes its Changeset", async () => {
    const { base, repository } = await createRepository();
    await createRelease(repository);

    expect(() => validateReleaseIntegrity(repository, base)).not.toThrow();
  });

  it("rejects a non-corresponding package version", async () => {
    const { base, repository } = await createRepository();
    await createRelease(repository, "0.0.1");

    expect(() => validateReleaseIntegrity(repository, base)).toThrow(
      "version must advance from 0.0.0 to 0.1.0",
    );
  });

  it("rejects changelog content not supplied by the consumed Changeset", async () => {
    const { base, repository } = await createRepository();
    await createRelease(repository, "0.1.0", "Describe an unrelated change.");

    expect(() => validateReleaseIntegrity(repository, base)).toThrow(
      "changelog does not match consumed minor Changesets",
    );
  });

  it("rejects an unauthorized entry hidden before a duplicate category", async () => {
    const { base, repository } = await createRepository();
    await createRelease(repository);
    await writeFile(
      join(repository, "packages/one/CHANGELOG.md"),
      "# @example/one\n\n## 0.1.0\n\n### Minor Changes\n\n" +
        "- deadbee: Injected release note.\n\n### Minor Changes\n\n" +
        "- abc1234: Add the public one API.\n",
    );
    git(repository, "add", ".");
    git(repository, "commit", "-qm", "duplicate category");

    expect(() => validateReleaseIntegrity(repository, base)).toThrow(
      "changelog has malformed release categories",
    );
  });

  it("rejects an empty recognized release category", async () => {
    const { base, repository } = await createRepository();
    await createRelease(repository);
    await writeFile(
      join(repository, "packages/one/CHANGELOG.md"),
      "# @example/one\n\n## 0.1.0\n\n### Patch Changes\n\n" +
        "### Minor Changes\n\n- abc1234: Add the public one API.\n",
    );
    git(repository, "add", ".");
    git(repository, "commit", "-qm", "empty category");

    expect(() => validateReleaseIntegrity(repository, base)).toThrow(
      "changelog has malformed release categories",
    );
  });

  it("rejects unexpected source artifacts", async () => {
    const { base, repository } = await createRepository();
    await createRelease(repository);
    await writeFile(join(repository, "packages/one/src/index.ts"), "export const one = 2;\n");
    git(repository, "add", ".");
    git(repository, "commit", "-qm", "unexpected source");

    expect(() => validateReleaseIntegrity(repository, base)).toThrow(
      "Release diff contains missing or unexpected artifacts",
    );
  });
});
