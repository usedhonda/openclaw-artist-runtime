import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeDailyVoice } from "../src/services/artistDailyVoiceComposer";
import { readResolvedConfig } from "../src/services/runtimeConfig";

describe("R10 daily voice redesign boundary", () => {
  it("composes URL-quoted daily voice without changing dry-run or live arm flags", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-r10-daily-redesign-"));
    await mkdir(join(root, "observations"), { recursive: true });
    await writeFile(join(root, "ARTIST.md"), "obsessions: 社会風刺\n", "utf8");
    await writeFile(join(root, "SOUL.md"), "tone: 短く刺す\n", "utf8");
    await writeFile(join(root, "observations", "2026-04-30.md"), [
      "- text: \"責任だけスクショの外に逃げている\"",
      "  author: \"observer\"",
      "  url: \"https://x.com/observer/status/3333333333\"",
      "  postedAt: \"2026-04-30T00:00:00.000Z\""
    ].join("\n"), "utf8");
    const before = await readResolvedConfig(root);

    const draft = await composeDailyVoice(root, { aiReviewProvider: "mock" });
    const after = await readResolvedConfig(root);

    expect(draft.draftText).toContain("https://x.com/observer/status/3333333333");
    expect(after.autopilot.dryRun).toBe(before.autopilot.dryRun);
    expect(after.distribution.liveGoArmed).toBe(before.distribution.liveGoArmed);
    expect(after.distribution.platforms.x.liveGoArmed).toBe(before.distribution.platforms.x.liveGoArmed);
    expect(after.distribution.platforms.instagram.liveGoArmed).toBe(before.distribution.platforms.instagram.liveGoArmed);
    expect(after.distribution.platforms.tiktok.liveGoArmed).toBe(before.distribution.platforms.tiktok.liveGoArmed);
  });
});
