"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { checkPdfHeader, PDF_LIMITS } from "@/lib/pdf-limits";
import { formatBytes, pageLabel } from "@/lib/format";
import { safeFileStem } from "@/lib/pdf-images";
import { imageFormatFromSignature } from "@/lib/images-to-pdf";
import { inspectImageFile, type ImageInfo } from "@/lib/image-dimensions";
import {
  computeMarkLayout,
  FONT_FAMILIES,
  MARK_POSITIONS,
  rotatedMarkBounds,
  type FontFamily,
  type MarkOptions,
  type MarkPosition,
  type MarkProgress,
  type TextAlign,
  type VerticalAlign,
} from "@/lib/pdf-marking";
import { parsePageRanges } from "@/lib/split-pdf";
import { PdfDropzone } from "./pdf-dropzone";
import { PdfPageGrid } from "./pdf-page-grid";
import { PdfPagePreview } from "./pdf-page-preview";
import { PdfProgress } from "./pdf-progress";
import { PdfResult } from "./pdf-result";
import { usePdfDocument } from "./use-pdf-document";

type WorkerReply =
  | { type: "progress"; progress: MarkProgress }
  | { type: "result"; ok: boolean; output?: ArrayBuffer; error?: string };

const FONT_STACK: Record<FontFamily, { family: string; weight: string }> = {
  helvetica: { family: "Helvetica, Arial, sans-serif", weight: "400" },
  "helvetica-bold": { family: "Helvetica, Arial, sans-serif", weight: "700" },
  times: { family: "'Times New Roman', Times, serif", weight: "400" },
  "times-bold": { family: "'Times New Roman', Times, serif", weight: "700" },
  courier: { family: "'Courier New', Courier, monospace", weight: "400" },
  "courier-bold": { family: "'Courier New', Courier, monospace", weight: "700" },
};

let measureCanvas: HTMLCanvasElement | null = null;

function positionAxes(position: MarkPosition): { vertical: VerticalAlign; horizontal: TextAlign } {
  if (position === "center") return { vertical: "middle", horizontal: "center" };
  if (position === "custom") return { vertical: "middle", horizontal: "center" };
  const [vertical, horizontal] = position.split("-");
  return {
    vertical: vertical === "top" || vertical === "bottom" ? vertical : "middle",
    horizontal: horizontal === "left" || horizontal === "right" ? horizontal : "center",
  };
}

function measureText(text: string, size: number, family: FontFamily) {
  if (typeof document === "undefined") return text.length * size * 0.55;
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  const context = measureCanvas.getContext("2d");
  if (!context) return text.length * size * 0.55;
  const font = FONT_STACK[family];
  context.font = `${font.weight} ${size}px ${font.family}`;
  return context.measureText(text).width;
}

export default function WatermarkTool() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"text" | "image">("text");
  const [text, setText] = useState("");
  const [fontFamily, setFontFamily] = useState<FontFamily>("helvetica");
  const [fontSize, setFontSize] = useState(36);
  const [color, setColor] = useState("#40404d");
  const [opacity, setOpacity] = useState(0.25);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState<MarkPosition>("center");
  const [customX, setCustomX] = useState(50);
  const [customY, setCustomY] = useState(50);
  const [align, setAlign] = useState<TextAlign>("center");
  const [valign, setValign] = useState<VerticalAlign>("middle");
  const [scale, setScale] = useState(100);
  const [pagesText, setPagesText] = useState("");
  const [previewPage, setPreviewPage] = useState(1);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<MarkProgress | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ url: string; name: string; pages: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const urlRef = useRef<string | null>(null);
  const taskRef = useRef(0);
  const mountedRef = useRef(false);
  const { document, pageCount, loading: previewLoading, error: previewError } = usePdfDocument(file);

  const rangeParse = useMemo(() => {
    if (!pageCount) return { pages: [] as number[], error: "" };
    try {
      const ranges = pagesText.trim() ? parsePageRanges(pagesText, pageCount) : [{ first: 1, last: pageCount }];
      return {
        pages: ranges.flatMap((range) => Array.from({ length: range.last - range.first + 1 }, (_, index) => range.first + index)),
        error: "",
      };
    } catch (reason) {
      return { pages: [] as number[], error: reason instanceof Error ? reason.message : "Enter valid page ranges." };
    }
  }, [pageCount, pagesText]);

  const highlightedPages = useMemo(() => new Set(rangeParse.pages), [rangeParse.pages]);
  const overPageLimit = pageCount > PDF_LIMITS.pages;
  const safePreviewPage = pageCount ? Math.min(previewPage, pageCount) : previewPage;
  const canProcess = Boolean(
    file && document && !previewLoading && !previewError && !overPageLimit && !busy && !rangeParse.error && rangeParse.pages.length > 0
    && (mode === "text" ? text.trim().length > 0 : Boolean(imageFile && imageInfo)),
  );

  useEffect(() => () => {
    if (imageInfo) URL.revokeObjectURL(imageInfo.url);
  }, [imageInfo]);

  const clearResult = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setResult(null);
  };

  const change = (fn: () => void) => {
    clearResult();
    setError("");
    fn();
  };

  const selectPdf = async (selected: File | undefined) => {
    if (busy) return;
    clearResult();
    setError("");
    setFile(null);
    if (!selected) return;
    if (!selected.size) { setError("The selected file is empty."); return; }
    if (selected.size > PDF_LIMITS.perFileBytes) { setError(`The PDF exceeds the ${PDF_LIMITS.perFileBytes / 1024 / 1024} MB file limit.`); return; }
    try {
      const head = new Uint8Array(await selected.slice(0, 1024).arrayBuffer());
      if (!checkPdfHeader(head)) { setError("This file does not have a PDF signature."); return; }
    } catch {
      setError("Unable to read the selected PDF.");
      return;
    }
    setFile(selected);
    setPagesText("");
    setPreviewPage(1);
  };

  const selectImage = async (selected: File | undefined) => {
    if (busy || !selected) return;
    clearResult();
    setError("");
    if (!selected.size) { setError("Choose a non-empty watermark image."); return; }
    if (selected.size > 10 * 1024 * 1024) { setError("Choose a watermark image under 10 MB."); return; }
    try {
      const head = new Uint8Array(await selected.slice(0, 8).arrayBuffer());
      const format = imageFormatFromSignature(head);
      if (!format) { setError("Choose a valid PNG or JPEG watermark image."); return; }
      const info = await inspectImageFile(selected);
      setImageFile(selected);
      setImageInfo(info);
      setMode("image");
      setScale(45);
      setError("");
    } catch {
      setError("Unable to read the watermark image.");
    }
  };

  const removeImage = () => {
    change(() => {
      setImageFile(null);
      setImageInfo(null);
      if (mode === "image") setMode("text");
    });
  };

  const changeMode = (next: "text" | "image") => {
    change(() => {
      setMode(next);
      setScale(next === "image" ? 45 : 100);
    });
  };

  const process = async () => {
    if (!file || !canProcess) {
      if (rangeParse.error) setError(rangeParse.error);
      else if (mode === "text" && !text.trim()) setError("Enter watermark text.");
      else if (mode === "image" && !imageFile) setError("Choose a PNG or JPEG watermark image.");
      return;
    }
    clearResult();
    setError("");
    setProgress(null);
    setBusy(true);
    const task = ++taskRef.current;
    let pdfBytes: ArrayBuffer | null = null;
    let imageBytes: ArrayBuffer | null = null;
    try {
      pdfBytes = await file.arrayBuffer();
      if (task !== taskRef.current) { new Uint8Array(pdfBytes).fill(0); pdfBytes = null; return; }
      if (mode === "image" && imageFile) imageBytes = await imageFile.arrayBuffer();
      if (task !== taskRef.current) {
        if (pdfBytes) new Uint8Array(pdfBytes).fill(0);
        if (imageBytes) new Uint8Array(imageBytes).fill(0);
        return;
      }
      const format = imageBytes ? imageFormatFromSignature(new Uint8Array(imageBytes).subarray(0, 8)) : null;
      const options: MarkOptions = {
        operation: "watermark",
        mode,
        text: mode === "text" ? text : "",
        pages: pagesText.trim() || "all",
        position,
        rotation,
        opacity,
        fontSize,
        fontFamily,
        color,
        scale,
        align,
        valign,
        customX,
        customY,
        startNumber: 1,
        ...(mode === "image" && imageBytes && format ? { image: { bytes: new Uint8Array(imageBytes), format } } : {}),
      };
      const worker = new Worker(new URL("@/workers/pdf-marking.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        if (event.data.type === "progress") {
          if (task === taskRef.current && mountedRef.current) setProgress(event.data.progress);
          return;
        }
        worker.terminate();
        workerRef.current = null;
        if (!mountedRef.current || task !== taskRef.current) {
          if (event.data.output) new Uint8Array(event.data.output).fill(0);
          return;
        }
        setBusy(false);
        setProgress(null);
        if (!event.data.ok || !event.data.output) {
          setError(event.data.error ?? "The PDF could not be updated.");
          return;
        }
        try {
          if (!checkPdfHeader(new Uint8Array(event.data.output))) throw new Error("The generated PDF failed signature validation.");
          const blob = new Blob([event.data.output], { type: "application/pdf" });
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          setResult({ url, name: `${safeFileStem(file.name)}-watermarked.pdf`, pages: rangeParse.pages.length });
        } catch {
          setError("The generated PDF failed validation and was discarded.");
        } finally {
          new Uint8Array(event.data.output).fill(0);
        }
      };
      worker.onerror = () => {
        worker.terminate();
        workerRef.current = null;
        if (mountedRef.current && task === taskRef.current) {
          setBusy(false);
          setProgress(null);
          setError("PDF processing stopped unexpectedly. Try a different file.");
        }
      };
      const transfer: Transferable[] = [pdfBytes];
      if (imageBytes) transfer.push(imageBytes);
      worker.postMessage({ bytes: pdfBytes, options }, transfer);
      pdfBytes = null;
      imageBytes = null;
    } catch {
      if (pdfBytes) new Uint8Array(pdfBytes).fill(0);
      if (imageBytes) new Uint8Array(imageBytes).fill(0);
      if (mountedRef.current && task === taskRef.current) {
        setBusy(false);
        setProgress(null);
        setError("Unable to process the PDF.");
      }
    }
  };

  const cancel = () => {
    taskRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(false);
    setProgress(null);
    setError("Processing cancelled. Temporary browser data was released.");
  };

  const clearAll = () => {
    if (busy) return;
    taskRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    clearResult();
    setFile(null);
    setMode("text");
    setText("");
    setFontFamily("helvetica");
    setFontSize(36);
    setColor("#40404d");
    setOpacity(0.25);
    setRotation(0);
    setPosition("center");
    setCustomX(50);
    setCustomY(50);
    setAlign("center");
    setValign("middle");
    setScale(100);
    setPagesText("");
    setPreviewPage(1);
    setImageFile(null);
    setImageInfo(null);
    setError("");
    setProgress(null);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      taskRef.current += 1;
      workerRef.current?.terminate();
      workerRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, []);

  const previewOverlay = (size: { displayWidth: number; displayHeight: number; pageWidth: number; pageHeight: number; rotation: number }) => {
    const scaleFactor = size.displayWidth / Math.max(1, size.pageWidth);
    const margin = Math.max(18, fontSize) * scaleFactor;
    const maxWidth = Math.max(1, Math.min(size.displayWidth * scale / 100, size.displayWidth - margin * 2));
    const maxHeight = Math.max(1, Math.min(size.displayHeight * scale / 100, size.displayHeight - margin * 2));

    if (mode === "image" && imageInfo) {
      const ratio = Math.min(maxWidth / imageInfo.width, maxHeight / imageInfo.height);
      const width = imageInfo.width * ratio;
      const height = imageInfo.height * ratio;
      const bounds = rotatedMarkBounds(width, height, rotation);
      const layout = computeMarkLayout({
        displayWidth: size.displayWidth,
        displayHeight: size.displayHeight,
        position,
        align,
        valign,
        width: bounds.width,
        height: bounds.height,
        margin,
        customX,
        customY,
      });
      const centerX = layout.left + bounds.width / 2;
      const centerY = size.displayHeight - layout.bottom - bounds.height / 2;
      return (
        <img
          src={imageInfo.url}
          alt=""
          style={{
            position: "absolute",
            left: centerX - width / 2,
            top: centerY - height / 2,
            width,
            height,
            opacity,
            transform: `rotate(${rotation}deg)`,
            transformOrigin: "center",
          }}
        />
      );
    }

    if (mode !== "text" || !text.trim()) return null;
    let sizePx = fontSize * scaleFactor;
    let width = measureText(text, sizePx, fontFamily);
    if (width > maxWidth) {
      sizePx = Math.max(1, sizePx * maxWidth / width);
      width = maxWidth;
    }
    const height = sizePx;
    const bounds = rotatedMarkBounds(width, height, rotation);
    const layout = computeMarkLayout({
      displayWidth: size.displayWidth,
      displayHeight: size.displayHeight,
      position,
      align,
      valign,
      width: bounds.width,
      height: bounds.height,
      margin,
      customX,
      customY,
    });
    const centerX = layout.left + bounds.width / 2;
    const centerY = size.displayHeight - layout.bottom - bounds.height / 2;
    const font = FONT_STACK[fontFamily];
    return (
      <span
        style={{
          position: "absolute",
          left: centerX - width / 2,
          top: centerY - height / 2,
          width,
          height,
          fontSize: sizePx,
          lineHeight: 1,
          fontFamily: font.family,
          fontWeight: font.weight,
          color,
          opacity,
          whiteSpace: "nowrap",
          transform: `rotate(${rotation}deg)`,
          transformOrigin: "center",
        }}
      >
        {text}
      </span>
    );
  };

  return (
    <section className="merge-panel pdf-tool" aria-labelledby="watermark-heading">
      <h2 id="watermark-heading">Add a watermark to a PDF on this device</h2>
      <p>Add a text or image mark to chosen pages. This overlays content; it is not a secure redaction. The preview uses the same position, scale, opacity, and rotation settings as the PDF output.</p>
      <div className="privacy-note">PDFs up to {PDF_LIMITS.perFileBytes / 1024 / 1024} MB and {PDF_LIMITS.pages} pages, images up to 10 MB. Processing runs in a browser worker and the output is reopened and validated before download.</div>
      <PdfDropzone label="Choose a PDF" hint="PDF only · up to 50 MB" disabled={busy} onFiles={(files) => void selectPdf(files[0])} />
      {file ? (
        <div className="pdf-file-summary">
          <strong>{file.name}</strong>
          <span>{formatBytes(file.size)} · {previewLoading ? "Reading pages…" : previewError ? "Page count unavailable" : pageLabel(pageCount)}</span>
        </div>
      ) : null}
      {previewError ? <p role="alert" className="merge-error">{previewError}</p> : null}
      {overPageLimit ? <p role="alert" className="merge-error">This PDF has {pageCount} pages; the limit is {PDF_LIMITS.pages}.</p> : null}
      {file && document ? (
        <>
          <fieldset className="pdf-fieldset">
            <legend>Watermark type</legend>
            <label><input type="radio" name="watermark-mode" checked={mode === "text"} disabled={busy} onChange={() => changeMode("text")} /> Text watermark</label>
            <label><input type="radio" name="watermark-mode" checked={mode === "image"} disabled={busy} onChange={() => changeMode("image")} /> Image watermark</label>
          </fieldset>
          <div className="split-settings pdf-config">
            <label htmlFor="mark-pages">Pages to update</label>
            <input id="mark-pages" className="split-range-input" value={pagesText} disabled={busy} placeholder="All pages (default)" onChange={(event) => change(() => setPagesText(event.target.value))} aria-describedby="mark-pages-help" />
            <p id="mark-pages-help" className="route-note">Enter page numbers or ranges, such as 1-3, 5. Leave blank to use all pages.</p>

            {mode === "text" ? (
              <>
                <label htmlFor="mark-text">Watermark text</label>
                <input id="mark-text" className="split-range-input" maxLength={160} value={text} disabled={busy} onChange={(event) => change(() => setText(event.target.value))} />
                <label htmlFor="mark-font">Font</label>
                <select id="mark-font" className="split-range-input" value={fontFamily} disabled={busy} onChange={(event) => change(() => setFontFamily(event.target.value as FontFamily))}>
                  {FONT_FAMILIES.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
                </select>
                <label htmlFor="mark-color">Text color</label>
                <div className="pdf-color-row">
                  <input id="mark-color" type="color" value={color} disabled={busy} onChange={(event) => change(() => setColor(event.target.value))} />
                  <span>{color}</span>
                </div>
              </>
            ) : (
              <>
                <label className="file-picker">PNG or JPEG watermark image<input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" disabled={busy} onChange={(event) => { void selectImage(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
                {imageFile && imageInfo ? (
                  <div className="pdf-file-summary">
                    <strong>{imageFile.name}</strong>
                    <span>{imageInfo.width} × {imageInfo.height} px · {formatBytes(imageFile.size)}</span>
                    <button type="button" onClick={removeImage} disabled={busy}>Remove image</button>
                  </div>
                ) : <p className="route-note">Choose a PNG or JPEG image. Its aspect ratio is preserved.</p>}
              </>
            )}

            <label htmlFor="mark-position">Position</label>
            <select id="mark-position" className="split-range-input" value={position} disabled={busy} onChange={(event) => {
              const next = event.target.value as MarkPosition;
              change(() => {
                setPosition(next);
                if (next !== "custom") {
                  const axes = positionAxes(next);
                  setAlign(axes.horizontal);
                  setValign(axes.vertical);
                }
              });
            }}>
              {MARK_POSITIONS.map((value) => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}
              <option value="custom">Custom position</option>
            </select>
            <label htmlFor="mark-align">Horizontal alignment</label>
            <select id="mark-align" className="split-range-input" value={align} disabled={busy} onChange={(event) => {
              const next = event.target.value as TextAlign;
              change(() => {
                setAlign(next);
                if (position !== "custom") {
                  const axes = positionAxes(position);
                  setPosition(axes.vertical === "middle" && next === "center" ? "center" : `${axes.vertical}-${next}` as MarkPosition);
                }
              });
            }}>
              <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
            </select>
            <label htmlFor="mark-valign">Vertical alignment</label>
            <select id="mark-valign" className="split-range-input" value={valign} disabled={busy} onChange={(event) => {
              const next = event.target.value as VerticalAlign;
              change(() => {
                setValign(next);
                if (position !== "custom") {
                  const axes = positionAxes(position);
                  setPosition(next === "middle" && axes.horizontal === "center" ? "center" : `${next}-${axes.horizontal}` as MarkPosition);
                }
              });
            }}>
              <option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option>
            </select>
            {position === "custom" ? (
              <div className="pdf-custom-position">
                <label htmlFor="mark-custom-x">Horizontal position (%)</label>
                <input id="mark-custom-x" type="number" min={0} max={100} value={customX} disabled={busy} onChange={(event) => change(() => setCustomX(Number(event.target.value)))} />
                <label htmlFor="mark-custom-y">Vertical position (%)</label>
                <input id="mark-custom-y" type="number" min={0} max={100} value={customY} disabled={busy} onChange={(event) => change(() => setCustomY(Number(event.target.value)))} />
              </div>
            ) : null}
            <label htmlFor="mark-rotation">Rotation (degrees)</label>
            <div className="mark-angle">
              <input id="mark-rotation" type="number" min={0} max={359} value={rotation} disabled={busy} onChange={(event) => change(() => setRotation(Number(event.target.value)))} />
              <button type="button" className={rotation === 0 ? "angle-chip is-active" : "angle-chip"} aria-pressed={rotation === 0} onClick={() => change(() => setRotation(0))}>Straight</button>
              <button type="button" className={rotation === 45 ? "angle-chip is-active" : "angle-chip"} aria-pressed={rotation === 45} onClick={() => change(() => setRotation(45))}>Diagonal</button>
              <button type="button" className={rotation === 90 ? "angle-chip is-active" : "angle-chip"} aria-pressed={rotation === 90} onClick={() => change(() => setRotation(90))}>Vertical</button>
            </div>
            <label htmlFor="mark-opacity">Opacity</label>
            <input id="mark-opacity" type="range" min={0.05} max={1} step={0.05} value={opacity} disabled={busy} onChange={(event) => change(() => setOpacity(Number(event.target.value)))} />
            <span>{Math.round(opacity * 100)}%</span>
            <label htmlFor="mark-font-size">Font size</label>
            <input id="mark-font-size" type="number" min={6} max={96} value={fontSize} disabled={busy} onChange={(event) => change(() => setFontSize(Number(event.target.value)))} />
            <label htmlFor="mark-scale">Scale (% of page width)</label>
            <input id="mark-scale" type="number" min={5} max={100} value={scale} disabled={busy} onChange={(event) => change(() => setScale(Number(event.target.value)))} />
            <p className="route-note">Text is reduced to fit this width; image aspect ratio is preserved.</p>
          </div>
          <PdfPagePreview document={document} pageNumber={safePreviewPage} overlay={previewOverlay} label={`Watermark preview · page ${safePreviewPage}`} />
          <PdfPageGrid document={document} pageCount={pageCount} mode="preview" previewPage={safePreviewPage} highlighted={pagesText.trim() ? highlightedPages : undefined} onPreview={setPreviewPage} label="Choose a preview page" />
        </>
      ) : null}
      {rangeParse.error ? <p role="alert" className="merge-error">{rangeParse.error}</p> : null}
      <div className="merge-actions">
        <button type="button" className="hero-cta" disabled={!canProcess} onClick={() => void process()}>{busy ? "Updating PDF…" : "Add watermark"}</button>
        {busy ? <button type="button" onClick={cancel}>Cancel</button> : null}
        {file && !busy ? <button type="button" onClick={clearAll}>Reset</button> : null}
      </div>
      {busy ? <PdfProgress label="Applying watermark" value={progress?.completed} max={progress?.total} detail={progress?.label ?? "Preparing the browser worker…"} /> : null}
      {error ? <p role="alert" className="merge-error">{error}</p> : null}
      {result ? <PdfResult summary={`Validated watermarked PDF · ${result.pages} pages`} downloads={[{ url: result.url, name: result.name }]} onReset={clearAll} /> : null}
    </section>
  );
}

