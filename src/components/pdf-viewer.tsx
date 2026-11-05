"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { TextLayer } from "pdfjs-dist";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import {
  ANNOTATION_TOOL_LABELS,
  DEFAULT_TEXT_ANNOTATION_STYLE,
  IMAGE_OVERLAY_MAX_BYTES,
  RESIZE_HANDLES,
  RESIZE_HANDLE_LABELS,
  addAnnotationComment,
  appendFreehandPoint,
  createAnnotationComment,
  createDraftAnnotation,
  createEmptyAnnotationDocument,
  findAnnotationAtPoint,
  getAnnotationBounds,
  isMeaningfulAnnotation,
  moveAnnotation,
  removeAnnotationComment,
  removeAnnotationFromDocument,
  resizeAnnotation,
  resizeBoundsFromHandle,
  toPagePoint,
  validateImageOverlayFile,
  type AnnotationBounds,
  type AnnotationDocument,
  type AnnotationTool,
  type ImageOverlayFormat,
  type PagePoint,
  type PdfAnnotation,
  type ResizeHandle,
  type ViewerTool,
} from "@/lib/pdf-annotations";
import {
  canRedo,
  canUndo,
  commitHistory,
  commitHistorySince,
  createHistory,
  redoHistory,
  replaceHistoryPresent,
  undoHistory,
  type HistoryState,
} from "@/lib/annotation-history";
import { checkPdfHeader } from "@/lib/pdf-limits";
import { annotatedPdfFileName } from "@/lib/pdf-export-name";

type PdfJsModule = typeof import("pdfjs-dist");
type ExportReply = { ok: boolean; output?: ArrayBuffer; error?: string };

const AVAILABLE_ANNOTATION_TOOLS = [
  "highlight",
  "underline",
  "strikethrough",
  "freehand",
  "rectangle",
  "circle",
  "line",
  "arrow",
  "text-box",
  "image",
] as const satisfies readonly AnnotationTool[];

type LoadedOverlayImage = {
  src: string;
  name: string;
  format: ImageOverlayFormat;
};

type AnnotationInteraction =
  | {
      type: "move";
      annotation: PdfAnnotation;
      start: PagePoint;
    }
  | {
      type: "resize";
      annotation: PdfAnnotation;
      bounds: AnnotationBounds;
      handle: ResizeHandle;
    };

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The image could not be read."));
    };
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
}

function forceImageMimeType(dataUrl: string, format: ImageOverlayFormat): string {
  const separator = dataUrl.indexOf(",");
  if (separator < 0) throw new Error("The image data is not valid.");
  return `data:image/${format};base64,${dataUrl.slice(separator + 1)}`;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

export default function PdfViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const annotationLayerRef = useRef<HTMLDivElement>(null);
  const textLayerInstanceRef = useRef<TextLayer | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const loadingRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderRef = useRef<RenderTask | null>(null);
  const versionRef = useRef(0);
  const sourceBytesRef = useRef<Uint8Array | null>(null);
  const exportWorkerRef = useRef<Worker | null>(null);
  const exportRunRef = useRef(0);
  const exportUrlRef = useRef<string | null>(null);

  const [fileName, setFileName] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1.25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [activeTool, setActiveTool] = useState<ViewerTool>(null);
  const [annotationHistory, setAnnotationHistory] = useState<
    HistoryState<AnnotationDocument>
  >(() => createHistory(createEmptyAnnotationDocument()));
  const [draftAnnotation, setDraftAnnotation] = useState<PdfAnnotation | null>(null);
  const [previewAnnotation, setPreviewAnnotation] = useState<PdfAnnotation | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<number | null>(null);
  const [textBoxText, setTextBoxText] = useState("");
  const [textBoxFontSize, setTextBoxFontSize] = useState(
    DEFAULT_TEXT_ANNOTATION_STYLE.fontSize,
  );
  const [textBoxColor, setTextBoxColor] = useState(
    DEFAULT_TEXT_ANNOTATION_STYLE.color,
  );
  const [overlayImage, setOverlayImage] = useState<LoadedOverlayImage | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [commentText, setCommentText] = useState("");
  const annotationIdRef = useRef(0);
  const commentIdRef = useRef(0);
  const dragStartRef = useRef<PagePoint | null>(null);
  const draftAnnotationRef = useRef<PdfAnnotation | null>(null);
  const interactionRef = useRef<AnnotationInteraction | null>(null);
  const previewAnnotationRef = useRef<PdfAnnotation | null>(null);
  const editBaselineRef = useRef<AnnotationDocument | null>(null);

  const annotationDocument = annotationHistory.present;
  const annotations = annotationDocument.annotations;
  const comments = annotationDocument.comments;

  const clearDraft = useCallback(() => {
    dragStartRef.current = null;
    draftAnnotationRef.current = null;
    setDraftAnnotation(null);
  }, []);

  const clearInteraction = useCallback(() => {
    interactionRef.current = null;
    previewAnnotationRef.current = null;
    setPreviewAnnotation(null);
  }, []);

  const releaseDocument = useCallback(async () => {
    versionRef.current += 1;
    renderRef.current?.cancel();
    renderRef.current = null;
    textLayerInstanceRef.current?.cancel();
    textLayerInstanceRef.current = null;
    textLayerRef.current?.replaceChildren();

    const loading = loadingRef.current;
    loadingRef.current = null;
    pdfRef.current = null;
    sourceBytesRef.current = null;

    if (loading) {
      try {
        await loading.destroy();
      } catch {
        // The loading task may already be destroyed.
      }
    }
  }, []);

  const renderPage = useCallback(
    async (document: PDFDocumentProxy, page: number, scale: number) => {
      const currentVersion = versionRef.current;

      renderRef.current?.cancel();
      renderRef.current = null;

      try {
        const pdfPage = await document.getPage(page);

        if (currentVersion !== versionRef.current) return;

        const viewport = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;

        if (!canvas) return;

        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas is unavailable.");

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        setPageSize({ width: viewport.width, height: viewport.height });

        const task = pdfPage.render({
          canvas,
          canvasContext: context,
          viewport,
          transform:
            outputScale !== 1
              ? [outputScale, 0, 0, outputScale, 0, 0]
              : undefined,
        });

        renderRef.current = task;
        await task.promise;

        if (currentVersion === versionRef.current) {
          renderRef.current = null;
        }
      } catch (reason) {
        if (
          reason instanceof Error && reason.name === "RenderingCancelledException"
        ) {
          return;
        }

        if (currentVersion === versionRef.current) {
          setError(
            reason instanceof Error ? reason.message : "Unable to render this page.",
          );
        }
      }
    },
    [],
  );

  const resetAnnotationSession = useCallback(() => {
    editBaselineRef.current = null;
    annotationIdRef.current = 0;
    commentIdRef.current = 0;
    clearDraft();
    clearInteraction();
    setAnnotationHistory(createHistory(createEmptyAnnotationDocument()));
    setSelectedAnnotationId(null);
    setOverlayImage(null);
    setImageBusy(false);
    setCommentText("");
  }, [clearDraft, clearInteraction]);

  const clearExport = useCallback(() => {
    exportRunRef.current += 1;
    exportWorkerRef.current?.terminate();
    exportWorkerRef.current = null;
    if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);
    exportUrlRef.current = null;
    setExporting(false);
    setExportNotice("");
  }, []);

  const loadFile = async (file?: File) => {
    clearExport();
    await releaseDocument();
    resetAnnotationSession();

    setError("");
    setFileName("");
    setPageCount(0);
    setPageNumber(1);
    setPageSize({ width: 0, height: 0 });
    setActiveTool(null);

    if (!file) return;

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please select a PDF file.");
      return;
    }

    if (!file.size || file.size > 50 * 1024 * 1024) {
      setError("Choose a non-empty PDF smaller than 50 MB.");
      return;
    }

    const currentVersion = versionRef.current;
    setBusy(true);

    try {
      const pdfjs: PdfJsModule = await import("pdfjs-dist");

      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();

      const data = new Uint8Array(await file.arrayBuffer());

      if (currentVersion !== versionRef.current) return;

      if (!checkPdfHeader(data)) {
        throw new Error(
          "That file does not have a valid PDF signature. Choose a real PDF file.",
        );
      }

      // pdf.js may transfer the input buffer to its worker, so keep a private
      // copy for later annotation export.
      const source = data.slice();
      const task = pdfjs.getDocument({ data });
      loadingRef.current = task;

      const document = await task.promise;

      if (currentVersion !== versionRef.current) {
        await task.destroy();
        return;
      }

      pdfRef.current = document;

      if (document.numPages < 1 || document.numPages > 500) {
        throw new Error("PDF page count is outside the supported limit.");
      }

      setFileName(file.name);
      setPageCount(document.numPages);
      sourceBytesRef.current = source;
      await renderPage(document, 1, zoom);
    } catch (reason) {
      if (currentVersion === versionRef.current) {
        setError(
          reason instanceof Error ? reason.message : "Unable to open this PDF.",
        );
      }
    } finally {
      if (currentVersion === versionRef.current) {
        setBusy(false);
      }
    }
  };

  useEffect(() => {
    return () => {
      exportRunRef.current += 1;
      exportWorkerRef.current?.terminate();
      exportWorkerRef.current = null;
      if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);
      exportUrlRef.current = null;
      void releaseDocument();
    };
  }, [releaseDocument]);

  useEffect(() => {
    const document = pdfRef.current;
    const container = textLayerRef.current;
    if (!document || !container || pageCount < 1) return;

    const currentVersion = versionRef.current;
    let cancelled = false;
    let instance: TextLayer | null = null;

    container.replaceChildren();
    container.style.setProperty("--scale-factor", String(zoom));

    const renderTextLayer = async () => {
      try {
        const pdfPage = await document.getPage(pageNumber);
        if (cancelled || currentVersion !== versionRef.current) return;

        const textContent = await pdfPage.getTextContent();
        if (cancelled || currentVersion !== versionRef.current) return;

        instance = new TextLayer({
          textContentSource: textContent,
          container,
          viewport: pdfPage.getViewport({ scale: zoom }),
        });
        textLayerInstanceRef.current = instance;
        await instance.render();
      } catch (reason) {
        if (
          !cancelled &&
          currentVersion === versionRef.current &&
          !(reason instanceof Error && reason.name === "AbortException")
        ) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to prepare selectable PDF text.",
          );
        }
      }
    };

    void renderTextLayer();

    return () => {
      cancelled = true;
      instance?.cancel();
      if (textLayerInstanceRef.current === instance) {
        textLayerInstanceRef.current = null;
      }
      container.replaceChildren();
    };
  }, [pageCount, pageNumber, zoom]);

  const commitDocument = useCallback(
    (updater: (document: AnnotationDocument) => AnnotationDocument) => {
      setAnnotationHistory((history) => {
        const next = updater(history.present);
        return commitHistory(history, next);
      });
    },
    [],
  );

  const updateDocumentLive = useCallback(
    (updater: (document: AnnotationDocument) => AnnotationDocument) => {
      setAnnotationHistory((history) => {
        if (editBaselineRef.current === null) {
          editBaselineRef.current = history.present;
        }
        return replaceHistoryPresent(history, updater(history.present));
      });
    },
    [],
  );

  const finishLiveEdit = useCallback(() => {
    const baseline = editBaselineRef.current;
    if (!baseline) return;

    editBaselineRef.current = null;
    setAnnotationHistory((history) => commitHistorySince(history, baseline));
  }, []);

  const updateAnnotation = useCallback(
    (
      id: number,
      updater: (annotation: PdfAnnotation) => PdfAnnotation,
      live = false,
    ) => {
      const apply = (document: AnnotationDocument): AnnotationDocument => {
        let changed = false;
        const nextAnnotations = document.annotations.map((annotation) => {
          if (annotation.id !== id) return annotation;
          const next = updater(annotation);
          if (next !== annotation) changed = true;
          return next;
        });

        return changed ? { ...document, annotations: nextAnnotations } : document;
      };

      if (live) updateDocumentLive(apply);
      else commitDocument(apply);
    },
    [commitDocument, updateDocumentLive],
  );

  const addAnnotation = useCallback(
    (annotation: PdfAnnotation) => {
      commitDocument((document) => ({
        ...document,
        annotations: [...document.annotations, annotation],
      }));
    },
    [commitDocument],
  );

  const removeAnnotation = useCallback(
    (id: number) => {
      commitDocument((document) => removeAnnotationFromDocument(document, id));
      setSelectedAnnotationId((current) => (current === id ? null : current));
    },
    [commitDocument],
  );

  const undo = useCallback(() => {
    finishLiveEdit();
    setAnnotationHistory((history) => undoHistory(history));
  }, [finishLiveEdit]);

  const redo = useCallback(() => {
    finishLiveEdit();
    setAnnotationHistory((history) => redoHistory(history));
  }, [finishLiveEdit]);

  const activeSelectedAnnotationId =
    selectedAnnotationId !== null &&
    annotations.some((annotation) => annotation.id === selectedAnnotationId)
      ? selectedAnnotationId
      : null;

  const pageAnnotations = annotations.filter(
    (annotation) => annotation.page === pageNumber,
  );
  const selectedAnnotation = annotations.find(
    (annotation) => annotation.id === activeSelectedAnnotationId,
  );
  const selectedDisplayAnnotation = previewAnnotation?.id === activeSelectedAnnotationId
    ? previewAnnotation
    : selectedAnnotation;
  const pageComments = comments.filter((comment) => comment.page === pageNumber);
  const meaningfulAnnotationCount = annotations.filter(isMeaningfulAnnotation).length;

  useEffect(() => {
    if (!activeTool) return;

    const exitTool = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isTypingTarget(event.target)) return;
      setActiveTool(null);
      setSelectedAnnotationId(null);
      clearDraft();
      clearInteraction();
    };

    window.addEventListener("keydown", exitTool);
    return () => window.removeEventListener("keydown", exitTool);
  }, [activeTool, clearDraft, clearInteraction]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (modifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if (modifier && key === "y") {
        event.preventDefault();
        redo();
        return;
      }

      if (
        activeSelectedAnnotationId !== null &&
        (event.key === "Delete" || event.key === "Backspace")
      ) {
        event.preventDefault();
        removeAnnotation(activeSelectedAnnotationId);
        return;
      }

      if (activeSelectedAnnotationId === null || !selectedAnnotation) return;

      if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        const step = event.shiftKey ? 0.02 : 0.005;
        const deltaX = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const deltaY = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        updateAnnotation(
          activeSelectedAnnotationId,
          (annotation) => moveAnnotation(annotation, deltaX, deltaY),
        );
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    activeSelectedAnnotationId,
    redo,
    removeAnnotation,
    selectedAnnotation,
    undo,
    updateAnnotation,
  ]);

  const changePage = async (nextPage: number) => {
    const document = pdfRef.current;

    if (!document || nextPage < 1 || nextPage > pageCount) return;

    finishLiveEdit();
    clearDraft();
    clearInteraction();
    setSelectedAnnotationId(null);
    setPageNumber(nextPage);
    await renderPage(document, nextPage, zoom);
  };

  const changeZoom = async (nextZoom: number) => {
    const document = pdfRef.current;

    if (!document || nextZoom < 0.5 || nextZoom > 3) return;

    finishLiveEdit();
    clearDraft();
    clearInteraction();
    setZoom(nextZoom);
    await renderPage(document, pageNumber, nextZoom);
  };

  const cancel = async () => {
    clearExport();
    await releaseDocument();
    resetAnnotationSession();
    setBusy(false);
    setFileName("");
    setPageCount(0);
    setPageSize({ width: 0, height: 0 });
    setActiveTool(null);
    setError("PDF loading or rendering was cancelled.");
  };

  const chooseTool = (tool: ViewerTool) => {
    finishLiveEdit();
    clearDraft();
    clearInteraction();
    const nextTool = activeTool === tool ? null : tool;
    setActiveTool(nextTool);
    if (nextTool !== "select") setSelectedAnnotationId(null);
  };

  const selectAnnotation = (id: number) => {
    finishLiveEdit();
    clearDraft();
    clearInteraction();
    setActiveTool("select");
    setSelectedAnnotationId(id);
  };

  const getLayerPosition = (clientX: number, clientY: number): PagePoint => {
    const layer = annotationLayerRef.current;
    if (!layer) return { x: 0, y: 0 };
    return toPagePoint(clientX, clientY, layer.getBoundingClientRect());
  };

  const updateDraft = (annotation: PdfAnnotation) => {
    draftAnnotationRef.current = annotation;
    setDraftAnnotation(annotation);
  };

  const handleAnnotationStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activeTool) return;

    if (activeTool === "select") {
      const position = getLayerPosition(event.clientX, event.clientY);
      const hit = findAnnotationAtPoint(pageAnnotations, position);

      if (!hit) {
        setSelectedAnnotationId(null);
        return;
      }

      event.preventDefault();
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture unavailable; annotation still proceeds. */ }
      setSelectedAnnotationId(hit.id);
      interactionRef.current = { type: "move", annotation: hit, start: position };
      previewAnnotationRef.current = hit;
      setPreviewAnnotation(hit);
      return;
    }

    if (activeTool === "text-box" && !textBoxText.trim()) {
      setError("Enter text for the text box before drawing it on the PDF.");
      return;
    }

    if (activeTool === "image" && !overlayImage) {
      setError("Choose and validate an image before placing it on the PDF.");
      return;
    }

    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture unavailable; annotation still proceeds. */ }

    const position = getLayerPosition(event.clientX, event.clientY);
    dragStartRef.current = position;
    const draft = createDraftAnnotation(
      activeTool,
      position,
      position,
      pageNumber,
      textBoxText,
      { fontSize: textBoxFontSize, color: textBoxColor },
      overlayImage
        ? { src: overlayImage.src, name: overlayImage.name }
        : { src: "", name: "" },
    );
    updateDraft(draft);
  };

  const handleAnnotationMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;

    if (interaction) {
      const position = getLayerPosition(event.clientX, event.clientY);
      const next = interaction.type === "move"
        ? moveAnnotation(
            interaction.annotation,
            position.x - interaction.start.x,
            position.y - interaction.start.y,
          )
        : resizeAnnotation(
            interaction.annotation,
            resizeBoundsFromHandle(interaction.bounds, interaction.handle, position),
          );

      previewAnnotationRef.current = next;
      setPreviewAnnotation(next);
      return;
    }

    const start = dragStartRef.current;
    const draft = draftAnnotationRef.current;
    if (!activeTool || activeTool === "select" || !start || !draft) return;

    const position = getLayerPosition(event.clientX, event.clientY);
    updateDraft(
      activeTool === "freehand" && draft.kind === "freehand"
        ? appendFreehandPoint(draft, position)
        : createDraftAnnotation(
            activeTool,
            start,
            position,
            pageNumber,
            textBoxText,
            { fontSize: textBoxFontSize, color: textBoxColor },
            overlayImage
              ? { src: overlayImage.src, name: overlayImage.name }
              : { src: "", name: "" },
          ),
    );
  };

  const handleAnnotationEnd = () => {
    const interaction = interactionRef.current;

    if (interaction) {
      const preview = previewAnnotationRef.current;
      interactionRef.current = null;
      previewAnnotationRef.current = null;
      setPreviewAnnotation(null);

      if (preview && preview !== interaction.annotation) {
        updateAnnotation(preview.id, () => preview);
      }
      return;
    }

    const draft = draftAnnotationRef.current;

    if (draft && isMeaningfulAnnotation(draft)) {
      addAnnotation({ ...draft, id: ++annotationIdRef.current });
      setError("");
    }

    clearDraft();
  };

  const cancelPointerSession = () => {
    clearDraft();
    clearInteraction();
  };

  const beginResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    handle: ResizeHandle,
  ) => {
    if (!selectedDisplayAnnotation) return;

    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture unavailable; resize still proceeds. */ }
    const bounds = getAnnotationBounds(selectedDisplayAnnotation);
    interactionRef.current = {
      type: "resize",
      annotation: selectedDisplayAnnotation,
      bounds,
      handle,
    };
    previewAnnotationRef.current = selectedDisplayAnnotation;
    setPreviewAnnotation(selectedDisplayAnnotation);
  };

  const resizeFromKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    handle: ResizeHandle,
  ) => {
    if (!selectedDisplayAnnotation || !event.key.startsWith("Arrow")) return;

    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 0.02 : 0.005;
    const deltaX = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const deltaY = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    const bounds = getAnnotationBounds(selectedDisplayAnnotation);
    const corner = {
      x: handle.includes("w") ? bounds.x : bounds.x + bounds.width,
      y: handle.includes("n") ? bounds.y : bounds.y + bounds.height,
    };
    const nextBounds = resizeBoundsFromHandle(bounds, handle, {
      x: corner.x + deltaX,
      y: corner.y + deltaY,
    });

    updateAnnotation(
      selectedDisplayAnnotation.id,
      (annotation) => resizeAnnotation(annotation, nextBounds),
    );
  };

  const loadOverlayImage = async (file?: File) => {
    if (!file) return;

    setError("");
    setOverlayImage(null);
    setImageBusy(true);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const validation = validateImageOverlayFile(file.size, bytes);

      if (!validation.ok) {
        setError(validation.error);
        return;
      }

      const dataUrl = await readFileAsDataUrl(file);
      setOverlayImage({
        src: forceImageMimeType(dataUrl, validation.format),
        name: file.name,
        format: validation.format,
      });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The image could not be read.",
      );
    } finally {
      setImageBusy(false);
    }
  };

  const addComment = (annotationId: number | null) => {
    const text = commentText.trim();
    if (!text) return;

    finishLiveEdit();
    const comment = createAnnotationComment(
      ++commentIdRef.current,
      pageNumber,
      text,
      annotationId,
    );
    commitDocument((document) => addAnnotationComment(document, comment));
    setCommentText("");
  };

  const removeComment = (commentId: number) => {
    commitDocument((document) => removeAnnotationComment(document, commentId));
  };

  const exportEditedPdf = () => {
    const source = sourceBytesRef.current;
    const meaningful = annotations.filter(isMeaningfulAnnotation);

    if (!meaningful.length) {
      setError("Add at least one annotation before downloading an edited PDF.");
      return;
    }

    if (!source || !source.byteLength || exporting) return;

    finishLiveEdit();
    setError("");
    setExportNotice("");
    setExporting(true);

    const current = ++exportRunRef.current;
    const worker = new Worker(
      new URL("@/workers/pdf-export.worker.ts", import.meta.url),
      { type: "module" },
    );
    exportWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<ExportReply>) => {
      worker.terminate();
      if (exportWorkerRef.current === worker) exportWorkerRef.current = null;

      if (current !== exportRunRef.current) {
        if (event.data.output?.byteLength) {
          new Uint8Array(event.data.output).fill(0);
        }
        return;
      }

      const reply = event.data;

      if (!reply.ok || !reply.output) {
        setExporting(false);
        setError(reply.error ?? "The edited PDF could not be created.");
        return;
      }

      try {
        const output = new Uint8Array(reply.output);

        if (!checkPdfHeader(output)) {
          throw new Error("The exported file failed PDF signature validation.");
        }

        const url = URL.createObjectURL(
          new Blob([output], { type: "application/pdf" }),
        );
        exportUrlRef.current = url;

        const link = document.createElement("a");
        link.href = url;
        link.download = annotatedPdfFileName(fileName);
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();

        setExportNotice(
          `Edited PDF downloaded with ${meaningful.length} ${
            meaningful.length === 1 ? "annotation" : "annotations"
          } flattened into the file.`,
        );
        setExporting(false);

        window.setTimeout(() => {
          URL.revokeObjectURL(url);
          if (exportUrlRef.current === url) exportUrlRef.current = null;
        }, 60_000);
      } catch (reason) {
        setExporting(false);
        setError(
          reason instanceof Error
            ? reason.message
            : "The edited PDF failed validation.",
        );
      } finally {
        if (reply.output.byteLength) new Uint8Array(reply.output).fill(0);
      }
    };

    worker.onerror = () => {
      worker.terminate();
      if (exportWorkerRef.current === worker) exportWorkerRef.current = null;

      if (current === exportRunRef.current) {
        setExporting(false);
        setError("PDF export stopped unexpectedly. Try again.");
      }
    };

    // Send a copy so this viewer keeps the source PDF for later exports.
    const bytes = source.slice();
    const buffer = bytes.buffer as ArrayBuffer;
    worker.postMessage({ bytes: buffer, annotations: meaningful }, [buffer]);
  };

  const removeSelectedAnnotation = () => {
    if (activeSelectedAnnotationId === null) return;
    removeAnnotation(activeSelectedAnnotationId);
  };

  const renderAnnotation = (annotation: PdfAnnotation) => {
    if (annotation.kind === "text-box") {
      return (
        <div
          key={annotation.id}
          data-annotation-kind="text-box"
          data-annotation-id={annotation.id}
          aria-hidden="true"
          style={{
            position: "absolute",
            left: `${annotation.x * 100}%`,
            top: `${annotation.y * 100}%`,
            width: `${annotation.width * 100}%`,
            height: `${annotation.height * 100}%`,
            padding: 4,
            overflow: "hidden",
            background: "rgba(255, 255, 255, 0.82)",
            border: "1px solid rgba(35, 93, 190, 0.55)",
            color: annotation.color,
            fontSize: Math.max(6, annotation.fontSize * pageSize.height),
            lineHeight: 1.2,
            whiteSpace: "pre-wrap",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          {annotation.text}
        </div>
      );
    }

    if (annotation.kind === "image") {
      return (
        <div
          key={annotation.id}
          data-annotation-kind="image"
          data-annotation-id={annotation.id}
          aria-hidden="true"
          style={{
            position: "absolute",
            left: `${annotation.x * 100}%`,
            top: `${annotation.y * 100}%`,
            width: `${annotation.width * 100}%`,
            height: `${annotation.height * 100}%`,
            backgroundImage: `url("${annotation.src}")`,
            backgroundSize: "100% 100%",
            backgroundRepeat: "no-repeat",
            border: "1px solid rgba(35, 93, 190, 0.45)",
            pointerEvents: "none",
          }}
        />
      );
    }

    if (annotation.kind === "freehand") {
      return (
        <svg
          key={annotation.id}
          data-annotation-kind="freehand"
          data-annotation-id={annotation.id}
          aria-hidden="true"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
            pointerEvents: "none",
          }}
        >
          <polyline
            points={annotation.points.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke="rgba(35, 93, 190, 0.95)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      );
    }

    if (annotation.kind === "line" || annotation.kind === "arrow") {
      const markerId = `annotation-arrow-${annotation.id}`;

      return (
        <svg
          key={annotation.id}
          data-annotation-kind={annotation.kind}
          data-annotation-id={annotation.id}
          aria-hidden="true"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
            pointerEvents: "none",
          }}
        >
          {annotation.kind === "arrow" && (
            <defs>
              <marker
                id={markerId}
                markerWidth={5}
                markerHeight={5}
                refX={4.5}
                refY={2.5}
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M 0 0 L 5 2.5 L 0 5 z" fill="rgba(35, 93, 190, 0.95)" />
              </marker>
            </defs>
          )}
          <line
            x1={annotation.start.x}
            y1={annotation.start.y}
            x2={annotation.end.x}
            y2={annotation.end.y}
            stroke="rgba(35, 93, 190, 0.95)"
            strokeWidth={2.5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            markerEnd={annotation.kind === "arrow" ? `url(#${markerId})` : undefined}
          />
        </svg>
      );
    }

    if (annotation.kind === "rectangle" || annotation.kind === "circle") {
      return (
        <div
          key={annotation.id}
          data-annotation-kind={annotation.kind}
          data-annotation-id={annotation.id}
          aria-hidden="true"
          style={{
            position: "absolute",
            left: `${annotation.x * 100}%`,
            top: `${annotation.y * 100}%`,
            width: `${annotation.width * 100}%`,
            height: `${annotation.height * 100}%`,
            border: "2px solid rgba(35, 93, 190, 0.95)",
            borderRadius: annotation.kind === "circle" ? "50%" : undefined,
            background: "rgba(35, 93, 190, 0.06)",
            pointerEvents: "none",
          }}
        />
      );
    }

    if (
      annotation.kind !== "highlight" &&
      annotation.kind !== "underline" &&
      annotation.kind !== "strikethrough"
    ) {
      return null;
    }

    return (
      <div
        key={annotation.id}
        data-annotation-kind={annotation.kind}
        data-annotation-id={annotation.id}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: `${annotation.x * 100}%`,
          top: `${annotation.y * 100}%`,
          width: `${annotation.width * 100}%`,
          height: `${annotation.height * 100}%`,
          background:
            annotation.kind === "highlight"
              ? "rgba(255, 230, 0, 0.4)"
              : "transparent",
          border:
            annotation.kind === "highlight"
              ? "1px solid rgba(200, 160, 0, 0.7)"
              : undefined,
          borderBottom:
            annotation.kind === "underline"
              ? "2px solid rgba(35, 93, 190, 0.95)"
              : undefined,
          pointerEvents: "none",
        }}
      >
        {annotation.kind === "strikethrough" && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: 0,
              right: 0,
              borderTop: "2px solid rgba(210, 65, 65, 0.95)",
            }}
          />
        )}
      </div>
    );
  };

  const selectionBounds = selectedDisplayAnnotation
    ? getAnnotationBounds(selectedDisplayAnnotation)
    : null;
  const displayedPageAnnotations = previewAnnotation
    ? pageAnnotations.map((annotation) => (
        annotation.id === previewAnnotation.id ? previewAnnotation : annotation
      ))
    : pageAnnotations;
  const visibleAnnotations = draftAnnotation?.page === pageNumber
    ? [...displayedPageAnnotations, draftAnnotation]
    : displayedPageAnnotations;
  const commentTargetAnnotation = selectedAnnotation?.page === pageNumber
    ? selectedAnnotation
    : null;

  return (
    <section className="merge-panel" aria-label="PDF viewer">
      <h2>PDF Viewer</h2>

      <label className="file-picker">
        Choose PDF
        <input
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(event) => {
            void loadFile(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </label>

      {fileName && <p>{fileName}</p>}

      {busy && <p role="status">Loading PDF...</p>}

      {error && <p role="alert" className="merge-error">{error}</p>}

      {busy && (
        <button type="button" onClick={() => void cancel()}>
          Cancel
        </button>
      )}

      {pageCount > 0 && (
        <>
          <div
            className="merge-actions"
            role="group"
            aria-label="Annotation tools"
            style={{ flexWrap: "wrap" }}
          >
            <button
              type="button"
              aria-pressed={activeTool === null}
              onClick={() => chooseTool(null)}
            >
              Text selection
            </button>
            <button
              type="button"
              aria-pressed={activeTool === "select"}
              onClick={() => chooseTool("select")}
            >
              Select annotation
            </button>
            {AVAILABLE_ANNOTATION_TOOLS.map((tool) => (
              <button
                key={tool}
                type="button"
                aria-pressed={activeTool === tool}
                onClick={() => chooseTool(tool)}
              >
                {activeTool === tool
                  ? `Exit ${ANNOTATION_TOOL_LABELS[tool]}`
                  : ANNOTATION_TOOL_LABELS[tool]}
              </button>
            ))}
            <span role="status">
              {activeTool === "select"
                ? "Selection active. Click an annotation to select it; drag to move it, or use the corner handles to resize."
                : activeTool
                  ? `${ANNOTATION_TOOL_LABELS[activeTool]} active. Drag on the PDF; press Escape to exit.`
                  : "Text selection active. Choose an annotation tool to draw."}
            </span>
          </div>

          <div
            className="merge-actions"
            role="group"
            aria-label="Annotation history"
          >
            <button type="button" disabled={!canUndo(annotationHistory)} onClick={undo}>
              Undo annotation
            </button>
            <button type="button" disabled={!canRedo(annotationHistory)} onClick={redo}>
              Redo annotation
            </button>
            <span>
              {annotations.length} annotation{annotations.length === 1 ? "" : "s"} in
              this session
            </span>
          </div>

          <div
            className="merge-actions"
            role="group"
            aria-label="Export annotated PDF"
          >
            <button
              type="button"
              className="hero-cta"
              disabled={exporting || meaningfulAnnotationCount === 0}
              onClick={exportEditedPdf}
            >
              {exporting ? "Preparing edited PDF…" : "Download edited PDF"}
            </button>
            <span>
              {exporting
                ? "Flattening annotations into a copy of the PDF on this device..."
                : "Flattens all annotations into a copy. The original file is not changed."}
            </span>
          </div>

          {meaningfulAnnotationCount === 0 && (
            <p className="route-note">
              Add at least one annotation to enable the edited PDF download.
            </p>
          )}

          {exportNotice && (
            <p role="status" className="merge-success">
              {exportNotice}
            </p>
          )}

          {activeTool === "text-box" && (
            <div className="split-settings" role="group" aria-label="New text box settings">
              <label>
                Text box content
                <textarea
                  value={textBoxText}
                  rows={3}
                  onChange={(event) => setTextBoxText(event.target.value)}
                  onBlur={finishLiveEdit}
                  style={{ display: "block", width: "100%", marginTop: 6 }}
                />
              </label>
              <div className="merge-actions">
                <label>
                  Font size
                  <select
                    value={textBoxFontSize}
                    onChange={(event) => setTextBoxFontSize(Number(event.target.value))}
                  >
                    <option value={0.02}>Small</option>
                    <option value={0.025}>Medium</option>
                    <option value={0.04}>Large</option>
                  </select>
                </label>
                <label>
                  Text color
                  <input
                    type="color"
                    value={textBoxColor}
                    onChange={(event) => setTextBoxColor(event.target.value)}
                  />
                </label>
              </div>
            </div>
          )}

          {activeTool === "image" && (
            <div className="split-settings" role="group" aria-label="New image overlay settings">
              <label className="file-picker">
                Choose overlay image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                  disabled={imageBusy}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    void loadOverlayImage(file);
                  }}
                />
              </label>
              <p className="privacy-note">
                PNG, JPEG or WebP · maximum {Math.round(IMAGE_OVERLAY_MAX_BYTES / (1024 * 1024))} MB.
                The file signature is checked before placement.
              </p>
              {imageBusy && <p role="status">Validating image...</p>}
              {overlayImage && (
                <div className="merge-actions">
                  <div
                    role="img"
                    aria-label={`Overlay preview: ${overlayImage.name}`}
                    style={{
                      width: 72,
                      height: 72,
                      backgroundImage: `url("${overlayImage.src}")`,
                      backgroundSize: "contain",
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "center",
                      border: "1px solid var(--line)",
                      borderRadius: 4,
                    }}
                  />
                  <span>{overlayImage.name}</span>
                  <button type="button" onClick={() => setOverlayImage(null)}>
                    Clear image
                  </button>
                </div>
              )}
              <p>Drag on the current page to place the image, then select it to move or resize it.</p>
            </div>
          )}

          <div className="merge-actions">
            <button
              type="button"
              disabled={pageNumber <= 1}
              onClick={() => void changePage(pageNumber - 1)}
            >
              Previous
            </button>

            <span>
              Page {pageNumber} of {pageCount}
            </span>

            <button
              type="button"
              disabled={pageNumber >= pageCount}
              onClick={() => void changePage(pageNumber + 1)}
            >
              Next
            </button>

            <button
              type="button"
              disabled={zoom <= 0.5}
              onClick={() => void changeZoom(zoom - 0.25)}
            >
              −
            </button>

            <span>{Math.round(zoom * 100)}%</span>

            <button
              type="button"
              disabled={zoom >= 3}
              onClick={() => void changeZoom(zoom + 0.25)}
            >
              +
            </button>
          </div>

          <div
            style={{
              overflow: "auto",
              maxHeight: "75vh",
              padding: 16,
              background: "var(--surface, #f1f1f1)",
            }}
          >
            <div
              style={{
                position: "relative",
                display: "inline-block",
                cursor: activeTool === "select" ? "default" : activeTool ? "crosshair" : "default",
                touchAction: activeTool ? "none" : "auto",
              }}
            >
              <canvas
                ref={canvasRef}
                aria-label={`PDF page ${pageNumber}`}
                style={{ display: "block" }}
              />

              <div
                ref={textLayerRef}
                className="apos-text-layer"
                style={{ pointerEvents: activeTool ? "none" : "auto" }}
              />

              <div
                ref={annotationLayerRef}
                data-testid="pdf-annotation-layer"
                onPointerDown={handleAnnotationStart}
                onPointerMove={handleAnnotationMove}
                onPointerUp={handleAnnotationEnd}
                onPointerCancel={cancelPointerSession}
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 2,
                  cursor: activeTool === "select" ? "default" : activeTool ? "crosshair" : "default",
                  pointerEvents: activeTool ? "auto" : "none",
                  touchAction: activeTool ? "none" : "auto",
                }}
              >
                {visibleAnnotations.map(renderAnnotation)}

                {activeTool === "select" &&
                  selectedDisplayAnnotation &&
                  selectionBounds &&
                  selectedDisplayAnnotation.page === pageNumber && (
                    <div
                      data-testid="annotation-selection"
                      style={{
                        position: "absolute",
                        left: `${selectionBounds.x * 100}%`,
                        top: `${selectionBounds.y * 100}%`,
                        width: `${selectionBounds.width * 100}%`,
                        height: `${selectionBounds.height * 100}%`,
                        border: "2px dashed #235dbe",
                        boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.7)",
                        pointerEvents: "none",
                        zIndex: 3,
                      }}
                    >
                      {RESIZE_HANDLES.map((handle) => (
                        <button
                          key={handle}
                          type="button"
                          aria-label={`Resize selected annotation from ${RESIZE_HANDLE_LABELS[handle]}`}
                          onPointerDown={(event) => beginResize(event, handle)}
                          onKeyDown={(event) => resizeFromKeyboard(event, handle)}
                          style={{
                            position: "absolute",
                            left: handle.includes("w") ? -6 : "auto",
                            right: handle.includes("e") ? -6 : "auto",
                            top: handle.includes("n") ? -6 : "auto",
                            bottom: handle.includes("s") ? -6 : "auto",
                            width: 12,
                            height: 12,
                            padding: 0,
                            border: "2px solid #235dbe",
                            borderRadius: 2,
                            background: "#ffffff",
                            cursor: `${handle}-resize`,
                            pointerEvents: "auto",
                          }}
                        />
                      ))}
                    </div>
                  )}
              </div>
            </div>
          </div>

          <p className="privacy-note">
            Annotations and comments stay in this browser session until you export.
            Downloading an edited PDF creates a separate copy with annotations
            flattened in; the original file is not modified.
          </p>

          {pageAnnotations.length > 0 && (
            <ul className="merge-list" aria-label={`Annotations on page ${pageNumber}`}>
              {pageAnnotations.map((annotation, index) => (
                <li key={annotation.id}>
                  <span className="merge-filename">
                    {ANNOTATION_TOOL_LABELS[annotation.kind]} annotation {index + 1}
                    {annotation.kind === "text-box" && annotation.text.trim()
                      ? `: ${annotation.text.trim().slice(0, 48)}`
                      : ""}
                  </span>
                  <button
                    type="button"
                    aria-pressed={activeSelectedAnnotationId === annotation.id}
                    aria-label={`Select ${ANNOTATION_TOOL_LABELS[annotation.kind]} annotation ${index + 1}`}
                    onClick={() => selectAnnotation(annotation.id)}
                  >
                    {activeSelectedAnnotationId === annotation.id ? "Selected" : "Select"}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${ANNOTATION_TOOL_LABELS[annotation.kind]} annotation ${index + 1}`}
                    onClick={() => removeAnnotation(annotation.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selectedAnnotation &&
            selectedAnnotation.page === pageNumber &&
            activeTool === "select" && (
              <div
                className="split-settings"
                role="region"
                aria-label="Selected annotation properties"
              >
                <div className="merge-actions">
                  <strong>
                    Selected {ANNOTATION_TOOL_LABELS[selectedAnnotation.kind].toLowerCase()}
                  </strong>
                  <span>Page {selectedAnnotation.page}</span>
                  <button type="button" onClick={() => setSelectedAnnotationId(null)}>
                    Deselect
                  </button>
                  <button type="button" onClick={removeSelectedAnnotation}>
                    Delete annotation
                  </button>
                </div>

                {selectedAnnotation.kind === "text-box" && (
                  <>
                    <label>
                      Text box content
                      <textarea
                        value={selectedAnnotation.text}
                        rows={3}
                        onChange={(event) => updateAnnotation(
                          selectedAnnotation.id,
                          (annotation) => annotation.kind === "text-box"
                            ? { ...annotation, text: event.target.value }
                            : annotation,
                          true,
                        )}
                        onBlur={finishLiveEdit}
                        style={{ display: "block", width: "100%", marginTop: 6 }}
                      />
                    </label>
                    <div className="merge-actions">
                      <label>
                        Font size
                        <select
                          value={selectedAnnotation.fontSize}
                          onChange={(event) => updateAnnotation(
                            selectedAnnotation.id,
                            (annotation) => annotation.kind === "text-box"
                              ? { ...annotation, fontSize: Number(event.target.value) }
                              : annotation,
                            true,
                          )}
                          onBlur={finishLiveEdit}
                        >
                          <option value={0.02}>Small</option>
                          <option value={0.025}>Medium</option>
                          <option value={0.04}>Large</option>
                        </select>
                      </label>
                      <label>
                        Text color
                        <input
                          type="color"
                          value={selectedAnnotation.color}
                          onChange={(event) => updateAnnotation(
                            selectedAnnotation.id,
                            (annotation) => annotation.kind === "text-box"
                              ? { ...annotation, color: event.target.value }
                              : annotation,
                            true,
                          )}
                          onBlur={finishLiveEdit}
                        />
                      </label>
                    </div>
                  </>
                )}

                {selectedAnnotation.kind === "image" && (
                  <p>
                    Image overlay: <strong>{selectedAnnotation.name}</strong>. Drag the
                    annotation to reposition it or use a corner handle to resize it.
                  </p>
                )}

                <p className="privacy-note">
                  Drag the selection to move it. Corner handles resize it; focus a handle
                  and use the arrow keys for keyboard resizing. Arrow keys move the
                  selected annotation; Delete removes it. Ctrl+Z and Ctrl+Shift+Z undo
                  and redo annotation changes.
                </p>
              </div>
            )}

          <div
            className="split-settings"
            role="group"
            aria-label="Page comments"
          >
            <label>
              Comment
              <textarea
                value={commentText}
                rows={2}
                onChange={(event) => setCommentText(event.target.value)}
                style={{ display: "block", width: "100%", marginTop: 6 }}
              />
            </label>
            <div className="merge-actions">
              <button
                type="button"
                disabled={!commentText.trim()}
                onClick={() => addComment(null)}
              >
                Add page comment
              </button>
              <button
                type="button"
                disabled={!commentText.trim() || !commentTargetAnnotation}
                onClick={() => addComment(commentTargetAnnotation?.id ?? null)}
              >
                Add comment to selected annotation
              </button>
            </div>

            {pageComments.length > 0 && (
              <ul className="merge-list" aria-label={`Comments on page ${pageNumber}`}>
                {pageComments.map((comment, index) => {
                  const target = comment.annotationId === null
                    ? null
                    : pageAnnotations.find((annotation) => annotation.id === comment.annotationId);

                  return (
                    <li key={comment.id}>
                      <span className="merge-filename">
                        {target
                          ? `Comment on ${ANNOTATION_TOOL_LABELS[target.kind].toLowerCase()} annotation ${pageAnnotations.indexOf(target) + 1}`
                          : "Page comment"}
                        : {comment.text}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove comment ${index + 1} on page ${pageNumber}`}
                        onClick={() => removeComment(comment.id)}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
