import { degrees, PDFDocument, rgb, StandardFonts } from "@cantoo/pdf-lib";
import { PDF_LIMITS, checkPdfHeader } from "./pdf-limits";
import { parsePageRanges } from "./split-pdf";

export type MarkOptions = {
  operation: "watermark" | "page-number";
  text: string;
  pages: string;
  position: "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
  rotation: number;
  opacity: number;
  fontSize: number;
  startNumber: number;
  template: string;
  image?: { bytes: Uint8Array; format: "png" | "jpeg" };
};

function selectedPages(input: string, count: number) {
  if (!input.trim() || input.trim().toLowerCase() === "all") return Array.from({ length: count }, (_, index) => index + 1);
  const ranges = parsePageRanges(input, count);
  return ranges.flatMap(({ first, last }) => Array.from({ length: last - first + 1 }, (_, index) => first + index));
}

export async function markPdf(bytes: Uint8Array, options: MarkOptions) {
  if (!bytes.byteLength) throw new Error("Choose a non-empty PDF.");
  if (bytes.byteLength > PDF_LIMITS.perFileBytes) throw new Error("The PDF exceeds the 50 MB input limit.");
  if (!checkPdfHeader(bytes)) throw new Error("This file does not have a PDF signature.");
  if (!Number.isInteger(options.rotation) || options.rotation < 0 || options.rotation > 359) throw new Error("Rotation must be a whole number from 0 to 359 degrees.");
  if (!Number.isFinite(options.opacity) || options.opacity < 0.05 || options.opacity > 1) throw new Error("Opacity must be between 5% and 100%.");
  if (!Number.isFinite(options.fontSize) || options.fontSize < 6 || options.fontSize > 96) throw new Error("Font size must be from 6 to 96 points.");
  if (!(new Set(["center", "top-left", "top-right", "bottom-left", "bottom-right"])).has(options.position)) throw new Error("Choose a supported mark position.");
  if (options.operation === "watermark" && ((!options.image && !options.text.trim()) || options.text.length > 160 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(options.text))) throw new Error("Enter watermark text up to 160 characters or choose an image; control characters are not supported.");
  if (options.image && (!options.image.bytes.byteLength || options.image.bytes.byteLength > 10 * 1024 * 1024)) throw new Error("Watermark images must be non-empty and no larger than 10 MB.");
  if (options.operation === "page-number" && (!options.template.includes("{n}") || options.template.length > 80 || !Number.isInteger(options.startNumber) || options.startNumber < 0 || options.startNumber > 999999)) throw new Error("Use a numbering format that includes {n}; the starting number must be from 0 to 999,999.");
  let pdf: PDFDocument;
  let count: number;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); count = pdf.getPageCount(); }
  catch { throw new Error("This PDF could not be opened. It may be corrupt, encrypted, or unsupported."); }
  if (count < 1 || count > PDF_LIMITS.pages) throw new Error(`The document must contain 1-${PDF_LIMITS.pages} pages.`);
  const pages = selectedPages(options.pages, count);
  if (!pages.length) throw new Error("Select at least one page.");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const image = options.image ? options.image.format === "png" ? await pdf.embedPng(options.image.bytes) : await pdf.embedJpg(options.image.bytes) : null;
  pages.forEach((pageIndex, ordinal) => {
    const page = pdf.getPage(pageIndex - 1); const { width, height } = page.getSize();
    const text = options.operation === "page-number" ? options.template.replaceAll("{n}", String(options.startNumber + ordinal)) : options.text;
    const textWidth = font.widthOfTextAtSize(text, options.fontSize);
    const margin = Math.max(18, options.fontSize);
    let x: number; let y: number;
    if (image) {
      const scale = Math.min((width * 0.45) / image.width, (height * 0.45) / image.height);
      const imageWidth = image.width * scale; const imageHeight = image.height * scale;
      x = options.position.endsWith("right") ? width - margin - imageWidth : options.position.endsWith("left") ? margin : (width - imageWidth) / 2;
      y = options.position.startsWith("top") ? height - margin - imageHeight : options.position.startsWith("bottom") ? margin : (height - imageHeight) / 2;
      page.drawImage(image, { x, y, width: imageWidth, height: imageHeight, rotate: degrees(options.rotation), opacity: options.opacity });
    } else {
      x = options.position.endsWith("right") ? width - margin - textWidth : options.position.endsWith("left") ? margin : (width - textWidth) / 2;
      y = options.position.startsWith("top") ? height - margin - options.fontSize : options.position.startsWith("bottom") ? margin : (height - options.fontSize) / 2;
      page.drawText(text, { x, y, size: options.fontSize, font, color: rgb(0.35, 0.35, 0.35), rotate: degrees(options.rotation), opacity: options.opacity });
    }
  });
  const output = new Uint8Array(await pdf.save({ useObjectStreams: true }));
  try {
    if (output.byteLength > PDF_LIMITS.perFileBytes || !checkPdfHeader(output)) throw new Error("The generated PDF exceeded the output limit or failed its PDF signature check.");
    const checked = await PDFDocument.load(output, { updateMetadata: false });
    if (checked.getPageCount() !== count) throw new Error("The generated PDF failed its page-count check.");
    return output;
  } catch (error) { output.fill(0); throw error; }
}
