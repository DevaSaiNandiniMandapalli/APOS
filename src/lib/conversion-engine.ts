import { checkPdfHeader } from "./pdf-limits";
import { imageFormatSignature, readImageDimensions } from "./image-format";

export type ConversionFormat = "pdf" | "txt" | "html" | "png" | "jpeg" | "webp" | "tiff" | "docx" | "xlsx" | "pptx" | "odt" | "ods" | "odp" | "unknown";
export type ConversionStatus = "queued" | "validating" | "processing" | "complete" | "failed" | "skipped" | "cancelled";
export type ConversionProgress = { completed: number; total: number };
export type ConversionResult = { bytes: Uint8Array; pageCount?: number; characterCount?: number };

export type ConversionCapability = {
  id: string;
  inputFormat: ConversionFormat;
  outputFormat: ConversionFormat;
  inputExtensions: readonly string[];
  outputExtension: string;
  outputMediaType: string;
  maxFileBytes: number;
  maxBatchFiles: number;
  maxBatchBytes: number;
  maxPages?: number;
  validateOutput(bytes: Uint8Array): void;
  convert(file: Pick<File, "name" | "size" | "arrayBuffer">, settings: Readonly<Record<string, boolean | number | string>>, signal: AbortSignal, onProgress: (progress: ConversionProgress) => void): Promise<ConversionResult>;
};

export const conversionCapabilities = [
  {
    id: "pdf-to-text",
    inputFormat: "pdf",
    outputFormat: "txt",
    inputExtensions: [".pdf"],
    outputExtension: "txt",
    outputMediaType: "text/plain;charset=utf-8",
    maxFileBytes: 25 * 1024 * 1024,
    maxBatchFiles: 20,
    maxBatchBytes: 100 * 1024 * 1024,
    maxPages: 500,
    validateOutput: validatePlainTextOutput,
    convert: async (file, settings, signal, onProgress) => {
      const { convertPdfFileToText } = await import("./pdf-to-text");
      return convertPdfFileToText(file, { includePageLabels: settings.includePageLabels !== false }, signal, ({ completedPages, totalPages }) => onProgress({ completed: completedPages, total: totalPages }));
    },
  },
  {
    id: "pdf-to-html",
    inputFormat: "pdf",
    outputFormat: "html",
    inputExtensions: [".pdf"],
    outputExtension: "html",
    outputMediaType: "text/html;charset=utf-8",
    maxFileBytes: 25 * 1024 * 1024,
    maxBatchFiles: 20,
    maxBatchBytes: 100 * 1024 * 1024,
    maxPages: 500,
    validateOutput: validateHtmlOutput,
    convert: async (file, settings, signal, onProgress) => {
      const { convertPdfFileToHtml } = await import("./pdf-to-text");
      return convertPdfFileToHtml(file, { includePageLabels: settings.includePageLabels !== false }, signal, ({ completedPages, totalPages }) => onProgress({ completed: completedPages, total: totalPages }));
    },
  },
  ...(["png", "jpeg", "webp", "tiff"] as const).flatMap((inputFormat) =>
    (["png", "jpeg", "webp"] as const)
      .filter((outputFormat) => outputFormat !== inputFormat)
      .map((outputFormat) => {
        const extensions = { png: ".png", jpeg: ".jpg", webp: ".webp" } as const;
        const inputExtensions = { png: [".png"], jpeg: [".jpg", ".jpeg"], webp: [".webp"], tiff: [".tif", ".tiff"] } as const;
        const mediaTypes = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const;

        return {
          id: `${inputFormat}-to-${outputFormat}`,
          inputFormat,
          outputFormat,
          inputExtensions: inputExtensions[inputFormat],
          outputExtension: extensions[outputFormat].slice(1),
          outputMediaType: mediaTypes[outputFormat],
          maxFileBytes: 25 * 1024 * 1024,
          maxBatchFiles: 20,
          maxBatchBytes: 100 * 1024 * 1024,
          validateOutput(bytes: Uint8Array) {
            if (bytes.byteLength === 0 || !imageFormatSignature(bytes, outputFormat)) {
              throw new Error("The generated image failed format validation.");
            }
            const dimensions = readImageDimensions(bytes, outputFormat);
            if (
              dimensions.width < 1 ||
              dimensions.height < 1 ||
              dimensions.width > 12000 ||
              dimensions.height > 12000 ||
              dimensions.width * dimensions.height > 40_000_000
            ) {
              throw new Error("The generated image dimensions exceed the supported limits.");
            }
          },
          convert: async (file: Pick<File, "name" | "size" | "arrayBuffer">, settings: Readonly<Record<string, boolean | number | string>>, signal: AbortSignal, onProgress: (progress: ConversionProgress) => void) => {
            const { convertImageFile } = await import("./image-convert");
            return convertImageFile(file, outputFormat, settings, signal, onProgress);
          },
        } satisfies ConversionCapability;
      })
  ),
] satisfies readonly ConversionCapability[];

export function findConversionCapability(inputFormat: ConversionFormat, outputFormat: ConversionFormat) {
  return conversionCapabilities.find((capability) => capability.inputFormat === inputFormat && capability.outputFormat === outputFormat);
}

export const CONVERSION_LIMITS = {
  batchFiles: 20,
  inputFileBytes: 25 * 1024 * 1024,
  batchBytes: 100 * 1024 * 1024,
  outputFileBytes: 20 * 1024 * 1024,
  concurrentFiles: 2,
  outputCharacters: 20 * 1024 * 1024,
} as const;

const signatures: ReadonlyArray<{ format: Exclude<ConversionFormat, "txt" | "html" | "unknown" | "docx" | "xlsx" | "pptx" | "odt" | "ods" | "odp">; test(bytes: Uint8Array): boolean }> = [
  { format: "pdf", test: (bytes) => checkPdfHeader(bytes) },
  { format: "png", test: (bytes) => bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a },
  { format: "jpeg", test: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { format: "webp", test: (bytes) => bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP" },
  { format: "tiff", test: (bytes) => bytes.length >= 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a)) },
];

function ascii(bytes: Uint8Array, start: number, count: number) { return String.fromCharCode(...bytes.subarray(start, start + count)); }

export function identifyInputFormat(bytes: Uint8Array): ConversionFormat {
  return signatures.find(({ test }) => test(bytes))?.format ?? "unknown";
}

export function validateConversionInput(file: Pick<File, "name" | "size">, format: ConversionFormat, capability: ConversionCapability) {
  if (!file.size) throw new Error("The selected file is empty.");
  if (file.size > capability.maxFileBytes) throw new Error(`This converter accepts files up to ${formatBytes(capability.maxFileBytes)}.`);
  if (format !== capability.inputFormat) {
    const label = format === "unknown" ? "an unsupported or unrecognized format" : `a ${format.toUpperCase()} file`;
    throw new Error(`This conversion accepts ${capability.inputFormat.toUpperCase()} input; the file signature identifies ${label}.`);
  }
}

export function validateConversionOutput(bytes: Uint8Array, capability: ConversionCapability) {
  if (bytes.byteLength > CONVERSION_LIMITS.outputFileBytes) throw new Error(`The converted output exceeds the ${formatBytes(CONVERSION_LIMITS.outputFileBytes)} output limit.`);
  capability.validateOutput(bytes);
}

export function validatePlainTextOutput(bytes: Uint8Array) {
  if (bytes.byteLength > CONVERSION_LIMITS.outputFileBytes) throw new Error(`The converted output exceeds the ${formatBytes(CONVERSION_LIMITS.outputFileBytes)} output limit.`);
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("The generated text did not pass UTF-8 output validation."); }
}

export function validateHtmlOutput(bytes: Uint8Array) {
  if (bytes.byteLength > CONVERSION_LIMITS.outputFileBytes) throw new Error(`The converted output exceeds the ${formatBytes(CONVERSION_LIMITS.outputFileBytes)} output limit.`);
  let html: string;
  try { html = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("The generated HTML did not pass UTF-8 output validation."); }
  if (!/^<!doctype html><html lang="en">[\s\S]*<main>[\s\S]*<\/main>[\s\S]*<\/body><\/html>$/i.test(html) || /<script\b|<iframe\b|\son\w+\s*=|javascript:/i.test(html)) throw new Error("The generated HTML did not pass document structure validation.");
}

export function safeOutputFilename(inputName: string, requestedBase: string, extension: string, occupied: Set<string>) {
  const fallback = inputName.replace(/\.[^.]+$/, "") || "document";
  const leaf = requestedBase.trim().split(/[\\/]/).pop() || fallback;
  const base = (leaf || fallback)
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100) || "document";
  const normalizedExtension = extension.replace(/^\.+/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (!normalizedExtension) throw new Error("The converter does not define a safe output extension.");
  let candidate = `${base}.${normalizedExtension}`;
  let duplicate = 2;
  while (occupied.has(candidate.toLocaleLowerCase())) candidate = `${base} (${duplicate++}).${normalizedExtension}`;
  occupied.add(candidate.toLocaleLowerCase());
  return candidate;
}

export async function runBoundedQueue<T>(items: readonly T[], concurrency: number, processItem: (item: T) => Promise<void>, signal?: AbortSignal) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("Conversion concurrency must be between 1 and 8.");
  let cursor = 0;
  const worker = async () => {
    while (!signal?.aborted) {
      const index = cursor++;
      if (index >= items.length) return;
      await processItem(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
