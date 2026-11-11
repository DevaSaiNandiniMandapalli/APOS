"use client";

import { useEffect, useRef, useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import {
  addSlide,
  createDeck,
  deleteSlide,
  duplicateSlide,
  moveSlide,
  parseDeck,
  setTheme,
  THEMES,
  themeById,
  updateSlide,
  type Deck,
  type Slide,
} from "@/lib/presentation";

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ];
}

function wrapText(text: string, font: { widthOfTextAtSize: (t: string, s: number) => number }, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ");
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

export default function PresentationStudio() {
  const [deck, setDeck] = useState<Deck>(() => createDeck());
  const [selectedId, setSelectedId] = useState(() => deck.slides[0].id);
  const [presenting, setPresenting] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const theme = themeById(deck.themeId);
  const selected = deck.slides.find((slide) => slide.id === selectedId) ?? deck.slides[0];

  const select = (id: string) => setSelectedId(id);

  const patchSelected = (patch: Partial<Slide>) => {
    setDeck((current) => updateSlide(current, selected.id, patch));
  };

  const runAdd = () => {
    setDeck((current) => {
      const next = addSlide(current, selected.id);
      const created = next.slides[next.slides.findIndex((slide) => slide.id === selected.id) + 1];
      if (created) setSelectedId(created.id);
      return next;
    });
  };

  const runDuplicate = () => {
    setDeck((current) => {
      const next = duplicateSlide(current, selected.id);
      const index = next.slides.findIndex((slide) => slide.id === selected.id);
      const copy = next.slides[index + 1];
      if (copy) setSelectedId(copy.id);
      return next;
    });
  };

  const runDelete = () => {
    setDeck((current) => {
      const next = deleteSlide(current, selected.id);
      if (next === current) {
        setNotice("A deck needs at least one slide.");
        return current;
      }
      setSelectedId(next.slides[0].id);
      return next;
    });
  };

  const runMove = (direction: -1 | 1) => setDeck((current) => moveSlide(current, selected.id, direction));

  useEffect(() => {
    if (presenting === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPresenting(null);
      if (event.key === "ArrowRight" || event.key === " ") setPresenting((i) => Math.min((i ?? 0) + 1, deck.slides.length - 1));
      if (event.key === "ArrowLeft") setPresenting((i) => Math.max((i ?? 0) - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting, deck.slides.length]);

  const exportPdf = async () => {
    try {
      setNotice("Exporting PDF…");
      const pdf = await PDFDocument.create();
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const regular = await pdf.embedFont(StandardFonts.Helvetica);
      const width = 960;
      const height = 540;
      for (const slide of deck.slides) {
        const page = pdf.addPage([width, height]);
        const [bgR, bgG, bgB] = hexToRgb(theme.background);
        page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(bgR, bgG, bgB) });
        const [textR, textG, textB] = hexToRgb(theme.text);
        const [accR, accG, accB] = hexToRgb(theme.accent);
        page.drawRectangle({ x: 64, y: height - 78, width: 56, height: 6, color: rgb(accR, accG, accB) });

        const titleLines = wrapText(slide.title || " ", bold, slide.layout === "title" ? 52 : 36, width - 128);
        let cursorY = height - 130;
        for (const line of titleLines.slice(0, 4)) {
          page.drawText(line, { x: 64, y: cursorY, size: slide.layout === "title" ? 52 : 36, font: bold, color: rgb(textR, textG, textB) });
          cursorY -= slide.layout === "title" ? 62 : 44;
        }
        if (slide.layout !== "title") {
          const bodyLines = wrapText(slide.body || " ", regular, 20, width - 128);
          cursorY -= 10;
          for (const line of bodyLines.slice(0, 12)) {
            page.drawText(line, { x: 64, y: cursorY, size: 20, font: regular, color: rgb(textR, textG, textB) });
            cursorY -= 28;
          }
        }
      }
      const bytes = await pdf.save();
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${deck.title.replace(/[^\w\- ]+/g, "").trim() || "presentation"}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("Exported PDF");
    } catch (error) {
      setNotice(error instanceof Error ? `Export failed: ${error.message}` : "Export failed");
    }
  };

  const saveJson = () => {
    const blob = new Blob([JSON.stringify(deck, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "presentation.apos.deck.json";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Saved deck JSON");
  };

  const openPptx = async (file: File) => {
    try {
      const [{ readPptxSlides }, { newSlide }] = await Promise.all([
        import("@/lib/office-formats"),
        import("@/lib/presentation"),
      ]);
      const slides = readPptxSlides(new Uint8Array(await file.arrayBuffer()));
      if (!slides.length) { setNotice("That .pptx file has no readable slides."); return; }
      const next = {
        ...deck,
        title: file.name.replace(/\.[^.]+$/, "") || deck.title,
        slides: slides.map((lines, index) => newSlide({
          title: lines[0]?.slice(0, 120) ?? `Slide ${index + 1}`,
          body: lines.slice(1).join("\n"),
          layout: index === 0 && lines.length === 1 ? "title" : "title-body",
        })),
      };
      setDeck(next);
      setSelectedId(next.slides[0].id);
      setNotice(`Opened ${file.name} — ${next.slides.length} slide(s). Edit any text, then export PDF.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "That .pptx file could not be opened.");
    }
  };

  const openJson = async (file: File) => {
    const parsed = parseDeck(await file.text());
    if ("error" in parsed) {
      setNotice(parsed.error);
      return;
    }
    setDeck(parsed.deck);
    setSelectedId(parsed.deck.slides[0].id);
    setNotice(`Opened ${file.name}`);
  };

  return (
    <section className="deck" aria-label="Presentation editor">
      <div className="deck__actions">
        <button type="button" onClick={runAdd}>Add slide</button>
        <button type="button" onClick={runDuplicate}>Duplicate</button>
        <button type="button" onClick={runDelete}>Delete</button>
        <button type="button" onClick={() => runMove(-1)}>Move up</button>
        <button type="button" onClick={() => runMove(1)}>Move down</button>
        <label htmlFor="deck-theme">Theme</label>
        <select id="deck-theme" value={deck.themeId} onChange={(event) => setDeck((current) => setTheme(current, event.target.value))}>
          {THEMES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button type="button" onClick={() => setPresenting(deck.slides.findIndex((slide) => slide.id === selected.id))}>Present</button>
        <button type="button" onClick={() => void exportPdf()}>Export PDF</button>
        <button type="button" onClick={saveJson}>Save JSON</button>
        <button type="button" onClick={() => fileRef.current?.click()}>Open PPTX or JSON</button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.pptx,application/json,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          className="deck__file"
          aria-label="Open a presentation JSON or PowerPoint file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) { if (/\.pptx$/i.test(file.name)) void openPptx(file); else void openJson(file); }
            event.target.value = "";
          }}
        />
        {notice ? <span className="deck__notice" role="status">{notice}</span> : null}
      </div>

      <div className="deck__body">
        <ol className="deck__list" aria-label="Slides">
          {deck.slides.map((slide, index) => (
            <li key={slide.id}>
              <button
                type="button"
                className={slide.id === selected.id ? "is-active" : undefined}
                onClick={() => select(slide.id)}
                style={{ background: theme.background, color: theme.text }}
              >
                <span className="deck__index">{index + 1}</span>
                <span className="deck__thumb-title">{slide.title || "Untitled"}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="deck__canvas" style={{ background: theme.background, color: theme.text }}>
          <div className="deck__accent" style={{ background: theme.accent }} />
          <input
            className="deck__title"
            value={selected.title}
            onChange={(event) => patchSelected({ title: event.target.value })}
            aria-label="Slide title"
            placeholder="Slide title"
          />
          {selected.layout !== "title" ? (
            <textarea
              className="deck__content"
              value={selected.body}
              onChange={(event) => patchSelected({ body: event.target.value })}
              aria-label="Slide body"
              placeholder="Add bullet points or notes…"
            />
          ) : null}
          <div className="deck__meta">
            <label htmlFor="deck-layout">Layout</label>
            <select id="deck-layout" value={selected.layout} onChange={(event) => patchSelected({ layout: event.target.value as Slide["layout"] })}>
              <option value="title">Title</option>
              <option value="title-body">Title + body</option>
              <option value="section">Section</option>
            </select>
            <span>{deck.slides.findIndex((slide) => slide.id === selected.id) + 1} / {deck.slides.length}</span>
          </div>
        </div>
      </div>
      <p className="privacy-note">Slides are edited and exported entirely in your browser.</p>

      {presenting !== null ? (
        <div className="deck__present" role="dialog" aria-label="Presenting" onClick={() => setPresenting((i) => Math.min((i ?? 0) + 1, deck.slides.length - 1))}>
          <div className="deck__present-slide" style={{ background: theme.background, color: theme.text }}>
            <div className="deck__accent" style={{ background: theme.accent }} />
            <h2>{deck.slides[presenting]?.title}</h2>
            {deck.slides[presenting]?.layout !== "title" ? <p>{deck.slides[presenting]?.body}</p> : null}
          </div>
          <div className="deck__present-bar">
            <button type="button" onClick={(event) => { event.stopPropagation(); setPresenting((i) => Math.max((i ?? 0) - 1, 0)); }}>Previous</button>
            <span>{presenting + 1} / {deck.slides.length}</span>
            <button type="button" onClick={(event) => { event.stopPropagation(); setPresenting((i) => Math.min((i ?? 0) + 1, deck.slides.length - 1)); }}>Next</button>
            <button type="button" onClick={(event) => { event.stopPropagation(); setPresenting(null); }}>Close</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
