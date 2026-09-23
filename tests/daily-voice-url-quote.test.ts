import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeDailyVoice, parseDailyVoiceObservations } from "../src/services/artistDailyVoiceComposer";

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-daily-url-"));
  await mkdir(join(root, "observations"), { recursive: true });
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "obsessions: 都市の違和感\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "tone: 観察して刺す\n", "utf8");
  await writeFile(join(root, "observations", "2026-04-30.md"), [
    "# X Observations 2026-04-30",
    "",
    "- text: \"再開発で小さい店がまた消えた\"",
    "  author: \"city_note\"",
    "  url: \"https://x.com/city_note/status/2222222222\"",
    "  postedAt: \"2026-04-30T00:00:00.000Z\""
  ].join("\n"), "utf8");
  await writeFile(join(root, "runtime", "heartbeat-state.json"), "{\"mood\":\"dry\"}\n", "utf8");
  return root;
}

describe("daily voice URL quote format", () => {
  it("parses structured observations and drafts opinion plus blank-line URL", async () => {
    const root = await workspace();
    const draft = await composeDailyVoice(root, { aiReviewProvider: "mock", now: new Date("2026-04-30T01:00:00.000Z") });
    const [opinion, url] = draft.draftText.split(/\n\n/);

    expect(opinion).toContain("再開発で小さい店");
    expect(url).toBe("https://x.com/city_note/status/2222222222");
    expect(draft.charCount).toBe(Array.from(opinion).length);
    expect(draft.selectedSource).toEqual({ author: "city_note", url });
  });

  it("returns no entries for legacy bullet observations", () => {
    expect(parseDailyVoiceObservations("- old bullet only")).toEqual([]);
  });
});
