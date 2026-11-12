"use client";

import { useEffect, useRef, useState } from "react";
import {
  describePdfPreviewError,
  loadPdfPreview,
  type PdfPreviewDocument,
} from "@/lib/pdf-preview";

export type PdfDocumentState = {
  document: PdfPreviewDocument | null;
  pageCount: number;
  loading: boolean;
  error: string;
};

const EMPTY: PdfDocumentState = {
  document: null,
  pageCount: 0,
  loading: false,
  error: "",
};

export function usePdfDocument(file: File | null): PdfDocumentState {
  const [state, setState] = useState<PdfDocumentState>(EMPTY);
  const documentRef = useRef<PdfPreviewDocument | null>(null);

  useEffect(() => {
    let cancelled = false;

    const previous = documentRef.current;
    documentRef.current = null;
    if (previous) void previous.destroy();

    if (!file) {
      // Reset the preview state when the selected file is cleared.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(EMPTY);
      return;
    }

    // Enter the loading state for the new file before the async preview starts.
    setState({ document: null, pageCount: 0, loading: true, error: "" });
    void loadPdfPreview(file)
      .then((document) => {
        if (cancelled) {
          void document.destroy();
          return;
        }
        documentRef.current = document;
        setState({
          document,
          pageCount: document.pageCount,
          loading: false,
          error: "",
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          document: null,
          pageCount: 0,
          loading: false,
          error: describePdfPreviewError(error),
        });
      });

    return () => {
      cancelled = true;
      const current = documentRef.current;
      documentRef.current = null;
      if (current) void current.destroy();
    };
  }, [file]);

  return state;
}
