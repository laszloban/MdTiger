import { describe, expect, it } from "vitest";
import { fileName, isMarkdownPath, normalizePath, samePath, withDefaultExtension } from "./paths";

describe("paths", () => {
  it("compares case-insensitively and across separators", () => {
    expect(samePath("C:\\A\\b.md", "c:/a/B.md")).toBe(true);
    expect(samePath("C:\\A\\b.md", "C:\\A\\c.md")).toBe(false);
    expect(normalizePath("C:/X/y.md")).toBe("c:\\x\\y.md");
  });
  it("takes the file name from either separator", () => {
    expect(fileName("C:\\a\\b.md")).toBe("b.md");
    expect(fileName("C:/a/b.md")).toBe("b.md");
    expect(fileName("b.md")).toBe("b.md");
  });
  it("accepts only .md and .markdown", () => {
    expect(isMarkdownPath("a.MD")).toBe(true);
    expect(isMarkdownPath("a.markdown")).toBe(true);
    expect(isMarkdownPath("a.txt")).toBe(false);
    expect(isMarkdownPath("md")).toBe(false);
  });
  it("adds .md only when there is no extension", () => {
    expect(withDefaultExtension("C:\\a\\notes")).toBe("C:\\a\\notes.md");
    expect(withDefaultExtension("C:\\a.b\\notes")).toBe("C:\\a.b\\notes.md");
    expect(withDefaultExtension("C:\\a\\notes.txt")).toBe("C:\\a\\notes.txt");
  });
});
