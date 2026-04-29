import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DailyVoiceDraft } from "../src/types";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";

let aiRationale = "ARTIST.md の obsession「都市の違和感」と SOUL.md の tone「観察して刺す」に基づき、observation「再開発で小さい店がまた消えた」を街の記憶への違和感として artist の声に変換した。";
let aiOutputOverride: string | undefined;

vi.mock("../src/services/aiProviderClient", () => ({
  callAiProvider: vi.fn(async () => aiOutputOverride ?? [
      "selected_url: https://x.com/city_note/status/2222222222",
      "selected_author: city_note",
      "opinion: 小さい店が消える話は、街の記憶を誰が保管するのかって問いに見える。",
      `rationale: ${aiRationale}`
    ].join("\n"))
}));

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-daily-rationale-"));
  await mkdir(join(root, "observations"), { recursive: true });
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "obsessions: 都市の違和感\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "tone: 観察して刺す\n", "utf8");
  await writeFile(join(root, "observations", "2026-04-30.md"), [
    "- text: \"再開発で小さい店がまた消えた\"",
    "  author: \"city_note\"",
    "  url: \"https://x.com/city_note/status/2222222222\"",
    "  postedAt: \"2026-04-30T00:00:00.000Z\""
  ].join("\n"), "utf8");
  return root;
}

describe("daily voice rationale", () => {
  afterEach(() => {
    aiRationale = "ARTIST.md の obsession「都市の違和感」と SOUL.md の tone「観察して刺す」に基づき、observation「再開発で小さい店がまた消えた」を街の記憶への違和感として artist の声に変換した。";
    aiOutputOverride = undefined;
  });

  it("parses AI rationale and source fields into the draft", async () => {
    const { composeDailyVoice } = await import("../src/services/artistDailyVoiceComposer");
    const draft = await composeDailyVoice(await workspace(), { aiReviewProvider: "openai-codex" });

    expect(draft.draftText).toContain("小さい店が消える話");
    expect(draft.draftText).toContain("https://x.com/city_note/status/2222222222");
    expect(draft.selectedSource).toEqual({ author: "city_note", url: "https://x.com/city_note/status/2222222222" });
    expect(draft.rationale).toContain("都市の違和感");
    expect(draft.rationale).toContain("SOUL.md");
    expect(draft.rationale).toContain("observation");
  });

  it("generates fallback rationale in mock mode", async () => {
    const { composeDailyVoice } = await import("../src/services/artistDailyVoiceComposer");
    const draft = await composeDailyVoice(await workspace(), { aiReviewProvider: "mock" });

    expect(draft.rationale).toContain("ARTIST.md");
    expect(draft.rationale).toContain("SOUL.md");
  });

  it("replaces English provider rationale with a Japanese structured fallback", async () => {
    aiRationale = "Picked the government WhatsApp groups observation.";
    const { composeDailyVoice } = await import("../src/services/artistDailyVoiceComposer");
    const draft = await composeDailyVoice(await workspace(), { aiReviewProvider: "openai-codex" });

    expect(draft.rationale).toContain("ARTIST.md");
    expect(draft.rationale).toContain("SOUL.md");
    expect(draft.rationale).toContain("observation");
    expect(draft.rationale).not.toContain("Picked");
  });

  it("does not let same-line selected_url none leak into rationale", async () => {
    aiOutputOverride = [
      "selected_url: none",
      "selected_author: city_note",
      "opinion: 街の記憶が消える速度だけ、妙に正確になってる。",
      "rationale: ARTIST.md の obsession「都市の違和感」と SOUL.md の tone「観察して刺す」に基づき、observation「再開発で小さい店がまた消えた」を街の記憶への違和感として artist の声に変換した。 selected_url: none"
    ].join("\n");
    const { composeDailyVoice } = await import("../src/services/artistDailyVoiceComposer");
    const draft = await composeDailyVoice(await workspace(), { aiReviewProvider: "openai-codex" });

    expect(draft.rationale).not.toContain("selected_url");
  });

  it("does not let same-line selected_url with URL leak into rationale", async () => {
    aiOutputOverride = [
      "selected_url: none",
      "selected_author: city_note",
      "opinion: 小さい店の消え方だけ、街の議事録みたいに残る。",
      "rationale: ARTIST.md の obsession「都市の違和感」と SOUL.md の tone「観察して刺す」に基づき、observation「再開発で小さい店がまた消えた」を街の記憶への違和感として artist の声に変換した。 selected_url: https://x.com/city_note/status/3333333333"
    ].join("\n");
    const { composeDailyVoice } = await import("../src/services/artistDailyVoiceComposer");
    const draft = await composeDailyVoice(await workspace(), { aiReviewProvider: "openai-codex" });

    expect(draft.rationale).not.toContain("selected_url");
    expect(draft.rationale).not.toContain("https://x.com/city_note/status/3333333333");
  });

  it("shows rationale in Telegram preview and omits it when absent", async () => {
    const base: DailyVoiceDraft = {
      voiceKind: "quote",
      draftText: "街の記憶は、消えてから急に公共物みたいな顔をする。\n\nhttps://x.com/city_note/status/2222222222",
      draftHash: "1234567890abcdef",
      charCount: 28,
      sourceFragments: [],
      selectedSource: { author: "city_note", url: "https://x.com/city_note/status/2222222222" },
      createdAt: "2026-04-30T00:00:00.000Z"
    };

    const withRationale = await formatRuntimeEvent({ type: "artist_pulse_drafted", ...base, rationale: "persona と observation が重なった。", timestamp: 1 });
    expect(withRationale).toContain("💭 観察元: @city_note (URL あり)");
    expect(withRationale).toContain("🎯 なぜ: persona と observation が重なった。");
    expect(withRationale).not.toContain("💭 なぜ:");

    const withoutRationale = await formatRuntimeEvent({ type: "artist_pulse_drafted", ...base, timestamp: 1 });
    expect(withoutRationale).not.toContain("🎯 なぜ:");
  });
});
