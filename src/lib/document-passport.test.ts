import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, StandardFonts } from "@cantoo/pdf-lib";
import { strToU8, zipSync } from "fflate";
import {
  buildDocumentPassport,
  createCleanPdf,
  detectPassportKind,
  sha256Hex,
} from "./document-passport";

async function makePdf({ metadata = true, annotations = false } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([400, 500]);
  page.drawText("Passport fixture", { x: 30, y: 430, size: 14, font });
  if (metadata) {
    pdf.setTitle("Sensitive project");
    pdf.setAuthor("A. Person");
    pdf.setSubject("Internal");
  }
  if (annotations) {
    page.node.set(PDFName.of("Annots"), pdf.context.obj([
      pdf.context.obj({ Type: "Annot", Subtype: "Text", Rect: [10, 10, 40, 40], Contents: "Reviewer note" }),
    ]));
  }
  return new Uint8Array(await pdf.save());
}

function makeDocx({ macros = false, external = false } = {}): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    "word/document.xml": strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>'),
    "word/_rels/document.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="${external ? "External" : "Internal"}"/></Relationships>`),
    "docProps/core.xml": strToU8('<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Report</dc:title><dc:creator>Author</dc:creator></cp:coreProperties>'),
    "docProps/app.xml": strToU8('<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application></Properties>'),
  };
  if (macros) entries["word/vbaProject.bin"] = new Uint8Array([1, 2, 3]);
  return zipSync(entries);
}

describe("Document Passport", () => {
  it("detects PDF and ZIP-based Office files by signature", async () => {
    expect(detectPassportKind("a.pdf", await makePdf())).toBe("pdf");
    expect(detectPassportKind("a.docx", makeDocx())).toBe("docx");
    expect(detectPassportKind("a.bin", strToU8("hello"))).toBe("unknown");
  });

  it("hashes the exact bytes", async () => {
    const bytes = strToU8("passport");
    const first = await sha256Hex(bytes);
    const second = await sha256Hex(bytes);
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });

  it("reports PDF metadata and annotation flags with a reduced score", async () => {
    const bytes = await makePdf({ annotations: true });
    const report = await buildDocumentPassport(new File([bytes as unknown as BlobPart], "fixture.pdf", { type: "application/pdf" }));
    expect(report.detectedKind).toBe("pdf");
    expect(report.score).toBeLessThan(100);
    expect(report.flags.map((flag) => flag.id)).toEqual(expect.arrayContaining(["metadata", "annotations"]));
    expect(report.verdict).toBe("review");
    expect(report.canSanitize).toBe(true);
    expect(report.sections.some((section) => section.title === "Metadata")).toBe(true);
  });

  it("creates a clean copy without metadata or annotations and keeps every page", async () => {
    const bytes = await makePdf({ annotations: true });
    const file = new File([bytes as unknown as BlobPart], "fixture.pdf", { type: "application/pdf" });
    const clean = await createCleanPdf(file);
    const pdf = await PDFDocument.load(clean.bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle() ?? "").toBe("");
    expect(pdf.getAuthor() ?? "").toBe("");
    expect(pdf.getPage(0).node.Annots()).toBeUndefined();
  });

  it("flags macros and external relationships in a DOCX package", async () => {
    const report = await buildDocumentPassport(
      new File([makeDocx({ macros: true, external: true }) as unknown as BlobPart], "macro.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    );
    expect(report.detectedKind).toBe("docx");
    expect(report.flags.map((flag) => flag.id)).toEqual(expect.arrayContaining(["macros", "external-links"]));
    expect(report.score).toBeLessThan(70);
    expect(report.canSanitize).toBe(false);
  });

  it("does not reopen an unrecognised file", async () => {
    const report = await buildDocumentPassport(new File([strToU8("plain") as unknown as BlobPart], "mystery.bin"));
    expect(report.detectedKind).toBe("unknown");
    expect(report.flags.some((flag) => flag.id === "unknown")).toBe(true);
  });
});
