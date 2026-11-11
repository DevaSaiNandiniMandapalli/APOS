import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export type HtmlBlock =
  | { kind: "text"; text: string }
  | { kind: "image"; dataUrl: string; width: number; height: number };

export type HtmlPage = { page: number; blocks: HtmlBlock[] };

type Ctm = [number, number, number, number, number, number];
type Picture = { y: number; x: number; width: number; height: number };
type Line = { y: number; x: number; text: string };

const MAX_PICTURE_WIDTH = 1100;
const RENDER_SCALE = 1.5;

function cropPicture(source: HTMLCanvasElement, picture: Picture, pageHeight: number) {
  const left = Math.max(0, Math.round(picture.x * RENDER_SCALE) - 2);
  const top = Math.max(0, Math.round((pageHeight - picture.y - picture.height) * RENDER_SCALE) - 2);
  const width = Math.min(source.width - left, Math.round(picture.width * RENDER_SCALE) + 4);
  const height = Math.min(source.height - top, Math.round(picture.height * RENDER_SCALE) + 4);
  if (width < 8 || height < 8) return null;
  const scale = width > MAX_PICTURE_WIDTH ? MAX_PICTURE_WIDTH / width : 1;
  const target = document.createElement("canvas");
  target.width = Math.max(1, Math.round(width * scale));
  target.height = Math.max(1, Math.round(height * scale));
  const context = target.getContext("2d");
  if (!context) return null;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, left, top, width, height, 0, 0, target.width, target.height);
  return { dataUrl: target.toDataURL("image/jpeg", 0.85), width: target.width, height: target.height };
}

function collectPageContent(text: { str: string; transform?: number[] }[]) {
  const lines = new Map<number, Line[]>();
  for (const item of text) {
    const value = item.str?.trim();
    if (!value) continue;
    const transform = item.transform ?? [];
    const x = transform[4] ?? 0;
    const y = transform[5] ?? 0;
    const key = Math.round(y / 3);
    const bucket = lines.get(key) ?? [];
    bucket.push({ y, x, text: value });
    lines.set(key, bucket);
  }
  return [...lines.values()]
    .map((bucket) => {
      const sorted = bucket.sort((left, right) => left.x - right.x);
      return { y: sorted[0].y, x: sorted[0].x, text: sorted.map((entry) => entry.text).join(" ").replace(/\s+/g, " ").trim() };
    })
    .filter((line) => line.text.length > 0)
    .sort((left, right) => right.y - left.y || left.x - right.x);
}

async function paintPage(page: PDFPageProxy) {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const pageHeight = page.getViewport({ scale: 1 }).height;
  return { canvas, pageHeight };
}

export async function extractPdfHtmlPages(
  document: PDFDocumentProxy,
  options: { signal?: AbortSignal; onProgress?: (page: number, total: number) => void } = {},
) {
  const pdfjs = await import("pdfjs-dist");
  const pages: HtmlPage[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    if (options.signal?.aborted) throw new DOMException("Conversion cancelled", "AbortError");
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    const operators = await page.getOperatorList();
    const lines = collectPageContent(content.items as { str: string; transform?: number[] }[]);
    const pictures: Picture[] = [];
    let base: { x: number; y: number } = { x: 0, y: 0 };
    let pendingScale: { width: number; height: number } | null = null;
    for (let op = 0; op < operators.fnArray.length; op += 1) {
      const fn = operators.fnArray[op];
      const args = operators.argsArray[op] as unknown[] | undefined;
      if (fn === pdfjs.OPS.transform && args?.length === 6) {
        const matrix = args as Ctm;
        if (matrix[4] !== 0 || matrix[5] !== 0) base = { x: matrix[4], y: matrix[5] };
        else if (Math.abs(matrix[0]) > 1 || Math.abs(matrix[3]) > 1) pendingScale = { width: Math.abs(matrix[0]), height: Math.abs(matrix[3]) };
      } else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
        if (pendingScale && pendingScale.width > 4 && pendingScale.height > 4) {
          pictures.push({ x: base.x, y: base.y, width: pendingScale.width, height: pendingScale.height });
        }
      }
    }
    let painted: { canvas: HTMLCanvasElement; pageHeight: number } | null = null;
    const blocks: HtmlBlock[] = [];
    const lineQueue = lines.map((line) => ({ y: line.y, line }));
    const pictureQueue = pictures.map((picture) => ({ y: picture.y + picture.height, picture }));
    while (pictureQueue.length || lineQueue.length) {
      const nextLine = lineQueue[0];
      const nextPicture = pictureQueue[0];
      if (nextPicture && (!nextLine || nextPicture.y >= nextLine.y)) {
        const { picture } = pictureQueue.shift()!;
        painted = painted ?? (await paintPage(page));
        const cropped = painted ? cropPicture(painted.canvas, picture, painted.pageHeight) : null;
        if (cropped) blocks.push({ kind: "image", ...cropped });
        continue;
      }
      if (!nextLine) break;
      lineQueue.shift();
      blocks.push({ kind: "text", text: nextLine.line.text });
    }
    if (!blocks.some((block) => block.kind === "image")) {
      const operatorsWithPictures = operators.fnArray.some((fn) => fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject);
      if (operatorsWithPictures) {
        painted = painted ?? (await paintPage(page));
        if (painted) blocks.push({ kind: "image", dataUrl: painted.canvas.toDataURL("image/jpeg", 0.85), width: painted.canvas.width, height: painted.canvas.height });
      }
    }
    pages.push({ page: index, blocks });
    page.cleanup();
    options.onProgress?.(index, document.numPages);
  }
  return { pages, totalPages: document.numPages };
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const STYLE = "body{max-width:900px;margin:2rem auto;padding:0 1rem;font:17px/1.65 system-ui,sans-serif;color:#20212b}"
  + "section.page{margin:0 0 2.5rem;padding:0 0 1.5rem;border-bottom:1px solid #e4e6ef}"
  + "section.page:last-of-type{border-bottom:0}"
  + "h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#6b6f86;margin:0 0 .8rem}"
  + "p{margin:0 0 .7rem;overflow-wrap:anywhere}"
  + "figure{margin:1rem 0}img{max-width:100%;height:auto;border:1px solid #d8dae5;border-radius:6px}"
  + "figcaption{color:#5b5f74;font-size:13px}";

export function buildPdfHtml(title: string, pages: HtmlPage[]) {
  const body = pages
    .map((page) => {
      const inner = page.blocks
        .map((block) => block.kind === "text"
          ? `<p>${escapeHtml(block.text)}</p>`
          : `<figure><img src="${block.dataUrl}" width="${block.width}" height="${block.height}" alt="Picture on page ${page.page}"><figcaption>Picture on page ${page.page}</figcaption></figure>`)
        .join("");
      return `<section class="page" id="page-${page.page}"><h2>Page ${page.page}</h2>${inner}</section>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}
