import { describe, expect, it } from "vitest";
import {
  createDocument,
  renderPageTokens,
  renderPageTokensSafe,
  validateDocument,
  DEFAULT_PAGE_SETTINGS,
} from "./document-editor";
import {
  clearDocument,
  DOCUMENT_STORAGE_KEY,
  isAutosaveBlocked,
  loadDocument,
  saveDocument,
} from "./document-storage";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, v); },
  } as Storage;
}

describe("page-number tokens", () => {
  it("replaces {{page}} and {{pages}}", () => {
    expect(renderPageTokens("Page {{page}} of {{pages}}", 3, 9)).toBe("Page 3 of 9");
    expect(renderPageTokensSafe("{{ page }}", 2, 4)).toBe("2");
  });

  it("throws on unknown tokens but safe variant leaves them", () => {
    expect(() => renderPageTokens("Hi {{name}}", 1, 1)).toThrow(/Unknown page token/);
    expect(renderPageTokensSafe("Hi {{name}}", 1, 1)).toBe("Hi {{name}}");
  });
});

describe("validateDocument (import + autosave safety)", () => {
  it("normalizes a minimal old-format document", () => {
    const legacy = { title: "Legacy", blocks: [{ id: "b1", type: "paragraph", text: [{ text: "x", marks: { bold: false, italic: false, underline: false } }] }] };
    const result = validateDocument(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.pageSettings).toEqual(DEFAULT_PAGE_SETTINGS);
      expect(result.document.title).toBe("Legacy");
    }
  });

  it("rejects non-objects and empty blocks", () => {
    expect(validateDocument(null).ok).toBe(false);
    expect(validateDocument("nope").ok).toBe(false);
    expect(validateDocument({ blocks: [] }).ok).toBe(false);
    expect(validateDocument({ blocks: "x" }).ok).toBe(false);
  });

  it("validates pageSettings strictly", () => {
    const result = validateDocument({ blocks: [{ type: "paragraph", text: [] }], pageSettings: { size: "A3", orientation: "portrait", margin: "moderate" } });
    expect(result.ok).toBe(false);
  });
});

describe("document-storage", () => {
  it("round-trips save and load", () => {
    const storage = fakeStorage();
    const document = createDocument("Saved");
    const saved = saveDocument(document, storage);
    expect(saved.ok).toBe(true);
    const loaded = loadDocument(storage);
    expect(loaded.status).toBe("ok");
    if (loaded.status === "ok") {
      expect(loaded.document.title).toBe("Saved");
      expect(loaded.document.pageSettings).toEqual(DEFAULT_PAGE_SETTINGS);
    }
  });

  it("reports corrupted JSON safely and clears", () => {
    const storage = fakeStorage();
    storage.setItem(DOCUMENT_STORAGE_KEY, "{not json}");
    const loaded = loadDocument(storage);
    expect(loaded.status).toBe("corrupted");
    clearDocument(storage);
    expect(loadDocument(storage)).toEqual({ status: "none" });
  });

  it("reports unsupported version", () => {
    const storage = fakeStorage();
    storage.setItem(DOCUMENT_STORAGE_KEY, JSON.stringify({ version: 999, savedAt: Date.now(), document: createDocument() }));
    expect(loadDocument(storage).status).toBe("unsupported");
  });

  it("guards against autosaving a just-restored document unchanged", () => {
    expect(isAutosaveBlocked({ justRestoredDocumentId: "a", currentDocumentId: "a", hasPostRestoreEdit: false })).toBe(true);
    expect(isAutosaveBlocked({ justRestoredDocumentId: "a", currentDocumentId: "a", hasPostRestoreEdit: true })).toBe(false);
    expect(isAutosaveBlocked({ justRestoredDocumentId: null, currentDocumentId: "a", hasPostRestoreEdit: false })).toBe(false);
  });
});
