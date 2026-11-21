import { identifyImageFormat, readImageDimensions } from "./image-format";
import { unzipSync, zipSync, strToU8 } from "fflate";

export const OFFICE_LIMITS = {
  maxParagraphs: 20000,
  maxRows: 5000,
  maxColumns: 40,
  maxSlides: 200,
  maxCharacters: 500000,
} as const;

export const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
export const OFFICE_DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Irreversible check that a zip-based Office file can be read. Returns null when it cannot. */
export function unzipOffice(bytes: Uint8Array): Record<string, Uint8Array> | null {
  try {
    return unzipSync(bytes);
  } catch {
    return null;
  }
}

export function buildDocx(paragraphs: string[], title = "Converted document"): Uint8Array {
  const body = paragraphs
    .map((paragraph) => {
      const text = xmlEscape(paragraph);
      return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    })
    .join("");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_DOC_REL}" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEscape(title)}</dc:title></cp:coreProperties>`;

  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "docProps/core.xml": strToU8(core),
    "word/document.xml": strToU8(documentXml),
  });
}

function columnName(index: number): string {
  let name = "";
  let value = index;
  while (value >= 0) {
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26) - 1;
  }
  return name;
}

export function buildXlsx(rows: string[][], sheetName = "Sheet1"): Uint8Array {
  const sheetRows = rows
    .map((cells, rowIndex) => {
      const cellsXml = cells
        .map((value, columnIndex) => {
          if (value === "") return "";
          return `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cellsXml}</row>`;
    })
    .join("");

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;

  const safeName = xmlEscape((sheetName || "Sheet1").slice(0, 31).replace(/[\\/?*[\]:]/g, "-"));

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_DOC_REL}" Target="xl/workbook.xml"/></Relationships>`;

  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml),
  });
}

export function readDocxParagraphs(bytes: Uint8Array): string[] {
  const entries = unzipOffice(bytes);
  const xml = entries?.["word/document.xml"];
  if (!xml) throw new Error("This .docx file has no readable document body.");
  const raw = new TextDecoder().decode(xml);
  return raw
    .split(/<\/w:p>/)
    .map((chunk) =>
      decodeXml(
        chunk
          .replace(/<w:tab\b[^>]*\/>/g, "\t")
          .replace(/<w:br\b[^>]*\/>/g, "\n")
          .replace(/<\/w:tc>/g, "\t")
          .replace(/<[^>]+>/g, ""),
      ).trim(),
    )
    .filter((line) => line.length > 0);
}

function sharedStrings(entries: Record<string, Uint8Array>): string[] {
  const file = entries["xl/sharedStrings.xml"];
  if (!file) return [];
  const xml = new TextDecoder().decode(file);
  return (xml.match(/<si>[\s\S]*?<\/si>/g) ?? []).map((item) =>
    (item.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [])
      .map((text) => decodeXml(text.replace(/<[^>]+>/g, "")))
      .join(""),
  );
}

function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? "A";
  let value = 0;
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value - 1;
}

export function readXlsxRows(bytes: Uint8Array): string[][] {
  const entries = unzipOffice(bytes);
  if (!entries) throw new Error("This .xlsx file could not be opened. It may be damaged or password protected.");
  const sheetName = Object.keys(entries).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetName) throw new Error("This workbook has no readable worksheet.");
  const shared = sharedStrings(entries);
  const xml = new TextDecoder().decode(entries[sheetName]);
  const rows: string[][] = [];
  for (const rowMatch of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    const cells: string[] = [];
    for (const cell of rowMatch.match(/<c\b[^>]*>[\s\S]*?<\/c>|<c\b[^>]*\/>/g) ?? []) {
      const reference = /r="([A-Z]+\d+)"/.exec(cell)?.[1] ?? "A1";
      const index = columnIndex(reference);
      let value = "";
      if (/t="inlineStr"/.test(cell)) {
        value = (cell.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((item) => decodeXml(item.replace(/<[^>]+>/g, ""))).join("");
      } else if (/t="s"/.test(cell)) {
        const pointer = Number(/<v>([\s\S]*?)<\/v>/.exec(cell)?.[1] ?? "-1");
        value = shared[pointer] ?? "";
      } else {
        value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(cell)?.[1] ?? "");
      }
      if (index >= OFFICE_LIMITS.maxColumns) continue;
      cells[index] = value;
    }
    rows.push(Array.from({ length: Math.max(1, cells.length) }, (_, index) => cells[index] ?? ""));
    if (rows.length >= OFFICE_LIMITS.maxRows) throw new Error(`This workbook has more than ${OFFICE_LIMITS.maxRows} rows. Split it first.`);
  }
  return rows.filter((row) => row.some((cell) => cell.trim().length > 1 || (cell.trim() && !cell.includes("\u0000"))));
}

export function readPptxSlides(bytes: Uint8Array): string[][] {
  const entries = unzipOffice(bytes);
  if (!entries) throw new Error("This .pptx file could not be opened. It may be damaged or password protected.");
  const slideNames = Object.keys(entries)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/)![1]) - Number(b.match(/slide(\d+)\.xml/)![1]));
  if (!slideNames.length) throw new Error("This presentation has no readable slides.");
  return slideNames.map((name) => {
    const xml = new TextDecoder().decode(entries[name]);
    return (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? [])
      .map((paragraph) => (paragraph.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) ?? []).map((run) => decodeXml(run.replace(/<[^>]+>/g, ""))).join(""))
      .filter((line) => line.trim().length > 0);
  });
}

export type DocBlock =
  | { kind: "text"; text: string }
  | { kind: "image"; bytes: Uint8Array; format: "png" | "jpeg"; width: number; height: number };

/** Reads Word paragraphs and the pictures they contain, in document order. */
export function readDocxBlocks(bytes: Uint8Array): DocBlock[] {
  const entries = unzipOffice(bytes);
  const xml = entries?.["word/document.xml"];
  if (!xml || !entries) throw new Error("This .docx file has no readable document body.");
  const relationships = new Map<string, string>();
  const rels = entries["word/_rels/document.xml.rels"];
  if (rels) {
    const relXml = new TextDecoder().decode(rels);
    for (const match of relXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      relationships.set(match[1], match[2].replace(/^\/?word\//, "").replace(/^\.\//, ""));
    }
  }
  const blocks: DocBlock[] = [];
  const raw = new TextDecoder().decode(xml);
  for (const paragraph of raw.split(/<\/w:p>/)) {
    const text = decodeXml(
      paragraph
        .replace(/<w:tab\b[^>]*\/>/g, "\t")
        .replace(/<w:br\b[^>]*\/>/g, "\n")
        .replace(/<\/w:tc>/g, "\t")
        .replace(/<[^>]+>/g, ""),
    ).trim();
    if (text) blocks.push({ kind: "text", text });
    for (const blip of paragraph.matchAll(/<a:blip\b[^>]*r:embed="([^"]+)"/g)) {
      const target = relationships.get(blip[1]);
      if (!target) continue;
      const media = entries[`word/${target}`] ?? entries[target];
      if (!media?.byteLength) continue;
      const format = identifyImageFormat(media);
      if (format !== "png" && format !== "jpeg") continue;
      try {
        const size = readImageDimensions(media, format);
        if (!size.width || !size.height) continue;
        blocks.push({ kind: "image", bytes: media, format, width: size.width, height: size.height });
      } catch { /* skip pictures with unreadable headers */ }
    }
  }
  if (!blocks.length) throw new Error("This .docx file has no readable content.");
  return blocks;
}

/** A formatted run inside a Word paragraph. */
export type DocRun = { text: string; bold?: boolean; italic?: boolean; size?: number; color?: string; font?: string };

export type RichTableCell = { text: string; fill?: string; bold?: boolean; italic?: boolean; size?: number; color?: string; font?: string };

export type RichDocBlock =
  | {
      kind: "text";
      text: string;
      runs: DocRun[];
      align?: "left" | "center" | "right";
      level?: 1 | 2 | 3;
      bullet?: boolean;
      spaceBefore?: number;
      fill?: string;
    }
  | { kind: "table"; rows: RichTableCell[][]; columnCount: number }
  | { kind: "image"; bytes: Uint8Array; format: "png" | "jpeg"; width: number; height: number };

function parseRunProperties(rPr: string): Omit<DocRun, "text"> {
  const bold = /<w:b\b(?![^>]*w:val="(?:0|false)")/.test(rPr);
  const italic = /<w:i\b(?![^>]*w:val="(?:0|false)")/.test(rPr);
  const sizeMatch = /<w:sz w:val="(\d+)"/.exec(rPr);
  const colorMatch = /<w:color w:val="([0-9A-Fa-f]{6})"/.exec(rPr);
  return {
    bold: bold || undefined,
    italic: italic || undefined,
    size: sizeMatch ? Number(sizeMatch[1]) / 2 : undefined,
    color: colorMatch ? colorMatch[1].toUpperCase() : undefined,
  };
}

function parseParagraphProperties(pPr: string) {
  const style = /<w:pStyle w:val="([^"]+)"/.exec(pPr)?.[1] ?? "";
  const levelMatch = /^heading\s*(\d)$/i.exec(style);
  const level = levelMatch ? (Math.min(3, Math.max(1, Number(levelMatch[1]))) as 1 | 2 | 3) : undefined;
  const jc = /<w:jc w:val="(left|center|right|both|start|end)"/.exec(pPr)?.[1];
  const align: "left" | "center" | "right" | undefined =
    jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : undefined;
  const bullet = /<w:numPr>/.test(pPr);
  const spacing = /<w:spacing[^>]*w:before="(\d+)"/.exec(pPr)?.[1];
  const fill = /<w:shd[^>]*w:fill="([0-9A-Fa-f]{6})"/.exec(pPr)?.[1];
  return {
    level,
    align,
    bullet,
    spaceBefore: spacing ? Math.min(24, Number(spacing) / 20) : undefined,
    fill: fill && fill.toUpperCase() !== "FFFFFF" && fill.toUpperCase() !== "AUTO" ? fill.toUpperCase() : undefined,
  };
}

function cellText(cellXml: string): string {
  return decodeXml(
    cellXml
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, " ")
      .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, "$1")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function parseTable(tableXml: string): { rows: RichTableCell[][]; columnCount: number } | null {
  const rows: RichTableCell[][] = [];
  for (const rowMatch of tableXml.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
    const cells: RichTableCell[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) {
      const body = cellMatch[1];
      const tcPr = /<w:tcPr>([\s\S]*?)<\/w:tcPr>/.exec(body)?.[1] ?? "";
      const fill = /<w:shd[^>]*w:fill="([0-9A-Fa-f]{6})"/.exec(tcPr)?.[1];
      const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(body)?.[1] ?? "";
      const style = parseRunProperties(rPr);
      cells.push({
        text: cellText(body),
        fill: fill && fill.toUpperCase() !== "FFFFFF" && fill.toUpperCase() !== "AUTO" ? fill.toUpperCase() : undefined,
        bold: style.bold,
        color: style.color,
      });
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return null;
  return { rows, columnCount: Math.max(...rows.map((row) => row.length)) };
}

/**
 * Reads Word paragraphs with their run formatting (bold, italic, size, colour),
 * alignment, heading level, bullet state and paragraph shading, plus tables and
 * the pictures in document order.
 */
export function readDocxRichBlocks(bytes: Uint8Array): RichDocBlock[] {
  const entries = unzipOffice(bytes);
  const xml = entries?.["word/document.xml"];
  if (!xml || !entries) throw new Error("This .docx file has no readable document body.");
  const relationships = new Map<string, string>();
  const rels = entries["word/_rels/document.xml.rels"];
  if (rels) {
    const relXml = new TextDecoder().decode(rels);
    for (const match of relXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      relationships.set(match[1], match[2].replace(/^\/?word\//, "").replace(/^\.\//, ""));
    }
  }

  let raw = new TextDecoder().decode(xml);

  // Pull tables out first: they contain paragraphs, so splitting on </w:p>
  // would destroy their structure.
  const tables: string[] = [];
  raw = raw.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (match) => {
    tables.push(match);
    return `\u0000TBL${tables.length - 1}\u0000`;
  });

  const blocks: RichDocBlock[] = [];
  for (const paragraph of raw.split(/<\/w:p>/)) {
    const tableMarker = /\u0000TBL(\d+)\u0000/.exec(paragraph);
    if (tableMarker) {
      const parsed = parseTable(tables[Number(tableMarker[1])] ?? "");
      if (parsed) blocks.push({ kind: "table", rows: parsed.rows, columnCount: parsed.columnCount });
      continue;
    }

    const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(paragraph)?.[1] ?? "";
    const properties = parseParagraphProperties(pPr);

    const runs: DocRun[] = [];
    for (const runMatch of paragraph.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
      const body = runMatch[1];
      const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(body)?.[1] ?? "";
      const text = decodeXml(
        body
          .replace(/<w:tab\b[^>]*\/>/g, "\t")
          .replace(/<w:br\b[^>]*\/>/g, "\n")
          .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, "$1")
          .replace(/<[^>]+>/g, ""),
      );
      if (!text) continue;
      runs.push({ text, ...parseRunProperties(rPr) });
    }

    const text = runs.map((run) => run.text).join("").trim();
    if (text) blocks.push({ kind: "text", text, runs, ...properties });

    for (const blip of paragraph.matchAll(/<a:blip\b[^>]*r:embed="([^"]+)"/g)) {
      const target = relationships.get(blip[1]);
      if (!target) continue;
      const media = entries[`word/${target}`] ?? entries[target];
      if (!media?.byteLength) continue;
      const format = identifyImageFormat(media);
      if (format !== "png" && format !== "jpeg") continue;
      try {
        const size = readImageDimensions(media, format);
        if (!size.width || !size.height) continue;
        blocks.push({ kind: "image", bytes: media, format, width: size.width, height: size.height });
      } catch { /* skip pictures with unreadable headers */ }
    }
  }
  if (!blocks.length) throw new Error("This .docx file has no readable content.");
  return blocks;
}

/** Builds a .docx with paragraphs and embedded PNG/JPEG pictures. */
export function buildDocxRich(blocks: DocBlock[], title = "Converted document"): Uint8Array {
  let imageIndex = 0;
  const media: Record<string, Uint8Array> = {};
  const rels: string[] = [];
  const paragraphs: string[] = [];
  for (const block of blocks) {
    if (block.kind === "text") {
      paragraphs.push(`<w:p><w:r><w:t xml:space="preserve">${xmlEscape(block.text)}</w:t></w:r></w:p>`);
      continue;
    }
    imageIndex += 1;
    const name = `image${imageIndex}.${block.format === "png" ? "png" : "jpeg"}`;
    media[`word/media/${name}`] = block.bytes;
    const relId = `rIdImg${imageIndex}`;
    rels.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
    const maxWidth = 6 * 914400;
    const scale = Math.min(1, maxWidth / (block.width * 9525));
    const cx = Math.round(block.width * 9525 * scale);
    const cy = Math.round(block.height * 9525 * scale);
    paragraphs.push(
      `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imageIndex}" name="Picture ${imageIndex}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${imageIndex}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
    );
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}">${rels.join("")}</Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_DOC_REL}" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>APOS</dc:creator></cp:coreProperties>`;
  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "word/document.xml": strToU8(documentXml),
    "word/_rels/document.xml.rels": strToU8(documentRels),
    "docProps/core.xml": strToU8(core),
    ...media,
  });
}

export type DocxRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  size?: number;
  color?: string;
  font?: string;
};

export type DocxContentBlock =
  | { kind: "heading"; text: string; level: 1 | 2 | 3; alignment?: "left" | "center" | "right"; bold?: boolean; italic?: boolean; indent?: number; fontSize?: number; color?: string; font?: string; runs?: DocxRun[]; ruleBelow?: boolean }
  | { kind: "paragraph"; text: string; alignment?: "left" | "center" | "right" | "justify"; fontSize?: number; color?: string; font?: string; bold?: boolean; italic?: boolean; indent?: number; spaceBefore?: number; spaceAfter?: number; runs?: DocxRun[] }
  | { kind: "list"; text: string; indent?: number; fontSize?: number; color?: string; font?: string; runs?: DocxRun[]; ordered?: boolean }
  | { kind: "table"; rows: Array<Array<string | RichTableCell>>; header?: boolean; bordered?: boolean; columnWidths?: number[] }
  | { kind: "image"; bytes: Uint8Array; format: "png" | "jpeg"; width: number; height: number; maxWidth?: number; maxHeight?: number; alt?: string; anchor?: { x: number; y: number; width: number; height: number; pageWidth: number; pageHeight: number; behindText?: boolean } }
  | { kind: "positionedText"; text: string; x: number; top: number; width: number; fontSize: number; bold?: boolean; italic?: boolean; font?: string; color?: string }
  | { kind: "pageBreak" }
  | { kind: "sectionBreak"; pageWidth: number; pageHeight: number };

/** Splits a leading bullet or number marker off a list line. */
export function splitListMarker(text: string): { text: string; ordered: boolean } {
  const match = /^\s*([\u2022\u25AA\u25E6\u2023\u00B7\u25CF\u25CB]|[-*]|\d{1,3}[.)]|[a-zA-Z][.)])\s+/.exec(text);
  if (!match) return { text: text.trim(), ordered: false };
  return { text: text.slice(match[0].length).trim(), ordered: /\d|[a-zA-Z]/.test(match[1]) };
}

function docxParagraph(
  text: string,
  options: {
    alignment?: "left" | "center" | "right" | "justify";
    size?: number;
    bold?: boolean;
    italic?: boolean;
    color?: string;
    font?: string;
    indent?: number;
    spaceBefore?: number;
    spaceAfter?: number;
    styleId?: "Heading1" | "Heading2" | "Heading3";
    runs?: DocxRun[];
    numbering?: 1 | 2;
    ruleBelow?: boolean;
  } = {},
) {
  const alignment = options.alignment && options.alignment !== "left" ? `<w:jc w:val="${options.alignment}"/>` : "";
  const indent = options.indent && !options.numbering ? `<w:ind w:left="${Math.round(options.indent)}"/>` : "";
  const numbering = options.numbering ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${options.numbering}"/></w:numPr>` : "";
  const border = options.ruleBelow
    ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="B9BCC8"/></w:pBdr>`
    : "";
  const spacing = options.spaceBefore || options.spaceAfter
    ? `<w:spacing${options.spaceBefore ? ` w:before="${Math.round(options.spaceBefore)}"` : ""}${options.spaceAfter ? ` w:after="${Math.round(options.spaceAfter)}"` : ""}/>`
    : "";
  const style = options.styleId ? `<w:pStyle w:val="${options.styleId}"/>` : "";
  const pPr = alignment || indent || spacing || style || numbering || border
    ? `<w:pPr>${style}${numbering}${border}${spacing}${alignment}${indent}</w:pPr>`
    : "";
  const runProperties = (run: DocxRun) => {
    const font = run.font ? wordFontFamily(run.font) : "";
    const props = [
      font ? `<w:rFonts w:ascii="${xmlEscape(font)}" w:hAnsi="${xmlEscape(font)}" w:eastAsia="${xmlEscape(font)}" w:cs="${xmlEscape(font)}"/>` : "",
      run.bold ? "<w:b/>" : "",
      run.italic ? "<w:i/>" : "",
      run.size ? `<w:sz w:val="${Math.max(2, Math.round(run.size * 2))}"/><w:szCs w:val="${Math.max(2, Math.round(run.size * 2))}"/>` : "",
      run.color ? `<w:color w:val="${run.color.replace(/[^0-9a-f]/gi, "").slice(0, 6) || "20212B"}"/>` : "",
    ].join("");
    return props ? `<w:rPr>${props}</w:rPr>` : "";
  };
  const sourceRuns = options.runs?.length
    ? options.runs
    : [{ text, bold: options.bold, italic: options.italic, size: options.size, color: options.color, font: options.font }];
  const runs = sourceRuns.map((run) => {
    const parts = run.text.replace(/\r\n?/g, "\n").split("\n");
    return parts.map((part, index) =>
      `${index ? "<w:r><w:br/></w:r>" : ""}<w:r>${runProperties(run)}<w:t xml:space="preserve">${xmlEscape(part)}</w:t></w:r>`,
    ).join("");
  }).join("");
  return `<w:p>${pPr}${runs || "<w:r><w:t xml:space=\"preserve\"></w:t></w:r>"}</w:p>`;
}

function docxSectionProperties(pageWidth: number, pageHeight: number) {
  const width = Math.max(1, Math.round(pageWidth * 20));
  const height = Math.max(1, Math.round(pageHeight * 20));
  return `<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="${width}" w:h="${height}"${width > height ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>`;
}

function wordFontFamily(family: string | undefined) {
  const raw = (family ?? "").split(",")[0].replace(/["']/g, "").replace(/^[A-Z]{6}\+/, "").trim();
  const name = raw.replace(/[-_ ]?(?:bold|italic|oblique|regular|medium|light|semibold|demibold|black|heavy)\b.*$/i, "").trim() || raw;
  if (/mono|courier|consolas|menlo/i.test(name)) return "Courier New";
  if (/calibri|carlito/i.test(name)) return "Calibri";
  if (/cambria|caladea/i.test(name)) return "Cambria";
  if (/helvetica|arial|liberation sans/i.test(name)) return "Arial";
  if (/georgia/i.test(name)) return "Georgia";
  if (/times|liberation serif/i.test(name)) return "Times New Roman";
  if (/garamond/i.test(name)) return "Garamond";
  if (/palatino|book antiqua/i.test(name)) return "Palatino Linotype";
  if (/verdana/i.test(name)) return "Verdana";
  if (/tahoma/i.test(name)) return "Tahoma";
  if (/trebuchet/i.test(name)) return "Trebuchet MS";
  if (/segoe ui/i.test(name)) return "Segoe UI";
  if (/^serif$/i.test(name)) return "Times New Roman";
  if (/^(?:sans-serif|sans|system-ui)$/i.test(name)) return "Arial";
  // Preserve a real family name so Word can use it when installed. The
  // attribute is escaped by the caller; reject PDF internal names.
  if (/^[A-Za-z0-9][A-Za-z0-9 .&+-]{1,39}$/.test(name) && !/^g_\d+_f\d+$/i.test(name)) return name;
  return "Arial";
}

function docxPositionedParagraph(block: Extract<DocxContentBlock, { kind: "positionedText" }>) {
  const font = wordFontFamily(block.font);
  const x = Math.max(0, Math.round(block.x * 20));
  const top = Math.max(0, Math.round(block.top * 20));
  const width = Math.max(120, Math.round(block.width * 20));
  const height = Math.max(120, Math.round((block.fontSize * 1.45 + 2) * 20));
  const halfPoints = Math.max(2, Math.round(block.fontSize * 2));
  const runProperties = [
    `<w:rFonts w:ascii="${xmlEscape(font)}" w:hAnsi="${xmlEscape(font)}" w:eastAsia="${xmlEscape(font)}" w:cs="${xmlEscape(font)}"/>`,
    block.bold ? "<w:b/><w:bCs/>" : "",
    block.italic ? "<w:i/><w:iCs/>" : "",
    `<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>`,
    block.color ? `<w:color w:val="${block.color.replace(/[^0-9a-f]/gi, "").slice(0, 6) || "000000"}"/>` : "",
  ].join("");
  const frame = `<w:framePr w:w="${width}" w:h="${height}" w:x="${x}" w:y="${top}" w:hAnchor="page" w:vAnchor="page" w:wrap="none" w:hRule="atLeast"/>`;
  const paragraph = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="left"/>';
  return `<w:p><w:pPr>${frame}${paragraph}</w:pPr><w:r><w:rPr>${runProperties}</w:rPr><w:t xml:space="preserve">${xmlEscape(block.text)}</w:t></w:r></w:p>`;
}

function docxTable(rows: Array<Array<string | RichTableCell>>, header: boolean, bordered = false, columnWidths?: number[]) {
  const cleanRows = rows
    .map((row) => row.map((cell) => typeof cell === "string" ? { text: String(cell ?? "") } : { ...cell, text: String(cell.text ?? "") }))
    .filter((row) => row.length > 0);
  if (!cleanRows.length) return "";
  const columns = Math.min(20, cleanRows.reduce((max, row) => Math.max(max, row.length), 1));
  const width = 9360;
  // Prefer the column geometry measured from the PDF. Fall back to text length
  // when the source does not expose reliable cell positions.
  const measured = columnWidths
    ?.slice(0, columns)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  let widths: number[];
  if (measured && measured.length === columns && measured.length > 0) {
    const total = measured.reduce((sum, value) => sum + value, 0) || 1;
    widths = measured.map((value) => Math.max(560, Math.round((value / total) * width)));
  } else {
    const weights = Array.from({ length: columns }, (_, index) => {
      const longest = cleanRows.reduce((max, row) => Math.max(max, String(row[index]?.text ?? "").length), 1);
      return Math.min(70, Math.max(4, longest));
    });
    const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
    widths = weights.map((value) => Math.max(600, Math.round((value / totalWeight) * width)));
  }
  // A PDF table only has visible borders when the source drew them. Inventing
  // a grid adds lines the original document never had.
  const border = bordered
    ? `<w:tblBorders><w:top w:val="single" w:sz="4" w:color="C8CBD8"/><w:left w:val="single" w:sz="4" w:color="C8CBD8"/><w:bottom w:val="single" w:sz="4" w:color="C8CBD8"/><w:right w:val="single" w:sz="4" w:color="C8CBD8"/><w:insideH w:val="single" w:sz="4" w:color="DDE0EA"/><w:insideV w:val="single" w:sz="4" w:color="DDE0EA"/></w:tblBorders>`
    : `<w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders>`;
  const grid = `<w:tblGrid>${widths.map((value) => `<w:gridCol w:w="${value}"/>`).join("")}</w:tblGrid>`;
  const body = cleanRows.map((row, rowIndex) => {
    const cells = Array.from({ length: columns }, (_, index) => {
      const cell = row[index] ?? { text: "" };
      const isHeader = header && rowIndex === 0;
      const paragraph = cell.text
        ? docxParagraph(cell.text, { size: cell.size ?? 9, bold: isHeader || cell.bold, italic: cell.italic, color: cell.color, font: cell.font })
        : "<w:p/>";
      const fill = cell.fill && /^[0-9a-f]{6}$/i.test(cell.fill)
        ? `<w:shd w:val="clear" w:color="auto" w:fill="${cell.fill.toUpperCase()}"/>`
        : "";
      return `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/>${fill}<w:vAlign w:val="center"/></w:tcPr>${paragraph}</w:tc>`;
    }).join("");
    return `<w:tr>${cells}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${border}</w:tblPr>${grid}${body}</w:tbl>`;
}

/** Builds a valid Word document with direct heading formatting, tables, page breaks and pictures. */
export function buildDocxDocument(
  blocks: DocxContentBlock[],
  title = "Converted document",
  pageSize: { width: number; height: number } = { width: 612, height: 792 },
): Uint8Array {
  let imageIndex = 0;
  const media: Record<string, Uint8Array> = {};
  const rels: string[] = [];
  const content: string[] = [];

  for (const block of blocks) {
    if (block.kind === "heading") {
      const size = block.fontSize ?? (block.level === 1 ? 20 : block.level === 2 ? 16 : 13);
      content.push(docxParagraph(block.text, { size, bold: block.bold ?? true, italic: block.italic, color: block.color, font: block.font, alignment: block.alignment, indent: block.indent, styleId: `Heading${block.level}` as "Heading1" | "Heading2" | "Heading3", runs: block.runs, ruleBelow: block.ruleBelow }));
    } else if (block.kind === "paragraph") {
      content.push(docxParagraph(block.text, { alignment: block.alignment, size: block.fontSize, color: block.color, font: block.font, bold: block.bold, italic: block.italic, indent: block.indent, spaceBefore: block.spaceBefore, spaceAfter: block.spaceAfter, runs: block.runs }));
    } else if (block.kind === "list") {
      const { text, ordered } = splitListMarker(block.text);
      content.push(docxParagraph(text, { numbering: ordered || block.ordered ? 2 : 1, size: block.fontSize, color: block.color, font: block.font, runs: block.runs }));
    } else if (block.kind === "table") {
      content.push(docxTable(block.rows, block.header !== false, block.bordered === true, block.columnWidths));
      content.push("<w:p/>");
    } else if (block.kind === "positionedText") {
      content.push(docxPositionedParagraph(block));
    } else if (block.kind === "pageBreak") {
      content.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    } else if (block.kind === "sectionBreak") {
      content.push(`<w:p><w:pPr>${docxSectionProperties(block.pageWidth, block.pageHeight)}</w:pPr></w:p>`);
    } else {
      if (!block.bytes.byteLength || !Number.isFinite(block.width) || !Number.isFinite(block.height) || block.width <= 0 || block.height <= 0) continue;
      imageIndex += 1;
      const name = `image${imageIndex}.${block.format === "png" ? "png" : "jpeg"}`;
      media[`word/media/${name}`] = block.bytes;
      const relId = `rIdImg${imageIndex}`;
      rels.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
      const maxWidth = (block.maxWidth ?? 468) * 12700;
      const maxHeight = (block.maxHeight ?? 648) * 12700;
      const scale = Math.min(1, maxWidth / (block.width * 9525), maxHeight / (block.height * 9525));
      const cx = Math.max(1, Math.round(block.width * 9525 * scale));
      const cy = Math.max(1, Math.round(block.height * 9525 * scale));
      const picture = `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${imageIndex}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
      if (block.anchor) {
        const anchor = block.anchor;
        const anchorCx = Math.max(1, Math.round(anchor.width * 12700));
        const anchorCy = Math.max(1, Math.round(anchor.height * 12700));
        const offsetX = Math.max(0, Math.round(anchor.x * 12700));
        const offsetY = Math.max(0, Math.round((anchor.pageHeight - anchor.y - anchor.height) * 12700));
        content.push(
          `<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${imageIndex + 1}" behindDoc="${anchor.behindText === false ? 0 : 1}" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${offsetX}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${offsetY}</wp:posOffset></wp:positionV><wp:extent cx="${anchorCx}" cy="${anchorCy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${imageIndex}" name="Picture ${imageIndex}" descr="${xmlEscape(block.alt ?? "Embedded picture")}"/>${picture}</wp:anchor></w:drawing></w:r></w:p>`,
        );
      } else {
        content.push(
          `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imageIndex}" name="Picture ${imageIndex}" descr="${xmlEscape(block.alt ?? "Embedded picture")}"/>${picture}</wp:inline></w:drawing></w:r></w:p>`,
        );
      }
    }
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${content.join("")}${docxSectionProperties(pageSize.width, pageSize.height)}</w:body></w:document>`;
  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}">${rels.join("")}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style></w:styles>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_DOC_REL}" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>APOS</dc:creator></cp:coreProperties>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="\u2022"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "word/document.xml": strToU8(documentXml),
    "word/_rels/document.xml.rels": strToU8(documentRels),
    "word/styles.xml": strToU8(styles),
    "word/numbering.xml": strToU8(numbering),
    "docProps/core.xml": strToU8(core),
    ...media,
  });
}

/** Checks a generated .docx package before it is offered to the user. */
function resolvePackagePath(base: string, target: string): string | null {
  if (target.startsWith("/") || target.includes("\\")) return null;
  const parts = `${base}/${target}`.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!stack.length) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.length ? stack.join("/") : null;
}

/** Checks a generated .docx package before it is offered to the user. */
export function validateDocxDocument(bytes: Uint8Array) {
  const entries = unzipOffice(bytes);
  if (!entries) throw new Error("The generated Word file is not a readable ZIP package.");
  const documentXml = entries["word/document.xml"];
  if (!documentXml) throw new Error("The generated Word file has no document body.");
  const xml = new TextDecoder().decode(documentXml);
  if (!/<w:document\b/.test(xml) || !/<w:body>/.test(xml)) throw new Error("The generated Word document structure is invalid.");
  const rels = entries["word/_rels/document.xml.rels"];
  if (rels) {
    const relXml = new TextDecoder().decode(rels);
    for (const match of relXml.matchAll(/<Relationship\b[^>]*Target="([^"]+)"/g)) {
      const target = match[1];
      const external = /^(?:https?|mailto|tel|data):/i.test(target) || target.startsWith("#");
      if (external) continue;
      if (/^[a-zA-Z]:[\\/]/.test(target)) throw new Error("The generated Word file contains an unsafe relationship target.");
      const path = resolvePackagePath("word", target);
      if (!path) throw new Error("The generated Word file contains an unsafe relationship target.");
      const media = entries[path];
      if (!media) throw new Error("The generated Word file is missing a related media part.");
      if (path.startsWith("word/media/")) {
        const format = identifyImageFormat(media);
        if (format !== "png" && format !== "jpeg") throw new Error("The generated Word file contains an unsupported picture format.");
        const size = readImageDimensions(media, format);
        if (!size.width || !size.height) throw new Error("The generated Word file contains an unreadable picture.");
      }
    }
  }
  if (/<w:pgSz\b[^>]*w:w="0"|<w:pgSz\b[^>]*w:h="0"/.test(xml)) throw new Error("The generated Word file contains an invalid page size.");
  return { xml, entries };
}

export type XlsxSheet = { name: string; rows: string[][]; header?: boolean; freezeHeader?: boolean };

function sanitiseSheetName(name: string, used: Set<string>, index: number) {
  const base = (name || `Sheet${index + 1}`)
    .replace(/[\\/?*[\]:]/g, "-")
    .replace(/^'+|'+$/g, "")
    .trim()
    .slice(0, 31) || `Sheet${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLocaleLowerCase())) {
    const tail = ` (${suffix++})`;
    candidate = `${base.slice(0, Math.max(1, 31 - tail.length))}${tail}`;
  }
  used.add(candidate.toLocaleLowerCase());
  return candidate;
}

function worksheetXml(sheet: XlsxSheet) {
  const width = Math.min(OFFICE_LIMITS.maxColumns, sheet.rows.reduce((max, row) => Math.max(max, row.length), 1));
  const rows = sheet.rows.slice(0, OFFICE_LIMITS.maxRows);
  const cols = `<cols>${Array.from({ length: width }, (_, index) => {
    const longest = rows.reduce((max, row) => Math.max(max, (row[index] ?? "").length), 8);
    return `<col min="${index + 1}" max="${index + 1}" width="${Math.min(60, Math.max(9, longest + 2))}" customWidth="1"/>`;
  }).join("")}</cols>`;
  const sheetRows = rows.map((cells, rowIndex) => {
    const cellsXml = cells.slice(0, width).map((value, columnIndex) => {
      if (value === "") return "";
      const style = sheet.header !== false && rowIndex === 0 ? ' s="1"' : "";
      return `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cellsXml}</row>`;
  }).join("");
  const lastColumn = columnName(Math.max(0, width - 1));
  const dimension = `<dimension ref="A1:${lastColumn}${Math.max(1, rows.length)}"/>`;
  const freeze = sheet.freezeHeader !== false && rows.length > 1
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${dimension}${freeze}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${sheetRows}</sheetData></worksheet>`;
}

/** Builds a multi-sheet .xlsx workbook with bold headers, frozen header rows and inline strings. */
export function buildXlsxWorkbook(sheets: XlsxSheet[], title = "APOS workbook"): Uint8Array {
  if (!sheets.length) throw new Error("At least one worksheet is required.");
  const used = new Set<string>();
  const prepared = sheets.slice(0, 200).map((sheet, index) => ({ ...sheet, name: sanitiseSheetName(sheet.name, used, index) }));
  const workbookSheets = prepared.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}">${prepared.map((_sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${prepared.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${prepared.map((_sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_DOC_REL}" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>APOS</dc:creator></cp:coreProperties>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "docProps/core.xml": strToU8(core),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
    "xl/styles.xml": strToU8(styles),
  };
  prepared.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet)); });
  return zipSync(files);
}

/** Checks a generated .xlsx workbook before download. */
export function validateXlsxWorkbook(bytes: Uint8Array) {
  const entries = unzipOffice(bytes);
  if (!entries) throw new Error("The generated workbook is not a readable ZIP package.");
  const workbook = entries["xl/workbook.xml"];
  if (!workbook) throw new Error("The generated workbook has no workbook part.");
  const xml = new TextDecoder().decode(workbook);
  const sheetCount = (xml.match(/<sheet\b/g) ?? []).length;
  if (!sheetCount) throw new Error("The generated workbook has no worksheets.");
  for (let index = 1; index <= sheetCount; index += 1) {
    if (!entries[`xl/worksheets/sheet${index}.xml`]) throw new Error("The generated workbook is missing a worksheet part.");
  }
  if (!entries["xl/styles.xml"]) throw new Error("The generated workbook is missing its style table.");
  return { entries, sheetCount };
}
