import { describe, expect, it } from "vitest";
import {
  createDocument,
  documentToLexicalJSON,
  documentToSerializedEditorState,
  lexicalJSONToDocument,
  touchDocument,
  withPageSettings,
  DEFAULT_PAGE_SETTINGS,
  EMPTY_MARKS,
  type Document,
  type InlineMarks,
  type LexicalEditorStateJSON,
} from "./document-editor";

function richText(text: string, marks: InlineMarks = EMPTY_MARKS) {
  return { text, marks };
}

describe("document model", () => {
  it("creates a document with a single empty paragraph block and default page settings", () => {
    const document = createDocument("Report");
    expect(document.title).toBe("Report");
    expect(document.pageSettings).toEqual(DEFAULT_PAGE_SETTINGS);
    expect(document.blocks).toHaveLength(1);
    const first = document.blocks[0];
    if (first.type !== "paragraph") throw new Error("Expected paragraph block");
    expect(first.text).toHaveLength(1);
    expect(first.text[0].text).toBe("");
    expect(document.createdAt).toBeGreaterThan(0);
    expect(document.updatedAt).toBe(document.createdAt);
  });

  it("generates unique ids for documents and blocks", () => {
    const first = createDocument();
    const second = createDocument();
    expect(first.id).not.toBe(second.id);
    expect(first.blocks[0].id).not.toBe(second.blocks[0].id);
  });

  it("updates only the updatedAt timestamp on touch", () => {
    const document = createDocument();
    const touched = touchDocument(document);
    expect(touched.id).toBe(document.id);
    expect(touched.updatedAt).toBeGreaterThanOrEqual(document.updatedAt);
    expect(touched.createdAt).toBe(document.createdAt);
  });

  it("withPageSettings returns a new document with merged settings", () => {
    const document = createDocument();
    const next = withPageSettings(document, {
      size: "Letter",
      orientation: "landscape",
    });
    expect(next.id).toBe(document.id);
    expect(next.pageSettings.size).toBe("Letter");
    expect(next.pageSettings.orientation).toBe("landscape");
    expect(next.pageSettings.margin).toBe("moderate");
    expect(next.updatedAt).toBeGreaterThanOrEqual(document.updatedAt);
    // Original is unchanged
    expect(document.pageSettings.size).toBe("A4");
    expect(document.pageSettings.orientation).toBe("portrait");
  });
});

describe("document serialization round-trip", () => {
  it("round-trips a paragraph with inline marks including a link", () => {
    const document: Document = {
      id: "doc-1",
      title: "Memo",
      blocks: [
        {
          id: "b1",
          type: "paragraph",
          text: [
            richText("Hello ", { bold: true, italic: false, underline: false }),
            richText("world", { bold: true, italic: true, underline: true, link: "https://example.com" }),
          ],
        },
      ],
      pageSettings: DEFAULT_PAGE_SETTINGS,
      createdAt: 1000,
      updatedAt: 2000,
    };

    const serialized = documentToLexicalJSON(document);
    const restored = lexicalJSONToDocument(serialized, document.title);

    expect(restored.title).toBe("Memo");
    expect(restored.blocks).toHaveLength(1);
    const block = restored.blocks[0];
    if (block.type !== "paragraph") throw new Error("Expected paragraph block");
    expect(block.text).toHaveLength(2);
    expect(block.text[0]).toMatchObject({
      text: "Hello ",
      marks: { bold: true, italic: false, underline: false },
    });
    expect(block.text[1]).toMatchObject({
      text: "world",
      marks: { bold: true, italic: true, underline: true, link: "https://example.com" },
    });
  });

  it("round-trips every block type including headings", () => {
    const document: Document = {
      id: "doc-1",
      title: "Headings",
      blocks: [
        { id: "b1", type: "h1", text: [richText("Title")] },
        { id: "b2", type: "h2", text: [richText("Section")] },
        { id: "b3", type: "h3", text: [richText("Subsection")] },
        { id: "b4", type: "paragraph", text: [richText("Body")] },
      ],
      pageSettings: DEFAULT_PAGE_SETTINGS,
      createdAt: 1000,
      updatedAt: 2000,
    };

    const restored = lexicalJSONToDocument(documentToLexicalJSON(document));

    expect(restored.blocks.map((b) => b.type)).toEqual([
      "h1",
      "h2",
      "h3",
      "paragraph",
    ]);
    expect(restored.blocks.map((b) => {
      if ("text" in b) return b.text[0].text;
      return "";
    })).toEqual(["Title", "Section", "Subsection", "Body"]);
  });

  it("groups consecutive bullet blocks into a single list and restores them", () => {
    const document: Document = {
      id: "doc-1",
      title: "List",
      blocks: [
        { id: "b1", type: "bullet", text: [richText("First")] },
        { id: "b2", type: "bullet", text: [richText("Second")] },
        { id: "b3", type: "paragraph", text: [richText("Break")] },
        { id: "b4", type: "number", text: [richText("One")] },
        { id: "b5", type: "number", text: [richText("Two")] },
      ],
      pageSettings: DEFAULT_PAGE_SETTINGS,
      createdAt: 1000,
      updatedAt: 2000,
    };

    const serialized = documentToLexicalJSON(document);
    const listNodes = (serialized.root.children ?? []).filter((n) => n.type === "list");
    expect(listNodes).toHaveLength(2);

    const restored = lexicalJSONToDocument(serialized);
    expect(restored.blocks.map((b) => b.type)).toEqual([
      "bullet",
      "bullet",
      "paragraph",
      "number",
      "number",
    ]);
    expect(restored.blocks.map((b) => {
      if ("text" in b) return b.text[0].text;
      return "";
    })).toEqual(["First", "Second", "Break", "One", "Two"]);
  });

  it("round-trips an image block with alt and dimensions", () => {
    const document: Document = {
      id: "doc-1",
      title: "Image doc",
      blocks: [
        {
          id: "b1",
          type: "image",
          src: "data:image/png;base64,abc",
          alt: "A picture",
          width: 200,
          height: 100,
        },
      ],
      pageSettings: DEFAULT_PAGE_SETTINGS,
      createdAt: 1000,
      updatedAt: 2000,
    };

    const restored = lexicalJSONToDocument(documentToLexicalJSON(document));
    expect(restored.blocks).toHaveLength(1);
    const block = restored.blocks[0];
    if (block.type !== "image") throw new Error("Expected image block");
    expect(block.src).toBe("data:image/png;base64,abc");
    expect(block.alt).toBe("A picture");
    expect(block.width).toBe(200);
    expect(block.height).toBe(100);
  });

  it("round-trips a table block with rows and cells", () => {
    const document: Document = {
      id: "doc-1",
      title: "Table doc",
      blocks: [
        {
          id: "b1",
          type: "table",
          rows: [
            {
              id: "r1",
              cells: [
                {
                  id: "c1",
                  paragraphs: [[richText("Cell 1")]],
                },
                {
                  id: "c2",
                  paragraphs: [[richText("Cell 2")]],
                },
              ],
            },
          ],
        },
      ],
      pageSettings: DEFAULT_PAGE_SETTINGS,
      createdAt: 1000,
      updatedAt: 2000,
    };

    const restored = lexicalJSONToDocument(documentToLexicalJSON(document));
    expect(restored.blocks).toHaveLength(1);
    const block = restored.blocks[0];
    if (block.type !== "table") throw new Error("Expected table block");
    expect(block.rows).toHaveLength(1);
    expect(block.rows[0].cells).toHaveLength(2);
    expect(block.rows[0].cells[0].paragraphs[0][0].text).toBe("Cell 1");
    expect(block.rows[0].cells[1].paragraphs[0][0].text).toBe("Cell 2");
  });

  it("normalizes an empty document into a single paragraph", () => {
    const serialized: LexicalEditorStateJSON = {
      root: {
        type: "root",
        children: [],
        direction: null,
        format: "",
        indent: 0,
        version: 1,
      },
    };

    const restored = lexicalJSONToDocument(serialized);
    expect(restored.blocks).toHaveLength(1);
    const block = restored.blocks[0];
    if (block.type !== "paragraph") throw new Error("Expected paragraph block");
    expect(block.text[0].text).toBe("");
  });
});

describe("documentToSerializedEditorState", () => {
  it("produces a value castable to SerializedEditorState with a root", () => {
    const document = createDocument();
    const state = documentToSerializedEditorState(document);
    expect(state.root.type).toBe("root");
    expect(Array.isArray(state.root.children)).toBe(true);
  });

  it("includes heading tags in serialized output", () => {
    const document: Document = {
      id: "doc-1",
      title: "T",
      blocks: [{ id: "b1", type: "h2", text: [richText("H")] }],
      pageSettings: DEFAULT_PAGE_SETTINGS,
      createdAt: 1,
      updatedAt: 2,
    };
    const state = documentToSerializedEditorState(document);
    const heading = state.root.children?.find((n) => n.type === "heading");
    expect((heading as { tag?: string } | undefined)?.tag).toBe("h2");
  });
});
