import { describe, expect, it } from "vitest";
import {
  addStep,
  createWorkflow,
  moveStep,
  parseWorkflow,
  removeStep,
  serializeWorkflow,
  validateWorkflow,
} from "./workflow";

describe("workflow model", () => {
  it("adds and removes steps", () => {
    let wf = createWorkflow();
    expect(validateWorkflow(wf)).toContain("Add at least one step. Pick a tool from the palette, then save.");
    wf = addStep(wf, "merge");
    wf = addStep(wf, "compress");
    expect(wf.steps.map((s) => s.type)).toEqual(["merge", "compress"]);
    wf = removeStep(wf, wf.steps[0].id);
    expect(wf.steps.map((s) => s.type)).toEqual(["compress"]);
  });

  it("moves steps within bounds", () => {
    let wf = createWorkflow();
    wf = addStep(wf, "merge");
    wf = addStep(wf, "rotate");
    const ids = wf.steps.map((s) => s.id);
    wf = moveStep(wf, ids[1], -1);
    expect(wf.steps.map((s) => s.type)).toEqual(["rotate", "merge"]);
    expect(moveStep(wf, ids[1], -1).steps.map((s) => s.type)).toEqual(["rotate", "merge"]);
  });

  it("validates name and step count", () => {
    const wf = { name: " ", steps: addStep(createWorkflow(), "merge").steps };
    const errors = validateWorkflow(wf);
    expect(errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("round-trips JSON", () => {
    let wf = createWorkflow();
    wf = { ...wf, name: "Daily cleanup" };
    wf = addStep(wf, "compress");
    const parsed = parseWorkflow(serializeWorkflow(wf));
    expect("workflow" in parsed).toBe(true);
    if ("workflow" in parsed) {
      expect(parsed.workflow.name).toBe("Daily cleanup");
      expect(parsed.workflow.steps[0].type).toBe("compress");
    }
  });

  it("rejects unknown steps on import", () => {
    const result = parseWorkflow(JSON.stringify({ name: "x", steps: [{ type: "explode" }] }));
    expect("error" in result).toBe(true);
  });
});
