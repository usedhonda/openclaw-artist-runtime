import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface BirdRateLimitConfig {
  dailyMax: number;
  minIntervalMinutes: number;
}

export interface BirdCallLedger {
  date: string;
  calls: Array<string | BirdCallEntry>;
  cooldownUntil?: string;
  cooldownReason?: string;
  updatedAt: string;
}

export interface BirdCallEntry {
  timestamp: string;
  query?: string;
  mode?: string;
}

export interface BirdLedgerDetail {
  todayCalls: BirdCallEntry[];
  cooldown: {
    until?: string;
    reason?: string;
  };
  nextAllowedAt?: string;
}

export interface BirdAcquireResult {
  allowed: boolean;
  reason?: string;
  remaining: number;
  cooldownUntil?: string;
  nextAllowedAt?: string;
}

export interface BirdRateLimitStatus {
  todayCalls: number;
  dailyMax: number;
  minIntervalMinutes: number;
  cooldownUntil?: string;
  cooldownReason?: string;
  nextAllowedAt?: string;
}

const defaultLimits: BirdRateLimitConfig = {
  dailyMax: 5,
  minIntervalMinutes: 60
};

function ledgerPath(root: string): string {
  return join(root, "runtime", "bird-call-ledger.json");
}

function jstDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

async function readConfig(root: string, env: NodeJS.ProcessEnv = process.env): Promise<BirdRateLimitConfig> {
  const raw = await readFile(join(root, "runtime", "config-overrides.json"), "utf8").catch(() => "");
  const parsed = raw ? JSON.parse(raw) as { bird?: { rateLimits?: { dailyMax?: unknown; minIntervalMinutes?: unknown } } } : {};
  return {
    dailyMax: positiveInteger(env.OPENCLAW_BIRD_DAILY_MAX) ?? positiveInteger(parsed.bird?.rateLimits?.dailyMax) ?? defaultLimits.dailyMax,
    minIntervalMinutes: positiveInteger(env.OPENCLAW_BIRD_MIN_INTERVAL_MINUTES) ?? positiveInteger(parsed.bird?.rateLimits?.minIntervalMinutes) ?? defaultLimits.minIntervalMinutes
  };
}

async function readLedger(root: string, now = new Date()): Promise<BirdCallLedger> {
  const date = jstDate(now);
  const raw = await readFile(ledgerPath(root), "utf8").catch(() => "");
  if (!raw) {
    return { date, calls: [], updatedAt: now.toISOString() };
  }
  const parsed = JSON.parse(raw) as Partial<BirdCallLedger>;
  return {
    date,
    calls: parsed.date === date ? parsed.calls ?? [] : [],
    cooldownUntil: parsed.cooldownUntil,
    cooldownReason: parsed.cooldownReason,
    updatedAt: now.toISOString()
  };
}

async function writeLedger(root: string, ledger: BirdCallLedger): Promise<BirdCallLedger> {
  await mkdir(dirname(ledgerPath(root)), { recursive: true });
  await writeFile(ledgerPath(root), `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  return ledger;
}

export function isBirdBanIndication(value: string): boolean {
  return /(?:\b(?:429|403|suspended|shadowban|rate[\s-]?limit|banned|banning|bantype)\b|制限|凍結)/i.test(value);
}

export async function isInCooldown(root: string, now = new Date()): Promise<boolean> {
  const ledger = await readLedger(root, now);
  return Boolean(ledger.cooldownUntil && new Date(ledger.cooldownUntil).getTime() > now.getTime());
}

export async function tryAcquireBirdCall(root: string, now = new Date()): Promise<BirdAcquireResult> {
  const [limits, ledger] = await Promise.all([readConfig(root), readLedger(root, now)]);
  if (ledger.cooldownUntil && new Date(ledger.cooldownUntil).getTime() > now.getTime()) {
    return {
      allowed: false,
      reason: ledger.cooldownReason ?? "bird cool-down active",
      remaining: Math.max(0, limits.dailyMax - ledger.calls.length),
      cooldownUntil: ledger.cooldownUntil
    };
  }
  if (ledger.calls.length >= limits.dailyMax) {
    return {
      allowed: false,
      reason: `daily bird call limit reached (${limits.dailyMax}/day)`,
      remaining: 0
    };
  }
  const latest = ledger.calls.at(-1);
  if (latest) {
    const latestTimestamp = typeof latest === "string" ? latest : latest.timestamp;
    const nextAllowed = new Date(new Date(latestTimestamp).getTime() + limits.minIntervalMinutes * 60 * 1000);
    if (nextAllowed.getTime() > now.getTime()) {
      return {
        allowed: false,
        reason: `bird min interval active (${limits.minIntervalMinutes} minutes)`,
        remaining: Math.max(0, limits.dailyMax - ledger.calls.length),
        nextAllowedAt: nextAllowed.toISOString()
      };
    }
  }
  return {
    allowed: true,
    remaining: Math.max(0, limits.dailyMax - ledger.calls.length)
  };
}

export async function readBirdRateLimitStatus(root: string, now = new Date()): Promise<BirdRateLimitStatus> {
  const [limits, ledger, acquire] = await Promise.all([
    readConfig(root),
    readLedger(root, now),
    tryAcquireBirdCall(root, now)
  ]);
  return {
    todayCalls: ledger.calls.length,
    dailyMax: limits.dailyMax,
    minIntervalMinutes: limits.minIntervalMinutes,
    cooldownUntil: ledger.cooldownUntil,
    cooldownReason: ledger.cooldownReason,
    nextAllowedAt: acquire.nextAllowedAt
  };
}

export async function recordBirdCall(root: string, now = new Date(), detail: { query?: string; mode?: string } = {}): Promise<BirdCallLedger> {
  const ledger = await readLedger(root, now);
  const entry: BirdCallEntry = {
    timestamp: now.toISOString(),
    ...(detail.query ? { query: detail.query } : {}),
    ...(detail.mode ? { mode: detail.mode } : {})
  };
  return writeLedger(root, {
    ...ledger,
    calls: [...ledger.calls, entry],
    updatedAt: now.toISOString()
  });
}

export async function triggerCooldown(root: string, reason: string, now = new Date()): Promise<BirdCallLedger> {
  const ledger = await readLedger(root, now);
  return writeLedger(root, {
    ...ledger,
    cooldownUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    cooldownReason: reason,
    updatedAt: now.toISOString()
  });
}

export async function readBirdLedgerDetail(root: string, now = new Date()): Promise<BirdLedgerDetail> {
  const [ledger, acquire] = await Promise.all([readLedger(root, now), tryAcquireBirdCall(root, now)]);
  return {
    todayCalls: ledger.calls.map((call) => typeof call === "string" ? { timestamp: call } : call),
    cooldown: {
      ...(ledger.cooldownUntil ? { until: ledger.cooldownUntil } : {}),
      ...(ledger.cooldownReason ? { reason: ledger.cooldownReason } : {})
    },
    ...(acquire.nextAllowedAt ? { nextAllowedAt: acquire.nextAllowedAt } : {})
  };
}
