import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { validateReleaseIntegrity } from "../scripts/release-integrity.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directories: string[] = [];
const names = ["core", "projection", "syntax", "host"] as const;

function run(cwd: string, executable: string, ...args: string[]): string {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    timeout: 25_000,
    env: { ...process.env, TMPDIR: cwd },
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${executable} ${args.join(" ")}: ${result.error ?? ""}${result.stderr}${result.stdout}`,
    );
  return result.stdout.trim();
}

async function smoke(
  repository: string,
  base: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(
    "bun",
    [join(root, "scripts/projection-package-smoke.ts"), repository, "--release-base", base],
    {
      cwd: repository,
      env: { ...process.env, TMPDIR: repository },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  let stdout = "";
  let stderr = "";
  let failure: Error | undefined;
  let timedOut = false;
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.on("error", (error) => {
    failure = error;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    // The smoke runs npm and other children synchronously; terminate its entire group before cleanup.
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") failure = error as Error;
      }
    }
  }, 25_000);
  const status = await new Promise<number | null>((resolve) => child.once("close", resolve));
  clearTimeout(timer);
  if (failure) throw failure;
  if (timedOut) throw new Error(`Packed smoke timed out after 25s: ${stderr}${stdout}`);
  return { status, stdout, stderr };
}

async function manifest(
  repository: string,
  name: string,
): Promise<{
  version: string;
  dependencies: Record<string, string>;
  [key: string]: unknown;
}> {
  return JSON.parse(await readFile(join(repository, `packages/${name}/package.json`), "utf8"));
}

async function put(repository: string, path: string, value: unknown): Promise<void> {
  const target = join(repository, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(
    target,
    typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`,
  );
}

async function baseFixture(repository: string): Promise<string> {
  for (const name of ["core", "projection"] as const) {
    await cp(join(root, "packages", name), join(repository, "packages", name), { recursive: true });
  }
  for (const name of ["syntax", "host"] as const) {
    await put(repository, `packages/${name}/package.json`, {
      name: `@kalada/${name}`,
      version: "0.1.0",
      dependencies: { "@kalada/core": "^0.5.0" },
    });
  }
  await cp(
    join(root, "tests/consumers/projection"),
    join(repository, "tests/consumers/projection"),
    { recursive: true },
  );
  await symlink(join(root, "node_modules"), join(repository, "node_modules"), "dir");
  await put(repository, "package.json", { private: true, workspaces: ["packages/*"] });
  await put(
    repository,
    ".changeset/core.md",
    '---\n"@kalada/core": minor\n---\n\nAdvance core contracts.\n',
  );
  run(repository, "git", "init", "-q");
  run(
    repository,
    "git",
    "add",
    "package.json",
    ".changeset/core.md",
    ...names.map((name) => `packages/${name}/package.json`),
  );
  commit(repository, "base");
  return run(repository, "git", "rev-parse", "HEAD");
}

function commit(repository: string, message: string): void {
  run(
    repository,
    "git",
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    message,
  );
}

async function releaseFixture(repository: string, hash: string): Promise<void> {
  await unlink(join(repository, ".changeset/core.md"));
  for (const name of names) {
    const current = await manifest(repository, name);
    current.version = name === "core" ? "0.6.0" : "0.1.1";
    if (name !== "core") current.dependencies["@kalada/core"] = "^0.6.0";
    await put(repository, `packages/${name}/package.json`, current);
    const direct =
      name === "core" ? `### Minor Changes\n\n- ${hash}: Advance core contracts.\n\n` : "";
    const notes =
      name === "core"
        ? ""
        : `### Patch Changes\n\n- Updated dependencies [${hash}]\n  - @kalada/core@0.6.0\n`;
    await put(
      repository,
      `packages/${name}/CHANGELOG.md`,
      `# @kalada/${name}\n\n## ${current.version}\n\n${direct}${notes}`,
    );
  }
  run(repository, "git", "add", "-u");
  run(repository, "git", "add", ...names.map((name) => `packages/${name}/CHANGELOG.md`));
  commit(repository, "release");
}

async function fixture(): Promise<{ repository: string; base: string; hash: string }> {
  const repository = await mkdtemp(join(tmpdir(), "kalada-graph-"));
  directories.push(repository);
  const base = await baseFixture(repository);
  const hash = run(repository, "git", "rev-parse", "--short", "HEAD");
  await releaseFixture(repository, hash);
  return { repository, base, hash };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("validates the generated dependent graph and rejects tampered ranges, dependencies and notes", async () => {
  const { repository, base, hash } = await fixture();
  expect([...validateReleaseIntegrity(repository, base)].sort()).toEqual(
    [
      ["@kalada/core", "0.6.0"],
      ["@kalada/projection", "0.1.1"],
      ["@kalada/syntax", "0.1.1"],
      ["@kalada/host", "0.1.1"],
    ].sort(),
  );
  for (const name of ["syntax", "host"] as const) {
    const original = await manifest(repository, name);
    for (const range of ["^0.5.0", "https://evil.example/core.tgz"]) {
      await put(repository, `packages/${name}/package.json`, {
        ...original,
        dependencies: { "@kalada/core": range },
      });
      expect(() => validateReleaseIntegrity(repository, base)).toThrow();
    }
    await put(repository, `packages/${name}/package.json`, {
      ...original,
      dependencies: { ...original.dependencies, evil: "1.0.0" },
    });
    expect(() => validateReleaseIntegrity(repository, base)).toThrow("may only change");
    await put(repository, `packages/${name}/package.json`, original);
  }
  const path = "packages/projection/CHANGELOG.md";
  const original = await readFile(join(repository, path), "utf8");
  for (const altered of [
    original.replace(hash, "deadbee"),
    original.replace("@kalada/core@0.6.0", "@kalada/core@0.5.0"),
    original.replace(`Updated dependencies [${hash}]\n  - @kalada/core@0.6.0`, ""),
  ]) {
    await put(repository, path, altered);
    expect(() => validateReleaseIntegrity(repository, base)).toThrow();
  }
  await put(repository, path, original);
  expect(() => validateReleaseIntegrity(repository, base)).not.toThrow();
});

// Two 25s builds + two 25s packed commands, with 20s for fixture setup/teardown.
it("runs the actual packed release smoke against approved and mutually compatible stale packages", async () => {
  run(root, "bun", "run", "--filter", "@kalada/core", "build");
  run(root, "bun", "run", "--filter", "@kalada/projection", "build");
  const { repository, base } = await fixture();
  const approved = await smoke(repository, base);
  expect(approved.status, approved.stderr).toBe(0);
  expect(approved.stdout).toContain("Packed projection smoke passed");
  for (const name of ["core", "projection"] as const) {
    const current = await manifest(repository, name);
    current.version = name === "core" ? "0.5.0" : "0.1.0";
    if (name === "projection") current.dependencies["@kalada/core"] = "^0.5.0";
    await put(repository, `packages/${name}/package.json`, current);
  }
  const stale = await smoke(repository, base);
  expect(stale.status).not.toBe(0);
  expect(stale.stderr).toContain("version must advance from 0.5.0 to 0.6.0");
}, 120_000);
