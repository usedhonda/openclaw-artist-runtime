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
  llm?: {
    complete: (params: {
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      maxTokens?: number;
      purpose?: string;
      reasoning?: "low" | "medium" | "high" | "xhigh";
      signal?: AbortSignal;
    }) => Promise<{ text: string }>;
  };
  config?: { current?: () => unknown };
}

export type NativeRuntimeFailureReason =
  | "native_runtime_unavailable"
  | "native_runtime_unauthorized"
  | "native_runtime_timeout"
  | "native_runtime_empty_response"
  | "native_runtime_request_failed";

export class NativeRuntimeError extends Error {
  readonly reason: NativeRuntimeFailureReason;
  constructor(reason: NativeRuntimeFailureReason) {
    super(reason);
    this.name = "NativeRuntimeError";
    this.reason = reason;
  }
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
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((item) => {
    if (!isRecord(item)) return [];
    return (item.type === "text" || item.type === "output_text") && typeof item.text === "string" ? [item.text] : [];
  });
  return parts.join("").trim() || undefined;
}

/** Extract only assistant-authored text; tool/user content is never returned. */
export function extractOpenClawAssistantText(messages: unknown[]): string | undefined {
  const parts: string[] = [];
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "assistant") continue;
    const text = textFromContent(message.content);
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
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = (async () => {
    if (runtime.llm) {
      const currentConfig = runtime.config?.current?.();
      const defaults =
        isRecord(currentConfig) && isRecord(currentConfig.agents) ? currentConfig.agents.defaults : undefined;
      const thinkingDefault = isRecord(defaults) ? defaults.thinkingDefault : undefined;
      const reasoning =
        thinkingDefault === "low" ||
        thinkingDefault === "medium" ||
        thinkingDefault === "high" ||
        thinkingDefault === "xhigh"
          ? thinkingDefault
          : undefined;
      const result = await runtime.llm.complete({
        messages: [{ role: "user", content: prompt }],
        purpose: "artist-runtime creative AI",
        ...(reasoning ? { reasoning } : {}),
        signal: controller.signal
      });
      if (!result.text.trim()) throw new NativeRuntimeError("native_runtime_empty_response");
      return result.text.trim();
    }
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
    if (waited.status === "timeout") throw new NativeRuntimeError("native_runtime_timeout");
    if (waited.status !== "ok") throw new NativeRuntimeError(classifyNativeRuntimeFailure(waited.error));
    const messages = await runtime.subagent.getSessionMessages({
      sessionKey: run.sessionKey ?? sessionKey,
      limit: 20
    });
    const text = extractOpenClawAssistantText(messages.messages);
    if (!text) throw new NativeRuntimeError("native_runtime_empty_response");
    return text;
  })();
  try {
    return await Promise.race([
      operation,
      new Promise<undefined>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new NativeRuntimeError("native_runtime_timeout"));
        }, timeoutMs);
      })
    ]);
  } catch (error) {
    if (error instanceof NativeRuntimeError) throw error;
    throw new NativeRuntimeError(classifyNativeRuntimeFailure(error));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function classifyNativeRuntimeFailure(value: unknown): NativeRuntimeFailureReason {
  const text = typeof value === "string" ? value : value instanceof Error ? `${value.name} ${value.message}` : "";
  const normalized = text.toLowerCase();
  if (normalized.includes("timeout") || normalized.includes("timed out")) return "native_runtime_timeout";
  if (normalized.includes("unauthoriz") || normalized.includes("forbidden") || normalized.includes("auth"))
    return "native_runtime_unauthorized";
  if (
    normalized.includes("unavailable") ||
    normalized.includes("not configured") ||
    normalized.includes("missing") ||
    normalized.includes("requestscopedsubagentruntime")
  )
    return "native_runtime_unavailable";
  return "native_runtime_request_failed";
}
