import { describe, expect, it } from "vitest";
import {
  buildReportRows,
  countText,
  describeType,
  formatBytes,
  formatChecksum,
  isTextLike,
  reportToText,
} from "./file-inspector";

describe("file inspector helpers", () => {
  it("formats sizes with sensible units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(-1)).toBe("Unknown");
  });

  it("groups a SHA-256 checksum into readable octets", () => {
    const digest = "a".repeat(64);
    expect(formatChecksum(digest)).toBe("AAAAAAAA AAAAAAAA AAAAAAAA AAAAAAAA AAAAAAAA AAAAAAAA AAAAAAAA AAAAAAAA");
    expect(formatChecksum("not-a-hash")).toBe("not-a-hash");
  });

  it("describes types from MIME or extension", () => {
    expect(describeType("application/pdf", "a.pdf")).toBe("PDF document");
    expect(describeType("", "photo.PNG")).toBe("PNG image");
    expect(describeType("image/x-weird", "scan.bin")).toBe("X-WEIRD image");
    expect(describeType("", "notes.md")).toBe("Markdown document");
    expect(describeType("", "archive.unknownext")).toBe("UNKNOWNEXT file");
    expect(describeType("", "file")).toBe("Unknown type");
  });

  it("detects text-like files", () => {
    expect(isTextLike("text/plain", "a.txt")).toBe(true);
    expect(isTextLike("", "b.csv")).toBe(true);
    expect(isTextLike("application/pdf", "c.pdf")).toBe(false);
  });

  it("counts lines and words", () => {
    expect(countText(new TextEncoder().encode("one two\nthree"))).toEqual({ lines: 2, words: 3 });
    expect(countText(new TextEncoder().encode("   "))).toEqual({ lines: 0, words: 0 });
  });

  it("builds report rows including checksum and optional facts", () => {
    const rows = buildReportRows({
      name: "report.pdf",
      size: 2048,
      type: "application/pdf",
      lastModified: 0,
      pages: 3,
      checksum: "b".repeat(64),
    });
    const labels = rows.map((row) => row.label);
    expect(labels).toContain("File name");
    expect(labels).toContain("Pages");
    expect(labels).toContain("SHA-256");
    expect(rows.find((row) => row.label === "Size")?.value).toBe("2 KB");
    expect(rows.find((row) => row.label === "Pages")?.value).toBe("3");
    expect(rows.find((row) => row.label === "Last modified")?.value).toBe("Unknown");
    expect(reportToText(rows)).toContain("File name: report.pdf");
  });

  it("includes dimensions and text statistics when present", () => {
    const rows = buildReportRows({
      name: "pic.png",
      size: 100,
      type: "image/png",
      lastModified: Date.now(),
      width: 800,
      height: 400,
      lines: 10,
      words: 42,
    });
    expect(rows.find((row) => row.label === "Dimensions")?.value).toBe("800 × 400 px (ratio 2)");
    expect(rows.find((row) => row.label === "Text content")?.value).toBe("10 lines · 42 words");
  });
});
