import { describe, expect, it } from "vitest";
import {
  classifyPage,
  textSimilarity,
  summariseVerifyReport,
  visualChangePercent,
  type VerifyPageResult,
} from "./pdf-verify";

function page(overrides: Partial<VerifyPageResult> = {}): VerifyPageResult {
  return {
    page: 1,
    status: "identical",
    visualChangePercent: 0,
    visualSimilarityPercent: 100,
    textSimilarityPercent: 100,
    textAddedWords: 0,
    textRemovedWords: 0,
    beforeCharacters: 10,
    afterCharacters: 10,
    sizeChanged: false,
    ...overrides,
  };
}

function report(pages: VerifyPageResult[], beforePages = pages.length, afterPages = pages.length) {
  return summariseVerifyReport({
    beforeName: "before.pdf",
    afterName: "after.pdf",
    beforePages,
    afterPages,
    comparedPages: Math.min(beforePages, afterPages),
    pages,
  });
}

describe("Verify & Compare metrics", () => {
  it("treats identical text as a 100% match", () => {
    const result = textSimilarity("Hello  world", "hello world");
    expect(result.similarityPercent).toBe(100);
    expect(result.addedWords).toBe(0);
    expect(result.removedWords).toBe(0);
  });

  it("counts added and removed words", () => {
    const result = textSimilarity("the quick brown fox", "the slow brown fox jumps");
    expect(result.similarityPercent).toBeLessThan(100);
    expect(result.addedWords).toBe(2);
    expect(result.removedWords).toBe(1);
  });

  it("returns 100% for two empty texts", () => {
    expect(textSimilarity("", "").similarityPercent).toBe(100);
  });

  it("counts changed pixels with the tolerance applied", () => {
    const before = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);
    const after = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(visualChangePercent(before, before)).toBe(0);
    expect(visualChangePercent(before, after)).toBe(50);
    const tiny = new Uint8ClampedArray([245, 245, 245, 255, 255, 255, 255, 255]);
    expect(visualChangePercent(before, tiny)).toBe(0);
  });

  it("classifies missing, size, visual and text changes", () => {
    const base = {
      page: 1,
      visualChangePercent: 0,
      visualSimilarityPercent: 100,
      textSimilarityPercent: 100,
      textAddedWords: 0,
      textRemovedWords: 0,
      beforeCharacters: 10,
      afterCharacters: 10,
      sizeChanged: false,
    };
    expect(classifyPage(base)).toBe("identical");
    expect(classifyPage({ ...base, beforeCharacters: -1 })).toBe("missing-before");
    expect(classifyPage({ ...base, afterCharacters: -1 })).toBe("missing-after");
    expect(classifyPage({ ...base, sizeChanged: true })).toBe("size-changed");
    expect(classifyPage({ ...base, visualChangePercent: 3 })).toBe("visual-change");
    expect(classifyPage({ ...base, textSimilarityPercent: 80 })).toBe("text-changed");
  });

  it("summarises an identical comparison", () => {
    const result = report([page()]);
    expect(result.verdict).toBe("identical");
    expect(result.identicalPages).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it("summarises text and page-count differences", () => {
    const result = report([
      page(),
      page({ page: 2, status: "text-changed", textSimilarityPercent: 82, textAddedWords: 2, textRemovedWords: 1 }),
    ], 2, 3);
    expect(result.verdict).not.toBe("identical");
    expect(result.textChangedPages).toBe(1);
    expect(result.warnings.join(" ")).toContain("Page count changed");
    expect(result.warnings.join(" ")).toContain("text differences");
  });

  it("marks missing pages as a material difference", () => {
    const result = report([
      page(),
      page({ page: 2, status: "missing-after", beforeCharacters: 5, afterCharacters: -1 }),
    ]);
    expect(result.missingPages).toBe(1);
    expect(result.verdict).toBe("major-differences");
  });
});
