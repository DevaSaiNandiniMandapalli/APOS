import type { SerializedEditorState } from "lexical";

/** Inline formatting marks applied to a run of text. */
export type InlineMarks = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** When present, the run is a hyperlink to this URL. */
  link?: string;
};

export const EMPTY_MARKS: InlineMarks = {
  bold: false,
  italic: false,
  underline: false,
};

/** A single run of text with its inline marks. */
export type RichText = {
  text: string;
  marks: InlineMarks;
};

export const EMPTY_RICH_TEXT: RichText = {
  text: "",
  marks: { ...EMPTY_MARKS },
};

/** Block types supported by the Document Studio editor. */
export type BlockType =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "number"
  | "table"
  | "image";

/** A cell within a table row. Holds one or more paragraphs of rich text. */
export type TableCell = {
  id: string;
  paragraphs: RichText[][];
};

/** A row within a table block. */
export type TableRow = {
  id: string;
  cells: TableCell[];
};

/** A table block. Column count is the maximum cells across all rows. */
export type TableBlock = {
  id: string;
  type: "table";
  rows: TableRow[];
};

/** An image block. */
export type ImageBlock = {
  id: string;
  type: "image";
  src: string; // data URL
  alt: string;
  width: number | null; // px, null = natural size
  height: number | null;
};

export type ParagraphBlock = {
  id: string;
  type: "paragraph";
  text: RichText[];
};

export type HeadingBlock = {
  id: string;
  type: "h1" | "h2" | "h3";
  text: RichText[];
};

export type ListItemBlock = {
  id: string;
  type: "bullet" | "number";
  text: RichText[];
};

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | ListItemBlock
  | TableBlock
  | ImageBlock;

export type PageSize = "A4" | "Letter";
export type PageOrientation = "portrait" | "landscape";
export type PageMargin = "none" | "narrow" | "moderate" | "wide";

export type PageSettings = {
  size: PageSize;
  orientation: PageOrientation;
  margin: PageMargin;
  header: string;
  footer: string;
  showPageNumbers: boolean;
};

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  size: "A4",
  orientation: "portrait",
  margin: "moderate",
  header: "",
  footer: "",
  showPageNumbers: false,
};

/**
 * Replace `{{page}}` / `{{pages}}` tokens in a header/footer string.
 * Throws on unknown `{{token}}` so callers can surface an error; for UI rendering
 * use {@link renderPageTokensSafe} instead.
 */
export function renderPageTokens(template: string, page: number, pages: number): string {
  const normalizedPage = Math.max(1, Math.floor(page) || 1);
  const normalizedPages = Math.max(normalizedPage, Math.floor(pages) || normalizedPage);
  let unknown: string | null = null;
  const rendered = template.replace(/\{\{([^}]+)\}\}/g, (match, raw: string) => {
    const token = String(raw).trim().toLowerCase();
    if (token === "page") return String(normalizedPage);
    if (token === "pages") return String(normalizedPages);
    unknown = match;
    return match;
  });
  if (unknown) throw new Error(`Unknown page token: ${unknown}`);
  return rendered;
}

/** Non-throwing variant for UI rendering. Unknown tokens are left as-is. */
export function renderPageTokensSafe(template: string, page: number, pages: number): string {
  try {
    return renderPageTokens(template, page, pages);
  } catch {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safePages = Math.max(safePage, Math.floor(pages) || safePage);
    return template
      .replace(/\{\{\s*page\s*\}\}/gi, String(safePage))
      .replace(/\{\{\s*pages\s*\}\}/gi, String(safePages));
  }
}

export type Document = {
  id: string;
  title: string;
  blocks: Block[];
  pageSettings: PageSettings;
  createdAt: number;
  updatedAt: number;
};

export function createDocument(title = "Untitled"): Document {
  const now = Date.now();
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `doc-${now}`;
  return {
    id,
    title,
    blocks: [
      {
        id: `${id}-b1`,
        type: "paragraph",
        text: [{ ...EMPTY_RICH_TEXT }],
      },
    ],
    pageSettings: { ...DEFAULT_PAGE_SETTINGS },
    createdAt: now,
    updatedAt: now,
  };
}

export function touchDocument(document: Document): Document {
  return { ...document, updatedAt: Date.now() };
}

/** Loosely typed Lexical serialized node, used by the model adapter. */
export type LexicalNodeJSON = {
  type: string;
  children?: LexicalNodeJSON[];
  [key: string]: unknown;
};

export type LexicalEditorStateJSON = {
  root: LexicalNodeJSON & {
    type: "root";
    direction: null;
    format: string;
    indent: number;
    version: number;
  };
};

function richTextToTextNodes(richText: RichText[]): LexicalNodeJSON[] {
  return richText.map(({ text, marks }) => {
    const textNode: LexicalNodeJSON = {
      type: "text",
      text,
      bold: marks.bold,
      italic: marks.italic,
      underline: marks.underline,
      strikethrough: false,
      code: false,
      subscript: false,
      superscript: false,
      detail: 0,
      format: 0,
      mode: 0,
      style: "",
      children: [],
    };
    if (marks.link) {
      return {
        type: "link",
        url: marks.link,
        children: [textNode],
        format: 0,
        indent: 0,
        version: 1,
      };
    }
    return textNode;
  });
}

function cellParagraphsToNodes(paragraphs: RichText[][]): LexicalNodeJSON[] {
  return paragraphs.map((richText) => ({
    type: "paragraph",
    children: richTextToTextNodes(richText),
  }));
}

function blockToNode(block: Block): LexicalNodeJSON {
  const common = { format: 0, indent: 0, version: 1 };

  switch (block.type) {
    case "paragraph":
      return {
        ...common,
        type: "paragraph",
        children: richTextToTextNodes(block.text),
      };
    case "h1":
    case "h2":
    case "h3":
      return {
        ...common,
        type: "heading",
        tag: block.type,
        children: richTextToTextNodes(block.text),
      };
    case "table":
      return {
        ...common,
        type: "table",
        rows: block.rows.map((row) => ({
          id: row.id,
          type: "table_row",
          cells: row.cells.map((cell) => ({
            id: cell.id,
            type: "table_cell",
            header: false,
            children: cellParagraphsToNodes(cell.paragraphs),
          })),
        })),
      };
    case "image":
      return {
        ...common,
        type: "image",
        src: block.src,
        alt: block.alt,
        ...(block.width !== null ? { width: block.width } : {}),
        ...(block.height !== null ? { height: block.height } : {}),
        children: [],
      };
    case "bullet":
    case "number":
      return {
        ...common,
        type: "listitem",
        value: block.type === "bullet" ? 0 : 1,
        children: richTextToTextNodes(block.text),
      };
    default:
      const _exhaustive: never = block;
      return {
        ...common,
        type: "paragraph",
        children: [],
      };
  }
}

function textNodesToRichText(nodes: LexicalNodeJSON[]): RichText[] {
  return nodes.flatMap((node) => {
    if (node.type === "link") {
      const inner = textNodesToRichText(
        (node.children as LexicalNodeJSON[]) ?? [],
      );
      const url = (node.url as string) ?? "";
      return inner.map((run) => ({
        text: run.text,
        marks: { ...run.marks, link: url } as InlineMarks,
      }));
    }
    return [
      {
        text: (node.text as string) ?? "",
        marks: {
          bold: !!node.bold,
          italic: !!node.italic,
          underline: !!node.underline,
          link: (node.link as string) ?? undefined,
        },
      },
    ];
  });
}

function nodeToBlock(node: LexicalNodeJSON): Block {
  const id = (node.id as string) ?? `b-${Date.now()}`;
  const children = (node.children as LexicalNodeJSON[]) ?? [];

  switch (node.type) {
    case "heading":
      return {
        id,
        type: (node.tag as BlockType) ?? "h1",
        text: textNodesToRichText(children),
      } as HeadingBlock;
    case "listitem": {
      const type: "bullet" | "number" =
        (node.value as number) === 0 ? "bullet" : "number";
      return {
        id,
        type,
        text: textNodesToRichText(children),
      } as ListItemBlock;
    }
    case "table":
      return {
        id,
        type: "table",
        rows: (node.rows as LexicalNodeJSON[]).map((row) => ({
          id: (row.id as string) ?? `r-${Date.now()}`,
          cells: (row.cells as LexicalNodeJSON[]).map((cell) => ({
            id: (cell.id as string) ?? `c-${Date.now()}`,
            paragraphs: (cell.children as LexicalNodeJSON[]).map((paraNode) =>
              textNodesToRichText((paraNode.children as LexicalNodeJSON[]) ?? []),
            ),
          })),
        })),
      } as TableBlock;
    case "image":
      return {
        id,
        type: "image",
        src: (node.src as string) ?? "",
        alt: (node.alt as string) ?? "",
        width: (node.width as number | null) ?? null,
        height: (node.height as number | null) ?? null,
      } as ImageBlock;
    case "paragraph":
    default:
      return {
        id,
        type: "paragraph",
        text: textNodesToRichText(children),
      } as ParagraphBlock;
  }
}

/**
 * Serialize an APOS document into Lexical's serialized editor-state shape.
 * Consecutive bullet blocks are grouped into a single bulleted list node and
 * consecutive numbered blocks into a single numbered list node, matching
 * Lexical's required list -> listitem structure.
 */
export function documentToLexicalJSON(
  document: Document,
): LexicalEditorStateJSON {
  const children: LexicalNodeJSON[] = [];
  const blocks = document.blocks;
  let index = 0;

  while (index < blocks.length) {
    const block = blocks[index];

    if (block.type === "bullet" || block.type === "number") {
      const listType = block.type;
      const items: LexicalNodeJSON[] = [];

      while (index < blocks.length && blocks[index].type === listType) {
        items.push(blockToNode(blocks[index]));
        index += 1;
      }

      children.push({
        type: "list",
        listType,
        children: items,
        format: 0,
        indent: 0,
        version: 1,
      });
    } else {
      children.push(blockToNode(block));
      index += 1;
    }
  }

  return {
    root: {
      type: "root",
      children,
      direction: null,
      format: "",
      indent: 0,
      version: 1,
    },
  };
}

/**
 * Deserialize Lexical's serialized editor-state shape back into an APOS
 * document. A fresh document id is generated because the serialized shape
 * does not carry one.
 *
 * Backward compatible: callers may pass `options` to preserve title,
 * pageSettings (including header/footer/showPageNumbers) and timestamps
 * when the Lexical state is the source of truth.
 */
export function lexicalJSONToDocument(
  state: LexicalEditorStateJSON,
  title = "Untitled",
  options?: {
    id?: string;
    pageSettings?: PageSettings;
    createdAt?: number;
    updatedAt?: number;
  },
): Document {
  const now = Date.now();
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `doc-${now}`;
  const blocks: Block[] = [];

  for (const node of state.root.children as LexicalNodeJSON[]) {
    if (node.type === "list") {
      const listType = node.listType as "bullet" | "number";
      const items = node.children as LexicalNodeJSON[];
      for (const item of items) {
        blocks.push(nodeToBlock(item) as ListItemBlock);
      }
    } else {
      blocks.push(nodeToBlock(node));
    }
  }

  if (blocks.length === 0) {
    blocks.push({
      id: `${id}-b1`,
      type: "paragraph",
      text: [{ ...EMPTY_RICH_TEXT }],
    });
  }

  return {
    id: options?.id ?? id,
    title,
    blocks,
    pageSettings: options?.pageSettings ?? { ...DEFAULT_PAGE_SETTINGS },
    createdAt: options?.createdAt ?? now,
    updatedAt: options?.updatedAt ?? now,
  } as Document;
}

/**
 * Validate an untrusted value (e.g. parsed `.apos.json` or `localStorage` slot)
 * as a {@link Document}. Returns the document on success, or an error message.
 * Backward compatible: missing title/blocks/pageSettings are normalized.
 * Unknown extra fields are ignored so newer files degrade gracefully.
 */
export function validateDocument(value: unknown): { ok: true; document: Document } | { ok: false; error: string } {
  if (value === null || typeof value !== "object") return { ok: false, error: "Not a document object." };
  const v = value as Record<string, unknown>;

  const titleRaw = v.title;
  if (titleRaw !== undefined && typeof titleRaw !== "string") return { ok: false, error: "Document title must be a string." };
  const title = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw : "Untitled";

  const blocksRaw = v.blocks;
  if (blocksRaw !== undefined && !Array.isArray(blocksRaw)) return { ok: false, error: "Document blocks must be an array." };
  const blocks = (Array.isArray(blocksRaw) && blocksRaw.length ? blocksRaw : null) as Block[] | null;
  if (!blocks) return { ok: false, error: "Document has no blocks." };

  const now = Date.now();
  const idRaw = v.id;
  const id = typeof idRaw === "string" && idRaw ? idRaw : `doc-${now}`;
  const createdAtRaw = v.createdAt;
  const updatedAtRaw = v.updatedAt;
  const createdAt = typeof createdAtRaw === "number" && createdAtRaw > 0 ? createdAtRaw : now;
  const updatedAt = typeof updatedAtRaw === "number" && updatedAtRaw >= createdAt ? updatedAtRaw : createdAt;

  let pageSettings: PageSettings = { ...DEFAULT_PAGE_SETTINGS };
  if (v.pageSettings !== undefined) {
    if (v.pageSettings === null || typeof v.pageSettings !== "object") return { ok: false, error: "pageSettings must be an object." };
    const ps = v.pageSettings as Record<string, unknown>;
    const size = ps.size;
    if (size !== undefined && size !== "A4" && size !== "Letter") return { ok: false, error: "Invalid page size." };
    const orientation = ps.orientation;
    if (orientation !== undefined && orientation !== "portrait" && orientation !== "landscape") return { ok: false, error: "Invalid page orientation." };
    const margin = ps.margin;
    if (margin !== undefined && margin !== "none" && margin !== "narrow" && margin !== "moderate" && margin !== "wide") return { ok: false, error: "Invalid page margin." };
    const header = ps.header;
    if (header !== undefined && typeof header !== "string") return { ok: false, error: "header must be a string." };
    const footer = ps.footer;
    if (footer !== undefined && typeof footer !== "string") return { ok: false, error: "footer must be a string." };
    const showPageNumbers = ps.showPageNumbers;
    if (showPageNumbers !== undefined && typeof showPageNumbers !== "boolean") return { ok: false, error: "showPageNumbers must be a boolean." };
    pageSettings = {
      size: (size as PageSize | undefined) ?? DEFAULT_PAGE_SETTINGS.size,
      orientation: (orientation as PageOrientation | undefined) ?? DEFAULT_PAGE_SETTINGS.orientation,
      margin: (margin as PageMargin | undefined) ?? DEFAULT_PAGE_SETTINGS.margin,
      header: (header as string | undefined) ?? "",
      footer: (footer as string | undefined) ?? "",
      showPageNumbers: (showPageNumbers as boolean | undefined) ?? DEFAULT_PAGE_SETTINGS.showPageNumbers,
    };
  }

  const validatedBlocks = blocks.map((b, i) => {
    const block = (b ?? {}) as Record<string, unknown>;
    const blockId = typeof block.id === "string" && block.id ? block.id : `${id}-b${i + 1}`;
    const type = block.type;
    switch (type) {
      case "paragraph":
      case "h1":
      case "h2":
      case "h3":
      case "bullet":
      case "number":
        return { id: blockId, type, text: Array.isArray(block.text) ? block.text : [{ ...EMPTY_RICH_TEXT }] } as Block;
      case "table":
        return { id: blockId, type: "table", rows: Array.isArray(block.rows) ? block.rows : [] } as Block;
      case "image":
        return {
          id: blockId,
          type: "image",
          src: typeof block.src === "string" ? block.src : "",
          alt: typeof block.alt === "string" ? block.alt : "",
          width: typeof block.width === "number" ? block.width : null,
          height: typeof block.height === "number" ? block.height : null,
        } as Block;
      default:
        return { id: blockId, type: "paragraph", text: [{ ...EMPTY_RICH_TEXT }] } as Block;
    }
  });

  return { ok: true, document: { id, title, blocks: validatedBlocks, pageSettings, createdAt, updatedAt } };
}

/**
 * Convert an APOS document to a Lexical-compatible serialized editor state,
 * cast to the library type for use with {@link LexicalComposer}.
 */
export function documentToSerializedEditorState(
  document: Document,
): SerializedEditorState {
  return documentToLexicalJSON(document) as unknown as SerializedEditorState;
}

/** Merge page settings into a document, returning a new document. */
export function withPageSettings(
  document: Document,
  pageSettings: Partial<PageSettings>,
): Document {
  return {
    ...document,
    pageSettings: { ...document.pageSettings, ...pageSettings },
    updatedAt: Date.now(),
  };
}
