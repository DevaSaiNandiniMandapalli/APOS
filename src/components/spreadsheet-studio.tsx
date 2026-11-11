"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  calculateSheet,
  columnLabel,
  createSheet,
  parseCsv,
  toCsv,
} from "@/lib/spreadsheet";

export default function SpreadsheetStudio() {
  const initial = useMemo(() => createSheet(20, 8), []);
  const [rows, setRows] = useState(initial.rows);
  const [cols, setCols] = useState(initial.cols);
  const [cells, setCells] = useState(initial.cells);
  const [selected, setSelected] = useState("A1");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(() => calculateSheet(cells), [cells]);
  const selectedRaw = cells[selected] ?? "";
  const selectedResult = results[selected];
  const columns = Array.from({ length: cols }, (_, i) => columnLabel(i));
  const rowIndexes = Array.from({ length: rows }, (_, i) => i);

  const setCell = useCallback((id: string, value: string) => {
    setCells((current) => {
      if (value === "") {
        const next = { ...current };
        delete next[id];
        return next;
      }
      return { ...current, [id]: value };
    });
  }, []);

  const addRow = () => setRows((value) => Math.min(value + 1, 200));
  const addColumn = () => setCols((value) => Math.min(value + 1, 26));

  const exportCsv = () => {
    const csv = toCsv(rows, cols, cells, results);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "spreadsheet.csv";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Exported spreadsheet.csv");
  };

  const exportXlsx = async () => {
    const { buildXlsx } = await import("@/lib/office-formats");
    const grid = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => {
        const id = `${columnLabel(col + 1)}${row + 1}`;
        return results[id]?.isFormula ? results[id].display : (cells[id] ?? "");
      }),
    );
    const bytes = buildXlsx(grid, "Spreadsheet");
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).slice().buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "spreadsheet.xlsx";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Exported spreadsheet.xlsx");
  };

  const importSpreadsheet = async (file: File) => {
    let imported;
    if (/\.xlsx$/i.test(file.name)) {
      const { readXlsxRows } = await import("@/lib/office-formats");
      const grid = readXlsxRows(new Uint8Array(await file.arrayBuffer()));
      imported = Object.fromEntries(
        grid.flatMap((values, row) =>
          values.map((value, col) => [`${columnLabel(col + 1)}${row + 1}`, value] as const).filter(([, value]) => value.trim() !== ""),
        ),
      );
    } else {
      imported = parseCsv(await file.text());
    }
    if (!Object.keys(imported).length) { setNotice("That file has no filled cells."); return; }
    const maxRow = Object.keys(imported).reduce((max, id) => {
      const match = /([0-9]+)$/.exec(id);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const maxCol = Object.keys(imported).reduce((max, id) => {
      const letters = /^([A-Z]+)/.exec(id)?.[1] ?? "A";
      let index = 0;
      for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
      return Math.max(max, index);
    }, 0);
    setCells(imported);
    setRows(Math.max(rows, maxRow, 10));
    setCols(Math.max(cols, maxCol, 5));
    setNotice(`Imported ${file.name} — edit any cell, then export Excel or CSV.`);
  };

  const clearAll = () => {
    if (!window.confirm("Clear every cell?")) return;
    setCells({});
    setNotice("Cleared all cells");
  };

  return (
    <section className="spreadsheet" aria-label="Spreadsheet editor">
      <div className="spreadsheet__bar">
        <label className="spreadsheet__ref" htmlFor="spreadsheet-formula">{selected}</label>
        <input
          id="spreadsheet-formula"
          className="spreadsheet__formula"
          value={selectedRaw}
          onChange={(event) => setCell(selected, event.target.value)}
          placeholder="Enter a value or formula, e.g. =SUM(A1:A5)"
          aria-label="Formula bar"
        />
        {selectedResult?.isFormula ? (
          <span className="spreadsheet__result" aria-live="polite">= {selectedResult.display}</span>
        ) : null}
      </div>

      <div className="spreadsheet__actions">
        <button type="button" onClick={addRow}>Add row</button>
        <button type="button" onClick={addColumn}>Add column</button>
        <button type="button" onClick={exportCsv}>Export CSV</button>
        <button type="button" onClick={() => fileRef.current?.click()}>Import Excel or CSV</button>
        <button type="button" onClick={() => void exportXlsx()}>Export Excel</button>
        <button type="button" onClick={clearAll}>Clear</button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="spreadsheet__file"
          aria-label="Import an Excel or CSV file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importSpreadsheet(file);
            event.target.value = "";
          }}
        />
        {notice ? <span className="spreadsheet__notice" role="status">{notice}</span> : null}
      </div>

      <div className="spreadsheet__scroll">
        <table className="spreadsheet__grid">
          <thead>
            <tr>
              <th className="spreadsheet__corner" scope="col" />
              {columns.map((label) => (
                <th key={label} scope="col">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowIndexes.map((r) => (
              <tr key={r}>
                <th scope="row">{r + 1}</th>
                {columns.map((label) => {
                  const id = `${label}${r + 1}`;
                  const result = results[id];
                  const isFormula = result?.isFormula;
                  const error = result?.error;
                  return (
                    <td key={id} className={id === selected ? "is-selected" : undefined}>
                      <input
                        value={cells[id] ?? ""}
                        onFocus={() => setSelected(id)}
                        onChange={(event) => setCell(id, event.target.value)}
                        aria-label={`Cell ${id}`}
                        className={error ? "has-error" : undefined}
                        title={isFormula ? `= ${result?.display}` : undefined}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="privacy-note">Everything is calculated in your browser. Formulas support + − × ÷ ^, parentheses, cell references, ranges and SUM/AVERAGE/MIN/MAX/COUNT.</p>
    </section>
  );
}
