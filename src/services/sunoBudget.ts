import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SunoBudgetResetEntry } from "../types.js";

export const DEFAULT_SUNO_DAILY_CREDIT_LIMIT = 60;
export const DEFAULT_SUNO_MONTHLY_CREDIT_LIMIT = 0;
export const DEFAULT_SUNO_LIVE_CREATE_CREDIT_COST = 10;
export const SUNO_BUDGET_EXHAUSTED_REASON = "budget_exhausted";
export const SUNO_MONTHLY_BUDGET_EXHAUSTED_REASON = "budget_exhausted_monthly";

type BudgetState = {
  date: string;
  consumed: number;
  month: string;
  monthlyConsumed: number;
  lastResetAt?: string;
};

type ReserveResult = {
  ok: boolean;
  consumed: number;
  limit: number;
  reason?: typeof SUNO_BUDGET_EXHAUSTED_REASON | typeof SUNO_MONTHLY_BUDGET_EXHAUSTED_REASON;
  monthlyConsumed: number;
  monthlyLimit: number;
};

export type SunoBudgetState = {
  date: string;
  consumed: number;
  limit: number;
  remaining: number;
  lastResetAt?: string;
  monthly: {
    month: string;
    consumed: number;
    limit: number;
    remaining: number;
    unlimited: boolean;
  };
};

function utcDate(clock: () => Date): string {
  return clock().toISOString().slice(0, 10);
}

function utcMonth(clock: () => Date): string {
  return clock().toISOString().slice(0, 7);
}

function logSunoBudgetFailure(context: string, error: unknown): void {
  if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return;
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[suno-budget] ${context} failed: ${reason}`);
}

export class SunoBudgetTracker {
  constructor(
    private readonly workspaceRoot = ".",
    private readonly clock: () => Date = () => new Date()
  ) {}

  private statePath(): string {
    return join(this.workspaceRoot, "runtime", "suno", "budget.json");
  }

  private resetLogPath(): string {
    return join(this.workspaceRoot, "runtime", "suno", "budget-reset.jsonl");
  }

  private emptyState(): BudgetState {
    return {
      date: utcDate(this.clock),
      consumed: 0,
      month: utcMonth(this.clock),
      monthlyConsumed: 0
    };
  }

  private async readState(): Promise<BudgetState> {
    const contents = await readFile(this.statePath(), "utf8").catch(() => "");
    if (!contents) {
      return this.emptyState();
    }

    let parsed: Partial<BudgetState>;
    try {
      parsed = JSON.parse(contents) as Partial<BudgetState>;
    } catch {
      return this.emptyState();
    }
    const date = typeof parsed.date === "string" ? parsed.date : utcDate(this.clock);
    const month = typeof parsed.month === "string" ? parsed.month : date.slice(0, 7);
    const consumed = Number.isFinite(parsed.consumed) ? Number(parsed.consumed) : 0;
    const monthlyConsumed = Number.isFinite(parsed.monthlyConsumed)
      ? Number(parsed.monthlyConsumed)
      : month === utcMonth(this.clock)
        ? consumed
        : 0;
    return {
      date,
      consumed,
      month,
      monthlyConsumed,
      lastResetAt: typeof parsed.lastResetAt === "string" ? parsed.lastResetAt : undefined
    };
  }

  private async writeState(state: BudgetState): Promise<void> {
    const finalPath = this.statePath();
    const tmpPath = `${finalPath}.tmp`;
    await mkdir(dirname(finalPath), { recursive: true });
    await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tmpPath, finalPath);
    await unlink(tmpPath).catch((error) => logSunoBudgetFailure("state tmp cleanup", error));
  }

  private normalizeState(current: BudgetState): BudgetState {
    const today = utcDate(this.clock);
    const month = utcMonth(this.clock);
    return {
      ...current,
      date: current.date === today ? current.date : today,
      consumed: current.date === today ? current.consumed : 0,
      month: current.month === month ? current.month : month,
      monthlyConsumed: current.month === month ? current.monthlyConsumed : 0
    };
  }

  private monthlyRemaining(monthlyLimit: number, monthlyConsumed: number): number {
    return monthlyLimit > 0 ? Math.max(monthlyLimit - monthlyConsumed, 0) : 0;
  }

  private async appendResetLog(entry: { timestamp: string; consumedBefore: number; reason: string }): Promise<void> {
    const path = this.resetLogPath();
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  }

  async getResetHistory(limit = 10): Promise<SunoBudgetResetEntry[]> {
    const contents = await readFile(this.resetLogPath(), "utf8").catch(() => "");
    if (!contents.trim()) {
      return [];
    }

    const entries = contents
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          const parsed = JSON.parse(line) as Partial<SunoBudgetResetEntry>;
          return typeof parsed.timestamp === "string"
            && typeof parsed.reason === "string"
            && Number.isFinite(parsed.consumedBefore)
            ? {
                timestamp: parsed.timestamp,
                consumedBefore: Number(parsed.consumedBefore),
                reason: parsed.reason
              }
            : undefined;
        } catch {
          return undefined;
        }
      })
      .filter((entry): entry is SunoBudgetResetEntry => Boolean(entry));

    return entries.slice(-Math.max(limit, 0)).reverse();
  }

  async reserve(
    credits: number,
    limit = DEFAULT_SUNO_DAILY_CREDIT_LIMIT,
    monthlyLimit = DEFAULT_SUNO_MONTHLY_CREDIT_LIMIT
  ): Promise<ReserveResult> {
    const normalized = this.normalizeState(await this.readState());

    if (normalized.consumed + credits > limit) {
      return {
        ok: false,
        consumed: normalized.consumed,
        limit,
        reason: SUNO_BUDGET_EXHAUSTED_REASON,
        monthlyConsumed: normalized.monthlyConsumed,
        monthlyLimit
      };
    }

    if (monthlyLimit > 0 && normalized.monthlyConsumed + credits > monthlyLimit) {
      return {
        ok: false,
        consumed: normalized.consumed,
        limit,
        reason: SUNO_MONTHLY_BUDGET_EXHAUSTED_REASON,
        monthlyConsumed: normalized.monthlyConsumed,
        monthlyLimit
      };
    }

    const next = {
      ...normalized,
      consumed: normalized.consumed + credits,
      monthlyConsumed: normalized.monthlyConsumed + credits
    };
    await this.writeState(next);
    return {
      ok: true,
      consumed: next.consumed,
      limit,
      monthlyConsumed: next.monthlyConsumed,
      monthlyLimit
    };
  }

  // Refund a prior reservation. A reservation is only a real spend once the create reaches a
  // successful submit; a create that fails before submit must release the reserved credits so
  // failed attempts do not permanently burn daily/monthly budget.
  async release(credits: number): Promise<void> {
    if (!(credits > 0)) {
      return;
    }
    const normalized = this.normalizeState(await this.readState());
    await this.writeState({
      ...normalized,
      consumed: Math.max(normalized.consumed - credits, 0),
      monthlyConsumed: Math.max(normalized.monthlyConsumed - credits, 0)
    });
  }

  async getState(
    limit = DEFAULT_SUNO_DAILY_CREDIT_LIMIT,
    monthlyLimit = DEFAULT_SUNO_MONTHLY_CREDIT_LIMIT
  ): Promise<SunoBudgetState> {
    const normalized = this.normalizeState(await this.readState());

    return {
      date: normalized.date,
      consumed: normalized.consumed,
      limit,
      remaining: Math.max(limit - normalized.consumed, 0),
      lastResetAt: normalized.lastResetAt,
      monthly: {
        month: normalized.month,
        consumed: normalized.monthlyConsumed,
        limit: monthlyLimit,
        remaining: this.monthlyRemaining(monthlyLimit, normalized.monthlyConsumed),
        unlimited: monthlyLimit <= 0
      }
    };
  }

  async reset(
    limit = DEFAULT_SUNO_DAILY_CREDIT_LIMIT,
    monthlyLimit = DEFAULT_SUNO_MONTHLY_CREDIT_LIMIT,
    reason = "operator_reset"
  ): Promise<SunoBudgetState> {
    const today = utcDate(this.clock);
    const current = this.normalizeState(await this.readState());
    const timestamp = this.clock().toISOString();
    const next = {
      date: today,
      consumed: 0,
      month: current.month,
      monthlyConsumed: current.monthlyConsumed,
      lastResetAt: timestamp
    };
    await this.writeState(next);
    await this.appendResetLog({
      timestamp,
      consumedBefore: current.consumed,
      reason
    });
    return {
      date: today,
      consumed: 0,
      limit,
      remaining: limit,
      lastResetAt: timestamp,
      monthly: {
        month: next.month,
        consumed: next.monthlyConsumed,
        limit: monthlyLimit,
        remaining: this.monthlyRemaining(monthlyLimit, next.monthlyConsumed),
        unlimited: monthlyLimit <= 0
      }
    };
  }
}
