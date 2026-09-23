import { describe, expect, it } from "vitest";
import { validatePlanningCompleteness } from "../src/services/planningSkeletonValidator";

const completeBrief = [
  "# Brief",
  "- Mood: cold",
  "- Tempo: 128 BPM",
  "- Duration: 4 分",
  "- Style notes: thick bass",
  "- Lyrics theme: small venues erased by redevelopment"
].join("\n");

describe("planning skeleton validator", () => {
  it("accepts a complete planning skeleton", async () => {
    const result = await validatePlanningCompleteness("song-a", "# Song A", completeBrief);

    expect(result).toEqual({ complete: true, missing: [] });
  });

  it("drafts a completion proposal for missing planning fields", async () => {
    const result = await validatePlanningCompleteness("song-b", "# Song B", "# Brief\n- Mood: cold", {
      aiReviewProvider: "mock",
      now: new Date("2026-04-29T00:00:00.000Z")
    });

    expect(result.complete).toBe(false);
    expect(result.missing).toContain("tempo");
    expect(result.suggestions?.completedBrief).toContain("Planning Completion");
    expect(result.proposal?.fields[0]).toMatchObject({ field: "brief", targetFile: "songs/song-b/brief.md" });
  });

  it("rejects secret-like input before drafting", async () => {
    await expect(validatePlanningCompleteness("song-c", "# Song C", `${["TELEGRAM", "BOT", "TOKEN"].join("_")}=12345678`)).rejects.toThrow("planning_skeleton_secret_like_input");
  });
});
