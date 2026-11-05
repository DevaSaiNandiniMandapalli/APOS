import { describe, expect, it } from "vitest";
import { calculateSheet, columnLabel, parseCsv, parseRef, toCsv } from "./spreadsheet";

describe("columnLabel / parseRef", () => {
  it("maps column indexes to letters", () => {
    expect(columnLabel(0)).toBe("A");
    expect(columnLabel(25)).toBe("Z");
    expect(columnLabel(26)).toBe("AA");
    expect(columnLabel(27)).toBe("AB");
  });

  it("parses cell references", () => {
    expect(parseRef("A1")).toEqual({ row: 0, col: 0 });
    expect(parseRef("C4")).toEqual({ row: 3, col: 2 });
    expect(parseRef("AA10")).toEqual({ row: 9, col: 26 });
    expect(parseRef("bad")).toBeNull();
  });
});

describe("calculateSheet", () => {
  it("evaluates arithmetic", () => {
    const results = calculateSheet({ A1: "=2+3*4", A2: "=(2+3)*4", A3: "=10/4" });
    expect(results.A1.value).toBe(14);
    expect(results.A2.value).toBe(20);
    expect(results.A3.value).toBe(2.5);
  });

  it("references other cells", () => {
    const results = calculateSheet({ A1: "10", A2: "5", A3: "=A1-A2", A4: "=A1*A2" });
    expect(results.A3.value).toBe(5);
    expect(results.A4.value).toBe(50);
  });

  it("supports SUM/AVERAGE/MIN/MAX/COUNT over ranges", () => {
    const cells = { A1: "1", A2: "2", A3: "3", B1: "=SUM(A1:A3)", B2: "=AVERAGE(A1:A3)", B3: "=MAX(A1:A3)", B4: "=MIN(A1:A3)", B5: "=COUNT(A1:A3)" };
    const results = calculateSheet(cells);
    expect(results.B1.value).toBe(6);
    expect(results.B2.value).toBe(2);
    expect(results.B3.value).toBe(3);
    expect(results.B4.value).toBe(1);
    expect(results.B5.value).toBe(3);
  });

  it("detects circular references", () => {
    const results = calculateSheet({ A1: "=B1", B1: "=A1" });
    expect(results.A1.error).toBe("#CYCLE");
    expect(results.B1.error).toBe("#CYCLE");
  });

  it("reports errors for malformed formulas", () => {
    const results = calculateSheet({ A1: "=1+", A2: "=SUM(" });
    expect(results.A1.error).toBe("#ERROR");
    expect(results.A2.error).toBe("#ERROR");
  });
});

describe("CSV round-trip", () => {
  it("exports and re-imports values", () => {
    const cells = { A1: "name", B1: "score", A2: "Ada", B2: "=10+5", A3: "Grace, Jr", B3: "20" };
    const results = calculateSheet(cells);
    const csv = toCsv(3, 2, cells, results);
    expect(csv).toContain("name,score");
    expect(csv).toContain('"Grace, Jr",20');
    const parsed = parseCsv(csv);
    expect(parsed.A2).toBe("Ada");
    expect(parsed.B3).toBe("20");
    expect(parsed.A3).toBe("Grace, Jr");
  });
});
