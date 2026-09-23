import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAlertsResponse, buildPlatformDetailResponse, buildPlatformsResponse, buildRecoveryResponse } from "../src/routes";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { patchResolvedConfig } from "../src/services/runtimeConfig";

describe("persisted config across helper routes", () => {
  it("uses persisted authority overrides in platform helpers", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-platform-override-"));
    await ensureArtistWorkspace(root);
    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root },
      distribution: {
        platforms: {
          x: { authority: "draft_only", enabled: true }
        }
      }
    });

    const platforms = await buildPlatformsResponse({
      artist: { workspaceRoot: root }
    });
    const detail = await buildPlatformDetailResponse("x", {
      artist: { workspaceRoot: root }
    });

    expect(platforms.x.authority).toBe("draft_only");
    expect(detail.authority).toBe("draft_only");
  });

  it("uses persisted platform enablement in alerts", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-alert-override-"));
    await ensureArtistWorkspace(root);
    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root },
      distribution: {
        enabled: true,
        platforms: {
          instagram: { enabled: true }
        }
      }
    });

    const alerts = await buildAlertsResponse({
      artist: { workspaceRoot: root }
    });

    expect(alerts.some((alert) => alert.message.includes("instagram is enabled but has no confirmed publish capability"))).toBe(true);
  });

  it("uses persisted dry-run overrides in recovery diagnostics", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-recovery-override-"));
    await ensureArtistWorkspace(root);
    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: false, cycleIntervalMinutes: 15 }
    });

    const recovery = await buildRecoveryResponse({
      artist: { workspaceRoot: root }
    });

    expect(recovery.diagnostics.workspaceRoot).toBe(root);
    expect(recovery.diagnostics.dryRun).toBe(false);
    expect(recovery.autopilot.enabled).toBe(true);
  });
});
