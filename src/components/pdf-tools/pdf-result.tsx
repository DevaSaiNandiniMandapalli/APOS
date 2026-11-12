"use client";

import type { ReactNode } from "react";

export type PdfDownload = {
  url: string;
  name: string;
  meta?: string;
};

export type PdfResultProps = {
  summary: string;
  downloads: PdfDownload[];
  zip?: { url: string; name: string } | null;
  onReset?: () => void;
  children?: ReactNode;
};

export function PdfResult({ summary, downloads, zip, onReset, children }: PdfResultProps) {
  return (
    <div className="merge-success pdf-result" role="status">
      <p>{summary}</p>
      {children}
      {downloads.length > 0 ? (
        <ul className="pdf-result-list">
          {downloads.map((download) => (
            <li key={download.url}>
              <a href={download.url} download={download.name}>{download.name}</a>
              {download.meta ? <span> · {download.meta}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {zip ? <p><a className="pdf-result-zip" href={zip.url} download={zip.name}>Download all as ZIP</a></p> : null}
      {onReset ? <button type="button" className="pdf-result-reset" onClick={onReset}>Start over</button> : null}
    </div>
  );
}
