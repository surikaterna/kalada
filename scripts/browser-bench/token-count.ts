const source = process.argv[2];
const { lex } = await import(`${source}/packages/syntax/src/lexer.ts`);
const { DEFAULT_KALADA_SYNTAX_LIMITS: limits } = await import(
  `${source}/packages/syntax/src/limits.ts`
);
const texts = JSON.parse(await Bun.stdin.text()) as string[];
console.log(
  JSON.stringify(
    texts.map((text) => {
      const result = lex(text, limits);
      return {
        tokensIncludingTriviaAndEof: result.tokens.length,
        tokensExcludingTriviaAndEof: result.tokens.filter(
          (token) => !["whitespace", "comment", "eof"].includes(token.kind),
        ).length,
        lexDiagnostics: result.diagnostics.map((diagnostic) => diagnostic.code),
        syntaxLimits: limits,
      };
    }),
  ),
);
