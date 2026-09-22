import { describe, expect, it } from "vitest";
import { assertJavaScriptSecurity } from "./security.js";

describe("demo artifact security scan", () => {
  it("allows inert strings and property declarations", () => {
    expect(() =>
      assertJavaScriptSecurity(
        "safe.js",
        'const evidence={fetch:"not a call",process:"not a global"}; evidence.label="node:fs"; typeof process;',
      ),
    ).not.toThrow();
  });

  it.each([
    "fetch('/schema')",
    "globalThis.fetch('/schema')",
    "new Function('return 1')",
    "eval('1')",
    "require('fs')",
    "process.env.NODE_ENV",
    "navigator.sendBeacon('/source')",
    "new WebSocket('wss://example.invalid')",
  ])("rejects runtime primitive %s", (source) => {
    expect(() => assertJavaScriptSecurity("unsafe.js", source)).toThrow(
      /Forbidden runtime primitive/u,
    );
  });
});
