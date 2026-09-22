import { describe, expect, it } from "vitest";
import { inventoryJavaScript } from "./capability-inventory.js";

const FORBIDDEN_CANARIES = [
  'eval("1")',
  'Function("return 1")()',
  'new Function("return 1")',
  'globalThis.Function("return 1")()',
  'window.eval("1")',
  '(()=>{}).constructor("return 1")()',
  '({}).constructor.constructor("return 1")()',
  'import "node:fs"',
  'import("fs")',
  'import("/asset.js")',
  'require("node:path")',
  "process.env.NODE_ENV",
  "globalThis.process.env.NODE_ENV",
  'Bun.file("secret")',
  'Deno.readTextFile("secret")',
  'fetch("/schema")',
  'globalThis.fetch("/schema")',
  "new XMLHttpRequest()",
  'new WebSocket("wss://example.invalid")',
  'new EventSource("https://example.invalid")',
  'navigator.sendBeacon("/result")',
  'navigator.serviceWorker.register("/worker.js")',
  'anchor.href="https://example.invalid"',
  'element.setAttribute("src","/asset.js")',
  "window.fetch=localFetch",
  "navigator.sendBeacon=localBeacon",
];

describe("bounded emitted JavaScript inventory", () => {
  it.each(FORBIDDEN_CANARIES)("rejects direct observed syntax %s", (source) => {
    expect(() => inventoryJavaScript("canary.js", source)).toThrow(/Forbidden observed syntax/u);
  });

  it("normalizes observed imports, capabilities, and inert URL identifiers", () => {
    const inventory = inventoryJavaScript(
      "asset.js",
      'import value from "./shared-A1.js"; import("./lazy-B2.js"); typeof process; value instanceof Function; URL.createObjectURL(new Blob()); "https://json-schema.org/schema";',
    );
    expect(inventory).toEqual({
      imports: [
        { name: "dynamic:./lazy-B2.js", count: 1 },
        { name: "static:./shared-A1.js", count: 1 },
      ],
      capabilities: [
        { name: "identifier:Blob", count: 1 },
        { name: "identifier:Function", count: 1 },
        { name: "identifier:URL", count: 1 },
        { name: "member:createObjectURL", count: 1 },
        { name: "node-probe:typeof process", count: 1 },
      ],
      urlLiterals: [{ name: "foreign:https://json-schema.org/schema", count: 1 }],
    });
  });
});
