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
  'window.location="https://example.invalid"',
  'document.location="https://example.invalid"',
  'location="https://example.invalid"',
  'globalThis.location="/outside"',
  'self["location"]="/outside"',
  "top.location=nextLocation",
  'parent.location="https://example.invalid"',
  'window.location += "/outside"',
  "window.location=nextLocation",
  "++location",
  "({next:window.location}=source)",
  "[document.location]=source",
];

const SAFE_NAVIGATION_CONTROLS = [
  'const text="window.location=https://example.invalid"',
  'function keep(location){location="https://example.invalid"}',
  'let location="local"; location="https://example.invalid"',
  'const window={location:"local"}; window.location="https://example.invalid"',
  'const document={location:"local"}; document.location="/outside"',
  'const globalThis={location:"local"}; globalThis.location="/outside"',
  'const model={location:"local"}; model.location="https://example.invalid"',
  'const model={location:"https://example.invalid"}; model.location',
];

describe("bounded emitted JavaScript inventory", () => {
  it.each(FORBIDDEN_CANARIES)("rejects direct observed syntax %s", (source) => {
    expect(() => inventoryJavaScript("canary.js", source)).toThrow(/Forbidden observed syntax/u);
  });

  it.each(SAFE_NAVIGATION_CONTROLS)(
    "allows inert or lexically local location syntax %s",
    (source) => {
      expect(() => inventoryJavaScript("control.js", source)).not.toThrow();
    },
  );

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
