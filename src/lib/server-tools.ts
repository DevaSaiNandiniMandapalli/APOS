import { z } from "zod";

const optionSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["text", "number", "select", "checkbox", "password"]).catch("text"),
  default: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  choices: z.array(z.object({ value: z.string(), label: z.string() })).default([]),
  help: z.string().default(""),
});

const toolSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
  icon: z.string().default(""),
  accepts: z.string().default(".pdf"),
  multiple: z.boolean().default(false),
  min_files: z.number().int().min(1).default(1),
  options: z.array(optionSchema).default([]),
  wants_pages: z.boolean().default(false),
  available: z.boolean().default(false),
  unavailable_hint: z.string().default(""),
  category: z.string().default("core"),
  produces_pdf: z.boolean().default(true),
  interactive: z.boolean().default(false),
});

const registrySchema = z.object({
  tools: z.array(toolSchema),
  version: z.string().default(""),
  max_upload_mb: z.number().positive().default(50),
  max_files: z.number().int().positive().default(20),
  processing_server: z.boolean().default(true),
});

export type ServerToolOption = z.infer<typeof optionSchema>;
export type ServerTool = z.infer<typeof toolSchema>;
export type ServerRegistry = z.infer<typeof registrySchema>;

export type ServerDownload = { blob: Blob; filename: string };

export function serverApiBase() {
  const configured = process.env.NEXT_PUBLIC_APOS_API_URL?.trim();
  return (configured || "").replace(/\/+$/, "");
}

export function serverApiUrl(path: string) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${serverApiBase()}${suffix}`;
}

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: unknown; detail?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
    if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail;
  } catch {
    // Fall through to the status message.
  }
  return `The APOS processing server returned HTTP ${response.status}.`;
}

export async function fetchServerRegistry(signal?: AbortSignal): Promise<ServerRegistry> {
  let response: Response;
  try {
    response = await fetch(serverApiUrl("/api/v1/tools"), { signal, headers: { Accept: "application/json" }, cache: "no-store" });
  } catch (reason) {
    if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    throw new Error(
      `The APOS processing server is not reachable${serverApiBase() ? ` at ${serverApiBase()}` : ""}. Start the optional FastAPI service or set NEXT_PUBLIC_APOS_API_URL.`,
      { cause: reason },
    );
  }
  if (!response.ok) throw new Error(await readError(response));
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The configured APOS processing server did not return a JSON tool registry. Check NEXT_PUBLIC_APOS_API_URL.");
  }
  const parsed = registrySchema.safeParse(payload);
  if (!parsed.success) throw new Error("The APOS processing server returned an invalid tool registry.");
  return parsed.data;
}

export async function runServerTool(name: string, form: FormData, signal?: AbortSignal): Promise<ServerDownload> {
  let response: Response;
  try {
    response = await fetch(serverApiUrl(`/api/v1/tools/${encodeURIComponent(name)}`), { method: "POST", body: form, signal });
  } catch (reason) {
    if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    throw new Error("The processing server could not be reached. Check the server URL and network connection.", { cause: reason });
  }
  if (!response.ok) throw new Error(await readError(response));
  const blob = await response.blob();
  if (!blob.size) throw new Error("The processing server returned an empty file.");
  return { blob, filename: responseFilename(response, name) };
}

export async function inspectServerFormFields(bytes: ArrayBuffer, filename: string, signal?: AbortSignal) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), filename);
  const response = await fetch(serverApiUrl("/api/v1/inspect/form-fields"), { method: "POST", body: form, signal });
  if (!response.ok) throw new Error(await readError(response));
  const payload = (await response.json()) as { fields?: unknown };
  const parsed = z.array(z.object({
    name: z.string(),
    type: z.string().default("text"),
    value: z.string().default(""),
    states: z.array(z.string()).optional(),
  })).safeParse(payload.fields);
  if (!parsed.success) throw new Error("The processing server returned invalid form-field metadata.");
  return parsed.data;
}

function responseFilename(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { /* use the plain filename */ }
  }
  const quoted = /filename="([^"]+)"/i.exec(disposition)?.[1];
  if (quoted) return quoted;
  const simple = /filename=([^;]+)/i.exec(disposition)?.[1]?.trim();
  if (simple) return simple;
  return `${fallback.replace(/[^a-z0-9_-]+/gi, "-")}-output`;
}

export function defaultOptionValue(option: ServerToolOption): string | boolean {
  if (option.kind === "checkbox") return option.default === true || option.default === "true" || option.default === "on";
  if (option.default === null || option.default === undefined) {
    return option.kind === "select" ? option.choices[0]?.value ?? "" : "";
  }
  return String(option.default);
}

export function serverAccept(url: string) {
  return url.toLowerCase().includes("image/") ? "image/*" : url;
}

export const SERVER_TOOL_CATEGORY_LABELS: Record<string, string> = {
  organize: "Organize",
  convert: "Convert",
  edit: "Edit",
  optimize: "Optimize",
  secure: "Security",
  intelligence: "Intelligence",
  core: "Core",
};
