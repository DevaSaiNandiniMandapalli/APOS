import {
  PDFDocument,
  PDFFont,
  PDFImage,
  StandardFonts,
  rgb,
} from "@cantoo/pdf-lib";
import {
  type Document,
  type ImageBlock,
  type ListItemBlock,
  type PageMargin,
  type PageOrientation,
  type PageSize,
  type PageSettings,
  type RichText,
  renderPageTokens,
} from "./document-editor";
import { checkPdfHeader } from "./pdf-limits";

/* ============================================================
 * Document → PDF export (browser-local, no server upload)
 * ------------------------------------------------------------
 * Uses the already-installed `@cantoo/pdf-lib` standard fonts
 * (Helvetica family, WinAnsi). No new dependency.
 *
 * Pagination model (all units are PDF points, 72 per inch):
 *  - Page box: A4 (595×842) or US Letter (612×792), landscape
 *    swaps width/height.
 *  - Margin: none 0, narrow 36, moderate 56, wide 72.
 *  - Content width   = pageWidth  - 2×margin
 *  - Content top     = pageHeight - margin - headerReserve
 *  - Content bottom  = margin + footerReserve
 *  - Header is drawn from `renderPageTokens(header, page, total)`
 *    with `{{page}}`/`{{pages}}` expanded *after* total pages
 *    are known (two-pass: lay out pages, then draw chrome).
 *  - `showPageNumbers` additionally prints a centered "n / N"
 *    at the bottom of every page.
 *
 * Blocks are laid out sequentially; a block that does not fit
 * the remaining height starts on a new page. Text is wrapped
 * word-by-word against the font's `widthOfTextAtSize`. Lists
 * carry a bullet/number marker; tables draw a bordered grid
 * whose height is measured from the wrapped cell text; links
 * are drawn blue + underlined and added as a real annotation;
 * images are embedded from their data URL.
 *
 * Images: supports PNG and JPEG data URLs. A WebP/GIF/other
 * source decodes to a placeholder box with its alt text so
 * export never fails open.
 * ============================================================ */

export type DocumentPdfExportOptions = {
  /** Override margins (points). Defaults to the document's pageSettings.margin. */
  signal?: AbortSignal;
  onProgress?: (p: { completed: number; total: number }) => void;
  title?: string;
};

export type DocumentPdfExportResult = {
  bytes: Uint8Array;
  pageCount: number;
  title: string;
};

const RGB_INK = rgb(0.12, 0.13, 0.17);
const RGB_MUTED = rgb(0.38, 0.39, 0.45);
const RGB_LINK = rgb(0.16, 0.36, 0.75);
const RGB_GRID = rgb(0.78, 0.79, 0.82);

const FONT = {
  Helvetica: StandardFonts.Helvetica,
  Bold: StandardFonts.HelveticaBold,
  Italic: StandardFonts.HelveticaOblique,
  BoldItalic: StandardFonts.HelveticaBoldOblique,
} as const;

type FontKey = keyof typeof FONT;

const HEADING = {
  h1: { size: 20, leading: 24, spaceBefore: 10, spaceAfter: 6, font: "Bold" as FontKey },
  h2: { size: 15, leading: 18, spaceBefore: 8, spaceAfter: 5, font: "Bold" as FontKey },
  h3: { size: 12, leading: 15, spaceBefore: 6, spaceAfter: 4, font: "Bold" as FontKey },
} as const;

const BODY = { size: 10.5, leading: 14 };

function pageSizeFor(
  size: PageSize,
  orientation: PageOrientation,
): { w: number; h: number } {
  const base = size === "Letter" ? { w: 612, h: 792 } : { w: 595, h: 842 };
  return orientation === "landscape" ? { w: base.h, h: base.w } : base;
}

function marginFor(margin: PageMargin): number {
  switch (margin) {
    case "none":
      return 0;
    case "narrow":
      return 36;
    case "wide":
      return 72;
    case "moderate":
    default:
      return 56;
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
}

function sanitizeTitle(title: string): string {
  return title.trim() || "Document";
}

/** Decode a `data:image/...;base64,...` URL into raw bytes + kind. */
function decodeDataUrl(src: string): { bytes: Uint8Array; kind: "png" | "jpeg" | null } {
  const m = src.match(/^data:image\/([^;,]+);base64,([\s\S]+)$/);
  if (!m) return { bytes: new Uint8Array(0), kind: null };
  const subtype = m[1].toLowerCase();
  const kind = subtype === "png" ? "png" : subtype === "jpeg" || subtype === "jpg" ? "jpeg" : null;
  const b64 = m[2].replace(/\s/g, "");
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, kind };
  } catch {
    return { bytes: new Uint8Array(0), kind: null };
  }
}

type Fonts = Record<FontKey, PDFFont>;

type Run = { text: string; font: PDFFont; color: ReturnType<typeof rgb>; link: string | null };

function runsOf(rich: RichText[], fonts: Fonts): Run[] {
  return rich.flatMap((r) =>
    r.text
      .split("\n")
      .map((part, i) => ({ part, first: i === 0 }))
      .filter(({ part }) => part.length > 0 || r.text === "")
      .map(({ part }) => ({
        text: part,
        font: fonts[fontKeyFor(r.marks.bold, r.marks.italic)],
        color: r.marks.link ? RGB_LINK : RGB_INK,
        link: r.marks.link ?? null,
      })),
  );
}

function fontKeyFor(bold: boolean, italic: boolean): FontKey {
  if (bold && italic) return "BoldItalic";
  if (bold) return "Bold";
  if (italic) return "Italic";
  return "Helvetica";
}

function wrapWords(
  runs: Run[],
  maxWidth: number,
  fontSize: number,
): Array<{ runs: Run[]; width: number; hasBreak: boolean }> {
  const lines: Array<{ runs: Run[]; width: number; hasBreak: boolean }> = [];
  if (runs.length === 0) {
    lines.push({ runs: [], width: 0, hasBreak: false });
    return lines;
  }

  let current: Run[] = [];
  let currentWidth = 0;
  let lastBreak = false;

  const pushLine = (hasBreak: boolean) => {
    lines.push({ runs: current, width: currentWidth, hasBreak });
    current = [];
    currentWidth = 0;
  };

  for (const run of runs) {
    const words = run.text.split(/(\s+)/);
    for (const word of words) {
      if (word === "") continue;
      if (/^\s+$/.test(word)) {
        const width = run.font.widthOfTextAtSize(word, fontSize);
        const wouldBreak = current.length > 0 && currentWidth + width > maxWidth;
        if (wouldBreak) {
          pushLine(false);
        } else {
          current.push({ ...run, text: word });
          currentWidth += width;
        }
        continue;
      }

      const width = run.font.widthOfTextAtSize(word, fontSize);
      const wouldBreak = current.length > 0 && currentWidth + width > maxWidth;
      if (wouldBreak) {
        pushLine(false);
        current.push({ ...run, text: word });
        currentWidth = width;
      } else {
        current.push({ ...run, text: word });
        currentWidth += width;
      }
      lastBreak = false;
    }
    if (run.text.endsWith("\n")) lastBreak = true;
  }

  if (current.length > 0 || lastBreak) pushLine(true);
  if (lines.length === 0) lines.push({ runs: [], width: 0, hasBreak: false });
  return lines;
}

async function embedImage(
  pdf: PDFDocument,
  block: ImageBlock,
): Promise<{ image: { width: number; height: number; scale: (w: number, h: number) => { width: number; height: number } } | null; bytes: Uint8Array; kind: "png" | "jpeg" | null } | null> {
  const { bytes, kind } = decodeDataUrl(block.src);
  if (kind === "png" && bytes.length > 0) {
    try {
      const img = await pdf.embedPng(bytes);
      return { image: img, bytes, kind };
    } catch {
      return null;
    }
  }
  if (kind === "jpeg" && bytes.length > 0) {
    try {
      const img = await pdf.embedJpg(bytes);
      return { image: img, bytes, kind };
    } catch {
      return null;
    }
  }
  return null;
}

export async function documentToPdf(
  doc: Document,
  options: DocumentPdfExportOptions = {},
): Promise<DocumentPdfExportResult> {
  const signal = options.signal;
  throwIfAborted(signal);

  const blocks = doc.blocks ?? [];
  const settings: PageSettings = doc.pageSettings;
  const title = sanitizeTitle(options.title ?? doc.title ?? "Untitled");

  const { w: pageWidth, h: pageHeight } = pageSizeFor(settings.size, settings.orientation);
  const margin = marginFor(settings.margin);
  const headerReserve = settings.header.trim() ? 26 : 0;
  const footerReserve = settings.footer.trim() || settings.showPageNumbers ? 26 : 0;
  const contentWidth = Math.max(72, pageWidth - margin * 2);
  const contentTop = pageHeight - margin - headerReserve;
  const contentBottom = margin + footerReserve;
  const lineHeight = BODY.leading;
  const listIndent = 14;

  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator("APOS Document Studio");
  pdf.setProducer("APOS Document Studio");
  pdf.setSubject(title);

  const fonts: Fonts = {
    Helvetica: await pdf.embedFont(FONT.Helvetica),
    Bold: await pdf.embedFont(FONT.Bold),
    Italic: await pdf.embedFont(FONT.Italic),
    BoldItalic: await pdf.embedFont(FONT.BoldItalic),
  };

  // ---- First pass: layout -------------------------------------------------
  // We keep a list of "page chunks": drawing ops deferred until we know
  // the total page count (needed for {{page}}/{{pages}} tokens).
  type EmbeddedImage = PDFImage;
  type Op =
    | { kind: "text"; page: number; x: number; y: number; size: number; font: PDFFont; color: ReturnType<typeof rgb>; text: string; underline?: boolean; link?: string }
    | { kind: "line"; page: number; x1: number; y1: number; x2: number; y2: number }
    | { kind: "image"; page: number; x: number; y: number; w: number; h: number; image: EmbeddedImage }
    | { kind: "imagePlaceholder"; page: number; x: number; y: number; w: number; h: number; alt: string };

  const ops: Op[] = [];
  const annotations: Array<{ page: number; x: number; y: number; w: number; h: number; url: string }> = [];

  pdf.addPage([pageWidth, pageHeight]);
  let pageIndex = 0;
  let y = contentTop;

  const ensureSpace = (needed: number) => {
    if (needed <= contentTop - contentBottom) {
      if (y - needed < contentBottom) {
        pdf.addPage([pageWidth, pageHeight]);
        pageIndex += 1;
        y = contentTop;
      }
    } else {
      // Even a full page of space isn't enough (e.g. an image taller
      // than the content column): clamp to one full page.
      if (y < contentTop) {
        pdf.addPage([pageWidth, pageHeight]);
        pageIndex += 1;
        y = contentTop;
      }
    }
  };

  const emit = (op: Op) => ops.push(op);

  const totalBlocks = blocks.length;
  let blockIndex = 0;

  let listCounter = 0;
  let lastWasListContinuation = false;

  for (const block of blocks) {
    throwIfAborted(signal);
    blockIndex += 1;
    options.onProgress?.({ completed: blockIndex - 1, total: totalBlocks });

    if (block.type === "bullet" || block.type === "number") {
      // Start a fresh run when the list kind changes.
      if ((block as ListItemBlock).type === "number" && !lastWasListContinuation) listCounter = 0;
      const item = block as ListItemBlock;
      if (item.type === "number") listCounter += 1;
      const marker = item.type === "bullet" ? "•" : `${listCounter}.`;
      const markerWidth = fonts.Helvetica.widthOfTextAtSize(marker, BODY.size) + 6;
      const indentX = margin + listIndent;
      const lines = wrapWords(runsOf(item.text, fonts), contentWidth - listIndent - markerWidth, BODY.size);
      const blockHeight = lines.length * lineHeight + 2;
      ensureSpace(blockHeight);
      emit({
        kind: "text",
        page: pageIndex,
        x: indentX,
        y,
        size: BODY.size,
        font: fonts.Helvetica,
        color: RGB_INK,
        text: marker,
      });
      let cursorY = y;
      for (const line of lines) {
        let cx = indentX + markerWidth;
        for (const run of line.runs) {
          const width = run.font.widthOfTextAtSize(run.text, BODY.size);
          emit({
            kind: "text",
            page: pageIndex,
            x: cx,
            y: cursorY,
            size: BODY.size,
            font: run.font,
            color: run.color,
            text: run.text,
            ...(run.link ? { underline: true, link: run.link } : {}),
          });
          if (run.link) annotations.push({ page: pageIndex, x: cx, y: cursorY, w: width, h: BODY.size, url: run.link });
          cx += width;
        }
        cursorY -= lineHeight;
      }
      y = cursorY + 2;
      lastWasListContinuation = item.type === "number";
      continue;
    }
    lastWasListContinuation = false;

    if (block.type === "paragraph" || block.type === "h1" || block.type === "h2" || block.type === "h3") {
      const isHeading = block.type !== "paragraph";
      const heading = isHeading ? HEADING[block.type as "h1" | "h2" | "h3"] : null;
      const size = heading ? heading.size : BODY.size;
      const leading = heading ? heading.leading : BODY.leading;
      const font = fonts[heading ? heading.font : "Helvetica"];
      const spaceBefore = heading ? heading.spaceBefore : 0;
      const spaceAfter = heading ? heading.spaceAfter : 0;

      const runs = runsOf(block.text, fonts).map((r) => ({ ...r, font: heading ? font : r.font }));
      const lines = wrapWords(runs, contentWidth, size);

      const needed = spaceBefore + lines.length * leading + spaceAfter;
      ensureSpace(needed);

      let cursorY = y - spaceBefore - size;
      for (const line of lines) {
        let cx = margin;
        for (const run of line.runs) {
          const width = run.font.widthOfTextAtSize(run.text, size);
          emit({
            kind: "text",
            page: pageIndex,
            x: cx,
            y: cursorY,
            size,
            font: run.font,
            color: run.color,
            text: run.text,
            ...(run.link ? { underline: true, link: run.link } : {}),
          });
          if (run.link) annotations.push({ page: pageIndex, x: cx, y: cursorY, w: width, h: size, url: run.link });
          cx += width;
        }
        cursorY -= leading;
      }
      y = cursorY + spaceAfter;
      continue;
    }

    if (block.type === "table") {
      const table = block as { rows?: Array<{ cells?: Array<{ paragraphs?: RichText[][] }> }> };
      const rows = table.rows ?? [];
      if (rows.length === 0) continue;

      const colCount = Math.max(1, ...rows.map((r) => (r.cells?.length ?? 0)));
      const colWidth = contentWidth / colCount;
      const pad = 5;

      // Measure each row's height first so we can keep rows intact.
      const measured: Array<Array<{ lines: Array<{ runs: Run[] }>; height: number }>> = [];
      for (const row of rows) {
        const cells = row.cells ?? [];
        const cellLines: Array<{ lines: Array<{ runs: Run[] }>; height: number }> = [];
        for (let c = 0; c < colCount; c++) {
          const cell = cells[c];
          const paragraphs = cell?.paragraphs ?? [];
          const allLines: Array<{ runs: Run[] }> = [];
          for (const para of paragraphs) {
            const lines = wrapWords(runsOf(para, fonts), colWidth - pad * 2, BODY.size);
            for (const l of lines) allLines.push({ runs: l.runs });
          }
          if (allLines.length === 0) allLines.push({ runs: [] });
          cellLines.push({ lines: allLines, height: allLines.length * lineHeight + pad * 2 });
        }
        measured.push(cellLines);
      }

      for (let r = 0; r < rows.length; r++) {
        const rowHeight = Math.max(...measured[r].map((c) => c.height), 18);
        ensureSpace(rowHeight + 2);

        const topY = y;
        for (let c = 0; c < colCount; c++) {
          const x = margin + c * colWidth;
          const cell = measured[r][c];
          let cy = topY - pad - BODY.size;
          for (const line of cell.lines) {
            let cx = x + pad;
            for (const run of line.runs) {
              const width = run.font.widthOfTextAtSize(run.text, BODY.size);
              emit({
                kind: "text",
                page: pageIndex,
                x: cx,
                y: cy,
                size: BODY.size,
                font: run.font,
                color: run.color,
                text: run.text,
                ...(run.link ? { underline: true, link: run.link } : {}),
              });
              if (run.link) annotations.push({ page: pageIndex, x: cx, y: cy, w: width, h: BODY.size, url: run.link });
              cx += width;
            }
            cy -= lineHeight;
          }
          emit({ kind: "line", page: pageIndex, x1: x, y1: topY, x2: x, y2: topY - rowHeight });
          emit({ kind: "line", page: pageIndex, x1: x, y1: topY - rowHeight, x2: x + colWidth, y2: topY - rowHeight });
        }
        y -= rowHeight + 2;
      }
      continue;
    }

    if (block.type === "image") {
      const imgBlock = block as ImageBlock;
      const embedded = await embedImage(pdf, imgBlock);
      // embedImage returns a minimal structural type; cast to the real class.
      const embeddedImage = embedded?.image as PDFImage | null | undefined;
      // Natural size, clamped to content column.
      let w = 200;
      let h = 150;
      if (imgBlock.width && imgBlock.height) {
        w = imgBlock.width;
        h = imgBlock.height;
      } else if (embeddedImage) {
        w = embeddedImage.width;
        h = embeddedImage.height;
      }
      w = Math.min(w, contentWidth);
      h = Math.min(h, contentTop - contentBottom);
      if (w <= 0 || h <= 0) {
        w = 200;
        h = 150;
      }
      ensureSpace(h + 6);
      const x = margin + Math.max(0, (contentWidth - w) / 2);
      const topY = y;
      if (embeddedImage) {
        emit({ kind: "image", page: pageIndex, x, y: topY - h, w, h, image: embeddedImage });
      } else {
        // Placeholder box for unsupported image sources.
        const alt = imgBlock.alt || "Image placeholder";
        emit({ kind: "imagePlaceholder", page: pageIndex, x, y: topY - h, w, h, alt });
        const lines = wrapWords(
          [{ text: alt, font: fonts.Italic, color: RGB_MUTED, link: null }],
          w - 16,
          9,
        );
        let ly = topY - h / 2 + (lines.length * 11) / 2;
        for (const line of lines) {
          emit({
            kind: "text",
            page: pageIndex,
            x: x + 8,
            y: ly,
            size: 9,
            font: fonts.Italic,
            color: RGB_MUTED,
            text: line.runs.map((r) => r.text).join(""),
          });
          ly -= 11;
        }
      }
      y = topY - h - 6;
      continue;
    }
  }

  options.onProgress?.({ completed: totalBlocks, total: totalBlocks });

  const totalPages = pdf.getPageCount();
  const pages = pdf.getPages();

  // ---- Second pass: draw chrome (header/footer + page numbers) -----------
  for (let i = 0; i < totalPages; i++) {
    throwIfAborted(signal);
    const p = pages[i];
    const pageNo = i + 1;

    if (settings.header.trim()) {
      const text = renderPageTokens(settings.header, pageNo, totalPages);
      p.drawText(text, {
        x: margin,
        y: pageHeight - margin - headerReserve + 6,
        size: 9,
        font: fonts.Italic,
        color: RGB_MUTED,
      });
    }

    if (settings.footer.trim()) {
      const text = renderPageTokens(settings.footer, pageNo, totalPages);
      p.drawText(text, {
        x: margin,
        y: margin + 2,
        size: 9,
        font: fonts.Italic,
        color: RGB_MUTED,
      });
    }

    if (settings.showPageNumbers) {
      const text = `${pageNo} / ${totalPages}`;
      const tw = fonts.Helvetica.widthOfTextAtSize(text, 9);
      p.drawText(text, {
        x: (pageWidth - tw) / 2,
        y: margin + 2,
        size: 9,
        font: fonts.Helvetica,
        color: RGB_MUTED,
      });
    }
  }

  // ---- Third pass: draw content ops --------------------------------------
  for (const op of ops) {
    throwIfAborted(signal);
    const p = pages[op.page];
    if (!p) continue;
    if (op.kind === "text") {
      p.drawText(op.text, { x: op.x, y: op.y, size: op.size, font: op.font, color: op.color });
      if (op.underline) {
        p.drawLine({
          start: { x: op.x, y: op.y - 1.2 },
          end: { x: op.x + op.font.widthOfTextAtSize(op.text, op.size), y: op.y - 1.2 },
          thickness: 0.7,
          color: RGB_LINK,
        });
      }
    } else if (op.kind === "line") {
      p.drawLine({
        start: { x: op.x1, y: op.y1 },
        end: { x: op.x2, y: op.y2 },
        thickness: 0.6,
        color: RGB_GRID,
      });
    } else if (op.kind === "image") {
      p.drawImage(op.image, { x: op.x, y: op.y, width: op.w, height: op.h });
    } else {
      // imagePlaceholder: border + nothing (alt text already emitted as text)
      p.drawRectangle({
        x: op.x,
        y: op.y,
        width: op.w,
        height: op.h,
        borderColor: RGB_GRID,
        borderWidth: 0.8,
      });
    }
  }

  // ---- Link annotations ---------------------------------------------------
  for (const ann of annotations) {
    const p = pages[ann.page];
    if (!p) continue;
    const url = ann.url.startsWith("http://") || ann.url.startsWith("https://") || ann.url.startsWith("mailto:")
      ? ann.url
      : `https://${ann.url}`;
    try {
      const pageAny = p as unknown as {
        addLinkAnnotation?: (a: { x: number; y: number; width: number; height: number; url: string }) => void;
        context?: unknown;
        node?: { setContext?: (c: unknown) => void };
      };
      if (typeof pageAny.addLinkAnnotation === "function") {
        pageAny.addLinkAnnotation({
          x: ann.x,
          y: ann.y,
          width: ann.w,
          height: ann.h,
          url,
        });
      } else if (pageAny.node?.setContext) {
        pageAny.node.setContext(pdf.context);
      }
    } catch {
      /* Annotation failure must not break the export. */
    }
  }

  // ---- Validate -----------------------------------------------------------
  const bytes = new Uint8Array(await pdf.save({ useObjectStreams: true }));
  if (!checkPdfHeader(bytes) || bytes.byteLength === 0) {
    throw new Error("The generated PDF failed its header check.");
  }
  // Re-open to verify the file is a readable PDF and count pages.
  let verifiedPages = 0;
  try {
    const check = await PDFDocument.load(bytes, { updateMetadata: false });
    verifiedPages = check.getPageCount();
  } catch {
    throw new Error("The generated PDF could not be reopened for validation.");
  }
  if (verifiedPages !== totalPages) {
    throw new Error("The generated PDF failed its page-count check.");
  }

  return { bytes, pageCount: totalPages, title };
}

/** Download helper that mirrors the .apos.json Save flow. */
export function downloadPdfBlob(bytes: Uint8Array, title: string) {
  const safeTitle = (title.trim() || "document").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 100) || "document";
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeTitle}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// Legacy alias used by older call sites in tests.
export async function exportDocumentToPdf(doc: Document, options?: DocumentPdfExportOptions) {
  return documentToPdf(doc, options);
}
