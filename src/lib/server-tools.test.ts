import { describe, expect, it } from "vitest";
import { defaultOptionValue, serverAccept, serverApiBase, serverApiUrl, type ServerToolOption } from "./server-tools";

const base: ServerToolOption = { name: "level", label: "Level", kind: "select", choices: [{ value: "lossless", label: "Lossless" }], help: "" };

describe("server tool client helpers", () => {
  it("derives safe default option values", () => {
    expect(defaultOptionValue(base)).toBe("lossless");
    expect(defaultOptionValue({ ...base, kind: "checkbox", default: true })).toBe(true);
    expect(defaultOptionValue({ ...base, kind: "number", default: 4 })).toBe("4");
    expect(defaultOptionValue({ ...base, kind: "password" })).toBe("");
  });

  it("preserves image wildcards and API paths", () => {
    expect(serverAccept("image/*")).toBe("image/*");
    expect(serverAccept(".pdf,.p12,.pfx")).toBe(".pdf,.p12,.pfx");
    expect(serverApiUrl("/api/v1/tools")).toMatch(/\/api\/v1\/tools$/);
    expect(serverApiBase()).not.toMatch(/\/$/);
  });
});
