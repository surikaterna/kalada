import { writeFileSync } from "node:fs";
import { inspectArtifact } from "./artifact.js";
import { EXPECTED_INVENTORY, serializeInventory } from "./artifact-inventory.js";

const { inventory } = inspectArtifact(false);
writeFileSync(EXPECTED_INVENTORY, serializeInventory(inventory));
console.log(`Updated ${EXPECTED_INVENTORY}`);
