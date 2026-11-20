"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, FilePenLine, Loader2 } from "lucide-react";
import {
  fillPdfForm,
  inspectPdfForm,
  PDF_FORM_LIMITS,
  type PdfFormField,
  type PdfFormInspection,
  type PdfFormValues,
} from "@/lib/pdf-forms";

function initialValues(inspection: PdfFormInspection): PdfFormValues {
  return Object.fromEntries(inspection.fields.map((field) => [field.name, field.value]));
}

function Required({ required }: { required: boolean }) {
  return required ? <span className="form-required">Required</span> : null;
}

function FieldControl({ field, value, onChange }: { field: PdfFormField; value: string | boolean | string[] | undefined; onChange: (value: string | boolean | string[]) => void }) {
  if (field.kind === "text") {
    return <input aria-label={field.name} value={typeof value === "string" ? value : ""} maxLength={PDF_FORM_LIMITS.textLength} onChange={(event) => onChange(event.target.value)} />;
  }
  if (field.kind === "checkbox") {
    return <label className="office-check form-check"><input type="checkbox" aria-label={field.name} checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /> Checked</label>;
  }
  if (field.kind === "radio" || field.kind === "dropdown") {
    return <select aria-label={field.name} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)}>
      <option value="">— No selection —</option>
      {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>;
  }
  if (field.kind === "option-list") {
    const selected = Array.isArray(value) ? value : [];
    return <select aria-label={field.name} multiple value={selected} onChange={(event) => onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>
      {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>;
  }
  return <p className="route-note">This field type is not editable here.</p>;
}

export default function PdfFormsTool() {
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<PdfFormInspection | null>(null);
  const [values, setValues] = useState<PdfFormValues>({});
  const [flatten, setFlatten] = useState(true);
  const [busy, setBusy] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ url: string; name: string; detail: string } | null>(null);
  const urlRef = useRef<string | null>(null);
  const runRef = useRef(0);
  const mountedRef = useRef(false);

  const clearResult = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setResult(null);
  };

  const choose = async (selected: File | undefined) => {
    runRef.current += 1;
    const run = runRef.current;
    clearResult();
    setFile(null);
    setInspection(null);
    setValues({});
    setError("");
    setInspecting(false);
    if (!selected) return;
    if (!selected.size) { setError("That PDF is empty."); return; }
    if (selected.size > PDF_FORM_LIMITS.perFileBytes) { setError("Choose a PDF under 25 MB."); return; }
    setFile(selected);
    setInspecting(true);
    try {
      const next = await inspectPdfForm(selected);
      if (!mountedRef.current || run !== runRef.current) return;
      setInspection(next);
      setValues(initialValues(next));
    } catch (reason) {
      if (mountedRef.current && run === runRef.current) setError(reason instanceof Error ? reason.message : "The form fields could not be inspected.");
    } finally {
      if (mountedRef.current && run === runRef.current) setInspecting(false);
    }
  };

  const fill = async () => {
    if (!file || !inspection?.hasForm || busy) return;
    clearResult();
    setError("");
    setBusy(true);
    try {
      const output = await fillPdfForm(file, values, { flatten });
      if (!mountedRef.current) return;
      const url = URL.createObjectURL(new Blob([output.bytes.slice() as unknown as BlobPart], { type: "application/pdf" }));
      urlRef.current = url;
      const stem = file.name.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 100) || "document";
      setResult({
        url,
        name: `${stem}-filled.pdf`,
        detail: `${output.filledCount} field(s) filled across ${output.pageCount} page(s). ${output.flattened ? "The fields were flattened into the page." : "The fields remain editable."}`,
      });
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : "The form could not be filled.");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runRef.current += 1;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  return (
    <section className="pdf-forms" aria-labelledby="pdf-forms-heading">
      <h2 id="pdf-forms-heading">Fill a PDF form on this device</h2>
      <p>Open a PDF with AcroForm fields, fill text boxes, checkboxes, radio buttons and lists, then download a filled copy. Nothing is uploaded.</p>
      <div className="privacy-note">
        Limit: {PDF_FORM_LIMITS.perFileBytes / 1024 / 1024} MB and {PDF_FORM_LIMITS.pages} pages. APOS reads standard AcroForm fields; XFA forms and signature fields are not editable here. Flattening makes the values permanent but removes the fields.
      </div>

      <label className="file-picker">
        Choose a PDF with form fields
        <input type="file" accept="application/pdf,.pdf" disabled={busy || inspecting} onChange={(event) => { void choose(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
      </label>

      {inspecting ? <p role="status" className="verify-status"><Loader2 size={15} className="is-spinning" aria-hidden="true" /> Reading form fields…</p> : null}
      {file ? <p className="route-note"><strong>{file.name}</strong> · {(file.size / 1024).toFixed(1)} KB</p> : null}
      {error ? <p role="alert" className="merge-error">{error}</p> : null}

      {inspection && !inspection.hasForm ? (
        <div className="planned-panel">
          <h3>No fillable fields found</h3>
          <p>This PDF has no standard AcroForm fields. It may be a flat scan, an XFA form, or a document that was never designed as a fillable form.</p>
        </div>
      ) : null}

      {inspection?.hasForm ? (
        <form className="pdf-form-fields" onSubmit={(event) => { event.preventDefault(); void fill(); }}>
          <div className="pdf-form-summary">
            <span><FilePenLine size={15} aria-hidden="true" /> {inspection.fields.length} field(s) on {inspection.pageCount} page(s)</span>
          </div>
          <div className="pdf-form-grid">
            {inspection.fields.map((field) => (
              <fieldset className="pdf-form-field" key={field.name}>
                <legend>{field.name} <Required required={field.required} /></legend>
                <FieldControl field={field} value={values[field.name]} onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} />
                {field.options.length > 1 && field.kind !== "radio" && field.kind !== "dropdown" && field.kind !== "option-list" ? <p className="route-note">{field.options.length} options</p> : null}
              </fieldset>
            ))}
          </div>
          <label className="office-check"><input type="checkbox" checked={flatten} onChange={(event) => setFlatten(event.target.checked)} /> Flatten the filled fields into the page</label>
          <div className="merge-actions">
            <button type="submit" className="hero-cta" disabled={busy}>{busy ? "Filling…" : "Fill and download PDF"}</button>
            <button type="button" onClick={() => { clearResult(); setValues(initialValues(inspection)); setError(""); }} disabled={busy}>Reset values</button>
          </div>
        </form>
      ) : null}

      {result ? (
        <div className="merge-success">
          <p role="status"><CheckCircle2 size={16} aria-hidden="true" /> {result.detail}</p>
          <a href={result.url} download={result.name}><Download size={15} aria-hidden="true" /> Download {result.name}</a>
        </div>
      ) : null}
    </section>
  );
}
