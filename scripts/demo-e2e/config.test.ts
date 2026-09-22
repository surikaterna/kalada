import { describe, expect, it } from "vitest";
import { CANONICAL_DEMO_URL, parseDeployedUrl } from "./config.js";

describe("deployed demo URL", () => {
  it("accepts only the exact canonical Pages URL", () => {
    expect(parseDeployedUrl(CANONICAL_DEMO_URL).href).toBe(CANONICAL_DEMO_URL);
  });

  it.each([
    undefined,
    "http://surikaterna.github.io/kalada/",
    "https://example.invalid/kalada/",
    "https://surikaterna.github.io:443/kalada/",
    "https://surikaterna.github.io:444/kalada/",
    "https://user@surikaterna.github.io/kalada/",
    "https://surikaterna.github.io/kalada",
    "https://surikaterna.github.io/kalada/extra",
    "https://surikaterna.github.io/kalada/?query=1",
    "https://surikaterna.github.io/kalada/#fragment",
    "https://SURIKATERNA.github.io/kalada/",
    " https://surikaterna.github.io/kalada/",
  ])("rejects noncanonical deployed target %s", (value) => {
    expect(() => parseDeployedUrl(value)).toThrow(/DEMO_E2E_URL/u);
  });
});
