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
