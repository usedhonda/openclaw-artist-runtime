export type ErrorToastSource = "network" | "config-patch" | "probe" | "runtime";

export interface ErrorToast {
  id: string;
  source: ErrorToastSource;
  reason: string;
  message: string;
  count: number;
  createdAt: number;
  updatedAt: number;
  dismissAt: number;
}

export interface PushErrorToastInput {
  source: ErrorToastSource;
  reason: string;
  message: string;
}

export const DEFAULT_TOAST_DISMISS_MS = 5000;
export const DEFAULT_TOAST_DEDUP_MS = 5000;
export const DEFAULT_TOAST_MAX = 5;

export function pushErrorToast(
  queue: ErrorToast[],
  input: PushErrorToastInput,
  now: number,
  options: { dedupMs?: number; dismissMs?: number; maxSize?: number } = {}
): ErrorToast[] {
  const dedupMs = options.dedupMs ?? DEFAULT_TOAST_DEDUP_MS;
  const dismissMs = options.dismissMs ?? DEFAULT_TOAST_DISMISS_MS;
  const maxSize = options.maxSize ?? DEFAULT_TOAST_MAX;
  const id = `${input.source}:${input.reason}`;
  const existing = queue.find((toast) => toast.id === id && now - toast.updatedAt <= dedupMs);
  if (existing) {
    return queue.map((toast) => toast.id === id
      ? {
        ...toast,
        message: input.message,
        count: toast.count + 1,
        updatedAt: now,
        dismissAt: now + dismissMs
      }
      : toast);
  }

  const next = [
    ...queue,
    {
      id,
      source: input.source,
      reason: input.reason,
      message: input.message,
      count: 1,
      createdAt: now,
      updatedAt: now,
      dismissAt: now + dismissMs
    }
  ];
  return next.slice(Math.max(0, next.length - maxSize));
}

export function dismissErrorToast(queue: ErrorToast[], id: string): ErrorToast[] {
  return queue.filter((toast) => toast.id !== id);
}

export function expireErrorToasts(queue: ErrorToast[], now: number): ErrorToast[] {
  return queue.filter((toast) => toast.dismissAt > now);
}
