"use client";

import { useRef } from "react";
import { formatBytes, pageLabel } from "@/lib/format";

export type MergeEntry = {
  id: string;
  file: File;
  pageCount: number | null;
  thumbnail: string | null;
  status: "checking" | "ready" | "invalid";
  error?: string;
};

export type MergeFileListProps = {
  entries: MergeEntry[];
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
};

export function MergeFileList({ entries, busy, onMove, onRemove }: MergeFileListProps) {
  const dragIndex = useRef<number | null>(null);

  if (!entries.length) {
    return <p className="pdf-empty-state">No PDFs selected yet. Choose files or drop them above.</p>;
  }

  return (
    <ol className="merge-list pdf-merge-list" aria-label="PDF merge order">
      {entries.map((entry, index) => (
        <li
          key={entry.id}
          draggable={!busy}
          onDragStart={(event) => {
            dragIndex.current = index;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(index));
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const raw = event.dataTransfer.getData("text/plain");
            const from = dragIndex.current ?? (raw ? Number(raw) : Number.NaN);
            if (Number.isInteger(from) && from >= 0) onMove(from, index);
            dragIndex.current = null;
          }}
          onDragEnd={() => { dragIndex.current = null; }}
          className={entry.status === "invalid" ? "is-invalid" : ""}
        >
          <span className="merge-order">{index + 1}</span>
          <span className="pdf-merge-thumb" aria-hidden="true">
            {entry.thumbnail ? <img src={entry.thumbnail} alt="" /> : <span>{entry.status === "checking" ? "…" : "PDF"}</span>}
          </span>
          <span className="pdf-merge-copy">
            <strong className="merge-filename" title={entry.file.name}>{entry.file.name}</strong>
            <span>
              {formatBytes(entry.file.size)}
              {" · "}
              {entry.pageCount === null ? "Checking pages…" : pageLabel(entry.pageCount)}
            </span>
            {entry.error ? <span className="pdf-merge-file-error" role="alert">{entry.error}</span> : null}
          </span>
          <span className="pdf-merge-actions">
            <button type="button" aria-label={`Move ${entry.file.name} up`} disabled={busy || index === 0} onClick={() => onMove(index, index - 1)}>↑</button>
            <button type="button" aria-label={`Move ${entry.file.name} down`} disabled={busy || index === entries.length - 1} onClick={() => onMove(index, index + 1)}>↓</button>
            <button type="button" aria-label={`Remove ${entry.file.name}`} disabled={busy} onClick={() => onRemove(entry.id)}>Remove</button>
          </span>
        </li>
      ))}
    </ol>
  );
}
