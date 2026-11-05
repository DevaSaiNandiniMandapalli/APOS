import { strToU8, zipSync } from "fflate";
import { OFFICE_DOC_REL, REL_NS, xmlEscape } from "./office-formats";

export type AgentBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullet"; items: string[] }
  | { type: "numbered"; items: string[] }
  | { type: "table"; rows: string[][] };

function plain(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
}

function splitRow(line: string): string[] {
  return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => plain(cell));
}

function isDivider(line: string): boolean {
  return /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");
}

/** Parses the Markdown subset the model is told to emit into document blocks. */
export function parseMarkdownBlocks(markdown: string): AgentBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: AgentBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) { index += 1; continue; }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, text: plain(heading[2]) });
      index += 1;
      continue;
    }

    if (/^\s*\|.*\|/.test(line)) {
      const rows: string[][] = [];
      while (index < lines.length && /^\s*\|.*\|/.test(lines[index])) {
        const current = lines[index];
        if (!isDivider(current)) rows.push(splitRow(current));
        index += 1;
      }
      if (rows.length) blocks.push({ type: "table", rows });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/;
    if (bullet.test(line)) {
      const items: string[] = [];
      while (index < lines.length && bullet.test(lines[index])) {
        items.push(plain((bullet.exec(lines[index]) as RegExpExecArray)[1]));
        index += 1;
      }
      blocks.push({ type: "bullet", items });
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/;
    if (numbered.test(line)) {
      const items: string[] = [];
      while (index < lines.length && numbered.test(lines[index])) {
        items.push(plain((numbered.exec(lines[index]) as RegExpExecArray)[1]));
        index += 1;
      }
      blocks.push({ type: "numbered", items });
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,3})\s+/.test(lines[index]) &&
      !bullet.test(lines[index]) &&
      !numbered.test(lines[index]) &&
      !/^\s*\|.*\|/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.length) blocks.push({ type: "paragraph", text: plain(paragraph.join(" ")) });
  }

  return blocks;
}

export function blocksToPlainText(blocks: AgentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "heading" || block.type === "paragraph") return block.text;
      if (block.type === "table") return block.rows.map((row) => row.join(" | ")).join("\n");
      return block.items.map((item, index) => (block.type === "numbered" ? `${index + 1}. ${item}` : `- ${item}`)).join("\n");
    })
    .join("\n\n");
}

function run(text: string, options: { bold?: boolean; size?: number } = {}): string {
  const properties = `${options.bold ? "<w:b/>" : ""}${options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : ""}`;
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function paragraph(content: string, options: { indent?: number; spaceAfter?: number; style?: string } = {}): string {
  const properties = [
    options.style ? `<w:pStyle w:val="${options.style}"/>` : "",
    `<w:spacing w:after="${options.spaceAfter ?? 120}"/>`,
    options.indent ? `<w:ind w:left="${options.indent}"/>` : "",
  ].join("");
  return `<w:p><w:pPr>${properties}</w:pPr>${content}</w:p>`;
}

function tableXml(rows: string[][]): string {
  const columns = Math.max(...rows.map((row) => row.length));
  const grid = Array.from({ length: columns }, () => `<w:gridCol w:w="${Math.floor(9000 / columns)}"/>`).join("");
  const border = `<w:top w:val="single" w:sz="4" w:color="D0D3D9"/><w:left w:val="single" w:sz="4" w:color="D0D3D9"/><w:bottom w:val="single" w:sz="4" w:color="D0D3D9"/><w:right w:val="single" w:sz="4" w:color="D0D3D9"/>`;
  const body = rows
    .map((row, rowIndex) => {
      const cells = Array.from({ length: columns }, (_, cellIndex) => {
        const text = row[cellIndex] ?? "";
        return `<w:tc><w:tcPr><w:tcBorders>${border}</w:tcBorders></w:tcPr>${paragraph(run(text, { bold: rowIndex === 0, size: 20 }), { spaceAfter: 0 })}</w:tc>`;
      }).join("");
      return `<w:tr>${cells}</w:tr>`;
    })
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${border}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

export function buildAgentDocx(markdown: string, title = "Generated document"): Uint8Array {
  const blocks = parseMarkdownBlocks(markdown);
  const body = blocks
    .map((block) => {
      if (block.type === "heading") {
        const sizes = { 1: 36, 2: 30, 3: 26 } as const;
        return paragraph(run(block.text, { bold: true, size: sizes[block.level] }), { spaceAfter: block.level === 1 ? 240 : 160 });
      }
      if (block.type === "paragraph") return paragraph(run(block.text));
      if (block.type === "table") return `${tableXml(block.rows)}${paragraph(run(""), { spaceAfter: 120 })}`;
      return block.items
        .map((item, index) => paragraph(run(block.type === "numbered" ? `${index + 1}. ${item}` : `• ${item}`), { indent: 360 }))
        .join("");
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
