import { PDFDocument } from "@cantoo/pdf-lib";
import { imageFormatFromSignature } from "@/lib/images-to-pdf";

type Request = { files: { name: string; bytes: ArrayBuffer }[]; size: "image" | "a4" | "letter"; orientation: "auto" | "portrait" | "landscape" };
const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };

scope.onmessage = async ({ data }) => {
  let output: Uint8Array | null = null;
  try {
    const pdf = await PDFDocument.create();
    for (const file of data.files) {
      const bytes = new Uint8Array(file.bytes);
      const format = imageFormatFromSignature(bytes);
      if (!format) throw new Error(`${file.name} is not a supported PNG or JPG image.`);
      const image = format === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      let width = image.width; let height = image.height;
      if (data.size !== "image") {
        const base = data.size === "a4" ? [595.28, 841.89] : [612, 792];
        const landscape = data.orientation === "landscape" || (data.orientation === "auto" && width > height);
        [width, height] = landscape ? [base[1], base[0]] : base;
        const scale = Math.min(width / image.width, height / image.height);
        const fitWidth = image.width * scale; const fitHeight = image.height * scale;
        const page = pdf.addPage([width, height]);
        page.drawImage(image, { x: (width - fitWidth) / 2, y: (height - fitHeight) / 2, width: fitWidth, height: fitHeight });
      } else {
        const page = pdf.addPage([width, height]);
        page.drawImage(image, { x: 0, y: 0, width, height });
      }
    }
    output = await pdf.save({ useObjectStreams: true });
    const checked = await PDFDocument.load(output);
    if (checked.getPageCount() !== data.files.length) throw new Error("The generated PDF failed its page-count check.");
    const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
    scope.postMessage({ ok: true, bytes: buffer }, [buffer]);
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : "The PDF could not be created." });
  } finally {
    data.files.forEach((file) => new Uint8Array(file.bytes).fill(0));
    output?.fill(0);
  }
};
