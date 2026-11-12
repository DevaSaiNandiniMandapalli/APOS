"use client";

import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

export type PdfDropzoneProps = {
  label: string;
  hint: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
};

export function PdfDropzone({
  label,
  hint,
  accept = "application/pdf,.pdf",
  multiple = false,
  disabled = false,
  onFiles,
}: PdfDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const hintId = useId();

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setActive(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length) onFiles(files);
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  };

  return (
    <div className="pdf-upload">
      <div className="pdf-upload-row">
        <label className="file-picker">
          {label}
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple={multiple}
            disabled={disabled}
            onChange={(event) => {
              const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
              event.currentTarget.value = "";
              if (files.length) onFiles(files);
            }}
          />
        </label>
        <span id={hintId} className="pdf-upload-hint">{hint}</span>
      </div>
      <div
        className={`drop-zone pdf-dropzone${active ? " drop-active" : ""}${disabled ? " is-disabled" : ""}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-describedby={hintId}
        onClick={openPicker}
        onKeyDown={keyDown}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setActive(false);
        }}
        onDrop={drop}
      >
        <strong>{multiple ? "Drop PDF files here" : "Drop a PDF here"}</strong>
        <span>or use the file picker above</span>
      </div>
    </div>
  );
}
