import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { secretLikePattern } from "../src/services/personaMigrator";
import { readResolvedConfig } from "../src/services/runtimeConfig";

describe("R10 secret pattern boundary", () => {
  it("tightens matching without changing dry-run or live arm flags", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-r10-secret-pattern-"));
    const before = await readResolvedConfig(root);

    expect(secretLikePattern.test("API key、cookie、token、実行ログ")).toBe(false);
    expect(secretLikePattern.test("API_KEY=xyz123abc")).toBe(true);

    const after = await readResolvedConfig(root);
    expect(after.autopilot.dryRun).toBe(before.autopilot.dryRun);
    expect(after.distribution.liveGoArmed).toBe(before.distribution.liveGoArmed);
    expect(after.distribution.platforms.x.liveGoArmed).toBe(before.distribution.platforms.x.liveGoArmed);
    expect(after.distribution.platforms.instagram.liveGoArmed).toBe(before.distribution.platforms.instagram.liveGoArmed);
    expect(after.distribution.platforms.tiktok.liveGoArmed).toBe(before.distribution.platforms.tiktok.liveGoArmed);
  });
});
