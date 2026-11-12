"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PdfPageRender, PdfPreviewDocument } from "@/lib/pdf-preview";

export type PdfPreviewSize = {
  displayWidth: number;
  displayHeight: number;
  pageWidth: number;
  pageHeight: number;
  rotation: number;
};

export type PdfPagePreviewProps = {
  document: PdfPreviewDocument | null;
  pageNumber: number;
  maxWidth?: number;
  label?: string;
  overlay?: (size: PdfPreviewSize) => ReactNode;
};

export function PdfPagePreview({
  document,
  pageNumber,
  maxWidth = 720,
  label,
  overlay,
}: PdfPagePreviewProps) {
  const [render, setRender] = useState<PdfPageRender | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [displayWidth, setDisplayWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!document) {
      setRender(null);
      setError("");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void document.renderPage(pageNumber, maxWidth, "png")
      .then((result) => {
        if (cancelled) return;
        setRender(result);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setRender(null);
        setLoading(false);
        setError("This page could not be previewed.");
      });
    return () => { cancelled = true; };
  }, [document, pageNumber, maxWidth]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setDisplayWidth(width);
    });
    observer.observe(element);
    setDisplayWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [render]);

  const displayHeight = render && render.pageWidth > 0
    ? displayWidth * (render.pageHeight / render.pageWidth)
    : 0;

  return (
    <figure className="pdf-page-preview" aria-label={label ?? `Preview of page ${pageNumber}`}>
      <div className="pdf-page-preview-frame" ref={containerRef} aria-busy={loading}>
        {render ? (
          <>
            <img src={render.dataUrl} alt={label ?? `Preview of page ${pageNumber}`} />
            {overlay && displayWidth > 0 ? (
              <div className="pdf-page-preview-overlay" aria-hidden="true">
                {overlay({
                  displayWidth,
                  displayHeight,
                  pageWidth: render.pageWidth,
                  pageHeight: render.pageHeight,
                  rotation: render.rotation,
                })}
              </div>
            ) : null}
          </>
        ) : (
          <div className="pdf-page-preview-placeholder">
            {loading ? "Rendering preview…" : error || "Choose a PDF to preview a page."}
          </div>
        )}
      </div>
      <figcaption>{label ?? `Page ${pageNumber}`} · approximate live preview</figcaption>
    </figure>
  );
}
