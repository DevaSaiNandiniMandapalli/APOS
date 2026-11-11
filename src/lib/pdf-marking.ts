import { degrees, PDFDocument, rgb, StandardFonts } from "@cantoo/pdf-lib";
import { PDF_LIMITS, checkPdfHeader } from "./pdf-limits";
import { parsePageRanges } from "./split-pdf";

export type MarkPosition =
  | "top-left" | "top-center" | "top-right"
  | "middle-left" | "center" | "middle-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export type NumberStyle = "decimal" | "roman" | "roman-upper" | "alpha" | "alpha-upper";

export type MarkOptions = {
  operation: "watermark" | "page-number";
  text: string;
  pages: string;
  position: MarkPosition;
  rotation: number;
  opacity: number;
  fontSize: number;
  startNumber: number;
  template: string;
  numberStyle?: NumberStyle;
  image?: { bytes: Uint8Array; format: "png" | "jpeg" };
};

export const MARK_POSITIONS: MarkPosition[] = [
  "top-left", "top-center", "top-right",
  "middle-left", "center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
];

export const NUMBER_STYLES: { value: NumberStyle; label: string; sample: string }[] = [
  { value: "decimal", label: "1, 2, 3", sample: "1 2 3" },
  { value: "roman", label: "i, ii, iii", sample: "i ii iii" },
  { value: "roman-upper", label: "I, II, III", sample: "I II III" },
  { value: "alpha", label: "a, b, c", sample: "a b c" },
  { value: "alpha-upper", label: "A, B, C", sample: "A B C" },
];

export function formatNumber(value: number, style: NumberStyle = "decimal"): string {
  if (style === "decimal") return String(value);
  if (style === "alpha" || style === "alpha-upper") {
    if (value < 1) return String(value);
    let n = value;
    let out = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(97 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return style === "alpha-upper" ? out.toUpperCase() : out;
  }
  const numerals: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let n = value;
  if (n < 1 || n > 3999) return String(value);
  let out = "";
  for (const [amount, glyph] of numerals) {
    while (n >= amount) { out += glyph; n -= amount; }
  }
  return style === "roman-upper" ? out.toUpperCase() : out;
}

function selectedPages(input: string, count: number) {
  if (!input.trim() || input.trim().toLowerCase() === "all") return Array.from({ length: count }, (_, index) => index + 1);
  const ranges = parsePageRanges(input, count);
  return ranges.flatMap(({ first, last }) => Array.from({ length: last - first + 1 }, (_, index) => first + index));
}

// Places a box of visual size (w x h) at the requested anchor on a page whose
// /Rotate value is pageRotation, and returns the drawing origin for `rotate`.
function place({ anchorX, anchorY, boxW, boxH, rotate }: { anchorX: number; anchorY: number; boxW: number; boxH: number; rotate: number }) {
  const radians = (rotate * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // Rotate the box about its own centre so the text stays centred on the anchor.
  const x = anchorX - (boxW / 2) * cos + (boxH / 2) * sin;
  const y = anchorY - (boxW / 2) * sin - (boxH / 2) * cos;
  return { x, y };
}

export async function markPdf(bytes: Uint8Array, options: MarkOptions) {
  if (!bytes.byteLength) throw new Error("Choose a non-empty PDF.");
  if (bytes.byteLength > PDF_LIMITS.perFileBytes) throw new Error("The PDF exceeds the 50 MB input limit.");
  if (!checkPdfHeader(bytes)) throw new Error("This file does not have a PDF signature.");
  if (!Number.isInteger(options.rotation) || options.rotation < 0 || options.rotation > 359) throw new Error("Rotation must be a whole number from 0 to 359 degrees.");
  if (!Number.isFinite(options.opacity) || options.opacity < 0.05 || options.opacity > 1) throw new Error("Opacity must be between 5% and 100%.");
  if (!Number.isFinite(options.fontSize) || options.fontSize < 6 || options.fontSize > 96) throw new Error("Font size must be from 6 to 96 points.");
  if (!MARK_POSITIONS.includes(options.position)) throw new Error("Choose a supported mark position.");
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
  const style = options.numberStyle ?? "decimal";
  const image = options.image ? options.image.format === "png" ? await pdf.embedPng(options.image.bytes) : await pdf.embedJpg(options.image.bytes) : null;
  pages.forEach((pageIndex, ordinal) => {
    const page = pdf.getPage(pageIndex - 1);
    const rotation = page.getRotation().angle % 360;
    const size = page.getSize();
    // Work in the space the reader sees: swap width/height for 90/270 rotations.
    const visualWidth = rotation === 90 || rotation === 270 ? size.height : size.width;
    const visualHeight = rotation === 90 || rotation === 270 ? size.width : size.height;
    const label = options.template.replaceAll("{n}", formatNumber(options.startNumber + ordinal, style));
    const text = options.operation === "page-number" ? label : options.text;
    const textWidth = font.widthOfTextAtSize(text, options.fontSize);
    const margin = Math.max(18, options.fontSize);
    const [vertical, horizontal] = options.position.split("-");
    const boxW = image ? visualWidth * 0.45 : textWidth;
    const boxH = image ? visualHeight * 0.45 : options.fontSize;
    const left = horizontal === "left" ? margin + boxW / 2 : horizontal === "right" ? visualWidth - margin - boxW / 2 : visualWidth / 2;
    const bottom = vertical === "top" ? visualHeight - margin - boxH / 2 : vertical === "bottom" ? margin + boxH / 2 : visualHeight / 2;
    // Convert the visual anchor back to unrotated page coordinates.
    let anchorX = left;
    let anchorY = bottom;
    if (rotation === 90) { anchorX = bottom; anchorY = size.height - left; }
    else if (rotation === 180) { anchorX = size.width - left; anchorY = size.height - bottom; }
    else if (rotation === 270) { anchorX = size.width - bottom; anchorY = left; }
    const rotate = (options.rotation - rotation + 360) % 360;
    if (image) {
      const { x, y } = place({ anchorX, anchorY, boxW, boxH, rotate });
      page.drawImage(image, { x, y, width: boxW, height: boxH, rotate: degrees(rotate), opacity: options.opacity });
    } else {
      // pdf-lib draws text from its baseline, so lift it by the descent first.
      const descent = options.fontSize * 0.22;
      const { x, y } = place({ anchorX, anchorY: anchorY - boxH / 2 + descent, boxW, boxH: 0, rotate });
      page.drawText(text, { x, y, size: options.fontSize, font, color: rgb(0.25, 0.25, 0.3), rotate: degrees(rotate), opacity: options.opacity });
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
