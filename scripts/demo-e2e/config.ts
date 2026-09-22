import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../..");
export const APP = resolve(ROOT, "apps/demo");
export const DIST = resolve(APP, "dist");
export const RESULTS = resolve(APP, "test-results/demo-e2e");
export const DEMO_BASE = "/kalada/";
export const CANONICAL_DEMO_URL = "https://surikaterna.github.io/kalada/";
export const PREVIEW_PORT = 4187;
export const LOCAL_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;

export function deployedUrl(): URL {
  return parseDeployedUrl(process.env.DEMO_E2E_URL);
}

export function parseDeployedUrl(configured: string | undefined): URL {
  if (!configured) throw new Error("DEMO_E2E_URL is required for deployed E2E");
  if (configured !== CANONICAL_DEMO_URL) {
    throw new Error(`DEMO_E2E_URL must equal ${CANONICAL_DEMO_URL}`);
  }
  return new URL(CANONICAL_DEMO_URL);
}
