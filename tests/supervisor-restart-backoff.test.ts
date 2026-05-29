import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("local gateway supervisor restart backoff", () => {
  it("keeps the supervisor script parseable and documents bounded crash-loop backoff", () => {
    execFileSync("bash", ["-n", "scripts/openclaw-local-gateway-supervisor"], {
      cwd: process.cwd(),
      stdio: "pipe"
    });

    const script = readFileSync("scripts/openclaw-local-gateway-supervisor", "utf8");

    expect(script).toContain("restart_delay_for_crashes()");
    expect(script).toContain("OPENCLAW_LOCAL_GATEWAY_RESTART_MAX_DELAY");
    expect(script).toContain("OPENCLAW_LOCAL_GATEWAY_RESTART_STABLE_RESET_SECONDS");
    expect(script).toContain("consecutive_crash_count=$((consecutive_crash_count + 1))");
    expect(script).toContain("delay=30");
    expect(script).toContain('delay="${restart_delay_max_seconds}"');
    expect(script).toContain("crash_count=${consecutive_crash_count}; restart in ${restart_delay_seconds}s");
  });
});
