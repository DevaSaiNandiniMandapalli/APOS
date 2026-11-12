"use client";

import { useEffect, useRef, useState } from "react";
import type { PdfPageRender, PdfPreviewDocument } from "@/lib/pdf-preview";

export type PdfPageGridMode = "toggle" | "preview" | "none";

export type PdfPageGridProps = {
  document: PdfPreviewDocument | null;
  pageCount: number;
  selected?: ReadonlySet<number>;
  highlighted?: ReadonlySet<number>;
  rotationByPage?: Readonly<Record<number, number>>;
  mode?: PdfPageGridMode;
  previewPage?: number;
  label?: string;
  onToggle?: (page: number) => void;
  onPreview?: (page: number) => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
};

const BATCH_SIZE = 12;

export function PdfPageGrid({
  document,
  pageCount,
  selected,
  highlighted,
  rotationByPage,
  mode = "none",
  previewPage,
  label = "Page thumbnails",
  onToggle,
  onPreview,
  onSelectAll,
  onClearSelection,
}: PdfPageGridProps) {
  const [thumbs, setThumbs] = useState<Record<number, PdfPageRender>>({});
  const [visibleCount, setVisibleCount] = useState(() => Math.min(BATCH_SIZE, pageCount));
  const [renderError, setRenderError] = useState("");
  const cacheRef = useRef(new Map<number, PdfPageRender>());

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    cacheRef.current.clear();
    setThumbs({});
    setRenderError("");
    setVisibleCount(Math.min(BATCH_SIZE, pageCount));
  }, [document, pageCount]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!document || pageCount < 1) return;
    let cancelled = false;

    const render = async () => {
      for (let page = 1; page <= Math.min(visibleCount, pageCount); page += 1) {
        if (cancelled) return;
        if (cacheRef.current.has(page)) continue;
        try {
          const result = await document.renderPage(page, 168, "jpeg");
          if (cancelled) return;
          cacheRef.current.set(page, result);
          setThumbs((current) => ({ ...current, [page]: result }));
        } catch {
          if (!cancelled) setRenderError("Some page thumbnails could not be rendered.");
          return;
        }
      }
    };

    void render();
    return () => { cancelled = true; };
  }, [document, pageCount, visibleCount]);

  if (!document || pageCount < 1) {
    return <p className="pdf-page-grid-empty">Choose a PDF to load page thumbnails.</p>;
  }

  const interactive = mode !== "none";

  return (
    <section className="pdf-page-grid-wrap" aria-label={label}>
      <div className="pdf-page-grid-head">
        <div>
          <strong>{label}</strong>
          <span>{pageCount} page{pageCount === 1 ? "" : "s"}</span>
        </div>
        {mode === "toggle" ? (
          <div className="pdf-page-grid-actions">
            <button type="button" onClick={onSelectAll}>Select all</button>
            <button type="button" onClick={onClearSelection}>Clear selection</button>
          </div>
        ) : null}
      </div>
      <div className="pdf-page-grid" role="group" aria-label={label}>
        {Array.from({ length: Math.min(visibleCount, pageCount) }, (_, index) => {
          const page = index + 1;
          const thumb = thumbs[page];
          const pending = rotationByPage?.[page] ?? 0;
          const totalRotation = ((thumb?.rotation ?? 0) + pending + 360) % 360;
          const isSelected = selected?.has(page) ?? false;
          const isHighlighted = highlighted?.has(page) ?? false;
          const isPreview = previewPage === page;
          const pressed = mode === "toggle" ? isSelected : mode === "preview" ? isPreview : undefined;
          const className = `pdf-page-thumb${isSelected ? " is-selected" : ""}${isHighlighted ? " is-highlighted" : ""}${isPreview ? " is-preview" : ""}`;
          const content = (
            <>
              <span className="pdf-page-thumb-frame">
                {thumb ? (
                  <img
                    src={thumb.dataUrl}
                    alt=""
                    loading="lazy"
                    style={pending ? { transform: `rotate(${pending}deg)` } : undefined}
                  />
                ) : (
                  <span className="pdf-page-thumb-loading" aria-hidden="true">Loading…</span>
                )}
              </span>
              <span className="pdf-page-thumb-label">
                Page {page}{totalRotation ? ` · ${totalRotation}°` : ""}
              </span>
            </>
          );

          if (!interactive) {
            return <div className={className} key={page}>{content}</div>;
          }

          const action = mode === "toggle" ? onToggle : onPreview;
          return (
            <button
              type="button"
              className={className}
              key={page}
              aria-pressed={pressed}
              aria-label={`Page ${page}${totalRotation ? `, ${totalRotation} degrees` : ""}${isSelected ? ", selected" : ""}${isPreview ? ", preview" : ""}`}
              onClick={() => action?.(page)}
            >
              {content}
            </button>
          );
        })}
      </div>
      {renderError ? <p className="route-note" role="status">{renderError}</p> : null}
      {visibleCount < pageCount ? (
        <button
          type="button"
          className="pdf-page-grid-more"
          onClick={() => setVisibleCount((current) => Math.min(pageCount, current + BATCH_SIZE))}
        >
          Load more pages ({Math.min(visibleCount, pageCount)} of {pageCount})
        </button>
      ) : null}
    </section>
  );
}
