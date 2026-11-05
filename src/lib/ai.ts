export type AiTask = "summarize" | "rewrite" | "explain" | "chat" | "document";

export const AI_TASKS: { id: AiTask; label: string; instruction: string }[] = [
  { id: "summarize", label: "Summarize", instruction: "Summarize the following text in a few clear sentences. Keep the key facts." },
  { id: "rewrite", label: "Rewrite clearly", instruction: "Rewrite the following text so it is clearer and more concise. Keep the meaning." },
  { id: "explain", label: "Explain simply", instruction: "Explain the following text in plain language for a general reader." },
  { id: "chat", label: "Ask a question", instruction: "Answer the user's request helpfully and briefly based on the text provided." },
];

export const MAX_INPUT_CHARS = 12000;
export const MAX_INSTRUCTION_CHARS = 2000;
export const MAX_DOCUMENT_TOKENS = 4096;
/** Sarvam 105B is a reasoning model: it spends tokens thinking before it answers. */
export const MAX_RESPONSE_TOKENS = 2048;
export const DEFAULT_MODEL = "sarvam-105b";

export function validateAiInput(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "Enter some text first.";
  if (trimmed.length > MAX_INPUT_CHARS) return `Text is too long (limit ${MAX_INPUT_CHARS} characters).`;
  return null;
}

export function buildMessages(task: AiTask, text: string): { role: "system" | "user"; content: string }[] {
  const definition = AI_TASKS.find((item) => item.id === task) ?? AI_TASKS[0];
  return [
    { role: "system", content: "You are a helpful assistant inside APOS, a document workspace. Be accurate and concise." },
    { role: "user", content: `${definition.instruction}\n\n-----\n${text.trim()}` },
  ];
}

export function buildRequest(task: AiTask, text: string, model = DEFAULT_MODEL) {
  return {
    model,
    temperature: 0.3,
    max_tokens: MAX_RESPONSE_TOKENS,
    messages: buildMessages(task, text),
  };
}

export function extractAnswer(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as {
    answer?: unknown;
    output?: unknown;
    text?: unknown;
    choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
  };
  if (typeof data.answer === "string" && data.answer.trim()) return data.answer.trim();
  if (typeof data.output === "string" && data.output.trim()) return data.output.trim();
  if (typeof data.text === "string" && data.text.trim()) return data.text.trim();
  const choice = data.choices?.[0];
  if (choice) {
    if (typeof choice.message?.content === "string" && choice.message.content.trim()) return choice.message.content.trim();
    if (typeof choice.text === "string" && choice.text.trim()) return choice.text.trim();
  }
  return null;
}

const DOCUMENT_SYSTEM_PROMPT = [
  "You convert documents into new documents.",
  "Reply with Markdown only, using this subset: '# ', '## ', '### ' headings, '- ' bullets,",
  "'1. ' numbered lists, pipe tables ('| a | b |' with a '| --- | --- |' separator), and plain paragraphs.",
  "Separate blocks with a blank line. Never add commentary, notes, explanations or code fences.",
  "Reproduce every fact from the source. Never invent names, numbers, dates or clauses.",
].join(" ");

export function buildDocumentMessages(instructions: string, text: string) {
  return [
    { role: "system" as const, content: DOCUMENT_SYSTEM_PROMPT },
    { role: "user" as const, content: `Instructions:\n${instructions.trim()}\n\nSource document:\n-----\n${text.trim()}` },
  ];
}

export function buildDocumentRequest(instructions: string, text: string, model = DEFAULT_MODEL) {
  return {
    model,
    temperature: 0.2,
    max_tokens: MAX_DOCUMENT_TOKENS,
    messages: buildDocumentMessages(instructions, text),
  };
}

export function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

export function validateInstructions(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Describe what the new document should contain.";
  if (trimmed.length > MAX_INSTRUCTION_CHARS) return `Instructions are too long (limit ${MAX_INSTRUCTION_CHARS} characters).`;
  return null;
}
