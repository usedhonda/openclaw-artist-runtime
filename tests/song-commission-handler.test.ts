import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handleCommission } from "../src/services/songCommissionHandler";

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-commission-handler-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "Current obsession: cities disappearing.\n", "utf8");
  await writeFile(join(root, "artist", "SONGBOOK.md"), "# SONGBOOK.md\n", "utf8");
  return root;
}

describe("song commission handler", () => {
  it("turns producer free text into a commission ChangeSet proposal", async () => {
    const root = await workspace();
    const result = await handleCommission(root, {
      brief: "都市の境界線で見えなくなる音、4 分くらい、太い bass + jazz drum",
      now: new Date("2026-04-29T01:00:00.000Z")
    });

    expect(result.proposal.id).toMatch(/^commission-commission_/);
    expect(result.proposal.source).toBe("commission");
    expect(result.proposal.commissionBrief?.songId).toMatch(/^commission_/);
    expect(result.proposal.fields.map((field) => field.field)).toEqual([
      "songId",
      "title",
      "brief",
      "lyricsTheme",
      "mood",
      "tempo",
      "duration",
      "style"
    ]);
    expect(result.commissionBrief.duration).toBe("4 分");
    expect(result.commissionBrief.styleNotes).toContain("bass");
  });

  it("rejects secret-like commission input before building a proposal", async () => {
    const root = await workspace();

    await expect(handleCommission(root, {
      brief: `notes: ${["TELEGRAM", "BOT", "TOKEN"].join("_")}=do-not-store`
    })).rejects.toThrow("commission_secret_like_input");
  });
});
