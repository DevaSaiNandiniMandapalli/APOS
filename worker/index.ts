import { buildDocumentRequest, buildRequest, buildShortDocumentRequest, extractAnswer, stripCodeFence, validateAiInput, validateInstructions, type AiTask } from "../src/lib/ai";
import { createRateLimiter } from "../src/lib/rate-limit";

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  SARVAM_API_KEY?: string;
  SARVAM_API_URL?: string;
  SARVAM_MODEL?: string;
  /** Comma-separated extra origins allowed to call /api/ai. */
  ALLOWED_ORIGINS?: string;
  /** Requests allowed per IP per window. Defaults to 20. */
  AI_RATE_LIMIT?: string;
  /** Window length in seconds. Defaults to 600. */
  AI_RATE_WINDOW_SECONDS?: string;
}

const TASKS: AiTask[] = ["summarize", "rewrite", "explain", "chat", "document"];
const MAX_BODY_BYTES = 128 * 1024;

let cachedLimiter: { key: string; limiter: ReturnType<typeof createRateLimiter> } | null = null;

function getLimiter(env: Env) {
  const limit = Number(env.AI_RATE_LIMIT ?? 20) || 20;
  const windowSeconds = Number(env.AI_RATE_WINDOW_SECONDS ?? 600) || 600;
  const key = `${limit}:${windowSeconds}`;
  if (!cachedLimiter || cachedLimiter.key !== key) {
    cachedLimiter = { key, limiter: createRateLimiter({ limit, windowMs: windowSeconds * 1000 }) };
  }
  return cachedLimiter.limiter;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

function clientKey(request: Request) {
  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0].trim() || "unknown";
}

/** Same-origin browser calls only, plus any origin listed in ALLOWED_ORIGINS. */
function originAllowed(request: Request, env: Env) {
  const origin = request.headers.get("origin");
  if (!origin) {
    // No Origin header: allow only when the request is not a cross-site browser call.
    const referer = request.headers.get("referer");
    if (!referer) return true;
    try {
      return new URL(referer).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }
  const self = new URL(request.url).origin;
  if (origin === self) return true;
  const extra = (env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return extra.includes(origin);
}

async function handleAi(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });

  if (!originAllowed(request, env)) return json({ error: "This origin is not allowed to use the AI endpoint." }, 403);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return json({ error: "The request body is too large." }, 413);

  const limit = getLimiter(env).check(clientKey(request));
  if (!limit.allowed) {
    return json(
      { error: "Too many AI requests. Wait a moment and try again." },
      429,
      { "retry-after": String(limit.retryAfterSeconds) },
    );
  }

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
    return json({ answer }, 200, { "x-ratelimit-remaining": String(limit.remaining) });
  } catch (reason) {
    const message = reason instanceof Error && reason.message.startsWith("AI request failed") ? reason.message : "Could not reach the AI service. Try again.";
    return json({ error: message }, 502);
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/ai") return handleAi(request, env);
    if (pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
};

export default worker;
