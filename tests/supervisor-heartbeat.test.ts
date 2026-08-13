import { mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  autopilotHeartbeatPath,
  isSupervisorHeartbeatStale,
  readSupervisorHeartbeat,
  supervisorHeartbeatPath,
  writeAutopilotHeartbeat,
  writeSupervisorHeartbeat
} from "../src/services/supervisorHealth";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-supervisor-heartbeat-"));
}

describe("supervisor heartbeat artifacts", () => {
  it("writes supervisor heartbeat and detects stale timestamps", async () => {
    const root = workspace();
    const startedAt = new Date("2026-05-28T00:00:00.000Z");
    const now = new Date("2026-05-28T00:00:30.000Z");

    const heartbeat = await writeSupervisorHeartbeat(root, { pid: 1234, startedAt, now });

    expect(heartbeat).toEqual({
      timestamp: "2026-05-28T00:00:30.000Z",
      pid: 1234,
      uptimeMs: 30_000,
      startedAt: "2026-05-28T00:00:00.000Z"
    });
    expect(await readSupervisorHeartbeat(root)).toEqual(heartbeat);
    expect(await readFile(supervisorHeartbeatPath(root), "utf8")).toContain("\"pid\": 1234");
    expect(isSupervisorHeartbeatStale(heartbeat, {
      now: new Date("2026-05-28T00:00:45.000Z"),
      staleMs: 60_000
    })).toBe(false);
    expect(isSupervisorHeartbeatStale(heartbeat, {
      now: new Date("2026-05-28T00:01:31.000Z"),
      staleMs: 60_000
    })).toBe(true);
    expect(isSupervisorHeartbeatStale(undefined, { now, staleMs: 60_000 })).toBe(true);
  });

  it("records and preserves the live Gateway child across supervisor heartbeat refreshes", async () => {
    const root = workspace();
    const helper = "scripts/openclaw-supervisor-health.mjs";
    execFileSync("node", [helper, "heartbeat", "--workspace", root, "--pid", "1234", "--started-at-ms", "1000", "--child-pid", "5678", "--child-state", "running", "--child-started-at-ms", "2000"]);
    execFileSync("node", [helper, "heartbeat", "--workspace", root, "--pid", "1234", "--started-at-ms", "1000"]);

    const heartbeat = await readSupervisorHeartbeat(root);
    expect(heartbeat).toMatchObject({
      pid: 1234,
      gateway: { pid: 5678, state: "running" }
    });
    expect(heartbeat?.gateway?.uptimeMs).toBeGreaterThan(0);
  });

  it("writes autopilot heartbeat attempts and results without changing state machine semantics", async () => {
    const root = workspace();

    await writeAutopilotHeartbeat(root, {
      now: new Date("2026-05-28T01:00:00.000Z"),
      lastTickAttempt: "2026-05-28T01:00:00.000Z"
    });
    const heartbeat = await writeAutopilotHeartbeat(root, {
      now: new Date("2026-05-28T01:00:03.000Z"),
      lastTickResult: "ran",
      currentStage: "planning"
    });

    expect(heartbeat).toMatchObject({
      updatedAt: "2026-05-28T01:00:03.000Z",
      lastTickAttempt: "2026-05-28T01:00:00.000Z",
      lastTickResult: "ran",
      currentStage: "planning"
    });
    expect(await readFile(autopilotHeartbeatPath(root), "utf8")).toContain("\"currentStage\": \"planning\"");
  });
});
