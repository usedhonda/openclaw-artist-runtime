import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, updateSongState, writeSongBrief } from "../src/services/artistState";
import { ArtistAutopilotService } from "../src/services/autopilotService";
import { readResolvedConfig } from "../src/services/runtimeConfig";

describe("R10 take select boundary", () => {
  it("selects a take without changing dry-run or live arm flags", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-r10-take-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "r10-take", "R10 Take");
    await writeSongBrief(root, "r10-take", "# Brief\nMood: cold\nStyle notes: bass");
    await updateSongState(root, "r10-take", { status: "takes_imported" });
    await mkdir(join(root, "songs", "r10-take", "lyrics"), { recursive: true });
    await writeFile(join(root, "songs", "r10-take", "lyrics", "lyrics.v1.md"), "hook chorus", "utf8");
    await mkdir(join(root, "songs", "r10-take", "suno"), { recursive: true });
    await writeFile(join(root, "songs", "r10-take", "suno", "latest-results.json"), JSON.stringify({ runId: "run-1", urls: ["https://suno.example/good-bass-cold-hook"] }), "utf8");
    const before = await readResolvedConfig(root);

    await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } }
    });
    const after = await readResolvedConfig(root);

    expect(after.autopilot.dryRun).toBe(before.autopilot.dryRun);
    expect(after.distribution.liveGoArmed).toBe(before.distribution.liveGoArmed);
    expect(after.distribution.platforms.x.liveGoArmed).toBe(before.distribution.platforms.x.liveGoArmed);
  });
});
