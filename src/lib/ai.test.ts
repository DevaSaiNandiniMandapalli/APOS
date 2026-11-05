import { describe, expect, it } from "vitest";
import { buildMessages, buildRequest, DEFAULT_MODEL, extractAnswer, MAX_INPUT_CHARS, validateAiInput } from "./ai";

describe("validateAiInput", () => {
  it("rejects empty text", () => {
    expect(validateAiInput("   ")).toBeTruthy();
  });
  it("rejects text over the limit", () => {
    expect(validateAiInput("a".repeat(MAX_INPUT_CHARS + 1))).toBeTruthy();
  });
  it("accepts normal text", () => {
    expect(validateAiInput("Hello world")).toBeNull();
  });
});

describe("buildRequest", () => {
  it("uses the Sarvam 105B model and a system + user message", () => {
    const request = buildRequest("summarize", "  some text  ");
    expect(request.model).toBe(DEFAULT_MODEL);
    expect(request.messages).toHaveLength(2);
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[1].content).toContain("some text");
    expect(request.messages[1].content).toContain("Summarize");
  });

  it("switches the instruction per task", () => {
    expect(buildMessages("rewrite", "x")[1].content).toContain("Rewrite");
    expect(buildMessages("explain", "x")[1].content).toContain("plain language");
  });
});

describe("extractAnswer", () => {
  it("reads OpenAI-style choices", () => {
    expect(extractAnswer({ choices: [{ message: { content: " hi " } }] })).toBe("hi");
  });
  it("reads plain answer fields", () => {
    expect(extractAnswer({ answer: "ok" })).toBe("ok");
    expect(extractAnswer({ output: "out" })).toBe("out");
  });
  it("returns null for unknown shapes", () => {
    expect(extractAnswer({})).toBeNull();
    expect(extractAnswer(null)).toBeNull();
  });
});
