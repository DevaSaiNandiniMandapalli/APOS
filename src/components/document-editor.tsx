"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  $createParagraphNode,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
  type ParagraphNode,
  type RangeSelection,
  type TextFormatType,
} from "lexical";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
  ListItemNode,
} from "@lexical/list";
import { LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  INSERT_TABLE_COMMAND,
  TableNode,
  TableCellNode,
  TableRowNode,
} from "@lexical/table";
import {
  AutoFocusPlugin,
} from "@lexical/react/LexicalAutoFocusPlugin";
import {
  LexicalErrorBoundary,
} from "@lexical/react/LexicalErrorBoundary";
import {
  LexicalComposer,
} from "@lexical/react/LexicalComposer";
import {
  HistoryPlugin,
} from "@lexical/react/LexicalHistoryPlugin";
import {
  ListPlugin,
} from "@lexical/react/LexicalListPlugin";
import {
  LinkPlugin,
} from "@lexical/react/LexicalLinkPlugin";
import {
  OnChangePlugin,
} from "@lexical/react/LexicalOnChangePlugin";
import {
  RichTextPlugin,
} from "@lexical/react/LexicalRichTextPlugin";
import {
  ContentEditable,
} from "@lexical/react/LexicalContentEditable";
import {
  TablePlugin,
} from "@lexical/react/LexicalTablePlugin";
import {
  useLexicalComposerContext,
} from "@lexical/react/LexicalComposerContext";
import {
  HeadingNode,
  ImageNode,
  $createHeadingNode,
  $createImageNode,
  type HeadingTag,
} from "@/lib/document-nodes";
import {
  createDocument,
  documentToSerializedEditorState,
  lexicalJSONToDocument,
  renderPageTokensSafe,
  validateDocument,
  withPageSettings,
  type Document,
  type LexicalEditorStateJSON,
  type PageSettings,
} from "@/lib/document-editor";
import {
  clearDocument,
  isAutosaveBlocked,
  loadDocument,
  saveDocument,
} from "@/lib/document-storage";

export interface DocumentEditorProps {
  initialDocument?: Document;
  onChange?: (document: Document) => void;
  readOnly?: boolean;
}


function getSelectedParagraphs(selection: RangeSelection): ParagraphNode[] {
  const paragraphs = new Set<ParagraphNode>();
  for (const node of selection.getNodes()) {
    if ($isParagraphNode(node)) {
      paragraphs.add(node);
    } else {
      try {
        const parent = node.getParentOrThrow();
        if ($isParagraphNode(parent)) {
          paragraphs.add(parent);
        }
      } catch {
        // Node has no parent inside the editor.
      }
    }
  }
  return [...paragraphs];
}

function toggleInlineFormat(
  editor: LexicalEditor,
  format: TextFormatType,
): void {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    for (const node of selection.getNodes()) {
      if ($isTextNode(node)) {
        node.toggleFormat(format);
      }
    }
  });
}

function toggleHeading(editor: LexicalEditor, tag: HeadingTag): void {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    for (const paragraph of getSelectedParagraphs(selection)) {
      if (paragraph.getType() === "heading") {
        const heading = paragraph as unknown as {
          getTag(): HeadingTag;
          setTag(tag: HeadingTag): void;
        };
        if (heading.getTag() === tag) {
          const replacement = $createParagraphNode();
          for (const child of paragraph.getChildren()) {
            replacement.append(child);
          }
          paragraph.replace(replacement);
        } else {
          heading.setTag(tag);
        }
      } else {
        const heading = $createHeadingNode(tag);
        for (const child of paragraph.getChildren()) {
          heading.append(child);
        }
        paragraph.replace(heading);
      }
    }
  });
}

function toggleList(editor: LexicalEditor, listType: "bullet" | "number"): void {
  if (listType === "bullet") {
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
  } else {
    editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
  }
}

function toggleLink(editor: LexicalEditor, url: string | null): void {
  editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
}

function insertTable(editor: LexicalEditor, rows: number, columns: number): void {
  editor.dispatchCommand(INSERT_TABLE_COMMAND, {
    rows: String(Math.max(1, Math.min(20, rows))),
    columns: String(Math.max(1, Math.min(10, columns))),
  });
}

function insertImage(
  editor: LexicalEditor,
  src: string,
  alt: string,
  width: number | null,
  height: number | null,
): void {
  editor.update(() => {
    const imageNode = $createImageNode(src, alt, width, height);
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      selection.insertNodes([imageNode]);
    }
  });
}

function isSelectionInLink(editor: LexicalEditor): boolean {
  try {
    return editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      return selection.getNodes().some((node) => {
        let current: LexicalNode | null = node;
        while (current && current.getType() !== "root") {
          if (current.getType() === "link") return true;
          current = current.getParentOrThrow();
        }
        return false;
      });
    });
  } catch {
    return false;
  }
}

function getSelectionLinkUrl(editor: LexicalEditor): string | null {
  try {
    return editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return null;
      const nodes = selection.getNodes();
      for (const node of nodes) {
        let current: LexicalNode | null = node;
        while (current && current.getType() !== "root") {
          if (current.getType() === "link") {
            return (current as { getUrl?: () => string }).getUrl?.() ?? null;
          }
          current = current.getParentOrThrow();
        }
      }
      return null;
    });
  } catch {
    return null;
  }
}

type PendingLinkAction =
  | { kind: "insert"; url: string }
  | { kind: "remove" }
  | null;
type PendingImageAction =
  | { src: string; alt: string; width: number | null; height: number | null }
  | null;

/**
 * Lives INSIDE the LexicalComposer tree. Registers the editor instance with the
 * parent and drains queued link/image actions on demand. Renders nothing.
 */
function LexicalEditorCommands({
  onEditorReady,
  pendingLinkActionRef,
  pendingImageActionRef,
  actionVersion,
}: {
  onEditorReady: (editor: LexicalEditor) => void;
  pendingLinkActionRef: { current: PendingLinkAction };
  pendingImageActionRef: { current: PendingImageAction };
  actionVersion: number;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    onEditorReady(editor);
  }, [editor, onEditorReady]);

  useEffect(() => {
    const link = pendingLinkActionRef.current;
    if (link) {
      pendingLinkActionRef.current = null;
      toggleLink(editor, link.kind === "insert" ? link.url : null);
    }
    const image = pendingImageActionRef.current;
    if (image) {
      pendingImageActionRef.current = null;
      insertImage(editor, image.src, image.alt, image.width, image.height);
    }
  }, [editor, actionVersion, pendingLinkActionRef, pendingImageActionRef]);

  return null;
}

function DocumentEditorPane({ onChange }: { onChange: (document: Document) => void }) {
  const onChangeHandler = useCallback(
    (editorState: unknown, editorInstance: LexicalEditor) => {
      const json = editorInstance.getEditorState().toJSON() as unknown as LexicalEditorStateJSON;
      // The parent DocumentEditor calls applyDocument(), which itself
      // re-asserts title/pageSettings from its own state — so the Pane only
      // needs to forward the Lexical blocks. Keep a fallback title here.
      const next = lexicalJSONToDocument(json, "Untitled");
      onChange(next);
    },
    [onChange],
  );

  return (
    <>
      <HistoryPlugin />
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            className="document-editor__pane"
            style={{
              minHeight: "55vh",
              outline: "none",
              whiteSpace: "pre-wrap",
              fontSize: 16,
              lineHeight: 1.5,
            }}
          />
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <ListPlugin />
      <LinkPlugin />
      <TablePlugin />
      <OnChangePlugin onChange={onChangeHandler} />
      <AutoFocusPlugin />
    </>
  );
}

export default function DocumentEditor({
  initialDocument,
  onChange,
  readOnly = false,
}: DocumentEditorProps) {
  const [externalEditor, setExternalEditor] = useState<LexicalEditor | null>(null);

  const [document, setDocument] = useState<Document>(
    () => initialDocument ?? createDocument("Untitled"),
  );

  // Leave pageSettings ref for Pane to avoid stale closures.

  const [linkDialog, setLinkDialog] = useState<{ open: boolean; url: string }>({
    open: false,
    url: "",
  });
  const [imageDialog, setImageDialog] = useState<{ open: boolean }>({
    open: false,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(document.title);
  const [saveStatus, setSaveStatus] = useState<"idle" | "dirty" | "saved" | "error">("idle");
  const [exportStatus, setExportStatus] = useState<{ kind: "idle" | "exporting" | "done" | "error"; message?: string }>({ kind: "idle" });
  const [recovery, setRecovery] = useState<{ document: Document; savedAt: number } | null>(() => {
    const loaded = loadDocument();
    return loaded.status === "ok" && loaded.document.id !== document.id ? { document: loaded.document, savedAt: loaded.savedAt } : null;
  });
  const [justRestoredId, setJustRestoredId] = useState<string | null>(null);
  const [hasPostRestoreEdit, setHasPostRestoreEdit] = useState(true);
  const [reopenError, setReopenError] = useState<string | null>(null);
  const reopenInputRef = useRef<HTMLInputElement>(null);

  const pageSettings = useMemo(
    () => document.pageSettings,
    [document.pageSettings],
  );

  // --- Autosave (debounced, browser-local only) ---
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyDocument = useCallback(
    (next: Document) => {
      setDocument(next);
      setTitle(next.title);
      setSaveStatus("dirty");
      setHasPostRestoreEdit(true);
      onChange?.(next);
    },
    [onChange],
  );

  useEffect(() => {
    if (saveStatus !== "dirty") return;

    const docToSave = document;
    const blocked = isAutosaveBlocked({
      justRestoredDocumentId: justRestoredId,
      currentDocumentId: docToSave.id,
      hasPostRestoreEdit,
    });
    if (blocked) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSaveStatus("dirty");
      const result = saveDocument(docToSave);
      if (result.ok) {
        setSaveStatus("saved");
      } else {
        setSaveStatus("error");
      }
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [document, saveStatus, justRestoredId, hasPostRestoreEdit]);

  // Lexical actions are queued by the toolbar handlers and drained inside the
  // LexicalComposer tree by <LexicalEditorCommands>, never via a hook outside it.
  const pendingLinkActionRef = useRef<PendingLinkAction>(null);
  const pendingImageActionRef = useRef<PendingImageAction>(null);
  // Bumped whenever an action is queued so the command component drains it.
  const [actionVersion, setActionVersion] = useState(0);

  const handleNew = useCallback(() => {
    if (saveStatus === "dirty" && !window.confirm("You have unsaved changes. Start a new document anyway?")) return;
    const next = createDocument("Untitled");
    setRecovery(null);
    setJustRestoredId(null);
    setHasPostRestoreEdit(true);
    setSaveStatus("idle");
    setReopenError(null);
    clearDocument();
    applyDocument(next);
  }, [saveStatus, applyDocument]);

  const handleSave = useCallback(() => {
    const safeTitle = (title.trim() || "Untitled").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 100) || "document";
    const payload = { ...document, title: title.trim() || "Untitled" };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeTitle}.apos.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSaveStatus("saved");
    saveDocument(payload);
  }, [document, title]);

  const handleExportPdf = useCallback(async () => {
    setExportStatus({ kind: "exporting" });
    try {
      const { documentToPdf, downloadPdfBlob } = await import("@/lib/document-pdf");
      const result = await documentToPdf(
        { ...document, title: title.trim() || "Untitled" },
        {},
      );
      downloadPdfBlob(result.bytes, result.title);
      setExportStatus({ kind: "done", message: `Exported ${result.pageCount} page${result.pageCount === 1 ? "" : "s"} as PDF.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "PDF export failed.";
      setExportStatus({ kind: "error", message });
    }
  }, [document, title]);

  const handleReopenOpenPicker = useCallback(() => {
    reopenInputRef.current?.click();
  }, []);

  const handleReopenFile = useCallback(
    async (file: File) => {
      if (saveStatus === "dirty" && !window.confirm("You have unsaved changes. Open another document anyway?")) return;
      setReopenError(null);
      try {
        const text = await file.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          setReopenError("That file is not valid JSON.");
          return;
        }
        const validated = validateDocument(parsed);
        if (!validated.ok) {
          setReopenError(validated.error);
          return;
        }
        setRecovery(null);
        setJustRestoredId(validated.document.id);
        setHasPostRestoreEdit(false);
        applyDocument(validated.document);
        setSaveStatus("idle");
      } catch (err) {
        setReopenError(err instanceof Error ? err.message : "Could not open that file.");
      }
    },
    [saveStatus, applyDocument],
  );

  const handleRestoreRecovery = useCallback(() => {
    if (!recovery) return;
    setJustRestoredId(recovery.document.id);
    setHasPostRestoreEdit(false);
    applyDocument(recovery.document);
    setRecovery(null);
    setSaveStatus("idle");
  }, [recovery, applyDocument]);

  const handleDiscardRecovery = useCallback(() => {
    clearDocument();
    setRecovery(null);
  }, []);

  const handleLinkInsert = useCallback(
    (url: string) => {
      pendingLinkActionRef.current = { kind: "insert", url: url.trim() };
      setLinkDialog({ open: false, url: "" });
      setActionVersion((version) => version + 1);
    },
    [],
  );

  const handleLinkRemove = useCallback(() => {
    pendingLinkActionRef.current = { kind: "remove" };
    setLinkDialog({ open: false, url: "" });
    setActionVersion((version) => version + 1);
  }, []);

  const handleImageInsert = useCallback(
    (src: string, alt: string, width: number | null, height: number | null) => {
      pendingImageActionRef.current = { src, alt, width, height };
      setImageDialog({ open: false });
      setActionVersion((version) => version + 1);
    },
    [],
  );

  const handlePageSettingsChange = useCallback(
    (next: Partial<PageSettings>) => {
      const nextDocument = withPageSettings(document, next);
      applyDocument(nextDocument);
    },
    [document, applyDocument],
  );

  const initialEditorState = useMemo(
    () => JSON.stringify(documentToSerializedEditorState(document)),
    [document],
  );

  const openLinkDialog = useCallback(() => {
    const ed = externalEditor;
    const url = ed ? getSelectionLinkUrl(ed) : null;
    setLinkDialog({ open: true, url: url ?? "" });
  }, [externalEditor]);

  const openImageDialog = useCallback(() => {
    setImageDialog({ open: true });
  }, []);

  const handleTitleChange = useCallback(
    (next: string) => {
      setTitle(next);
      applyDocument({ ...document, title: next.trim() || "Untitled", updatedAt: Date.now() });
    },
    [document, applyDocument],
  );

  const renderedHeader = renderPageTokensSafe(pageSettings.header, 1, 1);
  const renderedFooter = renderPageTokensSafe(pageSettings.footer, 1, 1);

  return (
    <div className="document-editor">
      {recovery && (
        <div className="document-editor__recovery" role="alert">
          <p>A recovered document “{recovery.document.title}” was saved on this device at {new Date(recovery.savedAt).toLocaleString()}.</p>
          <p>It has not been applied yet. Review and restore if it’s yours.</p>
          <div className="document-editor__row">
            <button type="button" onClick={handleRestoreRecovery}>Restore</button>
            <button type="button" onClick={handleDiscardRecovery}>Discard</button>
          </div>
        </div>
      )}

      <div className="document-editor__titlebar">
        <label htmlFor="doc-title" className="sr-only">Document title</label>
        <input
          id="doc-title"
          type="text"
          value={title}
          placeholder="Untitled"
          onChange={(event) => handleTitleChange(event.target.value)}
          disabled={readOnly}
          className="document-editor__title"
        />
        <span className="document-editor__status" aria-live="polite">
          {saveStatus === "saved" && "Saved locally · "}
          {saveStatus === "dirty" && "Editing… "}
          {saveStatus === "error" && "Autosave failed — download a backup. "}
          <span className="document-editor__status-note">Browser-local — no upload</span>
        </span>
        <div className="document-editor__file-actions">
          <button type="button" onClick={handleNew} disabled={readOnly}>New</button>
          <button type="button" onClick={handleSave} disabled={readOnly}>Save</button>
          <button type="button" onClick={handleExportPdf} disabled={readOnly || exportStatus.kind === "exporting"}>
            {exportStatus.kind === "exporting" ? "Exporting…" : "Export PDF"}
          </button>
          <button type="button" onClick={handleReopenOpenPicker} disabled={readOnly}>Reopen</button>
          <input
            ref={reopenInputRef}
            type="file"
            accept=".apos.json,application/json"
            className="sr-only"
            aria-label="Reopen .apos.json file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void handleReopenFile(file);
              event.currentTarget.value = "";
            }}
          />
        </div>
      </div>

      {reopenError && (
        <div className="document-editor__error" role="alert">
          {reopenError}
        </div>
      )}

      {exportStatus.kind === "done" && (
        <div className="document-editor__status" aria-live="polite">
          {exportStatus.message}
        </div>
      )}
      {exportStatus.kind === "error" && (
        <div className="document-editor__error" role="alert">
          {exportStatus.message ?? "PDF export failed."}
        </div>
      )}

      <LexicalComposer
        initialConfig={{
          namespace: "document-editor",
          nodes: [
            HeadingNode,
            ImageNode,
            ListNode,
            ListItemNode,
            LinkNode,
            TableNode,
            TableCellNode,
            TableRowNode,
          ],
          editable: !readOnly,
          onError: (error: Error) => {
            console.error("[APOS Document Editor]", error);
          },
          editorState: initialEditorState,
        }}
      >
        <LexicalEditorCommands
          onEditorReady={setExternalEditor}
          pendingLinkActionRef={pendingLinkActionRef}
          pendingImageActionRef={pendingImageActionRef}
          actionVersion={actionVersion}
        />
        {/* Header/footer zones drawn outside Lexical (text only, tokens fully supported) */}
        {pageSettings.header && (
          <div className="document-editor__header" aria-label="Header">
            <p>{renderedHeader || "Header"}</p>
          </div>
        )}
        <DocumentEditorPane
          onChange={(next) => {
            const preserved = { ...next, title: title.trim() || "Untitled", pageSettings };
            // Preserve the header/footer set via the toolbar by keeping the
            // incoming pageSettings when Pane rebuilds from Lexical.
            applyDocument(preserved);
          }}
        />
        {pageSettings.footer && (
          <div className="document-editor__footer" aria-label="Footer">
            <p>{renderedFooter}</p>
          </div>
        )}
        {pageSettings.showPageNumbers && (
          <div className="document-editor__page-badge" aria-label="Page number preview">
            <span>1</span><span aria-hidden="true">/</span><span>1</span>
          </div>
        )}
        <DocumentToolbar
          readOnly={readOnly}
          onLinkRemove={handleLinkRemove}
          pageSettings={pageSettings}
          onPageSettingsChange={handlePageSettingsChange}
          openLinkDialog={openLinkDialog}
          openImageDialog={openImageDialog}
        />
        <LinkDialog
          open={linkDialog.open}
          url={linkDialog.url}
          onInsert={handleLinkInsert}
          onRemove={handleLinkRemove}
          onClose={() => setLinkDialog({ open: false, url: "" })}
        />
        <ImageDialog
          open={imageDialog.open}
          fileInputRef={fileInputRef}
          onInsert={handleImageInsert}
          onClose={() => setImageDialog({ open: false })}
        />
      </LexicalComposer>
    </div>
  );
}

function DocumentToolbar({
  readOnly,
  onLinkRemove,
  pageSettings,
  onPageSettingsChange,
  openLinkDialog,
  openImageDialog,
}: {
  readOnly: boolean;
  onLinkRemove: () => void;
  pageSettings: PageSettings;
  onPageSettingsChange: (next: Partial<PageSettings>) => void;
  openLinkDialog: () => void;
  openImageDialog: () => void;
}) {
  const [editor] = useLexicalComposerContext();

  const isActive = useCallback(
    (format: TextFormatType) => {
      try {
        return editor.getEditorState().read(() => {
          const selection = $getSelection();
          return (
            $isRangeSelection(selection) && selection.hasFormat(format)
          );
        });
      } catch {
        return false;
      }
    },
    [editor],
  );

  const isHeadingActive = useCallback(
    (tag: HeadingTag) => {
      try {
        return editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          return selection.getNodes().some((node) => {
            let block: LexicalNode | null = node;
            while (
              block &&
              block.getType() !== "root" &&
              block.getType() !== "paragraph" &&
              block.getType() !== "heading"
            ) {
              block = block.getParentOrThrow();
            }
            return (
              block?.getType() === "heading" &&
              (block as { getTag?: () => HeadingTag }).getTag?.() === tag
            );
          });
        });
      } catch {
        return false;
      }
    },
    [editor],
  );

  const linkActive = useCallback(() => isSelectionInLink(editor), [editor]);

  return (
    <div className="document-editor__toolbar">
      <div className="document-editor__group">
        <button
          type="button"
          aria-pressed={isActive("bold")}
          className={`document-editor__button ${
            isActive("bold") ? "document-editor__button--active" : ""
          }`}
          onClick={() => toggleInlineFormat(editor, "bold")}
          disabled={readOnly}
        >
          Bold
        </button>
        <button
          type="button"
          aria-pressed={isActive("italic")}
          className={`document-editor__button ${
            isActive("italic") ? "document-editor__button--active" : ""
          }`}
          onClick={() => toggleInlineFormat(editor, "italic")}
          disabled={readOnly}
        >
          Italic
        </button>
        <button
          type="button"
          aria-pressed={isActive("underline")}
          className={`document-editor__button ${
            isActive("underline") ? "document-editor__button--active" : ""
          }`}
          onClick={() => toggleInlineFormat(editor, "underline")}
          disabled={readOnly}
        >
          Underline
        </button>
      </div>
      <span className="document-editor__separator" />
      <div className="document-editor__group">
        <button
          type="button"
          aria-pressed={isHeadingActive("h1")}
          onClick={() => toggleHeading(editor, "h1")}
          disabled={readOnly}
        >
          H1
        </button>
        <button
          type="button"
          aria-pressed={isHeadingActive("h2")}
          onClick={() => toggleHeading(editor, "h2")}
          disabled={readOnly}
        >
          H2
        </button>
        <button
          type="button"
          aria-pressed={isHeadingActive("h3")}
          onClick={() => toggleHeading(editor, "h3")}
          disabled={readOnly}
        >
          H3
        </button>
      </div>
      <span className="document-editor__separator" />
      <div className="document-editor__group">
        <button
          type="button"
          onClick={() => toggleList(editor, "bullet")}
          disabled={readOnly}
        >
          Bullet list
        </button>
        <button
          type="button"
          onClick={() => toggleList(editor, "number")}
          disabled={readOnly}
        >
          Numbered list
        </button>
      </div>
      <span className="document-editor__separator" />
      <div className="document-editor__group">
        <button
          type="button"
          aria-pressed={linkActive()}
          onClick={openLinkDialog}
          disabled={readOnly}
        >
          Link
        </button>
        {linkActive() && (
          <button
            type="button"
            className="document-editor__button document-editor__button--danger"
            onClick={onLinkRemove}
            disabled={readOnly}
          >
            Remove link
          </button>
        )}
      </div>
      <span className="document-editor__separator" />
      <div className="document-editor__group">
        <button
          type="button"
          onClick={() => {
            const rows = window.prompt("Number of rows (1-20)", "3");
            const cols = window.prompt("Number of columns (1-10)", "3");
            if (rows !== null && cols !== null) {
              const r = Number(rows);
              const c = Number(cols);
              if (Number.isFinite(r) && Number.isFinite(c)) {
                insertTable(editor, r, c);
              }
            }
          }}
          disabled={readOnly}
        >
          Table
        </button>
        <button
          type="button"
          onClick={openImageDialog}
          disabled={readOnly}
        >
          Image
        </button>
      </div>
      <span className="document-editor__separator" />
      <div className="document-editor__group document-editor__group--page">
        <label htmlFor="doc-page-size">Page size</label>
        <select
          id="doc-page-size"
          value={pageSettings.size}
          onChange={(event) =>
            onPageSettingsChange({ size: event.target.value as PageSettings["size"] })
          }
          disabled={readOnly}
        >
          <option value="A4">A4</option>
          <option value="Letter">Letter</option>
        </select>
        <label htmlFor="doc-page-orientation">Orientation</label>
        <select
          id="doc-page-orientation"
          value={pageSettings.orientation}
          onChange={(event) =>
            onPageSettingsChange({
              orientation: event.target.value as PageSettings["orientation"],
            })
          }
          disabled={readOnly}
        >
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </select>
        <label htmlFor="doc-page-margin">Margins</label>
        <select
          id="doc-page-margin"
          value={pageSettings.margin}
          onChange={(event) =>
            onPageSettingsChange({ margin: event.target.value as PageSettings["margin"] })
          }
          disabled={readOnly}
        >
          <option value="none">None</option>
          <option value="narrow">Narrow</option>
          <option value="moderate">Moderate</option>
          <option value="wide">Wide</option>
        </select>
        <label htmlFor="doc-header">Header</label>
        <input
          id="doc-header"
          type="text"
          value={pageSettings.header}
          placeholder="Header text — use {{page}} / {{pages}}"
          onChange={(event) => onPageSettingsChange({ header: event.target.value })}
          disabled={readOnly}
        />
        <label htmlFor="doc-footer">Footer</label>
        <input
          id="doc-footer"
          type="text"
          value={pageSettings.footer}
          placeholder="Footer text — use {{page}} / {{pages}}"
          onChange={(event) => onPageSettingsChange({ footer: event.target.value })}
          disabled={readOnly}
        />
        <label>
          <input
            type="checkbox"
            checked={pageSettings.showPageNumbers}
            onChange={(event) => onPageSettingsChange({ showPageNumbers: event.target.checked })}
            disabled={readOnly}
          />
          Page numbers
        </label>
      </div>
    </div>
  );
}

function LinkDialog({
  open,
  url,
  onInsert,
  onRemove,
  onClose,
}: {
  open: boolean;
  url: string;
  onInsert: (url: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [linkUrl, setLinkUrl] = useState(url);
  if (!open) return null;
  return (
    <div className="document-editor__dialog document-editor__dialog--overlay">
      <div className="document-editor__dialog--panel">
        <h3>{linkUrl ? "Edit link" : "Insert link"}</h3>
        <div className="document-editor__field">
          <label>URL</label>
          <input
            type="url"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder="https://example.com"
            autoFocus
          />
        </div>
        <div className="document-editor__dialog--actions">
          <button type="button" onClick={onClose}>Cancel</button>
          {linkUrl ? (
            <button type="button" onClick={onRemove} className="document-editor__button--danger">
              Remove
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (linkUrl.trim()) onInsert(linkUrl.trim());
              onClose();
            }}
            disabled={!linkUrl.trim()}
          >
            {linkUrl ? "Update" : "Insert"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImageDialog({
  open,
  fileInputRef,
  onInsert,
  onClose,
}: {
  open: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onInsert: (
    src: string,
    alt: string,
    width: number | null,
    height: number | null,
  ) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [imageWidth, setImageWidth] = useState("");
  const [imageHeight, setImageHeight] = useState("");
  const [imageAlt, setImageAlt] = useState("");

  if (!open) return null;
  return (
    <div className="document-editor__dialog document-editor__dialog--overlay">
      <div className="document-editor__dialog--panel">
        <h3>Insert image</h3>
        <div className="document-editor__field">
          <label>Image file</label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            ref={fileInputRef}
            onChange={(event) => {
              const selected = event.currentTarget.files?.[0] ?? null;
              if (!selected) return;
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                setPreview(dataUrl);
                const img = new Image();
                img.onload = () => {
                  setImageWidth(String(img.naturalWidth));
                  setImageHeight(String(img.naturalHeight));
                };
                img.src = dataUrl;
              };
              reader.readAsDataURL(selected);
            }}
          />
          {preview && (
            <img
              src={preview}
              alt={imageAlt}
              style={{ maxWidth: "200px", maxHeight: "200px", marginTop: 8 }}
            />
          )}
        </div>
        <div className="document-editor__field">
          <label>Alt text</label>
          <input
            type="text"
            value={imageAlt}
            onChange={(event) => setImageAlt(event.target.value)}
            placeholder="Image description"
          />
        </div>
        <div className="document-editor__field document-editor__field--row">
          <div>
            <label>Width (px)</label>
            <input
              type="number"
              min="0"
              value={imageWidth}
              onChange={(event) => setImageWidth(event.target.value)}
            />
          </div>
          <div>
            <label>Height (px)</label>
            <input
              type="number"
              min="0"
              value={imageHeight}
              onChange={(event) => setImageHeight(event.target.value)}
            />
          </div>
        </div>
        <div className="document-editor__dialog--actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            onClick={() => {
              const w = imageWidth ? Number(imageWidth) : null;
              const h = imageHeight ? Number(imageHeight) : null;
              onInsert(
                preview ?? "",
                imageAlt,
                Number.isFinite(w) ? w : null,
                Number.isFinite(h) ? h : null,
              );
              onClose();
            }}
            disabled={!preview}
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
