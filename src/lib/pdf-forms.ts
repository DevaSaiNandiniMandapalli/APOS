import {
  PDFButton,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  StandardFonts,
} from "@cantoo/pdf-lib";
import { checkPdfHeader } from "./pdf-limits";

export const PDF_FORM_LIMITS = {
  perFileBytes: 25 * 1024 * 1024,
  pages: 500,
  textLength: 10_000,
  fields: 500,
} as const;

export type PdfFormFieldKind = "text" | "checkbox" | "radio" | "dropdown" | "option-list" | "button" | "signature" | "unknown";

export type PdfFormField = {
  name: string;
  kind: PdfFormFieldKind;
  value: string | boolean | string[];
  options: string[];
  required: boolean;
};

export type PdfFormInspection = {
  pageCount: number;
  fields: PdfFormField[];
  hasForm: boolean;
};

export type PdfFormValues = Record<string, string | boolean | string[]>;

export type PdfFormFillResult = {
  bytes: Uint8Array;
  pageCount: number;
  fieldCount: number;
  filledCount: number;
  flattened: boolean;
};

function validateFile(bytes: Uint8Array, size: number) {
  if (!size) throw new Error("Choose a non-empty PDF.");
  if (size > PDF_FORM_LIMITS.perFileBytes) throw new Error("The PDF exceeds the 25 MB form limit.");
  if (!checkPdfHeader(bytes)) throw new Error("This file does not have a PDF signature.");
}

function describeField(field: unknown): PdfFormField {
  const base = field as { getName: () => string; isRequired: () => boolean };
  const name = base.getName();
  const required = base.isRequired();
  if (field instanceof PDFTextField) return { name, kind: "text", value: field.getText() ?? "", options: [], required };
  if (field instanceof PDFCheckBox) return { name, kind: "checkbox", value: field.isChecked(), options: [], required };
  if (field instanceof PDFRadioGroup) return { name, kind: "radio", value: field.getSelected() ?? "", options: field.getOptions(), required };
  if (field instanceof PDFDropdown) return { name, kind: "dropdown", value: field.getSelected()[0] ?? "", options: field.getOptions(), required };
  if (field instanceof PDFOptionList) return { name, kind: "option-list", value: field.getSelected() ?? [], options: field.getOptions(), required };
  if (field instanceof PDFButton) return { name, kind: "button", value: "", options: [], required };
  if (field instanceof PDFSignature) return { name, kind: "signature", value: "", options: [], required };
  return { name, kind: "unknown", value: "", options: [], required };
}

export async function inspectPdfForm(file: Pick<File, "name" | "size" | "arrayBuffer">): Promise<PdfFormInspection> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateFile(bytes, file.size);
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new Error("This PDF could not be opened. It may be encrypted, damaged or unsupported.");
  }
  const pageCount = pdf.getPageCount();
  if (pageCount < 1 || pageCount > PDF_FORM_LIMITS.pages) throw new Error(`The PDF must contain 1-${PDF_FORM_LIMITS.pages} pages.`);
  const form = pdf.getForm();
  const rawFields = form.getFields();
  if (!rawFields.length) return { pageCount, fields: [], hasForm: false };
  if (rawFields.length > PDF_FORM_LIMITS.fields) throw new Error(`This PDF has more than ${PDF_FORM_LIMITS.fields} form fields. Split it first.`);
  return { pageCount, fields: rawFields.map(describeField), hasForm: true };
}

function valuesFor(value: string | boolean | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value) return [value];
  return [];
}

export async function fillPdfForm(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
  values: PdfFormValues,
  options: { flatten?: boolean } = {},
): Promise<PdfFormFillResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateFile(bytes, file.size);
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new Error("This PDF could not be opened. It may be encrypted, damaged or unsupported.");
  }
  const pageCount = pdf.getPageCount();
  if (pageCount < 1 || pageCount > PDF_FORM_LIMITS.pages) throw new Error(`The PDF must contain 1-${PDF_FORM_LIMITS.pages} pages.`);
  const form = pdf.getForm();
  const fields = form.getFields();
  if (!fields.length) throw new Error("This PDF has no fillable form fields.");
  const byName = new Map(fields.map((field) => [field.getName(), field]));
  let filledCount = 0;
  for (const [name, value] of Object.entries(values)) {
    if (name.startsWith("__")) continue;
    const field = byName.get(name);
    if (!field) continue;
    if (field instanceof PDFTextField) {
      const text = String(value ?? "").slice(0, PDF_FORM_LIMITS.textLength);
      field.setText(text);
      filledCount += 1;
    } else if (field instanceof PDFCheckBox) {
      if (Boolean(value)) field.check(); else field.uncheck();
      filledCount += 1;
    } else if (field instanceof PDFRadioGroup) {
      const selected = valuesFor(value)[0];
      if (selected) { field.select(selected); filledCount += 1; }
      else { field.clear(); }
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      const selected = valuesFor(value);
      if (selected.length) { field.select(selected); filledCount += 1; }
      else { field.clear(); }
    }
  }
  const flatten = options.flatten !== false;
  if (flatten) {
    try {
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      form.updateFieldAppearances(font);
      form.flatten();
    } catch {
      throw new Error("The form could not be flattened safely. Try downloading it unfilled or fill it in a PDF reader.");
    }
  }
  const output = new Uint8Array(await pdf.save({ useObjectStreams: true }));
  try {
    if (!checkPdfHeader(output) || output.byteLength > PDF_FORM_LIMITS.perFileBytes * 2) throw new Error("The filled form failed output validation.");
    const verified = await PDFDocument.load(output, { updateMetadata: false });
    if (verified.getPageCount() !== pageCount) throw new Error("The filled form failed its page-count check.");
  } catch (error) {
    output.fill(0);
    throw error;
  }
  return { bytes: output, pageCount, fieldCount: fields.length, filledCount, flattened: flatten };
}
