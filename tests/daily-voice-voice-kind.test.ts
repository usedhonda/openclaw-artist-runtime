import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeDailyVoice } from "../src/services/artistDailyVoiceComposer";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";
import type { DailyVoiceDraft } from "../src/types";

async function workspace(withUrl: boolean): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-daily-kind-"));
  await mkdir(join(root, "observations"), { recursive: true });
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "obsessions: 街の違和感\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "tone: 短く観察\n", "utf8");
  await writeFile(join(root, "observations", "2026-04-30.md"), [
    "- text: \"小さい劇場の灯りが消えた\"",
    "  author: \"stage_note\"",
    `  url: ${withUrl ? "\"https://x.com/stage_note/status/4444444444\"" : "null"}`,
    "  postedAt: \"2026-04-30T00:00:00.000Z\""
  ].join("\n"), "utf8");
  return root;
}

function event(draft: DailyVoiceDraft): Parameters<typeof formatRuntimeEvent>[0] {
  return { type: "artist_pulse_drafted", ...draft, timestamp: 1 };
}

describe("daily voice kind labels", () => {
  it("marks URL-backed daily voice as quote", async () => {
    const draft = await composeDailyVoice(await workspace(true), { aiReviewProvider: "mock" });
    const text = await formatRuntimeEvent(event(draft));

    expect(draft.voiceKind).toBe("quote");
    expect(text.startsWith("🔁 引用ポスト draft:")).toBe(true);
  });

  it("marks URL-less daily voice as musing", async () => {
    const draft = await composeDailyVoice(await workspace(false), { aiReviewProvider: "mock" });
    const text = await formatRuntimeEvent(event(draft));

    expect(draft.voiceKind).toBe("musing");
    expect(text.startsWith("💭 つぶやき draft:")).toBe(true);
    expect(text).toContain("🎯 なぜ:");
    expect(text).not.toContain("💭 なぜ:");
  });

  it("formats future studio whisper events with a distinct label", async () => {
    const text = await formatRuntimeEvent({
      type: "artist_pulse_drafted",
      voiceKind: "studio_whisper",
      draftText: "制作中、低いベースだけ先に歩いていった。",
      draftHash: "1234567890abcdef",
      charCount: 22,
      sourceFragments: [],
      createdAt: "2026-04-30T00:00:00.000Z",
      timestamp: 1
    });

    expect(text.startsWith("🎵 制作中のひとこと draft:")).toBe(true);
  });
});
