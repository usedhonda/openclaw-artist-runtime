/** Minimal public OpenClaw runtime shape used by the creative AI adapter. */
export interface OpenClawAiRuntime {
  subagent: {
    run: (params: {
      sessionKey: string;
      message: string;
      disableTools?: boolean;
      promptMode?: "minimal" | string;
      lightContext?: boolean;
      deliver?: boolean;
      idempotencyKey?: string;
      provider?: string;
      model?: string;
      extraSystemPrompt?: string;
    }) => Promise<{ runId: string; sessionKey?: string; runtime?: unknown }>;
    waitForRun: (params: { runId: string; timeoutMs?: number }) => Promise<{
      status: "ok" | "error" | "timeout" | string;
      error?: string;
    }>;
    getSessionMessages: (params: { sessionKey: string; limit?: number }) => Promise<{
      messages: unknown[];
    }>;
  };
}

let activeRuntime: OpenClawAiRuntime | undefined;
let sessionCounter = 0;

export function setOpenClawAiRuntime(runtime: OpenClawAiRuntime | undefined): void {
  activeRuntime = runtime;
}

export function getOpenClawAiRuntime(): OpenClawAiRuntime | undefined {
  return activeRuntime;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!isRecord(item)) return [];
    return typeof item.text === "string" ? [item.text] : [];
  });
  return parts.join("").trim() || undefined;
}

/** Extract only assistant-authored text; tool/user content is never returned. */
export function extractOpenClawAssistantText(messages: unknown[]): string | undefined {
  const parts: string[] = [];
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "assistant") continue;
    const text = textFromContent(message.content) ?? textFromContent(message.text);
    if (text) parts.push(text);
  }
  return parts.join("\n").trim() || undefined;
}

export async function callOpenClawAiRuntime(
  runtime: OpenClawAiRuntime,
  prompt: string,
  timeoutMs: number
): Promise<string | undefined> {
  const sessionKey = `artist-runtime:creative:${Date.now()}-${++sessionCounter}`;
  const run = await runtime.subagent.run({
    sessionKey,
    message: prompt,
    disableTools: true,
    promptMode: "minimal",
    lightContext: true,
    deliver: false,
    idempotencyKey: sessionKey
  });
  const waited = await runtime.subagent.waitForRun({ runId: run.runId, timeoutMs });
  if (waited.status !== "ok") return undefined;
  const messages = await runtime.subagent.getSessionMessages({ sessionKey: run.sessionKey ?? sessionKey, limit: 20 });
  return extractOpenClawAssistantText(messages.messages);
}
