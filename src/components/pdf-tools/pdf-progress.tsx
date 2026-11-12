"use client";

export type PdfProgressProps = {
  label: string;
  value?: number;
  max?: number;
  detail?: string;
};

export function PdfProgress({ label, value, max, detail }: PdfProgressProps) {
  const determinate = typeof value === "number" && typeof max === "number" && max > 0;
  const percent = determinate ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;

  return (
    <div className="pdf-progress" role="status" aria-live="polite">
      <div className="pdf-progress-copy">
        <strong>{label}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
      <div
        className={`pdf-progress-track${determinate ? "" : " is-indeterminate"}`}
        role={determinate ? "progressbar" : undefined}
        aria-label={determinate ? label : undefined}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? max : undefined}
        aria-valuenow={determinate ? value : undefined}
      >
        <span className="pdf-progress-fill" style={determinate ? { width: `${percent}%` } : undefined} />
      </div>
    </div>
  );
}
