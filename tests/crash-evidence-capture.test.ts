import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureGatewayCrashEvidence,
  classifyGatewayExit,
  crashEvidenceIndexPath
} from "../src/services/supervisorHealth";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-crash-evidence-"));
}

describe("gateway crash evidence capture", () => {
  it("classifies gateway exits by rc, signal, startup window, and ticker tail context", () => {
    expect(classifyGatewayExit({
      pid: 1,
      rc: 0,
      startedAtMs: 1_000,
      exitedAtMs: 2_000,
      tailLines: []
    })).toBe("clean_exit");
    expect(classifyGatewayExit({
      pid: 1,
      rc: 137,
      startedAtMs: 1_000,
      exitedAtMs: 120_000,
      tailLines: []
    })).toBe("signal_exit");
    expect(classifyGatewayExit({
      pid: 1,
      rc: 1,
      startedAtMs: 1_000,
      exitedAtMs: 30_000,
      tailLines: []
    })).toBe("startup_crash");
    expect(classifyGatewayExit({
      pid: 1,
      rc: 1,
      startedAtMs: 1_000,
      exitedAtMs: 120_000,
      tailLines: ["autopilot ticker cycle failed"]
    })).toBe("tick_after_crash");
  });

  it("writes structured evidence JSON and append-only gateway exit index", async () => {
    const root = workspace();
    const evidence = await captureGatewayCrashEvidence(root, {
      pid: 4321,
      rc: 1,
      startedAtMs: Date.parse("2026-05-28T02:00:00.000Z"),
      exitedAtMs: Date.parse("2026-05-28T02:02:00.000Z"),
      tailLines: ["gateway starting", "autopilot run-cycle threw"]
    });

    expect(evidence).toMatchObject({
      pid: 4321,
      rc: 1,
      uptimeMs: 120_000,
      exitContext: "tick_after_crash"
    });
    const index = await readFile(crashEvidenceIndexPath(root), "utf8");
    expect(index).toContain("\"exitContext\":\"tick_after_crash\"");
    expect(index).toContain("\"file\":\"gateway-exit-2026-05-28T02-02-00-000Z-4321.json\"");
  });

  it("captures evidence from the supervisor helper CLI using the gateway log tail", async () => {
    const root = workspace();
    const logPath = join(root, "gateway.log");
    await writeFile(logPath, [
      "first line",
      "gateway running",
      "ticker cycle crashed"
    ].join("\n"), "utf8");

    const stdout = execFileSync("node", [
      "scripts/openclaw-supervisor-health.mjs",
      "crash-evidence",
      "--workspace",
      root,
      "--pid",
      "9876",
      "--rc",
      "1",
      "--started-at-ms",
      `${Date.parse("2026-05-28T03:00:00.000Z")}`,
      "--exited-at-ms",
      `${Date.parse("2026-05-28T03:02:00.000Z")}`,
      "--log",
      logPath,
      "--tail-lines",
      "2"
    ], { cwd: process.cwd(), encoding: "utf8" });

    expect(stdout).toContain("tick_after_crash");
    const index = await readFile(crashEvidenceIndexPath(root), "utf8");
    expect(index).toContain("\"pid\":9876");
    expect(index).toContain("ticker cycle crashed");
  });
});
