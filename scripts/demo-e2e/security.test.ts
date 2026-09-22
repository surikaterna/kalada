import ts from "typescript";
import { describe, expect, it } from "vitest";
import { assertJavaScriptSecurity } from "./security.js";
import { RuntimeAnalyzer } from "./security-analysis.js";

const SAFE_FIXTURES = [
  'import("./environment-Ab_12.js")',
  'import value from "./index-Ab_12.js"',
  'const local={fetch:"inert",label:"require",constructor:"data"}; local.label="sourceURL";',
  "const processState = 'browser'; typeof process;",
  "value instanceof Function; Function.prototype;",
  "const Function=class Local {}; new Function(); // eval and fetch are harmless comments",
  'class Store { require(uri){ return this.documents.get(uri) } read(){ return this.require("document") } }',
  "const message='fetch'; console.log('eval'); const data={label:'require'};",
  'try { throw 1 } catch (fetch) { fetch("local") }',
  'for (let fetch=()=>{}; false;) { fetch("local") }',
  'for (let fetch in {}) { fetch("local") }',
  'for (const fetch of [()=>{}]) { fetch("local") }',
  'switch (0) { case 0: const fetch=()=>{}; fetch("local"); break }',
  'if (false) { var fetch=()=>{} } fetch("local")',
  'for (var fetch=()=>{}; false;) {} fetch("local")',
  'function run(){ fetch("local"); function fetch(){} } run()',
  '(function fetch(){fetch("local")})()',
  'const C=class fetch { static run(){fetch("local")} }; C.run()',
  "setTimeout(()=>{},0)",
  "window.getComputedStyle({})",
  "new window.EditContext()",
  'const docs="fetch eval require Function"; console.log(docs)',
  "const cb=()=>{}; setTimeout.bind(globalThis,cb,0)()",
  "const cb=()=>{}; const alias=cb; setInterval(alias,0)",
  "const cb=()=>{}; setTimeout.call(globalThis,cb,0)",
  "const cb=()=>{}; setTimeout.apply(globalThis,[cb,0])",
  "const cb=(()=>{}).bind(null); setTimeout(cb,0)",
  "const box={cb:()=>{}}; setTimeout(box.cb,0)",
  "const callbacks=[()=>{}]; setTimeout(callbacks[0],0)",
  "const {cb}={cb:()=>{}}; setTimeout(cb,0)",
  "const [cb]=[()=>{}]; setTimeout(cb,0)",
  "navigator.scheduling.isInputPending()",
  'window.visualViewport?.addEventListener("resize",()=>{})',
  'const context=new window.EditContext(); context.addEventListener("textupdate",()=>{})',
  'const local={constructor:"data"}; local.constructor;',
  "const cb=()=>{}; const timer=setTimeout.bind(globalThis,cb,0); timer()",
  "const call=setTimeout.call; call(globalThis,()=>{},0)",
  "const apply=setInterval.apply; apply(globalThis,[()=>{},0])",
  "const bind=setTimeout.bind; const timer=bind(globalThis,()=>{},0); timer()",
  'const call=Reflect.get.call; call(Reflect,{value:"safe"},"value")',
  'const call=Object.getOwnPropertyDescriptor.call; call(Object,{value:"safe"},"value").value',
  'window.matchMedia(...["screen"])',
  'const args=["screen"]; window.matchMedia(...args)',
  'const call=window.matchMedia.call; call(window,"screen")',
  'const apply=window.matchMedia.apply; apply(window,["screen"])',
  "const bind=window.EditContext.bind; const Context=bind(window); new Context()",
  "setTimeout(...[()=>{},0])",
  'const name="ͼ", key=typeof Symbol>"u"?"__ͼ":Symbol.for(name), root=typeof globalThis<"u"?globalThis:window; root[key]=1',
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
  "try {} catch (fetch) {}; fetch('/x')",
  "for (let fetch=()=>{}; false;) {}; fetch('/x')",
  "for (let fetch in {}) {}; fetch('/x')",
  "for (const fetch of []) {}; fetch('/x')",
  "switch(0){case 0: let fetch=()=>{};} fetch('/x')",
  "{ const fetch=()=>{}; fetch('local') } fetch('/x')",
  "{ function fetch(){} fetch('local') } fetch('/x')",
  "{ class fetch{} } fetch('/x')",
  'globalThis.open("https://example.invalid")',
  'globalThis.location.assign("https://example.invalid")',
  'navigator.serviceWorker.register("/worker.js")',
  'globalThis.setTimeout("alert(1)",0)',
  'Object.constructor("return 1")()',
  'Object["constructor"]("return 1")()',
  'const O=Object; O.constructor("return 1")()',
  'Reflect.get(Object,"constructor")("return 1")()',
  'Object.getOwnPropertyDescriptor(Object,"constructor").value("return 1")()',
  'Object.constructor.call(null,"return 1")()',
  'Object.constructor.bind(null,"return 1")()()',
  "Object.constructor;",
  "Reflect.constructor;",
  "Object.assign.constructor;",
  'Object.assign.constructor("return 1")()',
  "Reflect.get.constructor;",
  "globalThis.constructor;",
  "setTimeout.constructor;",
  "(()=>{}).constructor;",
  'const local={constructor:"data"}; local.constructor()',
  'const local={constructor:"data"}; local.constructor.constructor("return 1")()',
  'const key=getKey(); const local={safe:()=>{}}; local[key].constructor("return 1")()',
  'setTimeout({value:"alert(1)"}.value,0)',
  'setTimeout(["alert(1)"][0],0)',
  'const {value:cb}={value:"alert(1)"}; setTimeout(cb,0)',
  'const code="alert(1)"; const cb={value:code}.value; setInterval(cb,0)',
  'const box={cb:()=>{},...{cb:"alert(1)"}}; setTimeout(box.cb,0)',
  'const key="cb"; const box={cb:()=>{},[key]:"alert(1)"}; setTimeout(box.cb,0)',
  "setTimeout(callbacks.current,0)",
  "const cb=getCallback(); setTimeout(cb,0)",
  "setTimeout(()=>globalThis,0)",
  "setTimeout(globalThis.open,0)",
  'navigator.serviceWorker.addEventListener("message",()=>{})',
  "navigator.serviceWorker.isInputPending()",
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
  'const open=globalThis.open; open.call(globalThis,"https://example.invalid")',
  'const open=globalThis.open; open("https://example.invalid")',
  'globalThis.open?.("https://example.invalid")',
  '(0,globalThis.open)("https://example.invalid")',
  'globalThis.open.apply(globalThis,["https://example.invalid"])',
  'globalThis.open.bind(globalThis)("https://example.invalid")',
  'new globalThis.open("https://example.invalid")',
  'globalThis.location["assign"]("https://example.invalid")',
  'navigator["serviceWorker"].register("/worker.js")',
  "globalThis.open`https://example.invalid`",
  "globalThis.getComputedStyle`body`",
  "new globalThis.getComputedStyle({})",
  "window.EditContext()",
  'const sw=navigator.serviceWorker; sw.addEventListener("message",()=>{})',
  'navigator.serviceWorker.addEventListener?.("message",()=>{})',
  'navigator.serviceWorker.addEventListener.call(navigator.serviceWorker,"message",()=>{})',
  'navigator.serviceWorker.addEventListener.apply(navigator.serviceWorker,["message",()=>{}])',
  'navigator.serviceWorker.addEventListener.bind(navigator.serviceWorker)("message",()=>{})',
  'const add=navigator.serviceWorker.addEventListener; add("message",()=>{})',
  "const scheduling=navigator.serviceWorker; scheduling.isInputPending()",
  "navigator.window.getComputedStyle({})",
  "navigator.serviceWorker.window.getComputedStyle({})",
  "new navigator.serviceWorker.window.EditContext()",
  'const call=Reflect.get.call; call(Reflect,globalThis,"Function")("return 1")()',
  'let call; call=Reflect.get.call; const alias=call; alias(Reflect,globalThis,"Function")("return 1")()',
  'const apply=Reflect.get.apply; apply(Reflect,[globalThis,"Function"])("return 1")()',
  'const bind=Reflect.get.bind; bind(Reflect,globalThis,"Function")()("return 1")()',
  'const call=Object.getOwnPropertyDescriptor.call; call(Object,globalThis,"Function").value("return 1")()',
  'const apply=Object.getOwnPropertyDescriptor.apply; apply(Object,[globalThis,"Function"]).value("return 1")()',
  'Reflect.apply(Reflect.get,Reflect,[globalThis,"Function"])("return 1")()',
  'const call=Reflect.construct.call; call(Reflect,Function,["return 1"])()',
  'const call=setTimeout.call; call(()=>{},"alert(1)",0)',
  'const apply=setTimeout.apply; apply(globalThis,["alert(1)",0])',
  'const bind=setTimeout.bind; bind(globalThis,"alert(1)",0)()',
  'const call=setInterval.call; call(globalThis,"alert(1)",0)',
  'const apply=setInterval.apply; const alias=apply; alias(globalThis,["alert(1)",0])',
  'let apply; apply=setInterval.apply; const alias=apply; alias(globalThis,["alert(1)",0])',
  "const apply=setTimeout.apply; apply(globalThis,[,0])",
  "const apply=setTimeout.apply; apply(globalThis,getArgs())",
  'const box={call:Reflect.get.call}; const {call}=box; call(Reflect,globalThis,"Function")("return 1")()',
  'const {call}=Reflect.get; call(Reflect,globalThis,"Function")("return 1")()',
  'const list=[setTimeout.apply]; const apply=list[0]; apply(globalThis,["alert(1)",0])',
  'const box={cb:()=>{}}; box.cb="alert(1)"; setTimeout(box.cb,0)',
  'const box={cb:()=>{}}; const cb=box.cb; box.cb="alert(1)"; setTimeout(cb,0)',
  'const box={cb:()=>{}}; const alias=box; alias.cb="alert(1)"; setTimeout(box.cb,0)',
  'const box={cb:()=>{}}; let alias; alias=box; alias.cb="alert(1)"; setTimeout(box.cb,0)',
  'const list=[()=>{}]; list[0]="alert(1)"; setTimeout(list[0],0)',
  'const list=[()=>{}]; let alias; alias=list; alias[0]="alert(1)"; setTimeout(list[0],0)',
  "const list=[()=>{}]; const cb=list[0]; delete list[0]; setTimeout(cb,0)",
  'const box={cb:()=>{}}; Object.assign(box,{cb:"alert(1)"}); setTimeout(box.cb,0)',
  'const box={cb:()=>{}}; Object.defineProperty(box,"cb",{value:"alert(1)"}); setTimeout(box.cb,0)',
  'const box={cb:()=>{}}; ({value:box.cb}={value:"alert(1)"}); setTimeout(box.cb,0)',
  'const box={cb:()=>{}}; ({...box.cb}={value:"alert(1)"}); setTimeout(box.cb,0)',
  'window.getComputedStyle=window.open; window.getComputedStyle("https://example.invalid")',
  'window["getComputedStyle"]=window.open; window.getComputedStyle("https://example.invalid")',
  'const host=window; host.getComputedStyle=window.open; host.getComputedStyle("https://example.invalid")',
  'window.getComputedStyle ||= window.open; window.getComputedStyle("https://example.invalid")',
  "delete window.getComputedStyle; window.getComputedStyle({})",
  "Object.assign(window,{getComputedStyle:window.open})",
  'Object.defineProperty(window,"getComputedStyle",{value:window.open})',
  'Reflect.set(window,"getComputedStyle",window.open)',
  'const call=Reflect.set.call; call(Reflect,window,"getComputedStyle",window.open)',
  'Reflect.defineProperty(window,"getComputedStyle",{value:window.open})',
  "const call=window.EditContext.call; call(window)",
  "const apply=window.EditContext.apply; apply(window,[])",
  "const bind=window.EditContext.bind; const Context=bind(window,1,2); new Context()",
  'function invoke(){return this.open}; const call=invoke.call; call(globalThis)("https://example.invalid")',
  'window.matchMedia(...["screen","extra"])',
  "const args=getArgs(); window.matchMedia(...args)",
  "window.matchMedia(...[,])",
  'window.matchMedia(..."screen")',
  'const invoke=(...args)=>window.matchMedia(...args); invoke("screen","extra")',
  'const apply=window.matchMedia.apply; apply(window,["screen","extra"])',
  "window.matchMedia()",
  "window.getComputedStyle()",
  "new window.EditContext(1,2)",
  'setTimeout("alert(1)",0)',
  'setTimeout?.("alert(1)",0)',
  '(0,setTimeout)("alert(1)",0)',
  'const timer=setTimeout; timer.call(globalThis,"alert(1)",0)',
  'setTimeout.apply(globalThis,["alert(1)",0])',
  'setTimeout.bind(globalThis,"alert(1)",0)()',
  "setTimeout`alert(1)`",
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

  it("rejects a timer closure beyond the inspection bound", () => {
    const source = `setTimeout(function(){/*${"x".repeat(1_001)}*/},0)`;
    expect(() => assertJavaScriptSecurity("oversized-timer.js", source)).toThrow(
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
