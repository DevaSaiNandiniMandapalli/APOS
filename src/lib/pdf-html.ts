import type { PDFDocumentProxy } from "pdfjs-dist";
import { zipSync } from "fflate";
import { buildPdfPageStructure, normalisePageTextItems, type PdfLine } from "./pdf-structured";
import { dataUrlToImageBytes, extractPdfPictures } from "./pdf-pictures";

export type HtmlBlock =
  | { kind: "text"; text: string; y?: number }
  | { kind: "heading"; text: string; level: 1 | 2 | 3; y?: number }
  | { kind: "table"; rows: string[][]; header: boolean; y?: number; x?: number; width?: number; height?: number }
  | {
    kind: "image";
    dataUrl: string;
    width: number;
    height: number;
    y?: number;
    x?: number;
    boxWidth?: number;
    boxHeight?: number;
    pageWidth?: number;
    pageHeight?: number;
  };

export type HtmlPageLine = Pick<PdfLine, "text" | "x" | "y" | "width" | "fontSize">;

export type HtmlPage = {
  page: number;
  width?: number;
  height?: number;
  blocks: HtmlBlock[];
  lines?: HtmlPageLine[];
};

export type PdfHtmlMode = "reading" | "layout";

export type PdfHtmlOptions = {
  mode?: PdfHtmlMode;
  includeImages?: boolean;
  includeTables?: boolean;
  includePageLabels?: boolean;
  inlineImages?: boolean;
  assetPath?: (pageNumber: number, imageIndex: number) => string;
};

type PdfJsModule = typeof import("pdfjs-dist");

export async function extractPdfHtmlPages(
  document: PDFDocumentProxy,
  options: {
    pages?: readonly number[];
    signal?: AbortSignal;
    onProgress?: (page: number, total: number) => void;
    includePictures?: boolean;
  } = {},
) {
  const pdfjs: PdfJsModule = await import("pdfjs-dist");
  const pageNumbers = options.pages ?? Array.from({ length: document.numPages }, (_, index) => index + 1);
  const pages: HtmlPage[] = [];
  for (let position = 0; position < pageNumbers.length; position += 1) {
    if (options.signal?.aborted) throw new DOMException("Conversion cancelled", "AbortError");
    const pageNumber = pageNumbers[position];
    const page = await document.getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const raw = normalisePageTextItems(pdfjs, content.items as unknown[], viewport);
      const structure = buildPdfPageStructure(raw, viewport.width, viewport.height, pageNumber);
      const pictures = options.includePictures === false
        ? []
        : await extractPdfPictures(document, { pages: [pageNumber], signal: options.signal });
      const blocks: HtmlBlock[] = structure.blocks.map((block) => {
        if (block.kind === "table") {
          return { kind: "table", rows: block.table.rows, header: block.table.header, y: block.table.y, x: block.table.x, width: block.table.width, height: block.table.height };
        }
        if (block.kind === "heading") return { kind: "heading", text: block.text, level: block.level ?? 2, y: block.y };
        return { kind: "text", text: block.text, y: block.y };
      });
      for (const picture of pictures) {
        blocks.push({
          kind: "image",
          dataUrl: picture.dataUrl,
          width: picture.width,
          height: picture.height,
          x: picture.x,
          y: picture.y,
          boxWidth: picture.boxWidth,
          boxHeight: picture.boxHeight,
          pageWidth: picture.pageWidth,
          pageHeight: picture.pageHeight,
        });
      }
      blocks.sort((left, right) => (right.y ?? 0) - (left.y ?? 0));
      pages.push({
        page: pageNumber,
        width: viewport.width,
        height: viewport.height,
        blocks,
        lines: structure.lines.map((line) => ({
          text: line.text,
          x: line.x,
          y: line.y,
          width: line.width,
          fontSize: line.fontSize,
        })),
      });
    } finally {
      page.cleanup();
    }
    options.onProgress?.(position + 1, pageNumbers.length);
  }
  return { pages, totalPages: pageNumbers.length };
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function cssValue(value: number) {
  return Math.max(0, Math.min(100, value)).toFixed(3);
}

const STYLE = [
  ":root{color-scheme:light dark}",
  "body{margin:0;background:#eef0f5;color:#20212b;font:16px/1.65 system-ui,-apple-system,'Segoe UI',sans-serif}",
  "main{max-width:980px;margin:0 auto;padding:28px 18px 48px}",
  "header.document-head{margin:0 0 24px;padding:20px 22px;border:1px solid #d9dce8;border-radius:14px;background:#fff}",
  "header.document-head h1{margin:0 0 6px;font-size:clamp(24px,4vw,34px);line-height:1.15}",
  "header.document-head p{margin:0;color:#656a7e;font-size:14px}",
  "section.page{margin:0 0 26px;padding:20px 22px;border:1px solid #d9dce8;border-radius:14px;background:#fff;box-shadow:0 4px 16px rgba(25,25,45,.04)}",
  "section.page>h2{margin:0 0 14px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7a7f94}",
  "p{margin:0 0 .85rem;overflow-wrap:anywhere}",
  ".pdf-heading{margin:1.2rem 0 .6rem;line-height:1.25;color:#171822}",
  "h3.pdf-heading{font-size:1.28rem}h4.pdf-heading{font-size:1.12rem}h5.pdf-heading{font-size:1rem}",
  "figure{margin:1rem 0;padding:10px;border:1px solid #e0e2eb;border-radius:10px;background:#fafbfe}",
  "img{max-width:100%;height:auto;border-radius:6px}",
  "figcaption{color:#656a7e;font-size:12px;margin-top:6px}",
  "table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:.92em}",
  "th,td{border:1px solid #d7dae5;padding:7px 9px;text-align:left;vertical-align:top;overflow-wrap:anywhere}",
  "th{background:#f1f3f9;font-weight:700}",
  ".empty-page{color:#7a7f94;font-style:italic}",
  ".layout-note{max-width:980px;margin:16px auto 0;padding:0 18px;color:#656a7e;font-size:13px}",
  "section.pdf-page-layout{margin:0 0 26px;padding:0 0 0;background:#fff;border:1px solid #d9dce8;border-radius:10px;overflow:hidden}",
  ".layout-canvas{position:relative;width:100%;background:#fff;overflow:hidden}",
  ".layout-line{position:absolute;white-space:pre;line-height:1.15;color:#181922;transform-origin:left top;overflow:hidden}",
  ".layout-image{position:absolute;object-fit:fill;border:0}",
  ".layout-table{position:absolute;border-collapse:collapse;font-size:60%;background:#fff;margin:0}",
  ".layout-table td,.layout-table th{border:1px solid #c8cbd8;padding:1px 3px;font-size:8px;line-height:1.15}",
  ".layout-page-label{position:absolute;left:8px;top:6px;font-size:10px;color:#8a8fa3;z-index:2}",
  "@media(max-width:640px){main{padding:16px 10px 32px}header.document-head,section.page{padding:14px 14px;border-radius:10px}table{display:block;overflow-x:auto}}",
  "@media print{body{background:#fff}main{max-width:none;padding:0}header.document-head,section.page{box-shadow:none;border-color:#ccc;break-inside:avoid}}",
].join("");

function renderTable(rows: string[][], header: boolean) {
  if (!rows.length) return "";
  const head = header && rows.length > 1
    ? `<thead><tr>${rows[0].map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead>`
    : "";
  const bodyRows = header && rows.length > 1 ? rows.slice(1) : rows;
  return `<table>${head}<tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function readingBody(page: HtmlPage, options: Required<Pick<PdfHtmlOptions, "includeImages" | "includeTables">> & PdfHtmlOptions) {
  const blocks = page.blocks.filter((block) => {
    if (block.kind === "image" && !options.includeImages) return false;
    return true;
  });
  if (!blocks.length) return '<p class="empty-page">This page has no selectable text or pictures.</p>';
  return blocks.map((block, index) => {
    if (block.kind === "heading") {
      const level = Math.min(5, Math.max(3, block.level + 1));
      return `<h${level} class="pdf-heading level-${block.level}">${escapeHtml(block.text)}</h${level}>`;
    }
    if (block.kind === "table") {
      if (!options.includeTables) return `<p>${escapeHtml(block.rows.map((row) => row.join(" | ")).join("\n"))}</p>`;
      return renderTable(block.rows, block.header);
    }
    if (block.kind === "image") {
      const imageIndex = blocks.slice(0, index + 1).filter((item) => item.kind === "image").length;
      const source = options.inlineImages === false && options.assetPath
        ? options.assetPath(page.page, imageIndex)
        : block.dataUrl;
      return `<figure><img src="${escapeHtml(source)}" width="${Math.round(block.width)}" height="${Math.round(block.height)}" alt="Picture on page ${page.page}" loading="lazy"><figcaption>Picture on page ${page.page}</figcaption></figure>`;
    }
    return `<p>${escapeHtml(block.text)}</p>`;
  }).join("");
}

function layoutBody(page: HtmlPage, options: Required<Pick<PdfHtmlOptions, "includeImages" | "includeTables">> & PdfHtmlOptions) {
  const width = page.width ?? 595;
  const height = page.height ?? 842;
  const lines = page.lines ?? [];
  const blocks = page.blocks.filter((block) => {
    if (block.kind === "image" && !options.includeImages) return false;
    if (block.kind === "table" && !options.includeTables) return false;
    return block.kind === "table" || block.kind === "image";
  });
  const baseFont = Math.max(8, width / 52);
  const tableRects = page.blocks.filter((block): block is Extract<HtmlBlock, { kind: "table" }> => block.kind === "table" && Boolean(options.includeTables));
  const visibleLines = lines.filter((line) => !tableRects.some((table) => table.y !== undefined && table.height !== undefined && line.y <= table.y + 2 && line.y >= table.y - table.height));
  const textParts = visibleLines.map((line) => {
    const left = (line.x / width) * 100;
    const top = ((height - line.y - line.fontSize) / height) * 100;
    const size = (line.fontSize / baseFont) * 100;
    return `<span class="layout-line" style="left:${cssValue(left)}%;top:${cssValue(top)}%;width:${cssValue((line.width / width) * 100)}%;font-size:${size.toFixed(2)}%">${escapeHtml(line.text)}</span>`;
  }).join("");
  let imageIndex = 0;
  const blockParts = blocks.map((block) => {
    if (block.kind === "table") {
      const left = ((block.x ?? 0) / width) * 100;
      const top = ((height - (block.y ?? 0) - (block.height ?? 0)) / height) * 100;
      return `<table class="layout-table" style="left:${cssValue(left)}%;top:${cssValue(top)}%;width:${cssValue(((block.width ?? width) / width) * 100)}%">${block.rows.map((row, rowIndex) => `<tr>${row.map((cell) => rowIndex === 0 && block.header ? `<th>${escapeHtml(cell)}</th>` : `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</table>`;
    }
    if (block.kind === "image") {
      imageIndex += 1;
      const pictureWidth = block.boxWidth ?? block.width;
      const pictureHeight = block.boxHeight ?? block.height;
      const pageWidth = block.pageWidth ?? width;
      const pageHeight = block.pageHeight ?? height;
      const left = ((block.x ?? 0) / pageWidth) * 100;
      const top = ((pageHeight - (block.y ?? 0) - pictureHeight) / pageHeight) * 100;
      const source = options.inlineImages === false && options.assetPath
        ? options.assetPath(page.page, imageIndex)
        : block.dataUrl;
      return `<img class="layout-image" src="${escapeHtml(source)}" alt="Picture on page ${page.page}" style="left:${cssValue(left)}%;top:${cssValue(top)}%;width:${cssValue((pictureWidth / pageWidth) * 100)}%;height:${cssValue((pictureHeight / pageHeight) * 100)}%" loading="lazy">`;
    }
    return "";
  }).join("");
  return `<div class="layout-canvas" style="aspect-ratio:${width}/${height};font-size:${baseFont.toFixed(2)}px">${options.includePageLabels === false ? "" : `<span class="layout-page-label" aria-hidden="true">Page ${page.page}</span>`}${textParts}${blockParts}</div>`;
}

export function buildPdfHtml(title: string, pages: HtmlPage[], options: PdfHtmlOptions = {}) {
  const mode = options.mode ?? "reading";
  const resolved = {
    mode,
    includeImages: options.includeImages !== false,
    includeTables: options.includeTables !== false,
    includePageLabels: options.includePageLabels !== false,
    inlineImages: options.inlineImages !== false,
    assetPath: options.assetPath,
  };
  const body = pages.map((page) => {
    if (mode === "layout") {
      return `<section class="pdf-page-layout" id="page-${page.page}" aria-label="Page ${page.page}">${layoutBody(page, resolved)}</section>`;
    }
    return `<section class="page" id="page-${page.page}" aria-label="Page ${page.page}">${resolved.includePageLabels ? `<h2>Page ${page.page}</h2>` : ""}${readingBody(page, resolved)}</section>`;
  }).join("");
  const note = mode === "layout" ? '<p class="layout-note">Layout mode approximates the original PDF page arrangement. Text remains selectable and may reflow differently at small screen sizes.</p>' : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: file:; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; base-uri 'none'"><meta name="generator" content="APOS"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main><header class="document-head"><h1>${escapeHtml(title)}</h1><p>Converted from PDF by APOS · ${pages.length} page${pages.length === 1 ? "" : "s"} · ${mode === "layout" ? "approximate layout view" : "reading view"}</p></header>${body}${note}</main></body></html>`;
}

export function buildPdfHtmlPackage(title: string, pages: HtmlPage[], options: PdfHtmlOptions = {}) {
  const assets: Record<string, Uint8Array> = {};
  const imagePaths = new Map<string, string>();
  for (const page of pages) {
    let imageIndex = 0;
    for (const block of page.blocks) {
      if (block.kind !== "image" || options.includeImages === false) continue;
      imageIndex += 1;
      const converted = dataUrlToImageBytes(block.dataUrl);
      const extension = converted.format === "png" ? "png" : "jpg";
      const path = `assets/page-${page.page}-picture-${imageIndex}.${extension}`;
      assets[path] = converted.bytes;
      imagePaths.set(`${page.page}:${imageIndex}`, path);
    }
  }
  const html = buildPdfHtml(title, pages, {
    ...options,
    inlineImages: false,
    assetPath: (pageNumber, imageIndex) => imagePaths.get(`${pageNumber}:${imageIndex}`) ?? "",
  });
  const readme = `APOS PDF to HTML package\n\nOpen index.html in any modern browser. The assets folder contains the pictures referenced by the HTML.\n\nThis package was generated locally in the browser. No document content was uploaded to APOS.\n`;
  const archive = zipSync({ "index.html": strToUtf8(html), "README.txt": strToUtf8(readme), ...assets });
  return { html, archive };
}

function strToUtf8(value: string) {
  return new TextEncoder().encode(value);
}
