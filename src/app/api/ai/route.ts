import { NextResponse } from "next/server";
import { buildRequest, extractAnswer, validateAiInput, type AiTask } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TASKS: AiTask[] = ["summarize", "rewrite", "explain", "chat"];

export async function POST(request: Request) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI is not configured on this server. An administrator must set SARVAM_API_KEY." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { task, text } = (body ?? {}) as { task?: unknown; text?: unknown };
  const resolvedTask: AiTask = TASKS.includes(task as AiTask) ? (task as AiTask) : "summarize";
  if (typeof text !== "string") {
    return NextResponse.json({ error: "Text is required." }, { status: 400 });
  }
  const inputError = validateAiInput(text);
  if (inputError) {
    return NextResponse.json({ error: inputError }, { status: 400 });
  }

  const endpoint = process.env.SARVAM_API_URL ?? "https://api.sarvam.ai/v1/chat/completions";
  const model = process.env.SARVAM_MODEL ?? undefined;
  const payload = buildRequest(resolvedTask, text, model);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      return NextResponse.json({ error: `AI request failed (${response.status}).` }, { status: 502 });
    }

    const data: unknown = await response.json();
    const answer = extractAnswer(data);
    if (!answer) {
      return NextResponse.json({ error: "The AI returned an unexpected response." }, { status: 502 });
    }
    return NextResponse.json({ answer }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not reach the AI service. Try again." }, { status: 502 });
  }
}
