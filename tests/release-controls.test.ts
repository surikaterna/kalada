import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories: string[] = [];
const exceptionPath = "release-exceptions/kalada-projection-0.1.0-native-core.json";
const sourceSha = "7ec71273a1f916135838cb84e2eded8d594e0e5e";

function run(cwd: string, executable: string, args: string[], env = process.env): string {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", env });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function write(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const content = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, content);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createFixture(): { base: string; path: string } {
  const path = mkdtempSync(join(tmpdir(), "kalada-release-controls-"));
  temporaryDirectories.push(path);
  write(join(path, "package.json"), {
    name: "fixture",
    version: "0.0.0",
    private: true,
    packageManager: "bun@1.4.2",
    workspaces: ["packages/*"],
  });
  write(join(path, "bun.lock"), "{}\n");
  write(join(path, ".changeset/config.json"), {
    access: "public",
    baseBranch: "main",
    commit: false,
    fixed: [],
    ignore: [],
    linked: [],
    privatePackages: { tag: false, version: false },
    updateInternalDependencies: "patch",
  });
  write(join(path, "packages/core/package.json"), {
    name: "@kalada/core",
    version: "0.5.0",
  });
  write(join(path, "packages/projection/package.json"), {
    name: "@kalada/projection",
    version: "0.1.0",
    dependencies: { "@kalada/core": "^0.5.0" },
  });
  write(join(path, "packages/projection/src/index.ts"), "export {};\n");
  run(path, "git", ["init", "-q", "-b", "main"]);
  run(path, "git", ["add", "."]);
  run(path, "git", [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "base",
  ]);
  return { path, base: run(path, "git", ["rev-parse", "HEAD"]) };
}

function changeset(path: string, args: string[]): void {
  run(path, process.execPath, [join(root, "node_modules/@changesets/cli/bin.js"), ...args]);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("terminal release controls", () => {
  it("retains the exact schema-v2 exception record and its history", () => {
    const current = readFileSync(join(root, exceptionPath), "utf8");
    const historical = run(root, "git", ["show", `${sourceSha}:${exceptionPath}`]);
    const history = run(root, "git", ["log", "--format=%H", "--follow", "--", exceptionPath]);

    expect(hash(current)).toBe("311614ea4524f39b74f7fef5068462836f81c242287d03d3e117eb1cad0b2adf");
    expect(`${historical}\n`).toBe(current);
    expect(history.split("\n")).toEqual([
      "bed622f19a5be57d2db32d6a5a36b1ab035f9900",
      "fbc5280767d3bedcd9ac45a11364a86d87fe64a6",
      "eb1a551ba63bd340c9c6ab9b164c8f9db7f2f969",
    ]);
    expect(hash(readFileSync(join(root, "release-exceptions/schema.v2.json"), "utf8"))).toBe(
      "bad6202f9ac164096aea6eb4d94d3741c7e6e3295ccc6a2d6c585bef2213cd75",
    );
  });

  it("does not ignore either publishable package", () => {
    const config = JSON.parse(readFileSync(join(root, ".changeset/config.json"), "utf8"));
    expect(config.ignore).toEqual([]);
  });

  it("recognizes both current registry versions and selects nothing to publish", () => {
    const fixture = createFixture();
    const bin = join(fixture.path, "bin");
    const calls = join(fixture.path, "npm-calls.txt");
    const output = join(fixture.path, "publish-plan.json");
    mkdirSync(bin);
    write(
      join(bin, "npm"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$NPM_CALLS"\ncase "$*" in\n` +
        `  *"@kalada/core"*) printf '%s\\n' '{"versions":["0.5.0"],"dist-tags":{"latest":"0.5.0"}}' ;;\n` +
        `  *"@kalada/projection"*) printf '%s\\n' '{"versions":["0.1.0"],"dist-tags":{"latest":"0.1.0"}}' ;;\n` +
        `  *) exit 1 ;;\nesac\n`,
    );
    chmodSync(join(bin, "npm"), 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, NPM_CALLS: calls };
    run(
      fixture.path,
      process.execPath,
      [join(root, "node_modules/@changesets/cli/bin.js"), "publish-plan", "--output", output],
      env,
    );

    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({ version: 1, plan: [] });
    expect(readFileSync(calls, "utf8")).toContain("info @kalada/core --json");
    expect(readFileSync(calls, "utf8")).toContain("info @kalada/projection --json");
  });

  it("has no pending status but selects a future projection Changeset normally", () => {
    const fixture = createFixture();
    const empty = join(fixture.path, "empty-status.json");
    changeset(fixture.path, ["status", "--since", fixture.base, "--output", empty]);
    expect(JSON.parse(readFileSync(empty, "utf8")).releases).toEqual([]);

    write(
      join(fixture.path, ".changeset/projection.md"),
      '---\n"@kalada/projection": patch\n---\n\nExercise ordinary release selection.\n',
    );
    write(join(fixture.path, "packages/projection/src/index.ts"), "export const next = true;\n");
    run(fixture.path, "git", ["add", "."]);
    run(fixture.path, "git", [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "future",
    ]);
    const selected = join(fixture.path, "selected-status.json");
    changeset(fixture.path, ["status", "--since", fixture.base, "--output", selected]);
    expect(JSON.parse(readFileSync(selected, "utf8")).releases).toMatchObject([
      { name: "@kalada/projection", type: "patch", oldVersion: "0.1.0", newVersion: "0.1.1" },
    ]);
  });
});
