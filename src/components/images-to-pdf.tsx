"use client";

import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS } from "@/lib/pdf-limits";
import {
  IMAGES_TO_PDF_LIMITS,
  imageFormatFromSignature,
  pageDimensions,
  safeImagesPdfName,
  validateImageBatch,
  validateImageDimensions,
  validateImagesToPdfSettings,
  type ImagesToPdfCompression,
  type ImagesToPdfFit,
  type ImagesToPdfMargin,
  type ImagesToPdfOrientation,
  type ImagesToPdfPageSize,
  type ImagesToPdfSettings,
} from "@/lib/images-to-pdf";

type ImageItem = {
  id: string;
  file: File;
  url: string;
  width: number;
  height: number;
  format: "png" | "jpeg";
};

type Reply =
  | { type: "progress"; done: number; total: number }
  | { ok: boolean; bytes?: ArrayBuffer; error?: string };

const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;

const DEFAULT_SETTINGS: ImagesToPdfSettings = {
  pageSize: "a4",
  orientation: "auto",
  margin: "none",
  customMarginMm: 10,
  customWidthMm: 210,
  customHeightMm: 297,
  fit: "fit",
  background: "#ffffff",
  compression: "original",
  quality: 0.85,
  outputName: "images.pdf",
};

export default function ImagesToPdf() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [settings, setSettings] = useState<ImagesToPdfSettings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [result, setResult] = useState<{ url: string; name: string; pages: number } | null>(null);
  const worker = useRef<Worker | null>(null);
  const resultUrlRef = useRef<string | null>(null);
  const itemUrlsRef = useRef<string[]>([]);
  const run = useRef(0);
  const mounted = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateSetting = <Key extends keyof ImagesToPdfSettings>(key: Key, value: ImagesToPdfSettings[Key]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const clearResult = () => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
    setResult(null);
  };

  const revokeItems = (list: ImageItem[]) => {
    for (const item of list) {
      URL.revokeObjectURL(item.url);
      itemUrlsRef.current = itemUrlsRef.current.filter((url) => url !== item.url);
    }
  };

  const replaceItems = (next: ImageItem[]) => {
    revokeItems(items);
    setItems(next);
  };

  const choose = async (incoming: FileList | File[] | null) => {
    if (!incoming || busy) return;
    clearResult(); setError(""); setProgress("");
    const chosen = Array.from(incoming);
    if (!chosen.length) return;
    const accepted: ImageItem[] = [];
    try {
      validateImageBatch(chosen.map((file) => file.size));
      for (const file of chosen) {
        const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
        const format = imageFormatFromSignature(head);
        if (!format) throw new Error(`${file.name} is not a supported PNG or JPG image.`);
        let bitmap: ImageBitmap;
        try { bitmap = await createImageBitmap(file); }
        catch { throw new Error(`${file.name} could not be decoded as a valid ${format === "png" ? "PNG" : "JPG"} image.`); }
        const width = bitmap.width; const height = bitmap.height; bitmap.close();
        validateImageDimensions(width, height);
        accepted.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file), width, height, format });
      }
      itemUrlsRef.current.push(...accepted.map((item) => item.url));
      replaceItems(accepted);
      if (!settings.outputName || settings.outputName === "images.pdf") {
        updateSetting("outputName", `${safeImagesPdfName(chosen[0].name.replace(/\.[^.]+$/, "") || "images")}`);
      }
    } catch (reason) {
      accepted.forEach((item) => URL.revokeObjectURL(item.url));
      setError(reason instanceof Error ? reason.message : "The selected images could not be read.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const move = (index: number, direction: -1 | 1) => {
    if (busy) return;
    setItems((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const changed = [...current];
      [changed[index], changed[target]] = [changed[target], changed[index]];
      return changed;
    });
    clearResult();
  };

  const reorder = (from: number, to: number) => {
    if (busy || from === to) return;
    setItems((current) => {
      const changed = [...current];
      const [moved] = changed.splice(from, 1);
      changed.splice(to, 0, moved);
      return changed;
    });
    clearResult();
  };

  const remove = (index: number) => {
    if (busy) return;
    const target = items[index];
    if (!target) return;
    revokeItems([target]);
    setItems((current) => current.filter((_item, position) => position !== index));
    clearResult();
  };

  const clearAll = () => {
    if (busy) return;
    revokeItems(items);
    setItems([]);
    clearResult();
    setError("");
    setProgress("");
  };

  const cancel = () => {
    run.current += 1;
    worker.current?.terminate();
    worker.current = null;
    clearResult();
    setBusy(false);
    setProgress("");
    setError("Processing cancelled. Temporary browser image data was released.");
  };

  const process = async () => {
    if (!items.length || busy) return;
    clearResult(); setError(""); setProgress("Validating settings…"); setBusy(true);
    const current = ++run.current;
    try {
      validateImagesToPdfSettings(settings);
      const files = await Promise.all(items.map(async (item) => ({ name: item.file.name, bytes: await item.file.arrayBuffer() })));
      if (current !== run.current) { files.forEach(({ bytes }) => new Uint8Array(bytes).fill(0)); return; }
      setProgress(`Creating ${items.length} page(s)…`);
      const active = new Worker(new URL("@/workers/images-to-pdf.worker.ts", import.meta.url), { type: "module" });
      worker.current = active;
      active.onmessage = async (event: MessageEvent<Reply>) => {
        const message = event.data;
        if ((message as { type?: string }).type === "progress") {
          const update = message as Extract<Reply, { type: "progress" }>;
          if (current === run.current && mounted.current) setProgress(`Placed ${update.done} of ${update.total} image(s)…`);
          return;
        }
        const reply = message as Exclude<Reply, { type: "progress" }>;
        active.terminate(); worker.current = null;
        if (current !== run.current || !mounted.current) { if (reply.bytes) new Uint8Array(reply.bytes).fill(0); return; }
        try {
          if (!reply.ok || !reply.bytes) throw new Error(reply.error ?? "The PDF could not be created.");
          if (reply.bytes.byteLength > PDF_LIMITS.perFileBytes || !checkPdfHeader(new Uint8Array(reply.bytes))) throw new Error("The generated PDF failed validation or exceeds the 50 MB output limit.");
          const checked = await PDFDocument.load(reply.bytes);
          if (checked.getPageCount() !== items.length) throw new Error("The generated PDF did not contain all selected images.");
          for (let index = 0; index < items.length; index += 1) {
            const expected = pageDimensions(settings, items[index].width, items[index].height);
            const actual = checked.getPage(index).getSize();
            if (Math.abs(actual.width - expected.width) > 0.02 || Math.abs(actual.height - expected.height) > 0.02) throw new Error(`Page ${index + 1} did not match the selected page size and orientation.`);
          }
          if (current !== run.current || !mounted.current) { new Uint8Array(reply.bytes).fill(0); return; }
          const objectUrl = URL.createObjectURL(new Blob([reply.bytes], { type: "application/pdf" }));
          resultUrlRef.current = objectUrl;
          const name = safeImagesPdfName(settings.outputName);
          setResult({ url: objectUrl, name, pages: items.length });
          setProgress(`Validated ${items.length} page(s).`);
        } catch (reason) {
          if (current === run.current && mounted.current) setError(reason instanceof Error ? reason.message : "The PDF failed validation.");
          setProgress("");
        } finally {
          if (reply.bytes) new Uint8Array(reply.bytes).fill(0);
          if (current === run.current && mounted.current) setBusy(false);
        }
      };
      active.onerror = () => { active.terminate(); worker.current = null; if (current === run.current && mounted.current) { setBusy(false); setError("Image conversion stopped unexpectedly."); setProgress(""); } };
      active.postMessage({ files, settings, orientation: settings.orientation }, files.map(({ bytes }) => bytes));
    } catch (reason) {
      if (current === run.current && mounted.current) {
        setBusy(false);
        setProgress("");
        setError(reason instanceof Error ? reason.message : "Unable to read the selected images.");
      }
    }
  };

  useEffect(() => {
    mounted.current = true;
    const currentUrls = itemUrlsRef.current;
    return () => {
      mounted.current = false; run.current += 1; worker.current?.terminate();
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      currentUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const pageSizeOptions: Array<{ value: ImagesToPdfPageSize; label: string }> = [
    { value: "a4", label: "A4" },
    { value: "a3", label: "A3" },
    { value: "a5", label: "A5" },
    { value: "letter", label: "Letter" },
    { value: "legal", label: "Legal" },
    { value: "image", label: "Original image dimensions" },
    { value: "custom", label: "Custom dimensions" },
  ];

  return <section className="merge-panel images-pdf" aria-labelledby="images-pdf-heading">
    <h2 id="images-pdf-heading">Combine images into a PDF on this device</h2>
    <p>Choose JPG and PNG images, arrange their page order, and place them on A4, A3, A5, Letter, Legal, natural or custom pages. Aspect ratios are preserved, and the finished PDF is reopened and checked before download.</p>
    <div className="privacy-note">Up to {IMAGES_TO_PDF_LIMITS.files} images and 50 MB combined. Images are decoded in the browser, processed in a Web Worker and never uploaded. Use the arrow buttons or drag a preview to change page order.</div>
    <label className="file-picker">Choose JPG or PNG images<input ref={inputRef} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" multiple disabled={busy} onChange={(event) => { void choose(event.currentTarget.files); }}/></label>
    <div
      className={`drop-zone${dragActive ? " drop-active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => { if (!busy) inputRef.current?.click(); }}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!busy) inputRef.current?.click(); } }}
      onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragActive(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
      onDrop={(event) => {
        event.preventDefault(); setDragActive(false);
        if (!busy && event.dataTransfer.files.length) void choose(event.dataTransfer.files);
      }}
    >Drop images here, or use the file picker above.</div>

    {items.length > 0 && <section className="images-pdf-order" aria-labelledby="images-order-heading">
      <div className="images-pdf-order-head"><h3 id="images-order-heading">Page order</h3><span>{items.length} image(s)</span><button type="button" onClick={clearAll} disabled={busy}>Clear all</button></div>
      <ol className="images-pdf-list" aria-label="Image page order">
        {items.map((item, index) => <li
          key={item.id}
          draggable={!busy}
          onDragStart={() => setDragIndex(index)}
          onDragOver={(event) => { event.preventDefault(); }}
          onDrop={(event) => { event.preventDefault(); if (dragIndex !== null) reorder(dragIndex, index); setDragIndex(null); }}
          onDragEnd={() => setDragIndex(null)}
          className={dragIndex === index ? "is-dragging" : ""}
        >
          <span className="images-pdf-index" aria-hidden="true">{index + 1}</span>
          <img src={item.url} alt={`Preview of ${item.file.name}`} width={item.width} height={item.height} />
          <div className="images-pdf-copy">
            <strong title={item.file.name}>{item.file.name}</strong>
            <span>{item.width} × {item.height}px · {formatBytes(item.file.size)} · {item.format.toUpperCase()}</span>
          </div>
          <div className="images-pdf-controls">
            <button type="button" disabled={busy || index === 0} aria-label={`Move up ${item.file.name}`} onClick={() => move(index, -1)}>Move up</button>
            <button type="button" disabled={busy || index === items.length - 1} aria-label={`Move down ${item.file.name}`} onClick={() => move(index, 1)}>Move down</button>
            <button type="button" disabled={busy} aria-label={`Remove ${item.file.name}`} onClick={() => remove(index)}>Remove</button>
          </div>
        </li>)}
      </ol>
    </section>}

    {items.length > 0 && <fieldset className="conversion-options images-pdf-settings">
      <legend>Page settings</legend>
      <label htmlFor="images-pdf-size">Page size
        <select id="images-pdf-size" value={settings.pageSize} disabled={busy} onChange={(event) => updateSetting("pageSize", event.target.value as ImagesToPdfPageSize)}>{pageSizeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      </label>
      {settings.pageSize !== "image" && <label htmlFor="images-pdf-orientation">Orientation
        <select id="images-pdf-orientation" value={settings.orientation} disabled={busy} onChange={(event) => updateSetting("orientation", event.target.value as ImagesToPdfOrientation)}><option value="auto">Automatic (follow each image)</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>
      </label>}
      {settings.pageSize === "custom" && <div className="images-pdf-inline">
        <label htmlFor="images-pdf-width">Custom width (mm)<input id="images-pdf-width" type="number" min={10} max={2000} value={settings.customWidthMm} disabled={busy} onChange={(event) => updateSetting("customWidthMm", Number(event.target.value))} /></label>
        <label htmlFor="images-pdf-height">Custom height (mm)<input id="images-pdf-height" type="number" min={10} max={2000} value={settings.customHeightMm} disabled={busy} onChange={(event) => updateSetting("customHeightMm", Number(event.target.value))} /></label>
      </div>}
      <label htmlFor="images-pdf-margin">Margins
        <select id="images-pdf-margin" value={settings.margin} disabled={busy} onChange={(event) => updateSetting("margin", event.target.value as ImagesToPdfMargin)}><option value="none">None</option><option value="small">Small (18 pt)</option><option value="medium">Medium (36 pt)</option><option value="large">Large (54 pt)</option><option value="custom">Custom</option></select>
      </label>
      {settings.margin === "custom" && <label htmlFor="images-pdf-margin-mm">Custom margin (mm)<input id="images-pdf-margin-mm" type="number" min={0} max={200} value={settings.customMarginMm} disabled={busy} onChange={(event) => updateSetting("customMarginMm", Number(event.target.value))} /></label>}
      <label htmlFor="images-pdf-fit">Image placement
        <select id="images-pdf-fit" value={settings.fit} disabled={busy} onChange={(event) => updateSetting("fit", event.target.value as ImagesToPdfFit)}><option value="fit">Fit to page — contain, preserve aspect ratio</option><option value="fill">Fill page — cover and crop at the page edge</option><option value="original">Original size — 96 DPI, top aligned</option><option value="center">Center at original size</option></select>
      </label>
      <label htmlFor="images-pdf-background">Background colour<input id="images-pdf-background" type="color" value={settings.background} disabled={busy} onChange={(event) => updateSetting("background", event.target.value)} /></label>
      <label htmlFor="images-pdf-compression">Image data
        <select id="images-pdf-compression" value={settings.compression} disabled={busy} onChange={(event) => updateSetting("compression", event.target.value as ImagesToPdfCompression)}><option value="original">Keep original image data</option><option value="jpeg">Recompress as JPEG</option><option value="png">Recompress as PNG</option></select>
      </label>
      {settings.compression === "jpeg" && <label htmlFor="images-pdf-quality">JPEG quality
        <select id="images-pdf-quality" value={settings.quality} disabled={busy} onChange={(event) => updateSetting("quality", Number(event.target.value))}><option value={0.7}>70%</option><option value={0.85}>85%</option><option value={0.95}>95%</option></select>
      </label>}
      <label htmlFor="images-pdf-output">Output filename<input id="images-pdf-output" value={settings.outputName} disabled={busy} onChange={(event) => updateSetting("outputName", event.target.value)} /></label>
    </fieldset>}

    <div className="merge-actions">
      <button type="button" className="hero-cta" disabled={!items.length || busy} onClick={() => void process()}>{busy ? "Creating PDF…" : "Create PDF"}</button>
      {busy && <button type="button" onClick={cancel}>Cancel</button>}
    </div>
    {progress && <p role="status" aria-live="polite">{progress}</p>}
    {error && <p role="alert" className="merge-error">{error}</p>}
    {result && <p role="status" className="merge-success"><a href={result.url} download={result.name}>Download validated PDF · {result.pages} pages</a><button type="button" onClick={() => { clearResult(); setProgress(""); }}>Clear result</button></p>}
  </section>;
}
