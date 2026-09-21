export interface PackageDependencyInput {
  readonly name: string;
  readonly version: string;
  readonly dependencies?: unknown;
  readonly allowedDependencies: readonly string[];
}

interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

function parseVersion(value: string, label: string): Version {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(value);
  if (!match) throw new Error(`${label} must be a stable semantic version; received ${value}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compare(left: Version, right: Version): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function caretUpperBound(version: Version): Version {
  if (version.major > 0) return { major: version.major + 1, minor: 0, patch: 0 };
  if (version.minor > 0) return { major: 0, minor: version.minor + 1, patch: 0 };
  return { major: 0, minor: 0, patch: version.patch + 1 };
}

function assertRangeIncludes(range: string, target: PackageDependencyInput): void {
  if (!range.startsWith("^")) {
    throw new Error(`${target.name} workspace dependency must use a canonical caret range`);
  }
  const minimum = parseVersion(range.slice(1), `${target.name} dependency range`);
  const version = parseVersion(target.version, `${target.name} version`);
  if (compare(version, minimum) < 0 || compare(version, caretUpperBound(minimum)) >= 0) {
    throw new Error(`${range} does not include packed ${target.name}@${target.version}`);
  }
}

function dependencyRecord(value: unknown, name: string): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} dependencies must be an object`);
  }
  const entries = Object.entries(value);
  if (entries.some(([, range]) => typeof range !== "string")) {
    throw new Error(`${name} dependency ranges must be strings`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export function assertDependencyPolicy(packages: readonly PackageDependencyInput[]): void {
  const packageByName = new Map(packages.map((item) => [item.name, item]));
  for (const item of packages) {
    const dependencies = dependencyRecord(item.dependencies, item.name);
    const actual = Object.keys(dependencies).sort();
    const allowed = [...item.allowedDependencies].sort();
    if (JSON.stringify(actual) !== JSON.stringify(allowed)) {
      throw new Error(`${item.name} dependencies must be exactly: ${allowed.join(", ") || "none"}`);
    }
    for (const name of allowed) {
      const target = packageByName.get(name);
      if (!target) throw new Error(`${item.name} dependency ${name} is not a packed workspace`);
      assertRangeIncludes(dependencies[name] ?? "", target);
    }
  }
}
