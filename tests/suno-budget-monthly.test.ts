import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUNO_DAILY_CREDIT_LIMIT,
  SUNO_MONTHLY_BUDGET_EXHAUSTED_REASON,
  SunoBudgetTracker
} from "../src/services/sunoBudget";

describe("SunoBudgetTracker monthly budget", () => {
  it("does not enforce the monthly budget when the configured limit is zero", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-budget-monthly-default-"));
    await mkdir(join(root, "runtime", "suno"), { recursive: true });
    await writeFile(
      join(root, "runtime", "suno", "budget.json"),
      `${JSON.stringify({ date: "2026-04-23", consumed: 10, month: "2026-04", monthlyConsumed: 999 }, null, 2)}\n`,
      "utf8"
    );
    const tracker = new SunoBudgetTracker(root, () => new Date("2026-04-23T12:00:00.000Z"));

    const result = await tracker.reserve(10, DEFAULT_SUNO_DAILY_CREDIT_LIMIT, 0);

    expect(result.ok).toBe(true);
    expect(result.monthlyLimit).toBe(0);
    expect(result.monthlyConsumed).toBe(1009);
  });

  it("blocks reservation without mutating state when the monthly limit would be exceeded", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-budget-monthly-exhausted-"));
    await mkdir(join(root, "runtime", "suno"), { recursive: true });
    await writeFile(
      join(root, "runtime", "suno", "budget.json"),
      `${JSON.stringify({ date: "2026-04-23", consumed: 20, month: "2026-04", monthlyConsumed: 55 }, null, 2)}\n`,
      "utf8"
    );
    const tracker = new SunoBudgetTracker(root, () => new Date("2026-04-23T12:00:00.000Z"));

    const result = await tracker.reserve(10, DEFAULT_SUNO_DAILY_CREDIT_LIMIT, 60);
    const persisted = JSON.parse(await readFile(join(root, "runtime", "suno", "budget.json"), "utf8")) as {
      consumed: number;
      monthlyConsumed: number;
    };

    expect(result).toEqual({
      ok: false,
      consumed: 20,
      limit: DEFAULT_SUNO_DAILY_CREDIT_LIMIT,
      reason: SUNO_MONTHLY_BUDGET_EXHAUSTED_REASON,
      monthlyConsumed: 55,
      monthlyLimit: 60
    });
    expect(persisted).toMatchObject({
      consumed: 20,
      monthlyConsumed: 55
    });
  });
});
