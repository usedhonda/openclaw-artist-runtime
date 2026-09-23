import type { AutopilotRunState } from "../types.js";

export type SunoRetryDecision =
  | { action: "ready" }
  | { action: "wait"; reason: string; nextRetryAt: string }
  | { action: "failed"; reason: string };

export interface SunoRetryOptions {
  now?: Date;
  maxRetries?: number;
  baseDelayMs?: number;
}

const defaultMaxRetries = 3;
const defaultBaseDelayMs = 5 * 60 * 1000;

export function classifySunoGenerateFailure(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || "suno_generate_failed");
}

export function nextSunoRetryDecision(state: AutopilotRunState, options: SunoRetryOptions = {}): SunoRetryDecision {
  const maxRetries = options.maxRetries ?? defaultMaxRetries;
  if (state.retryCount >= maxRetries) {
    return { action: "failed", reason: `suno_generate_failed_after_${maxRetries}_retries` };
  }
  if (state.retryCount <= 0 || !state.lastRunAt) {
    return { action: "ready" };
  }
  const now = options.now ?? new Date();
  const delay = (options.baseDelayMs ?? defaultBaseDelayMs) * 2 ** Math.max(0, state.retryCount - 1);
  const nextRetryAt = new Date(new Date(state.lastRunAt).getTime() + delay);
  if (now.getTime() < nextRetryAt.getTime()) {
    return {
      action: "wait",
      reason: `suno_generate_retry_wait_until_${nextRetryAt.toISOString()}`,
      nextRetryAt: nextRetryAt.toISOString()
    };
  }
  return { action: "ready" };
}
