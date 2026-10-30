import { describe, expect, it } from "vitest";
import { exhaustiveStudioCoverage, navigation, registry, searchTools, studioDefinitions, toolDefinitions, validateRegistry } from "./registry";

describe("tool registry", () => {
  it("contains all 15 studios with one navigation entry each", () => {
    expect(studioDefinitions).toHaveLength(15);
    expect(Object.keys(exhaustiveStudioCoverage).sort()).toEqual(studioDefinitions.map((studio) => studio.id).sort());
    expect(navigation.map((entry) => entry.id).sort()).toEqual(studioDefinitions.map((studio) => studio.id).sort());
    expect(new Set(navigation.map((entry) => entry.id)).size).toBe(15);
  });
  it("validates the canonical registry and its tool references", () => {
    expect(registry.tools).toHaveLength(15);
    expect(registry.tools.every((tool) => studioDefinitions.some((studio) => studio.id === tool.studioId))).toBe(true);
    expect(toolDefinitions.every((tool) => tool.status === "planned")).toBe(true);
  });
  it("rejects duplicate studio IDs and unknown references", () => {
    expect(() => validateRegistry([studioDefinitions[0], studioDefinitions[0]], [])).toThrow("Studio IDs must be unique");
    expect(() => validateRegistry(studioDefinitions, [{ ...toolDefinitions[0], studioId: "mystery-studio" }])).toThrow("Unknown studio");
  });
  it("rejects duplicate tool IDs and unavailable tools without a reason", () => {
    expect(() => validateRegistry(studioDefinitions, [toolDefinitions[0], toolDefinitions[0]])).toThrow("Tool IDs must be unique");
    expect(() => validateRegistry(studioDefinitions, [{ ...toolDefinitions[0], status: "unavailable", unavailableReason: undefined }])).toThrow();
  });
  it("searches across names, descriptions, and studio names", () => {
    expect(searchTools("merge").map((tool) => tool.id)).toContain("merge-pdf");
    expect(searchTools("office").map((tool) => tool.id)).toContain("pdf-to-office");
    expect(searchTools("  ")).toHaveLength(toolDefinitions.length);
    expect(searchTools("nothing matches")).toHaveLength(0);
  });
});
