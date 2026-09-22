import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../..");
export const APP = resolve(ROOT, "apps/demo");
export const DIST = resolve(APP, "dist");
export const RESULTS = resolve(APP, "test-results/demo-e2e");
export const DEMO_BASE = "/kalada/";
export const PREVIEW_PORT = 4187;
export const LOCAL_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;

export function deployedUrl(): URL {
  const configured = process.env.DEMO_E2E_URL;
  if (!configured) throw new Error("DEMO_E2E_URL is required for deployed E2E");
  const url = new URL(configured);
  if (url.pathname !== DEMO_BASE || url.search || url.hash) {
    throw new Error(`DEMO_E2E_URL must target the canonical ${DEMO_BASE} route`);
  }
  return url;
}
