"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileUp, Loader2, Search, Server, ShieldCheck, X } from "lucide-react";
import {
  SERVER_TOOL_CATEGORY_LABELS,
  defaultOptionValue,
  fetchServerRegistry,
  inspectServerFormFields,
  runServerTool,
  serverAccept,
  type ServerRegistry,
  type ServerTool,
  type ServerToolOption,
} from "@/lib/server-tools";

const BROWSER_EQUIVALENT: Record<string, string> = {
  merge: "/tools/merge-pdf",
  split: "/tools/split-pdf",
  organize: "/tools/organize-pages",
  rotate: "/tools/rotate-pdf",
  remove_pages: "/tools/delete-pdf-pages",
  images_to_pdf: "/tools/images-to-pdf",
  pdf_to_images: "/tools/pdf-to-images",
  pdf_to_word: "/tools/pdf-to-office",
  pdf_to_excel: "/tools/pdf-to-office",
  extract_text: "/tools/pdf-to-text",
  compress: "/tools/compress-pdf",
  edit: "/tools/edit-pdf",
  watermark: "/tools/pdf-watermark",
  page_numbers: "/tools/pdf-page-numbers",
  protect: "/tools/protect-pdf",
  unlock: "/tools/unlock-pdf",
  repair: "/tools/repair-pdf",
  metadata: "/tools/pdf-metadata",
  redact: "/tools/redact-pdf",
  ocr: "/tools/ocr-pdf",
  summarize: "/tools/ai-assistant",
};

type FormField = { name: string; type: string; value: string; states?: string[] };
const JSON_OPTIONS = new Set(["elements", "regions", "fields"]);

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function initialOptions(tool: ServerTool) {
  return Object.fromEntries(tool.options.filter((option) => !JSON_OPTIONS.has(option.name)).map((option) => [option.name, defaultOptionValue(option)])) as Record<string, string | boolean>;
}

function setupCommand() {
  return [
    "python -m venv backend/.venv",
    "backend/.venv/Scripts/python.exe -m pip install -e \"backend[test]\"",
    "backend/.venv/Scripts/python.exe -m uvicorn apos_api.main:app --app-dir backend --reload --port 8000",
    "",
    "# In another terminal:",
    "$env:NEXT_PUBLIC_APOS_API_URL=\"http://127.0.0.1:8000\"",
    "npm.cmd run dev",
  ].join("\n");
}

export default function ServerToolsConsole() {
  const [registry, setRegistry] = useState<ServerRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<ServerTool | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [options, setOptions] = useState<Record<string, string | boolean>>({});
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [jsonValues, setJsonValues] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ url: string; filename: string; bytes: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    void fetchServerRegistry(controller.signal)
      .then((value) => {
        if (!mountedRef.current) return;
        setRegistry(value);
        setLoadError("");
      })
      .catch((reason) => {
        if (!mountedRef.current || controller.signal.aborted) return;
        setLoadError(reason instanceof Error ? reason.message : "The processing server could not be reached.");
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
    return () => {
      mountedRef.current = false;
      controller.abort();
      abortRef.current?.abort();
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    };
  }, []);

  const categories = useMemo(() => {
    const values = Array.from(new Set((registry?.tools ?? []).map((tool) => tool.category))).sort();
    return ["all", ...values];
  }, [registry]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return (registry?.tools ?? [])
      .filter((tool) => category === "all" || tool.category === category)
      .filter((tool) => !normalized || `${tool.label} ${tool.description} ${tool.name}`.toLocaleLowerCase().includes(normalized))
      .sort((left, right) => Number(right.available) - Number(left.available) || left.label.localeCompare(right.label));
  }, [category, query, registry]);

  const clearResult = () => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
    setResult(null);
  };

  const chooseTool = (tool: ServerTool) => {
    abortRef.current?.abort();
    clearResult();
    setSelected(tool);
    setFiles([]);
    setFormFields([]);
    setFieldValues({});
    setJsonValues({});
    setOptions(initialOptions(tool));
    setError("");
    setProgress("");
  };

  const back = () => {
    if (busy) return;
    clearResult();
    setSelected(null);
    setError("");
    setProgress("");
  };

  const chooseFiles = async (incoming: FileList | File[] | null) => {
    if (!incoming || !selected || busy) return;
    clearResult();
    setError("");
    const next = Array.from(incoming).slice(0, selected.multiple ? (registry?.max_files ?? 20) : 1);
    if (!next.length) return;
    const total = next.reduce((sum, file) => sum + file.size, 0);
    const maxFiles = selected.multiple ? (registry?.max_files ?? 20) : 1;
    if (next.length > maxFiles) { setError(`This tool accepts at most ${maxFiles} file(s).`); return; }
    if (total > (registry?.max_upload_mb ?? 50) * 1024 * 1024) { setError(`This server accepts up to ${registry?.max_upload_mb ?? 50} MB per request.`); return; }
    setFiles(next);
    setFormFields([]);
    setFieldValues({});
    if (selected.name === "form_fill" && next[0]) {
      try {
        setProgress("Reading the PDF form fields…");
        const fields = await inspectServerFormFields(await next[0].arrayBuffer(), next[0].name);
        if (!mountedRef.current) return;
        setFormFields(fields);
        setFieldValues(Object.fromEntries(fields.map((field) => [field.name, field.value])));
        if (!fields.length) setError("This PDF has no fillable form fields.");
      } catch (reason) {
        if (mountedRef.current) setError(reason instanceof Error ? reason.message : "The form fields could not be read.");
      } finally {
        if (mountedRef.current) setProgress("");
      }
    }
  };

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_file, position) => position !== index));
    clearResult();
  };

  const submit = async () => {
    if (!selected || !files.length || busy) return;
    if (files.length < selected.min_files) { setError(`${selected.label} needs at least ${selected.min_files} file(s).`); return; }
    if (selected.name === "form_fill" && !formFields.length) { setError("Choose a PDF with form fields first."); return; }
    clearResult(); setError(""); setBusy(true); setProgress("Uploading to your APOS processing server…");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file, file.name);
      for (const [name, value] of Object.entries(options)) {
        if (JSON_OPTIONS.has(name)) continue;
        form.append(name, typeof value === "boolean" ? String(value) : value);
      }
      for (const [name, value] of Object.entries(jsonValues)) {
        if (!value.trim()) continue;
        JSON.parse(value);
        form.append(name, value);
      }
      if (selected.name === "form_fill") {
        form.append("fields", JSON.stringify(fieldValues));
        form.set("lock", String(Boolean(options.lock)));
      }
      setProgress("Processing on your server…");
      const output = await runServerTool(selected.name, form, controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      const url = URL.createObjectURL(output.blob);
      resultUrlRef.current = url;
      setResult({ url, filename: output.filename, bytes: output.blob.size });
      setProgress("Done.");
    } catch (reason) {
      if (controller.signal.aborted) setError("Processing cancelled.");
      else if (reason instanceof SyntaxError) setError("The advanced JSON option is not valid JSON.");
      else setError(reason instanceof Error ? reason.message : "The processing request failed.");
      setProgress("");
    } finally {
      if (mountedRef.current) setBusy(false);
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setProgress("Cancelling…");
  };

  const reset = () => {
    if (busy) return;
    clearResult();
    setFiles([]);
    setError("");
    setProgress("");
    setFormFields([]);
    setFieldValues({});
    setJsonValues({});
    if (selected) setOptions(initialOptions(selected));
  };

  if (selected) {
    const browserEquivalent = BROWSER_EQUIVALENT[selected.name];
    return <section className="server-tools-panel" aria-labelledby="server-tool-heading">
      <div className="server-tool-detail-head">
        <button type="button" className="server-back" onClick={back}><ArrowLeft size={15} aria-hidden="true" /> All server tools</button>
        <span className={`server-availability ${selected.available ? "is-ready" : "is-missing"}`}><i /> {selected.available ? "Ready on this server" : "Unavailable on this server"}</span>
      </div>
      <h2 id="server-tool-heading">{selected.label}</h2>
      <p>{selected.description}</p>
      {!selected.available && <div className="server-tools-warning" role="alert"><AlertTriangle size={18} /><span>{selected.unavailable_hint || "A required native dependency is missing on the processing server."}</span></div>}
      <div className="server-tools-privacy"><ShieldCheck size={17} /><span>This tool sends the selected file to your configured APOS processing server. It is not processed in this browser. The server holds uploads in memory or a temporary directory and does not use a database.</span></div>
      {browserEquivalent && <p className="route-note">A browser-local version also exists: <Link href={browserEquivalent}>{browserEquivalent.replace("/tools/", "").replaceAll("-", " ")}</Link>.</p>}

      <label className="file-picker">Choose {selected.multiple ? "files" : "a file"}
        <input ref={inputRef} type="file" accept={serverAccept(selected.accepts)} multiple={selected.multiple} disabled={busy} onChange={(event) => { void chooseFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
      </label>
      <div
        className={`drop-zone${dragging ? " drop-active" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => { if (!busy) inputRef.current?.click(); }}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!busy) inputRef.current?.click(); } }}
        onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); if (!busy) void chooseFiles(event.dataTransfer.files); }}
      >Drop {selected.multiple ? "files" : "a file"} here, or use the picker above.</div>

      {files.length > 0 && <ul className="server-file-list" aria-label="Selected files">
        {files.map((file, index) => <li key={`${file.name}-${index}`}><FileUp size={15} aria-hidden="true" /><span>{file.name}</span><em>{formatBytes(file.size)}</em>{!busy && <button type="button" aria-label={`Remove ${file.name}`} onClick={() => removeFile(index)}><X size={14} /></button>}</li>)}
      </ul>}

      {selected.options.length > 0 && <fieldset className="conversion-options server-option-grid">
        <legend>Options</legend>
        {selected.options.map((option) => selected.name === "form_fill" && option.name === "fields" ? null : <ServerOption key={option.name} option={option} value={options[option.name]} jsonValue={jsonValues[option.name] ?? ""} onValue={(value) => setOptions((current) => ({ ...current, [option.name]: value }))} onJson={(value) => setJsonValues((current) => ({ ...current, [option.name]: value }))} />)}
      </fieldset>}

      {selected.name === "form_fill" && formFields.length > 0 && <fieldset className="conversion-options server-option-grid">
        <legend>Form fields</legend>
        {formFields.map((field) => <label key={field.name}>{field.name}
          {field.type === "checkbox"
            ? <input type="checkbox" checked={["true", "yes", "on", "1"].includes(fieldValues[field.name]?.toLowerCase() ?? "")} onChange={(event) => setFieldValues((current) => ({ ...current, [field.name]: event.target.checked ? "true" : "false" }))} />
            : field.type === "choice" && field.states?.length
              ? <select value={fieldValues[field.name] ?? ""} onChange={(event) => setFieldValues((current) => ({ ...current, [field.name]: event.target.value }))}><option value="">Leave unchanged</option>{field.states.map((state) => <option key={state} value={state}>{state}</option>)}</select>
              : <input value={fieldValues[field.name] ?? ""} onChange={(event) => setFieldValues((current) => ({ ...current, [field.name]: event.target.value }))} />}
        </label>)}
      </fieldset>}

      <div className="merge-actions">
        <button type="button" className="hero-cta" disabled={!files.length || busy || !selected.available || files.length < selected.min_files} onClick={() => void submit()}>{busy ? "Processing on server…" : `Run ${selected.label}`}</button>
        {busy && <button type="button" onClick={cancel}>Cancel</button>}
        {files.length > 0 && !busy && <button type="button" onClick={reset}>Start over</button>}
      </div>
      {progress && <p role="status" aria-live="polite" className="server-progress"><Loader2 size={16} className={busy ? "is-spinning" : ""} aria-hidden="true" />{progress}</p>}
      {error && <p role="alert" className="merge-error">{error}</p>}
      {result && <div className="merge-success server-result" role="status">
        <p><CheckCircle2 size={17} aria-hidden="true" /> Server output received · {formatBytes(result.bytes)}</p>
        <a href={result.url} download={result.filename}><Download size={15} aria-hidden="true" /> Download {result.filename}</a>
      </div>}
    </section>;
  }

  return <section className="server-tools-panel" aria-labelledby="server-tools-heading">
    <div className="server-tools-intro">
      <div>
        <h2 id="server-tools-heading">Optional self-hosted processing tools</h2>
        <p>These engines run on your own APOS FastAPI server for operations that need native libraries such as LibreOffice, Ghostscript, Tesseract or pyHanko. The browser-local tools elsewhere in APOS never upload a document.</p>
      </div>
      <Server size={30} aria-hidden="true" />
    </div>
    <div className="server-tools-privacy"><ShieldCheck size={17} /><span>Files sent here go only to the server URL configured at build time. That server does not use a database or permanent document storage. Do not enable it for documents you do not want to upload to that server.</span></div>
    {loading && <p role="status" className="server-loading"><Loader2 size={17} className="is-spinning" aria-hidden="true" /> Checking the processing server…</p>}
    {!loading && loadError && <div className="server-tools-warning" role="alert">
      <AlertTriangle size={20} />
      <div><strong>The processing server is not configured or not reachable.</strong><p>{loadError}</p><pre>{setupCommand()}</pre><p className="route-note">A remote deployment can use <code>NEXT_PUBLIC_APOS_API_URL</code> instead of localhost. The APOS browser-local tools continue to work without this service.</p></div>
    </div>}
    {!loading && !loadError && registry && <>
      <div className="server-tools-toolbar">
        <label className="server-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search server tools</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search processing tools…" /></label>
        <select aria-label="Server tool category" value={category} onChange={(event) => setCategory(event.target.value)}>
          {categories.map((value) => <option key={value} value={value}>{value === "all" ? "All categories" : SERVER_TOOL_CATEGORY_LABELS[value] ?? value}</option>)}
        </select>
        <span className="server-count">{visible.length} tool{visible.length === 1 ? "" : "s"} · server v{registry.version}</span>
      </div>
      {visible.length === 0 ? <p className="route-note">No server tools match that search.</p> : <div className="server-tool-grid">
        {visible.map((tool) => <button type="button" className="server-tool-card" key={tool.name} onClick={() => chooseTool(tool)}>
          <span className={`server-availability ${tool.available ? "is-ready" : "is-missing"}`}><i /> {tool.available ? "Ready" : "Missing dependency"}</span>
          <strong>{tool.label}</strong>
          <span>{tool.description}</span>
          <em>{SERVER_TOOL_CATEGORY_LABELS[tool.category] ?? tool.category} · {tool.name}</em>
        </button>)}
      </div>}
    </>}
    {!loading && !loadError && registry && <p className="route-note">The server API exposes {registry.tools.length} tools. Native features are shown as missing when their binary or package is not installed — APOS does not pretend they work.</p>}
  </section>;
}

function ServerOption({ option, value, jsonValue, onValue, onJson }: { option: ServerToolOption; value: string | boolean | undefined; jsonValue: string; onValue: (value: string | boolean) => void; onJson: (value: string) => void }) {
  if (JSON_OPTIONS.has(option.name)) {
    return <label>{option.label}<textarea className="server-json" value={jsonValue} onChange={(event) => onJson(event.target.value)} placeholder='[{"page":1,"x":0.1,"y":0.1,"w":0.2,"h":0.1}]' rows={4} /><span className="route-note">{option.help || "Advanced JSON, matching the selected server tool."}</span></label>;
  }
  if (option.kind === "checkbox") {
    return <label className="office-check"><input type="checkbox" checked={Boolean(value)} onChange={(event) => onValue(event.target.checked)} /> {option.label}{option.help ? <span className="route-note">{option.help}</span> : null}</label>;
  }
  if (option.kind === "select") {
    return <label>{option.label}<select value={String(value ?? "")} onChange={(event) => onValue(event.target.value)}>{option.choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>{option.help ? <span className="route-note">{option.help}</span> : null}</label>;
  }
  return <label>{option.label}<input type={option.kind === "password" ? "password" : option.kind === "number" ? "number" : "text"} value={String(value ?? "")} onChange={(event) => onValue(event.target.value)} />{option.help ? <span className="route-note">{option.help}</span> : null}</label>;
}
