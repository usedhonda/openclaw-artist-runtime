import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeVoiceTopOnly } from "../src/services/commandVoiceWrapper";

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-runid-seed-"));
  await mkdir(join(root, "observations"), { recursive: true });
  await mkdir(join(root, "artist"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "obsessions: 若者、コピー機、再開発\nsound: nu-jazz, low bass\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "Producer: ゆずるさん\nsentence_endings: だ。/な。/どう?\n", "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "Emotional weather: cold\n", "utf8");
  await writeFile(join(root, "observations", "2026-05-24.md"), [
    "- text: \"コピー機の夜に若者の疲れだけが光っていた\"",
    "  author: \"office_watcher\"",
    "  url: \"https://x.com/office_watcher/status/12345\"",
    "  postedAt: \"2026-05-24T00:00:00Z\"",
    "  motifMatch: \"若者/コピー機\"",
    "  motifScore: 9"
  ].join("\n"), "utf8");
  return root;
}

describe("voice runId seed", () => {
  it("keeps propose voice deterministic for the same runId and varies across runIds", async () => {
    const root = await workspace();
    const first = await composeVoiceTopOnly("propose", root, "propose", [], { runId: "spawn-fixed-a" });
    const firstAgain = await composeVoiceTopOnly("propose", root, "propose", [], { runId: "spawn-fixed-a" });
    const variants = await Promise.all([
      composeVoiceTopOnly("propose", root, "propose", [], { runId: "spawn-fixed-b" }),
      composeVoiceTopOnly("propose", root, "propose", [], { runId: "spawn-fixed-c" }),
      composeVoiceTopOnly("propose", root, "propose", [], { runId: "spawn-fixed-d" })
    ]);

    expect(firstAgain).toBe(first);
    expect([first, ...variants].some((value) => value !== first)).toBe(true);
    expect(first).toMatch(/コピー機|若者|office/);
  });
});
