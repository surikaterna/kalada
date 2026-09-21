import type { PackagePolicy } from "./types.js";

const rootExport = {
  import: { types: "./dist/index.d.ts", default: "./dist/index.js" },
  require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
};

const runtimeFiles = [
  "dist/index.cjs",
  "dist/index.cjs.map",
  "dist/index.d.cts",
  "dist/index.d.ts",
  "dist/index.js",
] as const;

const dualRuntimeFiles = [...runtimeFiles, "dist/index.js.map"] as const;
const coreDependency = { "@kalada/core": "^0.5.0" } as const;
const coreImports = {
  "dist/index.js": ["./index.cjs"],
  "dist/index.cjs": [],
} as const;
const dependentImports = {
  "dist/index.js": ["@kalada/core"],
  "dist/index.cjs": ["@kalada/core"],
} as const;

export const packagePolicies: readonly PackagePolicy[] = [
  {
    workspace: "@kalada/core",
    filesField: ["dist", "provenance", "README.md", "THIRD_PARTY_NOTICES.md"],
    packedFiles: [
      "README.md",
      "THIRD_PARTY_NOTICES.md",
      ...runtimeFiles,
      "package.json",
      "provenance/kuery-2.1.0.json",
    ],
    exports: { ".": rootExport, "./package.json": "./package.json" },
    dependencies: {},
    runtimeImports: coreImports,
  },
  {
    workspace: "@kalada/syntax",
    filesField: ["dist", "README.md"],
    packedFiles: ["README.md", ...dualRuntimeFiles, "package.json"],
    exports: { ".": rootExport, "./package.json": "./package.json" },
    dependencies: coreDependency,
    runtimeImports: dependentImports,
  },
  {
    workspace: "@kalada/projection",
    filesField: ["dist", "projection-v1.schema.json", "README.md"],
    packedFiles: ["README.md", ...dualRuntimeFiles, "package.json", "projection-v1.schema.json"],
    exports: {
      ".": rootExport,
      "./projection-v1.schema.json": {
        import: "./projection-v1.schema.json",
        default: "./projection-v1.schema.json",
      },
      "./package.json": "./package.json",
    },
    dependencies: coreDependency,
    runtimeImports: dependentImports,
  },
];
