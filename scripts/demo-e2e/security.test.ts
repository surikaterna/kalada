import { describe, expect, it } from "vitest";
import { assertJavaScriptSecurity } from "./security.js";

const SAFE_FIXTURES = [
  'import("./environment-Ab_12.js")',
  'import value from "./index-Ab_12.js"',
  'const local={fetch:"inert",constructor:"data"}; local.label="sourceURL";',
  "const processState = 'browser'; typeof process;",
  "value instanceof Function; Function.prototype; store.require('document');",
];

const FORBIDDEN_FIXTURES = [
  "fetch('/schema')",
  "globalThis.fetch('/schema')",
  'globalThis["fetch"]("/schema")',
  'window["fe" + "tch"]("/schema")',
  "self[`fe$" + '{"t"}ch`]("/schema")',
  'globalThis["fe".concat("tch")]("/schema")',
  "globalThis[key]('/schema')",
  "globalThis?.fetch?.('/schema')",
  'window?.["fetch"]?.("/schema")',
  "const host=globalThis; host[key]('/schema')",
  "const host=window; host.fetch('/schema')",
  "const {fetch: request}=globalThis; request('/schema')",
  "const {Function: C}=globalThis; C('return 1')()",
  "Reflect.get(globalThis, key)('/schema')",
  'Object.getOwnPropertyDescriptor(window,"fetch").value("/schema")',
  "new Function('return 1')",
  'globalThis["Function"]("return 1")()',
  'window["Fun" + "ction"]("return 1")()',
  'global["eval"]("1")',
  "eval('1')",
  "(0,eval)('1')",
  "eval.call(null,'1')",
  "const execute=eval; execute('1')",
  "Reflect.construct(Function,['return 1'])()",
  "(()=>{}).constructor('return 1')()",
  "(()=>{}).constructor.call(null,'return 1')()",
  "const C=(()=>{}).constructor; C('return 1')()",
  "({}).constructor.constructor('return 1')()",
  "Reflect.get(()=>{},'constructor')('return 1')()",
  "require('fs')",
  "require?.('node:fs')",
  "import('node:fs')",
  "import(moduleName)",
  "process.env.NODE_ENV",
  "navigator.sendBeacon('/source')",
  'navigator["send" + "Beacon"]("/source")',
  "new WebSocket('wss://example.invalid')",
  'new self["EventSource"]("https://example.invalid")',
  'new window["XML" + "HttpRequest"]()',
];

describe("demo artifact security scan", () => {
  it("allows inert strings and property declarations", () => {
    expect(() =>
      assertJavaScriptSecurity(
        "safe.js",
        'const evidence={fetch:"not a call",process:"not a global"}; evidence.label="node:fs"; typeof process;',
      ),
    ).not.toThrow();
  });

  it.each(SAFE_FIXTURES)("allows bundled or inert syntax %s", (source) => {
    expect(() => assertJavaScriptSecurity("safe.js", source)).not.toThrow();
  });

  it.each(FORBIDDEN_FIXTURES)("rejects runtime primitive %s", (source) => {
    expect(() => assertJavaScriptSecurity("unsafe.js", source)).toThrow(
      /Forbidden runtime primitive/u,
    );
  });
});
