import { describe, expect, it } from "vitest";
import { composeToyHost } from "./composition-boundary-spike.js";

const slot = (source: string, budget = 256) =>
  composeToyHost(source, source.indexOf("@expr{") + 5, budget);

describe("explicit toy host / real Expressions boundary", () => {
  it("shields quoted closing delimiters and escapes, then returns to trailing host text", () => {
    const source = String.raw`@expr{"a\"}b"}|tail} is host text`;
    expect(slot(source)).toEqual({
      status: "supported",
      opening: { start: 5, end: 6 },
      guest: { start: 6, end: 13 },
      closing: { start: 13, end: 14 },
      continuation: { start: 14, end: 15 },
      tail: { start: 15, end: source.length },
    });
    expect(source.slice(15)).toBe("tail} is host text");
  });

  it("tracks balanced parentheses and UTF-16 parent offsets across CRLF and astral text", () => {
    const source = '🌙\r\n@expr{("🌟}" + (value * 2))}|after';
    const result = slot(source);
    expect(result).toEqual({
      status: "supported",
      opening: { start: 9, end: 10 },
      guest: { start: 10, end: 31 },
      closing: { start: 31, end: 32 },
      continuation: { start: 32, end: 33 },
      tail: { start: 33, end: source.length },
    });
    if (result.status === "supported") {
      expect(source.slice(result.guest.start, result.guest.end)).toBe('("🌟}" + (value * 2))');
      expect(source.slice(result.tail.start)).toBe("after");
    }
  });

  it("rejects missing declaration, wrong position, missing or ambiguous close", () => {
    expect(slot("@other{value}|tail")).toMatchObject({ status: "invalid" });
    expect(composeToyHost("@expr{value}|tail", 0, 256)).toMatchObject({ status: "invalid" });
    expect(slot("@expr{value|tail")).toMatchObject({ status: "invalid" });
    expect(slot("@expr{value}}|tail")).toMatchObject({ status: "invalid" });
    expect(slot("@expr{value}tail")).toMatchObject({ status: "invalid" });
  });

  it("does not publish partial, empty or malformed guest parses", () => {
    for (const source of [
      "@expr{}|tail",
      "@expr{   }|tail",
      "@expr{value +}|tail",
      "@expr{a b}|tail",
      "@expr{a)}|tail",
    ]) {
      expect(slot(source).status).toBe("invalid");
    }
  });

  it("fails closed on unsupported braces and comment/quote lexical handoffs", () => {
    for (const source of [
      "@expr{a{b}}|tail",
      "@expr{(a}b)}|tail",
      "@expr{(a}|tail",
      "@expr{a /* } */ + b}|tail",
      "@expr{a // }\r\nb}|tail",
    ]) {
      expect(slot(source).status).toBe("unsupported");
    }
    expect(slot('@expr{"never }|tail')).toMatchObject({
      status: "invalid",
      reason: "unterminated quote",
    });
  });

  it("bounds scanning before reaching a close or invoking the guest parser", () => {
    expect(slot("@expr{value}|tail", 4)).toMatchObject({ status: "exhausted" });
    expect(slot("@expr{value}|tail", 6).status).toBe("supported");
    expect(slot(`@expr{${"a".repeat(10000)}}|tail`, 32)).toMatchObject({ status: "exhausted" });
    expect(slot("@expr{value}|tail", 0)).toMatchObject({ status: "exhausted" });
    expect(slot("@expr{value}|tail", Number.POSITIVE_INFINITY)).toMatchObject({
      status: "exhausted",
    });
  });

  it("does not confuse division with comments or a string newline with a host close", () => {
    expect(slot("@expr{a / b}|tail").status).toBe("supported");
    expect(slot('@expr{"a\r\n}b"}|tail').status).toBe("unsupported");
  });
});
