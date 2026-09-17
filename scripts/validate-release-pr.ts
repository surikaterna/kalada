import { resolve } from "node:path";
import { validateReleaseIntegrity } from "./release-integrity.js";

const base = process.argv[2];
const repository = process.argv[3] ?? ".";

if (!base) throw new Error("Usage: bun scripts/validate-release-pr.ts <base> [repository]");

validateReleaseIntegrity(resolve(repository), base);
console.log(`Release integrity validated against ${base}`);
