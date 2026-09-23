export type ConsoleConnectionState = "connected" | "stale" | "offline" | "reconnecting" | "recovered";

export interface ConnectionSnapshot {
  state: ConsoleConnectionState;
  lastRefreshAt: number | null;
  lastError?: string | null;
}

export function deriveConnectionState(input: {
  now: number;
  lastRefreshAt: number | null;
  networkError?: string | null;
  isRefreshing?: boolean;
  recoveredUntil?: number | null;
  staleMs?: number;
}): ConnectionSnapshot {
  const staleMs = input.staleMs ?? 15000;
  if (input.recoveredUntil && input.now < input.recoveredUntil) {
    return { state: "recovered", lastRefreshAt: input.lastRefreshAt, lastError: null };
  }
  if (input.isRefreshing && input.networkError) {
    return { state: "reconnecting", lastRefreshAt: input.lastRefreshAt, lastError: input.networkError };
  }
  if (input.networkError) {
    return { state: "offline", lastRefreshAt: input.lastRefreshAt, lastError: input.networkError };
  }
  if (input.lastRefreshAt !== null && input.now - input.lastRefreshAt > staleMs) {
    return { state: "stale", lastRefreshAt: input.lastRefreshAt, lastError: null };
  }
  return { state: "connected", lastRefreshAt: input.lastRefreshAt, lastError: null };
}
