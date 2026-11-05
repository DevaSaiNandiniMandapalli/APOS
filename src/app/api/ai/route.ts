import { NextResponse } from "next/server";
import { buildDocumentRequest, buildRequest, extractAnswer, stripCodeFence, validateAiInput, validateInstructions, type AiTask } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TASKS: AiTask[] = ["summarize", "rewrite", "explain", "chat", "document"];

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

  const { task, text, instructions } = (body ?? {}) as { task?: unknown; text?: unknown; instructions?: unknown };
  const resolvedTask: AiTask = TASKS.includes(task as AiTask) ? (task as AiTask) : "summarize";
  if (typeof text !== "string") {
    return NextResponse.json({ error: "Text is required." }, { status: 400 });
  }
  const inputError = validateAiInput(text);
  if (inputError) {
    return NextResponse.json({ error: inputError }, { status: 400 });
  }

  const wantsDocument = task === "document";
  if (wantsDocument) {
    if (typeof instructions !== "string") {
      return NextResponse.json({ error: "Instructions are required." }, { status: 400 });
    }
    const instructionError = validateInstructions(instructions);
    if (instructionError) {
      return NextResponse.json({ error: instructionError }, { status: 400 });
    }
  }

  const endpoint = process.env.SARVAM_API_URL ?? "https://api.sarvam.ai/v1/chat/completions";
  const model = process.env.SARVAM_MODEL ?? undefined;
  const payload = wantsDocument
    ? buildDocumentRequest(instructions as string, text, model)
    : buildRequest(resolvedTask, text, model);

  const ask = async (): Promise<string | null> => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      throw new Error(`AI request failed (${response.status}).`);
    }

    const data: unknown = await response.json();
    const raw = extractAnswer(data);
    return wantsDocument ? stripCodeFence(raw ?? "") || null : raw;
  };

  try {
    let answer = await ask();
    // The reasoning model sometimes spends its whole budget thinking and returns
    // nothing; one retry recovers most of those runs.
    if (!answer) answer = await ask();
    if (!answer) {
      return NextResponse.json(
        { error: "The AI spent its whole budget thinking and returned no text. Try again, or shorten the document." },
        { status: 502 },
      );
    }
    return NextResponse.json({ answer }, { headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    const message = reason instanceof Error && reason.message.startsWith("AI request failed") ? reason.message : "Could not reach the AI service. Try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
