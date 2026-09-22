import { runDemoE2E } from "./demo-e2e/runner.js";

await runDemoE2E(process.argv.includes("--deployed"));
