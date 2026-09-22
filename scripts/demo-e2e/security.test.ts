import ts from "typescript";
import { describe, expect, it } from "vitest";
import { assertJavaScriptSecurity } from "./security.js";
import { RuntimeAnalyzer } from "./security-analysis.js";

const SAFE_FIXTURES = [
  'import("./environment-Ab_12.js")',
  'import value from "./index-Ab_12.js"',
  'const local={label:"inert",constructor:"data"}; local.label="sourceURL";',
  "const processState = 'browser'; typeof process;",
  "value instanceof Function; Function.prototype;",
  "const Function=class Local {}; new Function(); // eval and fetch are harmless comments",
  'class Store { require(uri){ return this.documents.get(uri) } read(){ return this.require("document") } }',
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

const AUDITOR_REPROS = [
  `(true?globalThis:window)["Function"]("return 1")()`,
  `(globalThis||window)["eval"]("1")`,
  `[globalThis][0]["Function"]("return 1")()`,
  `(()=>globalThis)()["Function"]("return 1")()`,
  `const h=true?globalThis:window; h["Function"]("return 1")()`,
  `const R=Reflect; R.get(globalThis,"Function")("return 1")()`,
  `({Function:C}=globalThis); C("return 1")()`,
];

const FLOW_VARIANTS = [
  'const a=globalThis; const b=a; const c=b; c["Fun"+"ction"]("return 1")()',
  "let h; h=[window][0]; h[`Fun$" + '{"ction"}`]("return 1")()',
  'const h=(()=>{return self})(); h?.["eval"]?.("1")',
  'const R=(0,Reflect); R.get(globalThis,"Function")("return 1")()',
  "const R=true?Reflect:Reflect; const get=R[`g$" + '{"et"}`]; get(window,"eval")("1")',
  'const O=Object; O.getOwnPropertyDescriptor(globalThis,"Function").value("return 1")()',
  'const get=Object.getOwnPropertyDescriptor; get(window,"eval").value("1")',
  'const get=Reflect.get.bind(Reflect); get(globalThis,"Function")("return 1")()',
  'Reflect.get.apply(Reflect,[globalThis,"eval"])("1")',
  'const h=globalThis; new h["Fun".concat("ction")]("return 1")',
  'let C; ({["Fun"+"ction"]:C}=globalThis); C("return 1")()',
  'const host=((value)=>value)(globalThis); host["Function"]("return 1")()',
];

const FINAL_AUDITOR_REPROS = [
  `const id=x=>x; id(globalThis)["Function"]("return 1")()`,
  `function id(x){return x}; id(globalThis)["Function"]("return 1")()`,
  `const h=globalThis; const get=()=>h; get()["Function"]("return 1")()`,
  `const wrap=x=>()=>x; wrap(globalThis)()["Function"]("return 1")()`,
  `const h=alias; const alias=globalThis; h["Function"]("return 1")()`,
  `let a,b; a=b; b=globalThis; a["Function"]("return 1")()`,
  `function outer(){const h=globalThis; return ()=>h} outer()()["Function"]("return 1")()`,
];

const FINAL_FLOW_VARIANTS = [
  'let a,b,c; a=b; b=c; c=a; c=globalThis; a[key]("x")',
  'function pick({host=globalThis}={}){return host}; pick()[key]("x")',
  'const pass=(first=globalThis,...rest)=>first; pass()[key]("x")',
  'hoisted(globalThis)[key]("x"); function hoisted(value){return value}',
  'const get=()=>captured; const captured=globalThis; get()[key]("x")',
  'async function identity(value){return value}; identity(globalThis)[key]("x")',
  'function* identity(value){return yield value}; identity(globalThis)[key]("x")',
  'const key="\\u0046unction"; globalThis[key]("return 1")()',
  'function recursive(value){return recursive(value)}; recursive(globalThis)[key]("x")',
  "const key=getKey(); globalThis.location[key]",
];

describe("demo artifact security scan", () => {
  it("allows inert strings and property declarations", () => {
    expect(() =>
      assertJavaScriptSecurity(
        "safe.js",
        'const evidence={label:"not a call",runtime:"not a global"}; evidence.label="browser-only"; typeof process;',
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

  it.each(AUDITOR_REPROS)("rejects exact auditor host-flow repro %s", (source) => {
    expect(() => assertJavaScriptSecurity("auditor-repro.js", source)).toThrow(
      /Forbidden runtime primitive/u,
    );
  });

  it.each(FLOW_VARIANTS)("rejects adversarial host-flow variant %s", (source) => {
    expect(() => assertJavaScriptSecurity("flow-variant.js", source)).toThrow(
      /Forbidden runtime primitive/u,
    );
  });

  it.each(FINAL_AUDITOR_REPROS)("rejects exact final auditor repro %s", (source) => {
    expect(() => assertJavaScriptSecurity("final-auditor-repro.js", source)).toThrow(
      /Forbidden runtime primitive/u,
    );
  });

  it.each(FINAL_FLOW_VARIANTS)("rejects final adversarial flow variant %s", (source) => {
    expect(() => assertJavaScriptSecurity("final-flow-variant.js", source)).toThrow(
      /Forbidden runtime primitive/u,
    );
  });

  it.each([
    "const Function=class Local {}; new Function();",
    "function eval(value){return value}; eval(1)",
    "const fetch=(value)=>value; fetch('local')",
  ])("allows lexically shadowed harmless global name %s", (source) => {
    expect(() => assertJavaScriptSecurity("shadowed.js", source)).not.toThrow();
  });

  it("fails closed when the bounded analysis work cap is exhausted", () => {
    const file = ts.createSourceFile("capped.js", "const safe = 1;", ts.ScriptTarget.ESNext, true);
    const analyzer = new RuntimeAnalyzer(file, 1);
    analyzer.scan();
    expect([...analyzer.failures]).toContain("analysis work cap exhausted");
  });
});
