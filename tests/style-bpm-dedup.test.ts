import { describe, expect, it } from "vitest";
import { dedupeStyleBpm } from "../src/services/songSpawnProposer";

describe("spawn style BPM dedup", () => {
  it("removes BPM from styleNotes when tempo already carries the BPM", () => {
    const style = dedupeStyleBpm("tense urban jazz・142 BPM・BPM: 148・dry drums", "142 BPM");

    expect(style).toBe("tense urban jazz・dry drums");
    expect(style).not.toMatch(/\b\d{2,3}\s*BPM\b/i);
    expect(style).not.toMatch(/BPM:/i);
  });

  it("keeps only the first BPM when tempo is artist-decided", () => {
    const style = dedupeStyleBpm("BPM: 142, restrained hats, 148 BPM", "artist decides");

    expect(style).toContain("142");
    expect(style).not.toContain("148 BPM");
  });
});
