import { degrees, PDFDocument, rgb, StandardFonts, type Color, type PDFFont } from "@cantoo/pdf-lib";
import { getDisplaySize, getPageGeometry, visualPointToPdf, type PdfPageGeometry } from "./pdf-geometry";
import { PDF_LIMITS, checkPdfHeader } from "./pdf-limits";
import { parsePageRanges } from "./split-pdf";

export type MarkPosition =
  | "top-left" | "top-center" | "top-right"
  | "middle-left" | "center" | "middle-right"
  | "bottom-left" | "bottom-center" | "bottom-right"
  | "custom";

export type NumberStyle = "decimal" | "roman" | "roman-upper" | "alpha" | "alpha-upper";
export type FontFamily = "helvetica" | "helvetica-bold" | "times" | "times-bold" | "courier" | "courier-bold";
export type PageNumberFormat = "decimal" | "page" | "padded";
export type TextAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";

export type MarkOptions = {
  operation: "watermark" | "page-number";
  mode?: "text" | "image";
  text: string;
  pages: string;
  position: MarkPosition;
  rotation: number;
  opacity: number;
  fontSize: number;
  startNumber: number;
  template?: string;
  numberStyle?: NumberStyle;
  fontFamily?: FontFamily;
  color?: string;
  scale?: number;
  prefix?: string;
  suffix?: string;
  numberFormat?: PageNumberFormat;
  skipCover?: boolean;
  margin?: number;
  customX?: number;
  customY?: number;
  align?: TextAlign;
  valign?: VerticalAlign;
  image?: { bytes: Uint8Array; format: "png" | "jpeg" };
};

export type MarkProgress = { completed: number; total: number; label: string };

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

export const NUMBER_FORMATS: { value: PageNumberFormat; label: string }[] = [
  { value: "decimal", label: "1, 2, 3" },
  { value: "page", label: "Page 1, Page 2" },
  { value: "padded", label: "01, 02, 03" },
];

export const FONT_FAMILIES: { value: FontFamily; label: string }[] = [
  { value: "helvetica", label: "Helvetica" },
  { value: "helvetica-bold", label: "Helvetica Bold" },
  { value: "times", label: "Times Roman" },
  { value: "times-bold", label: "Times Roman Bold" },
  { value: "courier", label: "Courier" },
  { value: "courier-bold", label: "Courier Bold" },
];

const FONT_MAP: Record<FontFamily, StandardFonts> = {
  helvetica: StandardFonts.Helvetica,
  "helvetica-bold": StandardFonts.HelveticaBold,
  times: StandardFonts.TimesRoman,
  "times-bold": StandardFonts.TimesRomanBold,
  courier: StandardFonts.Courier,
  "courier-bold": StandardFonts.CourierBold,
};

const DEFAULT_COLOR = "#40404d";
const WINANSI_MAX_CODE = 0xff;
const UNDEFINED_WINANSI_CODES = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);

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

export function formatPageNumber(value: number, format: PageNumberFormat = "decimal"): string {
  if (format === "page") return `Page ${value}`;
  if (format === "padded") return String(value).padStart(2, "0");
  return String(value);
}

export function selectedPages(input: string, count: number, skipCover = false) {
  const pages = !input.trim() || input.trim().toLowerCase() === "all"
    ? Array.from({ length: count }, (_, index) => index + 1)
    : parsePageRanges(input, count).flatMap(({ first, last }) => Array.from({ length: last - first + 1 }, (_, index) => first + index));
  return skipCover ? pages.filter((page) => page !== 1) : pages;
}

function parseColor(value?: string): Color {
  const match = /^#([0-9a-f]{6})$/i.exec(value ?? DEFAULT_COLOR);
  if (!match) throw new Error("Choose a valid text color.");
  const number = Number.parseInt(match[1], 16);
  return rgb(((number >> 16) & 0xff) / 255, ((number >> 8) & 0xff) / 255, (number & 0xff) / 255);
}

function assertTextEncodable(text: string) {
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    if (code > WINANSI_MAX_CODE || UNDEFINED_WINANSI_CODES.has(code)) {
      throw new Error("The watermark text contains characters the built-in PDF fonts cannot encode. Use Latin characters or an image watermark.");
    }
  }
}

function fitText(text: string, font: PDFFont, requestedSize: number, maxWidth: number) {
  assertTextEncodable(text);
  let size = requestedSize;
  let width: number;
  try {
    width = font.widthOfTextAtSize(text, size);
  } catch {
    throw new Error("The watermark text contains characters the selected PDF font cannot encode.");
  }
  if (maxWidth > 0 && width > maxWidth) {
    size = Math.max(1, size * (maxWidth / width));
    width = maxWidth;
  }
  return { size, width, height: size };
}

export type MarkLayout = {
  left: number;
  bottom: number;
  horizontal: TextAlign;
  vertical: VerticalAlign;
};

/** Axis-aligned bounding box of a mark after its visual rotation. */
export function rotatedMarkBounds(width: number, height: number, angle: number) {
  const radians = angle * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  };
}

export function computeMarkLayout({
  displayWidth,
  displayHeight,
  position,
  align,
  valign,
  width,
  height,
  margin,
  customX,
  customY,
}: {
  displayWidth: number;
  displayHeight: number;
  position: MarkPosition;
  align: TextAlign;
  valign: VerticalAlign;
  width: number;
  height: number;
  margin: number;
  customX?: number;
  customY?: number;
}): MarkLayout {
  const [rawVertical, rawHorizontal] = position === "center" ? ["middle", "center"] : position.split("-");
  const horizontal = position === "custom" ? align : (rawHorizontal as TextAlign | undefined) ?? "center";
  const vertical = position === "custom" ? valign : (rawVertical as VerticalAlign | undefined) ?? "middle";
  const customAnchorX = displayWidth * (customX ?? 50) / 100;
  const customAnchorY = displayHeight * (1 - (customY ?? 50) / 100);
  let left = position === "custom"
    ? horizontal === "left" ? customAnchorX : horizontal === "right" ? customAnchorX - width : customAnchorX - width / 2
    : horizontal === "left" ? margin : horizontal === "right" ? displayWidth - margin - width : (displayWidth - width) / 2;
  let bottom = position === "custom"
    ? vertical === "top" ? customAnchorY - height : vertical === "bottom" ? customAnchorY : customAnchorY - height / 2
    : vertical === "top" ? displayHeight - margin - height : vertical === "bottom" ? margin : (displayHeight - height) / 2;
  const minLeft = margin;
  const maxLeft = displayWidth - margin - width;
  const minBottom = margin;
  const maxBottom = displayHeight - margin - height;
  left = maxLeft >= minLeft ? Math.max(minLeft, Math.min(maxLeft, left)) : Math.max(0, (displayWidth - width) / 2);
  bottom = maxBottom >= minBottom ? Math.max(minBottom, Math.min(maxBottom, bottom)) : Math.max(0, (displayHeight - height) / 2);
  return { left, bottom, horizontal, vertical };
}

function positionBox({
  geometry,
  position,
  align,
  valign,
  width,
  height,
  margin,
  customX,
  customY,
}: {
  geometry: PdfPageGeometry;
  position: MarkPosition;
  align: TextAlign;
  valign: VerticalAlign;
  width: number;
  height: number;
  margin: number;
  customX?: number;
  customY?: number;
}) {
  const display = getDisplaySize(geometry);
  const layout = computeMarkLayout({
    displayWidth: display.width,
    displayHeight: display.height,
    position,
    align,
    valign,
    width,
    height,
    margin,
    customX,
    customY,
  });
  return { display, ...layout };
}

export async function markPdf(bytes: Uint8Array, options: MarkOptions, onProgress?: (progress: MarkProgress) => void) {
  if (!bytes.byteLength) throw new Error("Choose a non-empty PDF.");
  if (bytes.byteLength > PDF_LIMITS.perFileBytes) throw new Error("The PDF exceeds the 50 MB input limit.");
  if (!checkPdfHeader(bytes)) throw new Error("This file does not have a PDF signature.");
  if (!Number.isInteger(options.rotation) || options.rotation < 0 || options.rotation > 359) throw new Error("Rotation must be a whole number from 0 to 359 degrees.");
  if (!Number.isFinite(options.opacity) || options.opacity < 0.05 || options.opacity > 1) throw new Error("Opacity must be between 5% and 100%.");
  if (!Number.isFinite(options.fontSize) || options.fontSize < 6 || options.fontSize > 96) throw new Error("Font size must be from 6 to 96 points.");
  if (options.position !== "custom" && !MARK_POSITIONS.includes(options.position)) throw new Error("Choose a supported mark position.");
  if (options.scale !== undefined && (!Number.isFinite(options.scale) || options.scale < 5 || options.scale > 100)) throw new Error("Scale must be between 5% and 100%.");
  if (options.margin !== undefined && (!Number.isFinite(options.margin) || options.margin < 0 || options.margin > 200)) throw new Error("Margin must be between 0 and 200 points.");
  if (options.customX !== undefined && (!Number.isFinite(options.customX) || options.customX < 0 || options.customX > 100)) throw new Error("Custom horizontal position must be between 0% and 100%.");
  if (options.customY !== undefined && (!Number.isFinite(options.customY) || options.customY < 0 || options.customY > 100)) throw new Error("Custom vertical position must be between 0% and 100%.");
  if (options.align !== undefined && !["left", "center", "right"].includes(options.align)) throw new Error("Choose a supported horizontal alignment.");
  if (options.valign !== undefined && !["top", "middle", "bottom"].includes(options.valign)) throw new Error("Choose a supported vertical alignment.");
  if (options.fontFamily !== undefined && !(options.fontFamily in FONT_MAP)) throw new Error("Choose a supported PDF font.");
  if (options.color !== undefined && !/^#[0-9a-f]{6}$/i.test(options.color)) throw new Error("Choose a valid text color.");

  const mode = options.operation === "page-number" ? "text" : options.mode ?? (options.image ? "image" : "text");
  if (options.operation === "watermark") {
    if (options.mode === undefined && options.image && options.text.trim()) throw new Error("Choose either a text watermark or an image watermark, not both.");
    if (mode === "image") {
      if (!options.image) throw new Error("Choose a PNG or JPEG watermark image.");
    } else if (!options.text.trim() || options.text.length > 160 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(options.text)) {
      throw new Error("Enter watermark text up to 160 characters; control characters are not supported.");
    }
  }
  if (options.image && (!options.image.bytes.byteLength || options.image.bytes.byteLength > 10 * 1024 * 1024)) throw new Error("Watermark images must be non-empty and no larger than 10 MB.");
  if (options.operation === "page-number") {
    if (options.template !== undefined && !options.template.includes("{n}")) throw new Error("Use a numbering format that includes {n}.");
    if (options.template !== undefined && options.template.length > 80) throw new Error("The custom numbering format must be 80 characters or fewer.");
    if ((options.prefix?.length ?? 0) > 80 || (options.suffix?.length ?? 0) > 80) throw new Error("Page-number prefixes and suffixes must be 80 characters or fewer.");
    if (!Number.isInteger(options.startNumber) || options.startNumber < 0 || options.startNumber > 999999) throw new Error("The starting number must be from 0 to 999,999.");
  }

  let pdf: PDFDocument;
  let count: number;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    count = pdf.getPageCount();
  } catch {
    throw new Error("This PDF could not be opened. It may be corrupt, encrypted, or unsupported.");
  }
  if (count < 1 || count > PDF_LIMITS.pages) throw new Error(`The document must contain 1-${PDF_LIMITS.pages} pages.`);
  const pages = selectedPages(options.pages, count, options.operation === "page-number" && options.skipCover);
  if (!pages.length) throw new Error("Select at least one page.");

  const font = options.operation === "page-number" || mode === "text" ? await pdf.embedFont(FONT_MAP[options.fontFamily ?? "helvetica"]) : null;
  const style = options.numberStyle ?? "decimal";
  const color = parseColor(options.color);
  const image = mode === "image" && options.image
    ? options.image.format === "png" ? await pdf.embedPng(options.image.bytes) : await pdf.embedJpg(options.image.bytes)
    : null;
  const margin = options.margin ?? (options.operation === "page-number" ? 24 : Math.max(18, options.fontSize));
  const scale = options.scale ?? (mode === "image" ? 45 : 100);

  pages.forEach((pageIndex, ordinal) => {
    const page = pdf.getPage(pageIndex - 1);
    const geometry = getPageGeometry(page);
    const display = getDisplaySize(geometry);
    const number = options.startNumber + ordinal;
    const label = options.operation === "page-number"
      ? options.template !== undefined
        ? options.template.replaceAll("{n}", formatNumber(number, style))
        : `${options.prefix ?? ""}${formatPageNumber(number, options.numberFormat)}${options.suffix ?? ""}`
      : options.text;
    // PDF /Rotate values rotate the displayed page clockwise. Adding the page
    // rotation to the mark rotation keeps the mark upright in the visible page
    // for 90° and 270° pages; the previous subtraction reversed the text
    // direction and clipped rotated-page marks.
    const rotate = (options.rotation + geometry.rotation) % 360;

    if (options.operation === "watermark" && mode === "image" && image) {
      const maxWidth = Math.max(1, Math.min(display.width * scale / 100, display.width - margin * 2));
      const maxHeight = Math.max(1, Math.min(display.height * scale / 100, display.height - margin * 2));
      const fitted = image.scaleToFit(maxWidth, maxHeight);
      const bounds = rotatedMarkBounds(fitted.width, fitted.height, options.rotation);
      const box = positionBox({
        geometry,
        position: options.position,
        align: options.align ?? "center",
        valign: options.valign ?? "middle",
        width: bounds.width,
        height: bounds.height,
        margin,
        customX: options.customX,
        customY: options.customY,
      });
      const centerX = box.left + bounds.width / 2;
      const centerY = box.bottom + bounds.height / 2;
      const anchor = visualPointToPdf(geometry, {
        x: centerX / box.display.width,
        y: 1 - centerY / box.display.height,
      });
      const radians = rotate * Math.PI / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      page.drawImage(image, {
        x: anchor.x - (fitted.width / 2) * cos + (fitted.height / 2) * sin,
        y: anchor.y - (fitted.width / 2) * sin - (fitted.height / 2) * cos,
        width: fitted.width,
        height: fitted.height,
        rotate: degrees(rotate),
        opacity: options.opacity,
      });
    } else if (font) {
      const maxWidth = options.operation === "page-number"
        ? Math.max(1, display.width - margin * 2)
        : Math.max(1, Math.min(display.width * scale / 100, display.width - margin * 2));
      const metrics = fitText(label, font, options.fontSize, maxWidth);
      const bounds = rotatedMarkBounds(metrics.width, metrics.height, options.rotation);
      const box = positionBox({
        geometry,
        position: options.position,
        align: options.align ?? "center",
        valign: options.valign ?? (options.operation === "page-number" ? "bottom" : "middle"),
        width: bounds.width,
        height: bounds.height,
        margin,
        customX: options.customX,
        customY: options.customY,
      });
      const centerX = box.left + bounds.width / 2;
      const centerY = box.bottom + bounds.height / 2;
      const anchor = visualPointToPdf(geometry, {
        x: centerX / box.display.width,
        y: 1 - centerY / box.display.height,
      });
      const radians = rotate * Math.PI / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const descent = metrics.size * 0.22;
      page.drawText(label, {
        x: anchor.x - (metrics.width / 2) * cos + (metrics.height / 2) * sin - descent * sin,
        y: anchor.y - (metrics.width / 2) * sin - (metrics.height / 2) * cos + descent * cos,
        size: metrics.size,
        font,
        color,
        rotate: degrees(rotate),
        opacity: options.opacity,
      });
    }
    onProgress?.({ completed: ordinal + 1, total: pages.length, label: `Marked page ${pageIndex} of ${count}` });
  });

  const output = new Uint8Array(await pdf.save({ useObjectStreams: true }));
  try {
    if (output.byteLength > PDF_LIMITS.perFileBytes || !checkPdfHeader(output)) throw new Error("The generated PDF exceeded the output limit or failed its PDF signature check.");
    const checked = await PDFDocument.load(output, { updateMetadata: false });
    if (checked.getPageCount() !== count) throw new Error("The generated PDF failed its page-count check.");
    return output;
  } catch (error) {
    output.fill(0);
    throw error;
  }
}
