import { buildDocumentRequest, buildRequest, buildShortDocumentRequest, extractAnswer, stripCodeFence, validateAiInput, validateInstructions, type AiTask } from "../src/lib/ai";

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  SARVAM_API_KEY?: string;
  SARVAM_API_URL?: string;
  SARVAM_MODEL?: string;
}

const TASKS: AiTask[] = ["summarize", "rewrite", "explain", "chat", "document"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function handleAi(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const apiKey = env.SARVAM_API_KEY;
  if (!apiKey) return json({ error: "AI is not configured on this server. An administrator must set SARVAM_API_KEY." }, 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const { task, text, instructions } = (body ?? {}) as { task?: unknown; text?: unknown; instructions?: unknown };
  const resolvedTask: AiTask = TASKS.includes(task as AiTask) ? (task as AiTask) : "summarize";
  if (typeof text !== "string") return json({ error: "Text is required." }, 400);
  const inputError = validateAiInput(text);
  if (inputError) return json({ error: inputError }, 400);

  const wantsDocument = task === "document";
  if (wantsDocument) {
    if (typeof instructions !== "string") return json({ error: "Instructions are required." }, 400);
    const instructionError = validateInstructions(instructions);
    if (instructionError) return json({ error: instructionError }, 400);
  }

  const endpoint = env.SARVAM_API_URL ?? "https://api.sarvam.ai/v1/chat/completions";
  const payload = wantsDocument
    ? buildDocumentRequest(instructions as string, text, env.SARVAM_MODEL)
    : buildRequest(resolvedTask, text, env.SARVAM_MODEL);

  const ask = async (body: unknown = payload): Promise<string | null> => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-subscription-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`AI request failed (${response.status}).`);
    const data: unknown = await response.json();
    const raw = extractAnswer(data);
    return wantsDocument ? stripCodeFence(raw ?? "") || null : raw;
  };

  try {
    let answer = await ask();
    if (!answer) answer = await ask();
    if (!answer && wantsDocument) {
      answer = await ask(buildShortDocumentRequest(instructions as string, text, env.SARVAM_MODEL));
    }
    if (!answer) {
      return json({ error: "The AI spent its whole budget thinking and returned no text. Try again, or shorten the document." }, 502);
    }
    return json({ answer });
  } catch (reason) {
    const message = reason instanceof Error && reason.message.startsWith("AI request failed") ? reason.message : "Could not reach the AI service. Try again.";
    return json({ error: message }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/ai") return handleAi(request, env);
    if (pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
};
