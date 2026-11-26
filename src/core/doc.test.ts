import { describe, expect, it } from "vitest";
import { detectLineSeparator } from "./doc";

describe("detectLineSeparator", () => {
  it("detects LF and CRLF", () => {
    expect(detectLineSeparator("a\nb\n")).toBe("\n");
    expect(detectLineSeparator("a\r\nb\r\n")).toBe("\r\n");
  });
  it("is LF when there is no line break", () => {
    expect(detectLineSeparator("")).toBe("\n");
    expect(detectLineSeparator("abc")).toBe("\n");
  });
  it("lets the first line break win", () => {
    expect(detectLineSeparator("a\r\nb\nc\n")).toBe("\r\n");
    expect(detectLineSeparator("a\nb\r\nc\r\n")).toBe("\n");
  });
  it("ignores a lone CR and a leading LF", () => {
    expect(detectLineSeparator("a\rb")).toBe("\n");
    expect(detectLineSeparator("\nabc")).toBe("\n");
  });
});
