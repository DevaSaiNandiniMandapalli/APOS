import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export type PdfJsTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfJsPageInfo = {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  text: string;
  textItems: PdfJsTextItem[];
  imageCount: number;
};

export type PdfJsValidationOptions = {
  expectedPageCount?: number;
  expectedSizes?: { width: number; height: number }[];
  expectedRotations?: Record<number, number>;
  expectedText?: Record<number, string[]>;
  minImages?: Record<number, number>;
  textPlacement?: {
    page: number;
    text: string;
    horizontal?: "left" | "right" | "center";
    vertical?: "top" | "bottom" | "middle";
  }[];
};

const normalizeRotation = (angle: number) => ((Math.round(angle) % 360) + 360) % 360;

/**
 * Independently validates a generated PDF with PDF.js (not pdf-lib). This is
 * intentionally used from Playwright so downloaded outputs are checked by a
 * second parser, including page geometry, rotation, extracted text and images.
 */
export async function validatePdfWithPdfJs(
  bytes: Uint8Array,
  options: PdfJsValidationOptions = {},
): Promise<{ pageCount: number; pages: PdfJsPageInfo[] }> {
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    verbosity: 0,
  });
  try {
    const document = await loadingTask.promise;
    if (options.expectedPageCount !== undefined && document.numPages !== options.expectedPageCount) {
      throw new Error(`PDF.js page count ${document.numPages} did not match expected ${options.expectedPageCount}.`);
    }
    const pages: PdfJsPageInfo[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent();
        const operators = await page.getOperatorList();
        const textItems: PdfJsTextItem[] = textContent.items
          .filter((item): item is Extract<typeof item, { str: string }> => "str" in item)
          .map((item) => {
            const transform = item.transform;
            const x = viewport.transform[0] * transform[4] + viewport.transform[2] * transform[5] + viewport.transform[4];
            const y = viewport.transform[1] * transform[4] + viewport.transform[3] * transform[5] + viewport.transform[5];
            return {
              text: item.str,
              x,
              y,
              width: item.width,
              height: item.height,
            };
          });
        const imageCount = operators.fnArray.filter((fn) =>
          fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject,
        ).length;
        const text = textItems.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
        pages.push({
          pageNumber,
          width: viewport.width,
          height: viewport.height,
          rotation: normalizeRotation(viewport.rotation),
          text,
          textItems,
          imageCount,
        });
      } finally {
        page.cleanup();
      }
    }

    for (const [index, expected] of (options.expectedSizes ?? []).entries()) {
      const page = pages[index];
      if (!page) throw new Error(`Expected a page at index ${index + 1} for size validation.`);
      if (Math.abs(page.width - expected.width) > 0.5 || Math.abs(page.height - expected.height) > 0.5) {
        throw new Error(`PDF.js page ${index + 1} size ${page.width}x${page.height} did not match ${expected.width}x${expected.height}.`);
      }
    }
    for (const [pageNumber, expectedRotation] of Object.entries(options.expectedRotations ?? {})) {
      const page = pages[Number(pageNumber) - 1];
      if (!page) throw new Error(`Expected page ${pageNumber} for rotation validation.`);
      if (page.rotation !== normalizeRotation(expectedRotation)) {
        throw new Error(`PDF.js page ${pageNumber} rotation ${page.rotation} did not match ${expectedRotation}.`);
      }
    }
    for (const [pageNumber, values] of Object.entries(options.expectedText ?? {})) {
      const page = pages[Number(pageNumber) - 1];
      if (!page) throw new Error(`Expected page ${pageNumber} for text validation.`);
      for (const value of values) {
        if (!page.text.includes(value)) throw new Error(`PDF.js page ${pageNumber} did not contain "${value}".`);
      }
    }
    for (const [pageNumber, minimum] of Object.entries(options.minImages ?? {})) {
      const page = pages[Number(pageNumber) - 1];
      if (!page) throw new Error(`Expected page ${pageNumber} for image validation.`);
      if (page.imageCount < minimum) throw new Error(`PDF.js page ${pageNumber} contained ${page.imageCount} images; expected at least ${minimum}.`);
    }
    for (const placement of options.textPlacement ?? []) {
      const page = pages[placement.page - 1];
      if (!page) throw new Error(`Expected page ${placement.page} for placement validation.`);
      const item = page.textItems.find((candidate) => candidate.text.includes(placement.text));
      if (!item) throw new Error(`PDF.js page ${placement.page} did not contain "${placement.text}" for placement validation.`);
      if (placement.horizontal === "right" && item.x < page.width / 2) throw new Error(`"${placement.text}" was not in the right half of page ${placement.page}.`);
      if (placement.horizontal === "left" && item.x >= page.width / 2) throw new Error(`"${placement.text}" did not start in the left half of page ${placement.page}.`);
      if (placement.vertical === "top" && item.y > page.height / 2) throw new Error(`"${placement.text}" was not in the top half of page ${placement.page}.`);
      if (placement.vertical === "bottom" && item.y < page.height / 2) throw new Error(`"${placement.text}" was not in the bottom half of page ${placement.page}.`);
    }
    return { pageCount: document.numPages, pages };
  } finally {
    await loadingTask.destroy();
  }
}
