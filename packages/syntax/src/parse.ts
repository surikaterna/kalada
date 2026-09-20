import type { KaladaCstDocument } from "./cst-types.js";
import { diagnostic } from "./diagnostics.js";
import { deepFreeze, freezeRange } from "./freeze.js";
import { lex } from "./lexer.js";
import { DEFAULT_KALADA_SYNTAX_LIMITS, resolveSyntaxLimits } from "./limits.js";
import { Parser } from "./parser.js";
import type { KaladaParseOptions, KaladaParseResult, KaladaSyntaxLimits } from "./public-types.js";

const parseLimits = new WeakMap<KaladaParseResult, KaladaSyntaxLimits>();

export function parseKaladaV1Expression(
  source: string,
  options?: KaladaParseOptions,
): KaladaParseResult {
  if (typeof source !== "string") return invalidParseResult();
  let limits: KaladaSyntaxLimits | null;
  try {
    limits = resolveSyntaxLimits(options);
  } catch {
    limits = null;
  }
  if (limits === null) return invalidParseResult(source);
  const scanned = lex(source, limits);
  const parser = new Parser(scanned.tokens, limits, scanned.diagnostics);
  const document: KaladaCstDocument = {
    source,
    tokens: scanned.tokens,
    expression: parser.parse(),
  };
  const result = deepFreeze({ document, diagnostics: parser.sink.diagnostics });
  parseLimits.set(result, limits);
  return result;
}

function invalidParseResult(source = ""): KaladaParseResult {
  const range = freezeRange(0, source.length);
  const eof = Object.freeze({
    kind: "eof" as const,
    text: "",
    range: freezeRange(source.length, source.length),
  });
  const result: KaladaParseResult = deepFreeze({
    document: {
      source,
      tokens: [eof],
      expression: { kind: "error" as const, token: null, range },
    },
    diagnostics: [
      diagnostic(
        "parse",
        "KALADA_SYNTAX_INVALID_INPUT",
        "Kalada syntax input is invalid.",
        range,
        [],
      ),
    ],
  });
  parseLimits.set(result, DEFAULT_KALADA_SYNTAX_LIMITS);
  return result;
}

export function syntaxLimitsFor(parsed: KaladaParseResult): KaladaSyntaxLimits | null {
  return parseLimits.get(parsed) ?? null;
}
