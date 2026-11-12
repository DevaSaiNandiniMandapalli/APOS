import { describe, expect, it } from "vitest";
import { pictureBoxFromTransform } from "./pdf-pictures";

const VIEWPORT: [number, number, number, number, number, number] = [1, 0, 0, -1, 0, 842];

describe("PDF picture placement", () => {
  it("maps a translated and scaled image into a source-sized page box", () => {
    const box = pictureBoxFromTransform([180, 0, 0, 120, 50, 520], VIEWPORT, 595, 842);
    expect(box.x).toBeCloseTo(50, 3);
    expect(box.y).toBeCloseTo(520, 3);
    expect(box.width).toBeCloseTo(180, 3);
    expect(box.height).toBeCloseTo(120, 3);
    expect(box.fullPage).toBe(false);
    expect(box.coverage).toBeLessThan(0.1);
  });

  it("recognises a full-page image without falling back to a page render", () => {
    const box = pictureBoxFromTransform([595, 0, 0, 842, 0, 0], VIEWPORT, 595, 842);
    expect(box.coverage).toBeCloseTo(1, 3);
    expect(box.fullPage).toBe(true);
  });

  it("keeps an identity-transform image as a tiny box instead of the whole page", () => {
    const box = pictureBoxFromTransform([1, 0, 0, 1, 0, 0], VIEWPORT, 595, 842);
    expect(box.width).toBeCloseTo(1, 3);
    expect(box.height).toBeCloseTo(1, 3);
    expect(box.fullPage).toBe(false);
  });
});
