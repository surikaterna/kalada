import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateChangesetPolicy } from "../scripts/changeset-policy/validate.js";

type Json = Record<string, unknown>;
type ExceptionFile = {
  path: string;
  status: string;
  baseSha256: string | null;
  headSha256: string | null;
};
type ExceptionRecord = Json & {
  authorization: { issueUrl: string; baseCommit: string };
  expiresAt: string;
  files: ExceptionFile[];
  package: { name: string; path: string; version: string };
  registryEvidence: Json & {
    capturedAt: string;
    command: string;
    package: string;
    response: string;
    responseSha256: string;
    version: string;
  };
};
type Fixture = { base: string; path: string };

const repositories: string[] = [];
const validResponse = JSON.stringify({ error: { code: "E404", summary: "Not found" } });
const validationTime = Date.parse("2026-09-18T14:00:00.000Z");

function run(repository: string, executable: string, args: string[]): string {
  return execFileSync(executable, args, {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    },
  }).trim();
}

function write(repository: string, path: string, value: string | Buffer): void {
  const target = join(repository, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, value);
}

function commit(repository: string): string {
  run(repository, "git", ["add", "-A"]);
  run(repository, "git", ["commit", "-m", "fixture"]);
  return run(repository, "git", ["rev-parse", "HEAD"]);
}

function manifest(name: string, version: string): string {
  return `${JSON.stringify({ name, version, type: "module" }, null, 2)}\n`;
}

function fixture(): Fixture {
  const path = mkdtempSync(join(tmpdir(), "kalada-policy-v2-"));
  repositories.push(path);
  run(path, "git", ["init", "-q"]);
  write(path, "package.json", '{"private":true}\n');
  write(path, "packages/projection/package.json", manifest("@kalada/projection", "0.1.0"));
  write(path, "packages/projection/src/index.ts", "export const projection = 1;\n");
  write(path, "packages/projection/src/removed.ts", "export const removed = true;\n");
  write(path, "packages/core/package.json", manifest("@kalada/core", "0.4.0"));
  write(path, "packages/core/src/index.ts", "export const core = 1;\n");
  write(path, "scripts/projection-smoke.ts", "export const smoke = 1;\n");
  return { path, base: commit(path) };
}

function hash(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fileDeclaration(fix: Fixture, path: string, status = "mod"): ExceptionFile {
  const before = status === "add" ? null : readBaseFile(fix, path);
  const after = status === "del" ? null : readFileSync(join(fix.path, path));
  return {
    path,
    status,
    baseSha256: before ? hash(before) : null,
    headSha256: after ? hash(after) : null,
  };
}

function readBaseFile(fix: Fixture, path: string): Buffer {
  return execFileSync("git", ["show", `${fix.base}:${path}`], { cwd: fix.path });
}

function firstFile(value: ExceptionRecord): ExceptionFile {
  const file = value.files[0];
  if (!file) throw new Error("Fixture is missing its correction file");
  return file;
}

function record(fix: Fixture, files: ExceptionFile[]): ExceptionRecord {
  const captured = new Date(validationTime - 60_000);
  const expires = new Date(captured.getTime() + 60 * 60 * 1000);
  return {
    schemaVersion: 2,
    exceptionKind: "unpublished-package-correction",
    repository: "surikaterna/kalada",
    reason: "Correct the never-published projection artifact without changing its version.",
    authorization: {
      issueUrl: "https://github.com/surikaterna/kalada/issues/44",
      baseCommit: fix.base,
    },
    reviewIssueUrl: "https://github.com/surikaterna/kalada/issues/45",
    removalIssueUrl: "https://github.com/surikaterna/kalada/issues/49",
    expiresAt: expires.toISOString(),
    package: {
      name: "@kalada/projection",
      path: "packages/projection/package.json",
      version: "0.1.0",
    },
    files,
    registryEvidence: {
      registry: "https://registry.npmjs.org",
      package: "@kalada/projection",
      version: "0.1.0",
      status: "not-found",
      httpStatus: 404,
      capturedAt: captured.toISOString(),
      command:
        "npm view @kalada/projection@0.1.0 version --json " +
        "--registry=https://registry.npmjs.org",
      response: validResponse,
      responseSha256: hash(validResponse),
    },
  };
}

function correction(
  fix: Fixture,
  mutate?: (value: ExceptionRecord) => void,
  prepare?: () => void,
): string {
  write(fix.path, "packages/projection/src/index.ts", "export const projection = 2;\n");
  prepare?.();
  const value = record(fix, [fileDeclaration(fix, "packages/projection/src/index.ts")]);
  mutate?.(value);
  write(fix.path, "release-exceptions/projection.json", `${JSON.stringify(value, null, 2)}\n`);
  return commit(fix.path);
}

function validate(fix: Fixture, head: string): void {
  validateChangesetPolicy(fix.path, fix.base, head, "surikaterna/kalada", validationTime);
}

function changeset(name: string): string {
  return `---\n"${name}": major\n---\n\nNormal release change.\n`;
}

afterEach(async () => {
  await Promise.all(
    repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("unpublished-package correction schema v2", () => {
  it("accepts one exact package plus ordinary verification and a normal core Changeset", () => {
    const fix = fixture();
    write(fix.path, "scripts/projection-smoke.ts", "export const smoke = 2;\n");
    write(fix.path, "packages/core/src/index.ts", "export const core = 2;\n");
    write(fix.path, ".changeset/core.md", changeset("@kalada/core"));
    expect(() => validate(fix, correction(fix))).not.toThrow();
  });

  it("accepts explicit add, modification, and deletion declarations", () => {
    const fix = fixture();
    const head = correction(
      fix,
      (value) => {
        value.files.push(fileDeclaration(fix, "packages/projection/src/added.ts", "add"));
        value.files.push(fileDeclaration(fix, "packages/projection/src/removed.ts", "del"));
      },
      () => {
        write(fix.path, "packages/projection/src/added.ts", "export const added = true;\n");
        unlinkSync(join(fix.path, "packages/projection/src/removed.ts"));
      },
    );
    expect(() => validate(fix, head)).not.toThrow();
  });

  it.each([
    ["repository", (value: ExceptionRecord) => (value.repository = "other/repository")],
    [
      "authorization issue",
      (value: ExceptionRecord) =>
        (value.authorization.issueUrl = "https://github.com/other/repository/issues/44"),
    ],
    [
      "authorization base",
      (value: ExceptionRecord) => (value.authorization.baseCommit = "a".repeat(40)),
    ],
    [
      "review issue",
      (value: ExceptionRecord) =>
        (value.reviewIssueUrl = "https://github.com/other/repository/issues/45"),
    ],
    [
      "removal issue",
      (value: ExceptionRecord) =>
        (value.removalIssueUrl = "https://github.com/other/repository/issues/49"),
    ],
    ["package name", (value: ExceptionRecord) => (value.package.name = "@kalada/other")],
    ["package version", (value: ExceptionRecord) => (value.package.version = "0.1.1")],
    [
      "evidence package",
      (value: ExceptionRecord) => (value.registryEvidence.package = "@kalada/other"),
    ],
    ["evidence version", (value: ExceptionRecord) => (value.registryEvidence.version = "0.1.1")],
    [
      "response hash",
      (value: ExceptionRecord) => (value.registryEvidence.responseSha256 = "a".repeat(64)),
    ],
    ["file hash", (value: ExceptionRecord) => (firstFile(value).headSha256 = "a".repeat(64))],
    ["file status", (value: ExceptionRecord) => (firstFile(value).status = "add")],
    [
      "wildcard path",
      (value: ExceptionRecord) => (firstFile(value).path = "packages/projection/src/*.ts"),
    ],
    [
      "outside path",
      (value: ExceptionRecord) => (firstFile(value).path = "packages/core/src/index.ts"),
    ],
    ["unknown field", (value: ExceptionRecord) => (value.bypass = true)],
  ])("rejects mismatched %s", (_name, mutate) => {
    const fix = fixture();
    expect(() => validate(fix, correction(fix, mutate))).toThrow();
  });

  it.each([
    ["unpinned", "npm view @kalada/projection@0.1.0 version --json"],
    [
      "alternate registry",
      "npm view @kalada/projection@0.1.0 version --json --registry=https://example.invalid",
    ],
    ["noncanonical", "npm view latest"],
  ])("rejects %s registry evidence commands", (_name, command) => {
    const fix = fixture();
    const head = correction(fix, (value) => {
      value.registryEvidence.command = command;
    });
    expect(() => validate(fix, head)).toThrow(/schema|canonical/u);
  });

  it("rejects duplicate and undeclared file entries", () => {
    const fix = fixture();
    const duplicate = correction(fix, (value) => value.files.push({ ...firstFile(value) }));
    expect(() => validate(fix, duplicate)).toThrow(/declare every|Duplicate/u);

    const another = fixture();
    const undeclared = correction(another, undefined, () => {
      write(another.path, "packages/projection/src/extra.ts", "export {};\n");
    });
    expect(() => validate(another, undeclared)).toThrow(/declare every/u);
  });

  it.each([
    ["published response", JSON.stringify("0.1.0")],
    ["non-E404 error", JSON.stringify({ error: { code: "E500" } })],
    ["non-JSON response", "npm unavailable"],
  ])("rejects %s as absence evidence", (_name, response) => {
    const fix = fixture();
    const head = correction(fix, (value) => {
      value.registryEvidence.response = response;
      value.registryEvidence.responseSha256 = hash(response);
    });
    expect(() => validate(fix, head)).toThrow(/E404|unpublished/u);
  });

  it.each([
    ["before the base", "2025-12-31T23:59:59.000Z", "2026-01-01T00:30:00.000Z"],
    ["expired", "2026-01-02T00:00:00.000Z", "2026-01-02T01:00:00.000Z"],
    [
      "over 24 hours",
      new Date(validationTime).toISOString(),
      new Date(validationTime + 25 * 60 * 60 * 1000).toISOString(),
    ],
  ])("rejects evidence that is %s", (_name, capturedAt, expiresAt) => {
    const fix = fixture();
    const head = correction(fix, (value) => {
      value.registryEvidence.capturedAt = capturedAt;
      value.expiresAt = expiresAt;
    });
    expect(() => validate(fix, head)).toThrow(/after the PR base|stale|24 hours/u);
  });

  it("rejects evidence captured after the validation time", () => {
    const fix = fixture();
    const head = correction(fix, (value) => {
      value.registryEvidence.capturedAt = new Date(validationTime + 1).toISOString();
      value.expiresAt = new Date(validationTime + 60 * 60 * 1000).toISOString();
    });
    expect(() => validate(fix, head)).toThrow(/future/u);
  });

  it("rejects name or version changes in the package manifest", () => {
    for (const changed of [
      manifest("@kalada/other", "0.1.0"),
      manifest("@kalada/projection", "0.2.0"),
    ]) {
      const fix = fixture();
      const head = correction(fix, (value) => {
        write(fix.path, "packages/projection/package.json", changed);
        value.files.push(fileDeclaration(fix, "packages/projection/package.json"));
      });
      expect(() => validate(fix, head)).toThrow(/name|version/u);
    }
  });

  it("rejects multi-package and unnecessary exceptions", () => {
    const multiple = fixture();
    write(multiple.path, "packages/core/src/index.ts", "export const core = 2;\n");
    expect(() => validate(multiple, correction(multiple))).toThrow(/exactly one|One exception/u);

    const unnecessary = fixture();
    write(unnecessary.path, ".changeset/projection.md", changeset("@kalada/projection"));
    expect(() => validate(unnecessary, correction(unnecessary))).toThrow(/unnecessary/u);
  });

  it("rejects renames, symlinks, and binary package changes", () => {
    const renamed = fixture();
    const renameHead = correction(renamed, (value) => {
      run(renamed.path, "git", [
        "mv",
        "packages/projection/src/index.ts",
        "packages/projection/src/renamed.ts",
      ]);
      firstFile(value).path = "packages/projection/src/renamed.ts";
    });
    expect(() => validate(renamed, renameHead)).toThrow(/rename|unsupported|declare every/u);

    const linked = fixture();
    const linkHead = correction(linked, (value) => {
      unlinkSync(join(linked.path, "packages/projection/src/index.ts"));
      symlinkSync("removed.ts", join(linked.path, "packages/projection/src/index.ts"));
      firstFile(value).headSha256 = hash("removed.ts");
    });
    expect(() => validate(linked, linkHead)).toThrow(/Symlinks|unsupported/u);

    const binary = fixture();
    const binaryHead = correction(binary, (value) => {
      const bytes = Buffer.from([0, 1, 2]);
      write(binary.path, "packages/projection/src/index.ts", bytes);
      firstFile(value).headSha256 = hash(bytes);
    });
    expect(() => validate(binary, binaryHead)).toThrow(/Binary/u);
  });
});
