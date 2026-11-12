import { PDFDocument, rgb } from "@cantoo/pdf-lib";
import {
  hexToRgb,
  imageFormatFromSignature,
  imagePlacement,
  marginPoints,
  pageDimensions,
  validateImageDimensions,
  validateImagesToPdfSettings,
  type ImagesToPdfSettings,
} from "@/lib/images-to-pdf";

type Request = {
  files: { name: string; bytes: ArrayBuffer }[];
  settings: ImagesToPdfSettings;
};
type Scope = {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
const scope = self as unknown as Scope;

async function recompress(bytes: Uint8Array, format: "png" | "jpeg", settings: ImagesToPdfSettings) {
  const blob = new Blob([bytes as unknown as BlobPart], { type: format === "png" ? "image/png" : "image/jpeg" });
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare an image for compression.");
    context.fillStyle = settings.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const outputType = settings.compression === "png" ? "image/png" : "image/jpeg";
    const converted = await canvas.convertToBlob({ type: outputType, quality: settings.compression === "jpeg" ? settings.quality : undefined });
    return { bytes: new Uint8Array(await converted.arrayBuffer()), format: settings.compression === "png" ? "png" as const : "jpeg" as const, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

scope.onmessage = async ({ data }) => {
  let output: Uint8Array | null = null;
  try {
    validateImagesToPdfSettings(data.settings);
    const pdf = await PDFDocument.create();
    pdf.setProducer("APOS");
    pdf.setCreator("APOS Images to PDF");
    const total = data.files.length;
    if (!total) throw new Error("Choose at least one image.");
    const [red, green, blue] = hexToRgb(data.settings.background);
    for (let index = 0; index < data.files.length; index += 1) {
      const file = data.files[index];
      const source = new Uint8Array(file.bytes);
      if (source.byteLength === 0) throw new Error(`${file.name} is empty.`);
      const sourceFormat = imageFormatFromSignature(source);
      if (!sourceFormat) throw new Error(`${file.name} is not a supported PNG or JPG image.`);
      let embedded: { bytes: Uint8Array; format: "png" | "jpeg"; width: number; height: number };
      if (data.settings.compression === "original") {
        const image = sourceFormat === "png" ? await pdf.embedPng(source) : await pdf.embedJpg(source);
        embedded = { bytes: source, format: sourceFormat, width: image.width, height: image.height };
      } else {
        embedded = await recompress(source, sourceFormat, data.settings);
      }
      validateImageDimensions(embedded.width, embedded.height);
      const image = embedded.format === "png" ? await pdf.embedPng(embedded.bytes) : await pdf.embedJpg(embedded.bytes);
      const dimensions = pageDimensions(data.settings, embedded.width, embedded.height);
      if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) throw new Error("The selected page settings produced an invalid page size.");
      const page = pdf.addPage([dimensions.width, dimensions.height]);
      page.drawRectangle({ x: 0, y: 0, width: dimensions.width, height: dimensions.height, color: rgb(red, green, blue) });
      const margin = marginPoints(data.settings);
      const placement = imagePlacement(embedded.width, embedded.height, dimensions.width, dimensions.height, margin, data.settings.fit);
      page.drawImage(image, placement);
      scope.postMessage({ type: "progress", done: index + 1, total });
    }
    output = await pdf.save({ useObjectStreams: true });
    const checked = await PDFDocument.load(output);
    if (checked.getPageCount() !== total) throw new Error("The generated PDF failed its page-count check.");
    if (output.byteLength < 8) throw new Error("The generated PDF failed its size check.");
    const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
    scope.postMessage({ ok: true, bytes: buffer }, [buffer]);
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : "The PDF could not be created." });
  } finally {
    data.files.forEach((file) => new Uint8Array(file.bytes).fill(0));
    output?.fill(0);
  }
};
