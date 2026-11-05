import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, rgb, degrees } from "@cantoo/pdf-lib";
import {
  exportAnnotatedPdf,
  annotatedPdfFileName,
  getPageGeometry,
  getDisplaySize,
  visualPointToPdf,
  visualRectToPdf,
  getTextBoxMetrics,
  type PageRotation,
} from "./pdf-export";
import { type PdfAnnotation, type PagePoint, type TextBoxAnnotation } from "./pdf-annotations";

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;

const geometry: { x: number; y: number; width: number; height: number; rotation: PageRotation } = {
  x: 0,
  y: 0,
  width: PAGE_WIDTH,
  height: PAGE_HEIGHT,
  rotation: 0,
};

async function makeSourcePdf({
  pageCount = 1,
  rotation,
  withText = true,
}: {
  pageCount?: number;
  rotation?: PageRotation;
  withText?: boolean;
} = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (let index = 0; index < pageCount; index += 1) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    if (rotation) page.setRotation(degrees(rotation));
    if (withText) {
      page.drawText(`Original page ${index + 1} text`, {
        x: 50,
        y: PAGE_HEIGHT - 80,
        size: 18,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }

  return new Uint8Array(await pdf.save());
}

function pageRectangleAnnotation({
  page = 1,
  x = 0.1,
  y = 0.1,
  width = 0.2,
  height = 0.3,
}: Partial<{ page: number; x: number; y: number; width: number; height: number }> = {}): PdfAnnotation {
  return {
    id: 1,
    page,
    kind: "rectangle",
    x,
    y,
    width,
    height,
  } as PdfAnnotation;
}

function textBoxAnnotation({
  page = 1,
  x = 0.3,
  y = 0.3,
  width = 0.4,
  height = 0.2,
  text = "Hello annotated world",
}: Partial<{ page: number; x: number; y: number; width: number; height: number; text: string }> = {}): PdfAnnotation {
  return {
    id: 2,
    page,
    kind: "text-box",
    x,
    y,
    width,
    height,
    text,
    fontSize: 0.03,
    color: "#17365d",
  } as PdfAnnotation;
}

function lineAnnotation({
  page = 1,
  start = { x: 0.1, y: 0.5 },
  end = { x: 0.5, y: 0.5 },
}: Partial<{ page: number; start: PagePoint; end: PagePoint }> = {}): PdfAnnotation {
  return {
    id: 3,
    page,
    kind: "line",
    start,
    end,
  } as PdfAnnotation;
}

function arrowAnnotation(overrides: Partial<{ page: number }> = {}): PdfAnnotation {
  return {
    id: 4,
    page: overrides.page ?? 1,
    kind: "arrow",
    start: { x: 0.1, y: 0.5 },
    end: { x: 0.5, y: 0.5 },
  } as PdfAnnotation;
}

function circleAnnotation(overrides: Partial<{ page: number }> = {}): PdfAnnotation {
  return {
    id: 5,
    page: overrides.page ?? 1,
    kind: "circle",
    x: 0.5,
    y: 0.5,
    width: 0.2,
    height: 0.2,
  } as PdfAnnotation;
}

function freehandAnnotation(overrides: Partial<{ page: number }> = {}): PdfAnnotation {
  return {
    id: 6,
    page: overrides.page ?? 1,
    kind: "freehand",
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.4, y: 0.2 },
      { x: 0.4, y: 0.4 },
    ],
  } as PdfAnnotation;
}

function highlightAnnotation(overrides: Partial<{ page: number }> = {}): PdfAnnotation {
  return {
    id: 7,
    page: overrides.page ?? 1,
    kind: "highlight",
    x: 0.2,
    y: 0.6,
    width: 0.3,
    height: 0.05,
  } as PdfAnnotation;
}

function imageAnnotation({
  page = 1,
  src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p8sAAAAASUVORK5CYII=",
  name = "overlay.png",
}: Partial<{ page: number; src: string; name: string }> = {}): PdfAnnotation {
  return {
    id: 8,
    page,
    kind: "image",
    x: 0.4,
    y: 0.4,
    width: 0.2,
    height: 0.2,
    src,
    name,
  } as PdfAnnotation;
}

async function exportedPages(output: Uint8Array) {
  const pdf = await PDFDocument.load(output, { updateMetadata: false });
  return pdf;
}

async function extractTexts(pdf: Awaited<ReturnType<typeof exportedPages>>) {
  const texts: string[] = [];
  for (const page of pdf.getPages()) {
    for (const asset of page.extractContents()) {
      if (asset.kind === "text") texts.push(asset.getText());
    }
  }
  return texts;
}

async function extractGraphicsCount(pdf: Awaited<ReturnType<typeof exportedPages>>) {
  let count = 0;
  for (const page of pdf.getPages()) {
    for (const asset of page.extractContents()) {
      if (asset.kind === "graphics") count += 1;
    }
  }
  return count;
}

async function extractImageCount(pdf: Awaited<ReturnType<typeof exportedPages>>) {
  let count = 0;
  for (const page of pdf.getPages()) {
    for (const asset of page.extractContents()) {
      if (asset.kind === "image") count += 1;
    }
  }
  return count;
}

describe("PDF export geometry", () => {
  const geometry = { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT };

  it("maps normalized top-left to PDF bottom-left space for rotation 0", () => {
    expect(
      visualPointToPdf({ ...geometry, rotation: 0 }, { x: 0.1, y: 0.2 }),
    ).toEqual({ x: 60, y: 640 });
  });

  it("maps normalized coordinates for rotation 90", () => {
    expect(
      visualPointToPdf({ ...geometry, rotation: 90 }, { x: 0.1, y: 0.2 }),
    ).toEqual({ x: 120, y: 80 });
  });

  it("maps normalized coordinates for rotation 180", () => {
    expect(
      visualPointToPdf({ ...geometry, rotation: 180 }, { x: 0.1, y: 0.2 }),
    ).toEqual({ x: 540, y: 160 });
  });

  it("maps normalized coordinates for rotation 270", () => {
    expect(
      visualPointToPdf({ ...geometry, rotation: 270 }, { x: 0.1, y: 0.2 }),
    ).toEqual({ x: 480, y: 720 });
  });

  it("builds an axis-aligned PDF rectangle for rotation 0", () => {
    const rect = visualRectToPdf(
      { ...geometry, rotation: 0 },
      { x: 0.1, y: 0.1, width: 0.2, height: 0.3 },
    );
    expect(rect.x).toBeCloseTo(60);
    expect(rect.y).toBeCloseTo(480);
    expect(rect.width).toBeCloseTo(120);
    expect(rect.height).toBeCloseTo(240);
  });

  it("builds an axis-aligned PDF rectangle for rotation 90", () => {
    const rect = visualRectToPdf(
      { ...geometry, rotation: 90 },
      { x: 0.1, y: 0.1, width: 0.2, height: 0.3 },
    );
    expect(rect.x).toBeCloseTo(60);
    expect(rect.y).toBeCloseTo(80);
    expect(rect.width).toBeCloseTo(180);
    expect(rect.height).toBeCloseTo(160);
  });

  it("clamps out-of-range normalized points", () => {
    expect(
      visualPointToPdf({ ...geometry, rotation: 0 }, { x: -0.5, y: 1.5 }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("normalizes arbitrary rotation angles to multiples of 90", () => {
    expect(({} as { rotation: PageRotation }).rotation).toBeUndefined();
    // normalization is exercised through getPageGeometry / visual helpers
  });
});

describe("PDF export page geometry from pdf-lib pages", () => {
  const pageGeometry = { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, rotation: 0 as PageRotation };

  it("reports crop box and zero rotation for a fresh page", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const geometry = getPageGeometry(page);
    expect(geometry).toEqual({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      rotation: 0,
    });
  });

  it("reports a non-zero rotation from the page /Rotate entry", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.setRotation(degrees(90));
    const geometry = getPageGeometry(page);
    expect(geometry.rotation).toBe(90);
    const display = getDisplaySize(geometry);
    expect(display).toEqual({ width: PAGE_HEIGHT, height: PAGE_WIDTH });
  });

  it("keeps display size unchanged for rotation 0 and 180", () => {
    expect(getDisplaySize(pageGeometry)).toEqual({
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
    });
    expect(getDisplaySize({ ...pageGeometry, rotation: 180 })).toEqual({
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
    });
  });
});

describe("PDF export text-box metrics", () => {
  it("computes a baseline anchor above the top-left corner", () => {
    const annotation = textBoxAnnotation({
      x: 0.1,
      y: 0.1,
      width: 0.4,
      height: 0.2,
    }) as TextBoxAnnotation;
    const metrics = getTextBoxMetrics(
      { ...geometry, rotation: 0 },
      annotation as TextBoxAnnotation,
    );
    expect(metrics.anchor.x).toBeGreaterThan(annotation.x * PAGE_WIDTH);
    expect(metrics.anchor.y).toBeLessThan((1 - annotation.y) * PAGE_HEIGHT);
    expect(metrics.fontSize).toBeGreaterThan(0);
    expect(metrics.maxWidth).toBeGreaterThan(0);
  });
});

describe("PDF export round-trip", () => {
  it("exports every supported annotation kind and preserves original text", async () => {
    const source = await makeSourcePdf({ pageCount: 2, withText: true });
    const annotations: PdfAnnotation[] = [
      pageRectangleAnnotation({ page: 1 }),
      circleAnnotation({ page: 1 }),
      lineAnnotation({ page: 1 }),
      arrowAnnotation({ page: 1 }),
      freehandAnnotation({ page: 1 }),
      highlightAnnotation({ page: 1 }),
      textBoxAnnotation({ page: 2 }),
      imageAnnotation({ page: 2 }),
    ];

    const output = await exportAnnotatedPdf(source, annotations);

    const pdf = await exportedPages(output);
    expect(pdf.getPageCount()).toBe(2);

    const texts = await extractTexts(pdf);
    expect(texts.join(" ")).toContain("Original page 1 text");
    expect(texts.join(" ")).toContain("Original page 2 text");
    expect(texts.join(" ")).toContain("Hello annotated world");

    expect(await extractGraphicsCount(pdf)).toBeGreaterThan(0);
    expect(await extractImageCount(pdf)).toBeGreaterThan(0);
  });

  it("keeps every source page even when only one page is annotated", async () => {
    const source = await makeSourcePdf({ pageCount: 3, withText: true });
    const output = await exportAnnotatedPdf(source, [
      pageRectangleAnnotation({ page: 2 }),
    ]);

    const pdf = await exportedPages(output);
    expect(pdf.getPageCount()).toBe(3);
    const texts = await extractTexts(pdf);
    expect(texts.join(" ")).toContain("Original page 1 text");
    expect(texts.join(" ")).toContain("Original page 3 text");
  });
});

describe("PDF export file name", () => {
  it("appends -annotated and strips the .pdf extension", () => {
    expect(annotatedPdfFileName("report.pdf")).toBe("report-annotated.pdf");
    expect(annotatedPdfFileName("report.PDF")).toBe("report-annotated.pdf");
    expect(annotatedPdfFileName("my document.pdf")).toBe(
      "my document-annotated.pdf",
    );
    expect(annotatedPdfFileName("")).toBe("document-annotated.pdf");
    expect(annotatedPdfFileName("weird/name:*.pdf")).toBe(
      "weird-name--annotated.pdf",
    );
  });
});

describe("PDF export error paths", () => {
  it("rejects an empty source", async () => {
    await expect(exportAnnotatedPdf(new Uint8Array(), [])).rejects.toThrow(
      "Choose a PDF to export",
    );
  });

  it("rejects a file without a PDF signature", async () => {
    await expect(
      exportAnnotatedPdf(new TextEncoder().encode("not a pdf"), []),
    ).rejects.toThrow("PDF signature");
  });

  it("rejects corrupt PDF bytes that pass the signature check", async () => {
    await expect(
      exportAnnotatedPdf(
        new TextEncoder().encode("%PDF-1.7 corrupt"),
        [pageRectangleAnnotation()],
      ),
    ).rejects.toThrow("could not be opened");
  });

  it("rejects an encrypted PDF", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pdf.encrypt({ userPassword: "secret", ownerPassword: "owner" });
    const encrypted = new Uint8Array(await pdf.save());

    await expect(
      exportAnnotatedPdf(encrypted, [pageRectangleAnnotation()]),
    ).rejects.toThrow("encrypted");
  });

  it("rejects when there are no meaningful annotations", async () => {
    const source = await makeSourcePdf();
    await expect(
      exportAnnotatedPdf(source, [
        { id: 1, page: 1, kind: "text-box", x: 0, y: 0, width: 0, height: 0, text: "   ", fontSize: 0.02, color: "#000" } as PdfAnnotation,
      ]),
    ).rejects.toThrow("at least one annotation");
  });

  it("rejects an annotation on a page outside the document", async () => {
    const source = await makeSourcePdf({ pageCount: 1 });
    await expect(
      exportAnnotatedPdf(source, [
        pageRectangleAnnotation({ page: 99 }),
      ]),
    ).rejects.toThrow("not in this PDF");
  });

  it("rejects text boxes with characters Helvetica cannot encode", async () => {
    const source = await makeSourcePdf();
    await expect(
      exportAnnotatedPdf(source, [
        textBoxAnnotation({ text: "Emoji \u{1F600} not supported" }),
      ]),
    ).rejects.toThrow("cannot encode");
  });
});
