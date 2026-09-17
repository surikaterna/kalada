import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateChangesetPolicy } from "../scripts/changeset-policy/validate.js";

type Fixture = { base: string; path: string };
type RecordValue = Record<string, unknown>;
type MutableException = RecordValue & {
  baseCommit: string;
  files: Array<RecordValue & { changeClass: string; headSha256: string; path: string }>;
  issue: string;
  observedRegistryEvidence: RecordValue & {
    capturedAt: string;
    command: string;
    package: string;
    responseSha256: string;
    version: string;
  };
  package: RecordValue & { headManifestSha256: string };
  repository: string;
};
const repositories: string[] = [];

function command(repository: string, commandName: string, args: string[]): string {
  return execFileSync(commandName, args, {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();
}

function write(repository: string, path: string, value: string | Buffer): void {
  const fullPath = join(repository, path);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, value);
}

function commit(repository: string, message = "test"): string {
  command(repository, "git", ["add", "-A"]);
  command(repository, "git", ["commit", "-m", message]);
  return command(repository, "git", ["rev-parse", "HEAD"]);
}

function fixture(): Fixture {
  const path = mkdtempSync(join(tmpdir(), "kalada-policy-"));
  repositories.push(path);
  command(path, "git", ["init", "-q"]);
  write(path, "package.json", '{"private":true}\n');
  write(path, "packages/core/package.json", `${JSON.stringify(baseManifest(), null, 2)}\n`);
  write(path, "packages/core/src/index.ts", "export const value = 1;\n");
  write(path, "packages/core/src/index.test.ts", "test('value', () => {});\n");
  write(path, "scripts/package-smoke.ts", "export const expected = true;\n");
  write(path, "scripts/internal.ts", "export const internal = true;\n");
  write(path, ".changeset/config.json", "{}\n");
  write(path, ".changeset/existing.md", changeset("@other/package"));
  write(path, "release-exceptions/existing.json", "{}\n");
  return { path, base: commit(path, "base") };
}

function baseManifest(): RecordValue {
  return {
    name: "@kalada/core",
    version: "0.1.0",
    type: "module",
    exports: { ".": "./dist/index.js" },
    files: ["dist", "README.md"],
    publishConfig: { access: "public" },
    dependencies: { example: "1.0.0" },
    scripts: { build: "tsup" },
    engines: { node: ">=22" },
  };
}

function changeset(packageName = "@kalada/core"): string {
  return `---\n"${packageName}": patch\n---\n\nDescribe the package change.\n`;
}

function hash(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validException(fix: Fixture, mutate?: (record: MutableException) => void): string {
  const manifestPath = "packages/core/package.json";
  const verificationPath = "scripts/package-smoke.ts";
  const beforeManifest = readFileSync(join(fix.path, manifestPath));
  const beforeVerification = readFileSync(join(fix.path, verificationPath));
  const manifest = { ...baseManifest(), repository: repositoryValue() };
  const afterManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  const afterVerification =
    "export const expectedRepository = 'https://github.com/surikaterna/kalada';\n";
  const registryResponse = '{"error":"Not found"}';
  write(fix.path, manifestPath, afterManifest);
  write(fix.path, verificationPath, afterVerification);
  const record: MutableException = {
    schemaVersion: 1,
    exceptionClass: "already-versioned-unpublished-correction",
    issue: "https://github.com/surikaterna/kalada/issues/3",
    repository: "surikaterna/kalada",
    baseCommit: fix.base,
    package: {
      name: "@kalada/core",
      path: manifestPath,
      version: "0.1.0",
      baseManifestSha256: hash(beforeManifest),
      headManifestSha256: hash(afterManifest),
      repository: repositoryValue(),
    },
    files: [
      {
        path: manifestPath,
        changeClass: "package-manifest-repository",
        baseSha256: hash(beforeManifest),
        headSha256: hash(afterManifest),
      },
      {
        path: verificationPath,
        changeClass: "package-verification",
        baseSha256: hash(beforeVerification),
        headSha256: hash(afterVerification),
      },
    ],
    observedRegistryEvidence: {
      registry: "https://registry.npmjs.org",
      package: "@kalada/core",
      version: "0.1.0",
      status: "not-found",
      httpStatus: 404,
      capturedAt: "2026-09-17T12:00:00Z",
      command: "npm view @kalada/core@0.1.0 version --json",
      response: registryResponse,
      responseSha256: hash(registryResponse),
    },
  };
  mutate?.(record);
  write(fix.path, "release-exceptions/issue-3.json", `${JSON.stringify(record, null, 2)}\n`);
  return commit(fix.path);
}

function repositoryValue(): RecordValue {
  return { type: "git", url: "https://github.com/surikaterna/kalada", directory: "packages/core" };
}

function exceptionFile(record: MutableException, index: number): MutableException["files"][number] {
  const file = record.files[index];
  if (!file) throw new Error(`Missing fixture exception file ${index}`);
  return file;
}

function validate(fix: Fixture, head: string): void {
  validateChangesetPolicy(fix.path, fix.base, head, "surikaterna/kalada");
}

afterEach(async () => {
  await Promise.all(
    repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("ordinary Changeset policy", () => {
  it("accepts a non-empty Changeset for a package change", () => {
    const fix = fixture();
    write(fix.path, "packages/core/src/index.ts", "export const value = 2;\n");
    write(fix.path, ".changeset/valid.md", changeset());
    expect(() => validate(fix, commit(fix.path))).not.toThrow();
  });

  it("accepts the canonical YAML comment syntax from the Auditor probe", () => {
    const fix = fixture();
    write(fix.path, "packages/core/src/index.ts", "export const value = 2;\n");
    write(
      fix.path,
      ".changeset/comment.md",
      '---\n# valid YAML comment\n"@kalada/core": patch\n---\n\nValid with frontmatter comment.\n',
    );
    expect(() => validate(fix, commit(fix.path))).not.toThrow();
  });

  it.each([
    ['\n"@kalada/core": minor\n', "Blank YAML lines."],
    ['"@kalada/core": patch # inline YAML comment\n', "Inline YAML comment."],
    ['"@kalada/core": none\n', "Canonical none release type."],
  ])("accepts representative canonical frontmatter %#", (frontmatter, summary) => {
    const fix = fixture();
    write(fix.path, "packages/core/src/index.ts", "export const value = 2;\n");
    write(fix.path, ".changeset/parity.md", `---\n${frontmatter}---\n\n${summary}\n`);
    expect(() => validate(fix, commit(fix.path))).not.toThrow();
  });

  it("accepts internal, documentation, CI, and test-only changes", () => {
    const fix = fixture();
    write(fix.path, "docs/policy.md", "Policy.\n");
    write(fix.path, ".github/workflows/extra.yml", "name: Extra\n");
    write(fix.path, "scripts/internal.ts", "export {};\n");
    write(fix.path, "packages/core/src/index.test.ts", "test('changed', () => {});\n");
    expect(() => validate(fix, commit(fix.path))).not.toThrow();
  });

  it("accepts the exact closed release exception", () => {
    const fix = fixture();
    expect(() => validate(fix, validException(fix))).not.toThrow();
  });

  it("rejects a package change without a Changeset", () => {
    const fix = fixture();
    write(fix.path, "packages/core/src/index.ts", "export const value = 2;\n");
    expect(() => validate(fix, commit(fix.path))).toThrow(/Missing Changeset/u);
  });

  it("rejects a Changeset declaring only an unknown workspace package", () => {
    const fix = fixture();
    write(fix.path, ".changeset/unknown.md", changeset("@bogus/pkg"));
    expect(() => validate(fix, commit(fix.path))).toThrow(/not in the publishable workspace/u);
  });

  it("rejects mixed real and unknown workspace package declarations", () => {
    const fix = fixture();
    write(fix.path, "packages/core/src/index.ts", "export const value = 2;\n");
    write(
      fix.path,
      ".changeset/mixed.md",
      '---\n"@kalada/core": patch\n"@bogus/pkg": patch\n---\n\nMixed declarations.\n',
    );
    expect(() => validate(fix, commit(fix.path))).toThrow(/@bogus\/pkg.*not in/u);
  });

  it("rejects an empty Changeset", () => {
    const fix = fixture();
    write(fix.path, ".changeset/empty.md", "---\n\n---\n\nNo bump.\n");
    expect(() => validate(fix, commit(fix.path))).toThrow(/must not be empty/u);
  });

  it.each([
    [
      "repository",
      (record: MutableException) => {
        record.repository = "other/repository";
      },
    ],
    [
      "issue",
      (record: MutableException) => {
        record.issue = "https://github.com/other/repository/issues/3";
      },
    ],
    [
      "base commit",
      (record: MutableException) => {
        record.baseCommit = "b".repeat(40);
      },
    ],
    [
      "manifest hash",
      (record: MutableException) => {
        record.package.headManifestSha256 = "b".repeat(64);
      },
    ],
    [
      "file hash",
      (record: MutableException) => {
        exceptionFile(record, 1).headSha256 = "b".repeat(64);
      },
    ],
    [
      "evidence package",
      (record: MutableException) => {
        record.observedRegistryEvidence.package = "@kalada/other";
      },
    ],
    [
      "evidence version",
      (record: MutableException) => {
        record.observedRegistryEvidence.version = "0.1.1";
      },
    ],
    [
      "evidence command",
      (record: MutableException) => {
        record.observedRegistryEvidence.command = "npm view latest";
      },
    ],
    [
      "evidence response hash",
      (record: MutableException) => {
        record.observedRegistryEvidence.responseSha256 = "b".repeat(64);
      },
    ],
    [
      "change class",
      (record: MutableException) => {
        exceptionFile(record, 1).changeClass = "package-manifest-repository";
      },
    ],
    [
      "unknown schema field",
      (record: MutableException) => {
        record.skip = true;
      },
    ],
  ])("rejects exception with invalid %s", (_name, mutate) => {
    const fix = fixture();
    expect(() => validate(fix, validException(fix, mutate))).toThrow();
  });

  it.each(["2026-13-01T00:00:00Z", "2025-02-29T00:00:00Z", "2026-01-01T24:00:00Z"])(
    "rejects invalid registry evidence calendar value %s",
    (capturedAt) => {
      const fix = fixture();
      const head = validException(fix, (record) => {
        record.observedRegistryEvidence.capturedAt = capturedAt;
      });
      expect(() => validate(fix, head)).toThrow(/timestamp|schema/u);
    },
  );

  it.each(["2024-02-29T23:59:59Z", "2000-02-29T00:00:00.123456789Z"])(
    "accepts valid UTC RFC3339 edge %s",
    (capturedAt) => {
      const fix = fixture();
      const head = validException(fix, (record) => {
        record.observedRegistryEvidence.capturedAt = capturedAt;
      });
      expect(() => validate(fix, head)).not.toThrow();
    },
  );

  it("rejects a manifest change beyond repository", () => {
    const fix = fixture();
    const head = validException(fix, (record) => {
      const manifest = { ...baseManifest(), version: "0.1.1", repository: repositoryValue() };
      const text = `${JSON.stringify(manifest, null, 2)}\n`;
      write(fix.path, "packages/core/package.json", text);
      record.package.headManifestSha256 = hash(text);
      exceptionFile(record, 0).headSha256 = hash(text);
    });
    expect(() => validate(fix, head)).toThrow(/name and version|Only the manifest/u);
  });

  it("rejects a broad script classified as package verification", () => {
    const fix = fixture();
    const head = validException(fix, (record) => {
      const before = "export const internal = true;\n";
      const after = "export const internal = false;\n";
      write(fix.path, "scripts/package-smoke.ts", "export const expected = true;\n");
      write(fix.path, "scripts/internal.ts", after);
      const declaration = exceptionFile(record, 1);
      declaration.path = "scripts/internal.ts";
      declaration.baseSha256 = hash(before);
      declaration.headSha256 = hash(after);
    });
    expect(() => validate(fix, head)).toThrow(/package-verification/u);
  });

  it("rejects an undeclared changed file", () => {
    const fix = fixture();
    const head = validException(fix, () => write(fix.path, "README.md", "extra\n"));
    expect(() => validate(fix, head)).toThrow(/declare every changed file/u);
  });

  it("rejects added or renamed exception files", () => {
    const fix = fixture();
    const head = validException(fix, (record) => {
      command(fix.path, "git", ["mv", "scripts/package-smoke.ts", "scripts/renamed.ts"]);
      exceptionFile(record, 1).path = "scripts/renamed.ts";
    });
    expect(() => validate(fix, head)).toThrow(
      /declare every changed file|added, deleted, or renamed/u,
    );
  });

  it("rejects binary exception changes", () => {
    const fix = fixture();
    const head = validException(fix, (record) => {
      const bytes = Buffer.from([0, 1, 2]);
      write(fix.path, "scripts/package-smoke.ts", bytes);
      exceptionFile(record, 1).headSha256 = hash(bytes);
    });
    expect(() => validate(fix, head)).toThrow(/Binary/u);
  });

  it("rejects symlink exception changes", () => {
    const fix = fixture();
    const head = validException(fix, (record) => {
      write(fix.path, "scripts/target.ts", "target\n");
      command(fix.path, "rm", ["scripts/package-smoke.ts"]);
      symlinkSync("target.ts", join(fix.path, "scripts/package-smoke.ts"));
      record.files.push({
        path: "scripts/target.ts",
        changeClass: "package-verification",
        baseSha256: "a".repeat(64),
        headSha256: hash("target\n"),
      });
    });
    expect(() => validate(fix, head)).toThrow(
      /unsupported change|added, deleted, or renamed|Symlinks/u,
    );
  });

  it("rejects edits and deletions of existing records and Changesets", () => {
    const fix = fixture();
    write(fix.path, "release-exceptions/existing.json", '{"edited":true}\n');
    command(fix.path, "rm", [".changeset/existing.md"]);
    expect(() => validate(fix, commit(fix.path))).toThrow(/changeset|Changeset|immutable/u);
  });

  it("rejects multiple or unnecessary exception records", () => {
    const fix = fixture();
    write(fix.path, "release-exceptions/one.json", "{}\n");
    write(fix.path, "release-exceptions/two.json", "{}\n");
    expect(() => validate(fix, commit(fix.path))).toThrow(/Only one/u);
  });
});
