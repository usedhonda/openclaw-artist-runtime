import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSongState, updateSongState } from "../src/services/artistState";
import { publishSocialAction } from "../src/services/socialPublishing";

describe("R10 degraded lyrics gate", () => {
  it("refuses publish when degradedLyrics is set without changing dry-run or live arm config", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-degraded-gate-"));
    await mkdir(join(root, "songs", "song-001", "social"), { recursive: true });
    await ensureSongState(root, "song-001", "Degraded Song");
    await updateSongState(root, "song-001", { degradedLyrics: true, status: "social_assets" });
    const config = {
      autopilot: { dryRun: true },
      distribution: {
        liveGoArmed: false,
        platforms: { x: { enabled: true, liveGoArmed: false, authority: "auto_publish" } }
      }
    };

    const { result, entry } = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      postType: "observation",
      text: "do not publish degraded lyrics",
      config
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("degraded lyrics");
    expect(entry.policyDecision.reason).toContain("degraded lyrics");
    expect(config.autopilot.dryRun).toBe(true);
    expect(config.distribution.liveGoArmed).toBe(false);
    expect(config.distribution.platforms.x.liveGoArmed).toBe(false);
  });
});
