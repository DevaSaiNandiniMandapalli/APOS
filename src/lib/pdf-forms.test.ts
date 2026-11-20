import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { fillPdfForm, inspectPdfForm } from "./pdf-forms";

async function makeForm() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 500]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const form = pdf.getForm();
  const name = form.createTextField("name");
  name.setText("Original");
  name.addToPage(page, { x: 40, y: 420, width: 220, height: 24, font });
  const agree = form.createCheckBox("agree");
  agree.addToPage(page, { x: 40, y: 380, width: 18, height: 18 });
  return new Uint8Array(await pdf.save());
}

describe("PDF forms", () => {
  it("inspects text and checkbox fields", async () => {
    const bytes = await makeForm();
    const inspection = await inspectPdfForm({ name: "form.pdf", size: bytes.byteLength, arrayBuffer: async () => bytes.buffer as ArrayBuffer });
    expect(inspection.hasForm).toBe(true);
    expect(inspection.pageCount).toBe(1);
    expect(inspection.fields.map((field) => field.name).sort()).toEqual(["agree", "name"]);
    expect(inspection.fields.find((field) => field.name === "name")?.kind).toBe("text");
    expect(inspection.fields.find((field) => field.name === "agree")?.kind).toBe("checkbox");
  });

  it("fills fields and leaves them editable when flatten is false", async () => {
    const bytes = await makeForm();
    const result = await fillPdfForm(
      { name: "form.pdf", size: bytes.byteLength, arrayBuffer: async () => bytes.buffer as ArrayBuffer },
      { name: "Ada Lovelace", agree: true },
      { flatten: false },
    );
    expect(result.filledCount).toBe(2);
    expect(result.flattened).toBe(false);
    const reopened = await PDFDocument.load(result.bytes);
    const form = reopened.getForm();
    expect(form.getTextField("name").getText()).toBe("Ada Lovelace");
    expect(form.getCheckBox("agree").isChecked()).toBe(true);
  });

  it("flattens fields into the page", async () => {
    const bytes = await makeForm();
    const result = await fillPdfForm(
      { name: "form.pdf", size: bytes.byteLength, arrayBuffer: async () => bytes.buffer as ArrayBuffer },
      { name: "Ada Lovelace", agree: true },
      { flatten: true },
    );
    expect(result.flattened).toBe(true);
    const reopened = await PDFDocument.load(result.bytes);
    expect(reopened.getForm().getFields()).toHaveLength(0);
    expect(reopened.getPageCount()).toBe(1);
  });

  it("rejects an empty or non-PDF input", async () => {
    await expect(inspectPdfForm({ name: "empty.pdf", size: 0, arrayBuffer: async () => new ArrayBuffer(0) })).rejects.toThrow("non-empty");
    const text = new TextEncoder().encode("not a PDF");
    await expect(inspectPdfForm({ name: "fake.pdf", size: text.byteLength, arrayBuffer: async () => text.buffer as ArrayBuffer })).rejects.toThrow("PDF signature");
  });
});
