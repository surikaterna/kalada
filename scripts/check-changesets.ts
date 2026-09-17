import { resolve } from "node:path";
import { validateChangesetPolicy } from "./changeset-policy/validate.js";

const [base, head, repositoryName, repository = process.cwd()] = process.argv.slice(2);
if (!base || !head || !repositoryName) {
  console.error(
    "Usage: bun run changeset:check -- <base-sha> <head-sha> <owner/repository> [path]",
  );
  process.exit(2);
}

try {
  validateChangesetPolicy(resolve(repository), base, head, repositoryName);
  console.log(`Changeset policy validated for ${base}..${head}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
